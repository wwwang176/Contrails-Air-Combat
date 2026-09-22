/**
 * 撤離任務的參數掃描。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/evacuate.probe.ts
 *
 * ══ 這一輪量得到什麼、量不到什麼 ══
 *
 * `AiController`（`src/ai/AiController.ts`）**只認識敵機、站位與 `FlightOrder`，
 * 完全沒有任務目標的輸入**。所以「AI 代飛的撤離
 * 到達率」量出來的是「戰鬥 AI 恰好飛進圓環的機率」—— 那個數字不能用來定
 * 距離與時限。
 *
 * **量得到的是兩個界**，而這兩個界足以定出起始值：
 *
 *   下界（時間）  帶槍、會被追打、但**不迴避**的直飛 → 路徑要飛多久的下限
 *   難度讀數      同一場的存活數 → 頂著 16 架追打能不能活著飛完
 *
 * **量不到「一邊打一邊走」** —— 那需要 AI 長出撤離行為，屬於下一輪
 * （spec §10 第 3 條）。
 *
 * ══ 三張表 ══
 *
 *   一、撤離點距離 × 到達時間
 *   二、架數 × 存活
 *   三、抵達半徑 × 判定精度與螢幕佔比
 */
import { Vector3 } from 'three'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { ENTRY_PLANS } from '../../src/battle/entry'
import { lineAbreast, sideSummary } from '../../src/battle/order'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { CAMERA_FOV_DEG } from '../../src/render/scene'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { DEFAULT_BATTLE, type BattleConfig } from '../../src/battle/setup'
import { VETERAN } from '../../src/ai/profile'

const DT = 1 / 240
/**
 * 這支探針自己建的撤離設定。
 *
 * 【為什麼不從 `MISSIONS` 找】12 關裡沒有撤離卡 —— 那個玩法的使用者是德 M3
 * 的返航節拍。但這支探針量的是**幾何**（距離 × 到達時間、抵達半徑），
 * 那與有沒有一張卡在用它無關，而且量出來的數字正是德 M3 的時限所依據的。
 */
const CARD = {
  blueCount: 4, redCount: 16, targetRadius: 1000,
  entry: 'pursuit' as const,
  blueSpec: P51D, redSpec: BF109K4,
  targetDistance: 20000,
}

/** 一路朝撤離點飛，不開火、不迴避 */
class Runner implements Controller {
  readonly point = new Vector3()
  private readonly aim = new Vector3()
  update(self: Aircraft, _dt: number, out: Command): void {
    out.throttle = WEP_THROTTLE
    out.brake = 0
    out.firing = false
    this.aim.copy(this.point).sub(self.state.position).normalize()
    out.aimWorld.copy(this.aim)
  }
}

interface Run {
  /** 到達的秒數；沒到就是 −1 */
  seconds: number
  outcome: string
  aliveBlue: number
  aliveRed: number
  /** 第一次判到達的那一步、離圓心多遠。沒到就是 NaN */
  hitDistance: number
  /** 玩家活著到終點嗎 */
  playerAlive: boolean
}

/**
 * 跑一場，回報到達秒數。
 *
 * 【時限一律給 `Infinity`】這些表要量的是「**要飛多久**」，不是「有沒有在
 * 時限內飛完」。時限反過來由這裡的數字推 —— 拿一個待定的時限去量它自己，
 * 就是「照著現況畫靶」。
 *
 * 【上限給距離 ÷ 80 m/s 的兩倍】80 是被打殘之後仍然飛得動的巡航下界。
 * 兩倍餘裕讓「飛不到」與「跑不完」分得開。
 */
function runTimed(
  distance: number, radius: number, blue: number, red: number, tas: number,
): Run {
  const base: BattleConfig = {
    ...DEFAULT_BATTLE,
    units: lineAbreast(ENTRY_PLANS[CARD.entry], CARD.blueSpec, CARD.blueCount,
      CARD.redSpec, CARD.redCount),
    aiProfile: VETERAN,
  }
  const point = new Vector3(0, base.altitude, -distance)
  const ctl = new Runner()
  ctl.point.copy(point)
  const b: Battle = createBattle(ctl, {
    ...base,
    // 【架數要重新組一張表】沒有 `blueCount` / `redCount` 可以覆寫。
    // 機種與擺法沿用那張卡的（`CARD.entry` 是 `ENTRY_PLANS` 的鍵）
    units: lineAbreast(
      ENTRY_PLANS[CARD.entry], CARD.blueSpec, blue, CARD.redSpec, red),
    tas,
    rules: { kind: 'evacuate', point, radius, seconds: Infinity },
  })
  const cap = Math.round((distance / 80) * 2 * 240)
  let steps = 0
  for (let i = 0; i < cap; i++) {
    stepBattle(b, DT)
    steps = i + 1
    if (b.outcome !== 'fighting') break
  }
  const done = b.outcome === 'victory'
  return {
    seconds: done ? steps * DT : -1,
    outcome: b.outcome,
    aliveBlue: b.blue.filter((c) => c.alive).length,
    aliveRed: b.red.filter((c) => c.alive).length,
    hitDistance: done ? b.mission.metric : NaN,
    playerAlive: b.player.alive,
  }
}

function pad(s: string | number, n: number): string {
  return String(s).padStart(n)
}

// ═════════════════════════════════════════════════════════
console.log(`
══ 一、撤離點距離 × 到達時間（直飛、藍 ${CARD.blueCount} 紅 ${CARD.redCount}、半徑 ${CARD.targetRadius} m）══
【時限的候選是「到達秒數 × 餘裕」】餘裕太小 → 直飛都到不了；太大 → 時限形同虛設

  距離 km   到達 s   我方剩   敵方剩   玩家活   ×1.2    ×1.4    ×1.6`)
