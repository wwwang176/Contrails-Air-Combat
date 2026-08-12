/**
 * 「原地垂直繞圈」的**時間軸**。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/stall-loop-trace.probe.ts
 *
 * `stall-loop.probe.ts` 回答「有多常發生」，這一支回答「發生的時候到底
 * 在跑哪一條路徑」。
 *
 * 【為什麼可以兩趟】模擬是決定性的 —— 種子只決定飛行員名字，不進任何
 * 物理路徑，同一個開局重跑逐位元相同。所以第一趟找出「最糟的那一架、
 * 那一段」，第二趟原封不動再跑一次、只在那個區間印細節，不必把 40 架
 * 的完整時間軸都留在記憶體裡。
 *
 * 【要看什麼】`(意圖, 幾何模式)` 這一對。幾何模式**壓過**意圖，所以
 * 「AI 現在在做什麼」不是意圖單獨決定的：`extend` 壓機頭是意圖，
 * `speedRecover` 壓機頭是模式，兩者的時間軸混在一起才看得出迴路。
 *
 * 【只看長機】僚機走的是站位保持（`stationCommand`），那條路徑有自己的
 * 速度控制器，會產生自己的振盪 —— 兩者混在一起看不出東西。長機以
 * `stationReference === null` 判定。
 *
 * 【`LONE_ONLY`：只找附近沒有敵機的】人工試飛回報的情境是「戰鬥區域已經
 * 遠離，長機還在原地垂直繞圈」。那個情境下 `overshoot` 閘門
 * （距離 < 120 m 且正在接近）**結構上不可能觸發**，所以它是另一條路徑的
 * 毛病。打開這個開關才找得到 —— 不然搜出來的永遠是纏鬥中的那些。
 *
 * 【`intent` 與 `mode` 在早退路徑上是過期值】沒有目標的三條分支（站位、
 * 集合、平飛）直接寫 `aimWorld` 然後 return，不更新那兩個欄位，所以它們
 * 留著上一次有目標時的值。**表裡多印一欄「有沒有目標」就是為了這件事** ——
 * 第一版沒有，於是把一段站位保持誤讀成 `extend`。
 */
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { cornerSpeed, stallSpeed } from '../../src/analysis/envelope'
import { extendPitchAngle, DEFAULT_STEER } from '../../src/ai/steer'
import type { Combatant } from '../../src/world/World'

// 【為什麼可以調長】人工回報的情境是「戰鬥區域已經遠離」，那要等到大半
// 陣亡、殘存者散開才會出現 —— 180 秒的 20v20 全程黏在一起，最孤立的繞圈
// 段落旁邊仍然有一架敵機在 147 m。
const DT = 1 / 240
const SECONDS = 600
const SEED = 20260811
const RAD = 180 / Math.PI
const STRIDE = 24
const WINDOW = 20
/** 印出來的區間要比判定視窗長 —— 迴路的起因在視窗開始之前 */
const TRACE_PAD = 30
const FLIP_ANGLE = 15 / RAD
const windowSamples = Math.round(WINDOW / (DT * STRIDE))

interface Worst {
  index: number; startSample: number; straight: number; flips: number
  /** 該視窗內「最近的敵機」的最小值，m。大 = 這一段真的是孤立的 */
  lonely: number
}

/**
 * 最近的活著的敵機距離，m。
 *
 * 【為什麼不用硬門檻篩】先寫成「整個視窗都沒有敵機在 1500 m 內」，在 20v20
 * 的預設開局裡**一個視窗都找不到** —— 40 架由 10 km 對進，全程黏在一起。
 * 改成「在所有繞圈視窗裡挑最孤立的那一個」，不必先猜距離該定多少。
 */
function nearestEnemy(cs: readonly Combatant[], me: Combatant): number {
  let best = Infinity
  for (const o of cs) {
    if (!o.alive || o.team === me.team || o.index === me.index) continue
    const d = o.aircraft.state.position.distanceTo(me.aircraft.state.position)
    if (d < best) best = d
  }
  return best
}