for (const d of [12000, 16000, 20000, 25000, 30000]) {
  const r = runTimed(d, CARD.targetRadius, CARD.blueCount, CARD.redCount, 200)
  const t = r.seconds
  console.log(
    `${pad((d / 1000).toFixed(0), 9)}`
    + `${pad(t < 0 ? '未到' : t.toFixed(1), 9)}`
    + `${pad(`${r.aliveBlue}/${CARD.blueCount}`, 9)}`
    + `${pad(`${r.aliveRed}/${CARD.redCount}`, 9)}`
    + `${pad(r.playerAlive ? '是' : '否', 8)}`
    + `${pad(t < 0 ? '—' : (t * 1.2).toFixed(0), 8)}`
    + `${pad(t < 0 ? '—' : (t * 1.4).toFixed(0), 8)}`
    + `${pad(t < 0 ? '—' : (t * 1.6).toFixed(0), 8)}`,
  )
}

// ═════════════════════════════════════════════════════════
console.log(`
══ 二、架數 × 存活（直飛、距離 ${CARD.targetDistance / 1000} km）══
【為什麼變異用開局空速而不是種子】createBattle 的 seed 只配飛行員名字、
不進物理路徑（M9 spec §6.2），同一組設定跑五次是逐位元相同的。要有變異
必須改設定本身。

  藍/紅     180     190     200     210     220   ← 開局 TAS m/s，格內是「我方剩/玩家活」`)
for (const [blue, red] of [[4, 8], [4, 12], [4, 16], [4, 20], [6, 16]] as const) {
  let line = pad(`${blue}/${red}`, 7)
  for (const tas of [180, 190, 200, 210, 220]) {
    const r = runTimed(CARD.targetDistance, CARD.targetRadius, blue, red, tas)
    line += pad(`${r.aliveBlue}${r.playerAlive ? '✓' : '✗'}`, 8)
  }
  console.log(line)
}

// ═════════════════════════════════════════════════════════
const SCREEN_AT = 20000
console.log(`
══ 三、抵達半徑 × 判定精度與螢幕佔比 ══
【判定精度】第一次判到達那一步離圓心多遠。它必須明顯小於半徑 ——
若逼近半徑，代表一個物理步就跨過了整個判定殼，快速通過時會漏判。

  半徑 m   判到達時的距離 m   差 m   ${SCREEN_AT / 1000} km 外佔螢幕高度`)
for (const radius of [500, 1000, 1500, 2000]) {
  const r = runTimed(CARD.targetDistance, radius, CARD.blueCount, CARD.redCount, 200)
  const share = (2 * Math.atan(radius / SCREEN_AT) * 180 / Math.PI) / CAMERA_FOV_DEG
  console.log(
    `${pad(radius, 8)}`
    + `${pad(Number.isNaN(r.hitDistance) ? '未到' : r.hitDistance.toFixed(0), 19)}`
    + `${pad(Number.isNaN(r.hitDistance) ? '—' : (radius - r.hitDistance).toFixed(0), 7)}`
    + `${pad(`${(share * 100).toFixed(1)}%`, 18)}`,
  )
}

// ═════════════════════════════════════════════════════════
/**
 * 【為什麼要分陣營量】同盟國那張卡玩家開 P-51 —— **全場最快的東西**，
 * 對頭交錯之後 16 架 Bf109 得反轉再追，追不上。軸心國那張卡反過來：
 * 玩家開 Bf109，追他的是更快的 P-51。同一組參數在兩張卡上可能是兩種難度。
 */
console.log(`
══ 四、陣營不對稱（直飛、距離 ${CARD.targetDistance / 1000} km、藍 4 紅 16）══

  陣營     我機      追兵      到達 s   我方剩   玩家活`)
for (const [label, mineSpec, theirsSpec] of [
  ['同盟國', P51D, BF109K4],
  ['軸心國', BF109K4, P51D],
] as const) {
  const card = { ...CARD, blueSpec: mineSpec, redSpec: theirsSpec }
  const base: BattleConfig = {
    ...DEFAULT_BATTLE,
    units: lineAbreast(ENTRY_PLANS[card.entry], card.blueSpec, card.blueCount,
      card.redSpec, card.redCount),
    aiProfile: VETERAN,
  }
  const point = new Vector3(0, base.altitude, -card.targetDistance)
  const ctl = new Runner()
  ctl.point.copy(point)
  const b: Battle = createBattle(ctl, {
    ...base,
    rules: { kind: 'evacuate', point, radius: card.targetRadius, seconds: Infinity },
  })
  const cap = Math.round((card.targetDistance / 80) * 2 * 240)
  let steps = 0
  for (let i = 0; i < cap; i++) {
    stepBattle(b, DT)
    steps = i + 1
    if (b.outcome !== 'fighting') break
  }
  const done = b.outcome === 'victory'
  console.log(
    `${pad(label, 7)}`
    + `${pad(sideSummary(base.units, 'blue'), 9)}`
    + `${pad(sideSummary(base.units, 'red'), 10)}`
    + `${pad(done ? (steps * DT).toFixed(1) : '未到', 9)}`
    + `${pad(`${b.blue.filter((c) => c.alive).length}/${card.blueCount}`, 9)}`
    + `${pad(b.player.alive ? '是' : '否', 8)}`,
  )
}