/** 第一趟：找出直線度最低、且視窗內至少翻轉兩次的那一段。 */
function findWorst(): Worst {
  const b = createBattle(new AiController(), DEFAULT_BATTLE, SEED)
  const cs = b.world.combatants
  const st = cs.map(() => ({
    sign: 0, flips: 0, n: 0, path: 0, start: new Vector3(), prev: new Vector3(),
    lonely: Infinity,
  }))
  for (let i = 0; i < cs.length; i++) {
    st[i]!.start.copy(cs[i]!.aircraft.state.position)
    st[i]!.prev.copy(cs[i]!.aircraft.state.position)
  }
  // 【排序判準是「孤立程度」不是直線度】人工回報的情境是「戰鬥區域已經
  // 遠離，長機還在繞圈」，所以要找的是離敵機最遠的那個繞圈段落。
  let worst: Worst = { index: -1, startSample: 0, straight: 2, flips: 0, lonely: -1 }
  let sample = 0
  for (let s = 0; s < Math.round(SECONDS / DT); s++) {
    stepBattle(b, DT)
    if (s % STRIDE !== 0) continue
    sample++
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      if (!c.alive) continue
      const t = st[i]!
      // 【只找長機】見檔頭
      if ((c.controller as AiController).stationReference !== null) continue
      const near = nearestEnemy(cs, c)
      if (near < t.lonely) t.lonely = near
      const pos = c.aircraft.state.position
      const vel = c.aircraft.state.velocity
      const speed = vel.length()
      const gamma = speed > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, vel.y / speed))) : 0
      if (gamma > FLIP_ANGLE && t.sign !== 1) { if (t.sign === -1) t.flips++; t.sign = 1 }
      else if (gamma < -FLIP_ANGLE && t.sign !== -1) { if (t.sign === 1) t.flips++; t.sign = -1 }
      t.path += Math.hypot(pos.x - t.prev.x, pos.z - t.prev.z)
      t.prev.copy(pos)
      t.n++
      if (t.n >= windowSamples) {
        const net = Math.hypot(pos.x - t.start.x, pos.z - t.start.z)
        const straight = t.path > 1 ? net / t.path : 1
        if (t.flips >= 2 && straight < 0.3 && t.lonely > worst.lonely) {
          worst = {
            index: i, startSample: sample - windowSamples, straight, flips: t.flips,
            lonely: t.lonely,
          }
        }
        t.start.copy(pos)
        t.path = 0
        t.n = 0
        t.flips = 0
        t.lonely = Infinity
      }
    }
  }
  return worst
}

const worst = findWorst()
if (worst.index < 0) {
  console.log('找不到符合條件的視窗（翻轉 ≥2 且直線度最低）')
} else {
  console.log(`最糟的視窗：第 ${worst.index} 架　t = ${(worst.startSample * DT * STRIDE).toFixed(1)}`
    + `–${((worst.startSample + windowSamples) * DT * STRIDE).toFixed(1)} s`
    + `　直線度 ${worst.straight.toFixed(3)}　翻轉 ${worst.flips} 次`
    + `　整段最近的敵機 ${worst.lonely.toFixed(0)} m`)
  console.log('')

  // 第二趟：同一個開局原封不動再跑，只印那一架在那一段的細節
  const b = createBattle(new AiController(), DEFAULT_BATTLE, SEED)
  const c = b.world.combatants[worst.index]!
  const padSamples = Math.round(TRACE_PAD / (DT * STRIDE))
  const from = Math.max(1, worst.startSample - padSamples)
  const to = worst.startSample + windowSamples + padSamples
  console.log(`  t(s)   TAS  高度   γ   目標 意圖      模式        corner  sweet  油門/煞  敵距 ┃ 目標: id  TAS  高度    γ   距我`)
  let sample = 0
  for (let s = 0; s < Math.round(SECONDS / DT); s++) {
    stepBattle(b, DT)
    if (s % STRIDE !== 0) continue
    sample++
    if (sample < from || sample > to) continue
    const a = c.aircraft
    const ai = c.controller as AiController
    const alt = a.state.position.y
    const vel = a.state.velocity
    const speed = vel.length()
    const gamma = speed > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, vel.y / speed))) * RAD : 0
    const tas = a.diag.aero.tas
    const corner = tas / cornerSpeed(a.spec, alt)
    const speedM = tas / Math.max(stallSpeed(a.spec, alt, 1), 1)
    // `extend` 若在跑，它命令的航跡角是多少（不管現在是不是 extend）
    void extendPitchAngle; void DEFAULT_STEER; void speedM

    /** 目標的狀態 —— 「我在追一個也在上下跑的東西嗎」是首要嫌疑 */
    function tgtLine(ctl: AiController, me: typeof a): string {
      const t = ctl.target
      if (t === null) return '（無目標）'
      const tv = t.state.velocity
      const tsp = tv.length()
      const tg = tsp > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, tv.y / tsp))) * RAD : 0
      const idx = b.world.combatants.findIndex((o) => o.aircraft === t)
      return `#${String(idx).padStart(2)} ${(t.diag.aero.tas * 3.6).toFixed(0).padStart(4)}`
        + `${t.state.position.y.toFixed(0).padStart(7)}`
        + `${tg.toFixed(0).padStart(5)}°`
        + `${t.state.position.distanceTo(me.state.position).toFixed(0).padStart(6)}`
    }
    console.log(
      `${(sample * DT * STRIDE).toFixed(1).padStart(6)}`
      + `${(tas * 3.6).toFixed(0).padStart(6)}`
      + `${alt.toFixed(0).padStart(6)}`
      + `${gamma.toFixed(0).padStart(5)}°`
      + `  ${ai.target === null ? ' 無 ' : ' 有 '}`
      + `${ai.intent.padEnd(9)}`
      + ` ${ai.mode.padEnd(13)}`
      + `${corner.toFixed(2).padStart(6)}`
      + `${speedM.toFixed(2).padStart(8)}`
      + `${(ai.sit.sweetPitch * RAD).toFixed(0).padStart(6)}°`
      + `  ${c.command.throttle.toFixed(2)}/${c.command.brake.toFixed(2)}`
      + `  ${nearestEnemy(b.world.combatants, c).toFixed(0).padStart(5)}`
      + ` ┃ ${tgtLine(ai, a)}`,
    )
    if (sample > to) break
  }
}
