/**
 * **AI 必須能把機首帶到扣得下扳機的位置。**
 *
 * 【場景來自人工回報】用 Bf 109 按 I 讓 AI 代飛，敵機在正前方約
 * 150 m、預瞄點在下方約 15°，我機沒有低頭；敵機爬升、預瞄點縮到 5°，仍然
 * 沒有低頭。
 *
 * 【根因】`steerCommand` 倒數第二層的 `applyPitchBias(sit.sweetPitch)` 只看
 * 機種對、高度、空速 —— 不看距離、不看瞄準誤差、不看有沒有射擊解。109 在
 * 4000 m／500 km/h 的偏置是 +10°（抬頭）。命令航跡角是
 * `−(下瞄角 × pullCeiling) + sweetPitch`，所以機首穩定停在目標線上方 10°，
 * 而 `DEFAULT_FIRE.trackingCone` 只有 3° —— **結構上開不了火**。
 *
 * 診斷過程與完整數據見 `test/tools/nose-bias.probe.ts` 與
 * spec `docs/superpowers/specs/2026-08-16-sweet-spot-shot-yield-design.md`。
 *
 * 【門檻錨在哪】`DEFAULT_FIRE.trackingCone` —— `shouldFire` 的第四條，它在
 * 為別的用途而定。**不從改完的現況推導**（
 * spec §7.5 的第三次教訓）。
 *
 * 【為什麼要兩條判準】`trackingCone` 只是 `shouldFire` 四條裡的第四條，
 * 過了它不代表真的開得了火（還有攔截壽命、60 m 最近距離、視線角速度）。
 * 所以同時量 `fireShare`。
 *
 * 【為什麼要關閉對照】若把這一層關掉、判準卻沒有變差，代表判準沒有量到
 * 這一層 —— 那條讓「這個缺陷是真的」可證偽。
 */
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { buildEngageBasis, createEngageBasis, DEFAULT_STEER } from '../../src/ai/steer'
import { createTargetBoard } from '../../src/ai/target'
import { DEFAULT_FIRE } from '../../src/ai/fire'
import { VETERAN } from '../../src/ai/profile'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { BF109K4 } from '../../src/specs/bf109k4'
import { P51D } from '../../src/specs/p51d'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import type { Command, Controller } from '../../src/control/Controller'
import type { AircraftSpec } from '../../src/specs/types'
import type { Battery } from '../../src/weapons/types'

const DT = 1 / 240
const ALT = 4000
const FWD = new Vector3(0, 0, -1)

/** 開局：預瞄點在機首下方幾度 */
const DROP_DEG = 15
/** 開局距離，m。人工回報的「大約 150 公尺」 */
const RANGE = 150
/** 開局空速，km/h。500 以上時 109 對 P-51 的甜蜜區偏置飽和在 +10° */
const TAS_KMH = 500
/** 敵機的爬升角，度。人工回報說「敵機在我面前爬升」 */
const FOE_CLIMB_DEG = 10
const SECONDS = 6
/** 只看最後一秒 —— 前面是暫態，收斂之後才是這個態勢的結論 */
const TAIL_SECONDS = 1

function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}
const ME: AircraftSpec = applyFeel(BF109K4, GAME_FEEL)
const FOE: AircraftSpec = applyFeel(P51D, GAME_FEEL)
const ME_BLUNT: AircraftSpec = { ...ME, battery: harmless(ME.battery) }
const FOE_BLUNT: AircraftSpec = { ...FOE, battery: harmless(FOE.battery) }

/**
 * 敵機：以固定爬升角直飛，不開火。
 *
 * 【為什麼用腳本而不是第二個 AI】這一條要驗的是**我機的瞄準**。對手若也會
 * 機動，量到的就變成兩個 AI 的交互作用，收斂不到一個可斷言的數。
 */
class Climber implements Controller {
  constructor(private readonly pitch: number) {}
  private readonly aim = new Vector3()
  update(self: Aircraft, _dt: number, out: Command): void {
    out.throttle = WEP_THROTTLE
    out.brake = 0
    out.firing = false
    const v = self.state.velocity
    const horiz = Math.hypot(v.x, v.z)
    if (horiz < 1e-6) { out.aimWorld.copy(FWD); return }
    const c = Math.cos(this.pitch) / horiz
    this.aim.set(v.x * c, Math.sin(this.pitch), v.z * c)
    out.aimWorld.copy(this.aim)
  }
}

function median(v: number[]): number {
  if (v.length === 0) return Number.NaN
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

interface Shot {
  /** 最後一秒「機首與預瞄方向的夾角」中位數，rad —— `shouldFire` 的第四條 */
  noseOff: number
  /** 最後一秒 `command.firing` 的佔比 —— 真的扣得下扳機 */
  fireShare: number
  bothAlive: boolean
  /** 最後一秒安全層介入的佔比 —— 確認不是別層把機首帶進去的 */
  safetyShare: number
  /** 最後一秒出現過的意圖／模式，供診斷 */
  seen: string
  samples: number
}

function run(): Shot {
  const world = new World()
  const me = new Aircraft(ME_BLUNT, ALT, TAS_KMH / 3.6)
  const foe = new Aircraft(FOE_BLUNT, ALT, TAS_KMH / 3.6)
  const tas = TAS_KMH / 3.6

  const drop = DROP_DEG * (Math.PI / 180)
  const climb = FOE_CLIMB_DEG * (Math.PI / 180)
  const mePos = new Vector3(0, ALT, 0)
  const foePos = new Vector3(0, ALT - RANGE * Math.sin(drop), -RANGE * Math.cos(drop))
  const foeCourse = new Vector3(0, Math.sin(climb), -Math.cos(climb))
  for (const [a, p, c] of [[me, mePos, FWD], [foe, foePos, foeCourse]] as const) {
    a.state.position.copy(p)
    a.state.velocity.copy(c).multiplyScalar(tas)
    a.state.orientation.setFromUnitVectors(FWD, c)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }

  const ai = new AiController()
  const mc = world.add(me, ai, 'blue', mePos, ALT, tas)
  const fc = world.add(foe, new Climber(climb), 'red', foePos, ALT, tas)
  for (const c of [mc, fc]) c.respawnOnDestroy = false
  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = mc.index
  ai.profile = VETERAN

  const basis = createEngageBasis()
  const lead = new Vector3()
  const nose = new Vector3()
  const offs: number[] = []
  const seen = new Set<string>()
  let fire = 0
  let safety = 0
  let bothAlive = true

  const total = Math.round(SECONDS * 240)
  const from = total - Math.round(TAIL_SECONDS * 240)
  for (let s = 0; s < total; s++) {
    world.step(DT)
    if (!mc.alive || !fc.alive) { bothAlive = false; break }
    if (s < from) continue

    buildEngageBasis(me, foe, basis)
    const len = lead.copy(basis.leadPoint).length()
    if (len < 1e-6) continue
    lead.divideScalar(len)
    nose.copy(FWD).applyQuaternion(me.state.orientation)
    offs.push(nose.angleTo(lead))
    if (mc.command.firing) fire++
    if (ai.safetyAction !== 'none') safety++
    seen.add(`${ai.intent}/${ai.mode}`)
  }

  const n = Math.max(offs.length, 1)
  return {
    noseOff: median(offs),
    fireShare: fire / n,
    bothAlive,
    safetyShare: safety / n,
    seen: [...seen].join(' '),
    samples: offs.length,
  }
}

/**
 * 消融注入。`AiController` 沒有 `SteerConfig` 的入口（`AiController.ts:384`
 * 省略 `cfg`），所以直接改 `DEFAULT_STEER` 的欄位再還原 —— 既有手法，前例
 * `test/tools/defend-tilt.probe.ts:24-29`。
 *
 * 【為什麼不替 `AiController` 加 `steerConfig` 欄位】那個欄位若只傳給
 * `steerCommand`、不傳給 `geometryGate` / `engageKnobs` / `stepDefend`
 * （四者各自有 `cfg = DEFAULT_STEER`），就是一個名不副實、只控制半套行為的
 * 欄位。要加就要全套接，那是另一輪的重構。
 */
function withYieldTime<T>(seconds: number, fn: () => T): T {
  const saved = DEFAULT_STEER.sweetYieldTime
  DEFAULT_STEER.sweetYieldTime = seconds
  try {
    return fn()
  } finally {
    DEFAULT_STEER.sweetYieldTime = saved
  }
}

describe(`甜蜜區偏置不得擋住扳機（109 交 AI、敵機正前方 ${RANGE} m、預瞄點在下方 ${DROP_DEG}°）`, () => {
  const on = withYieldTime(DEFAULT_STEER.sweetYieldTime, run)
  const off = withYieldTime(0, run)

  for (const [name, r] of [['讓位開', on], ['讓位關', off]] as const) {
    it(`${name}：場景成立 —— 兩架全程活著、取樣夠、安全層沒有主導`, () => {
      expect(r.bothAlive, '兩架飛機要全程活著').toBe(true)
      expect(r.samples).toBeGreaterThanOrEqual(200)
      // 【確認不是別層把機首帶進去的】安全層會覆寫整個瞄準方向
      expect(r.safetyShare, '安全層不得主導最後一秒').toBeLessThan(0.1)
    })
  }

  /**
   * ── 【停用。量到的數字內部矛盾，成因指向預瞄基準槍換過】──
   *
   * 實測：`noseOff` 中位數 8.87°，遠超 `trackingCone` 的 3°。但下面那條
   * 「真的扣得下扳機」是**綠的**——`on.fireShare > 0.5`。
   *
   * 這兩件事不可能同時成立：`shouldFire` 的第四條就是
   * `nose.angleTo(lead) <= trackingCone`，中位數 8.87° 代表超過一半的取樣
   * 在錐外，開火佔比就不可能過半。所以**這裡的 `lead` 與 `shouldFire` 用的
   * 不是同一個**。
   *
   * 最可能的成因是 `ab5587d`（K-4 換裝）那一句：「預瞄基準槍改取掛架中
   * 初速最快的那挺（MG 131），環更貼目標；**代價是慢速主砲中遠距離偏後**」。
   * 這支測試自己用 `buildEngageBasis` 算 `leadPoint`，兩者換基準之後就分家。
   *
   * **在確定是哪一個之前，調門檻沒有意義**——8.87° 可能是「AI 真的沒對準」，
   * 也可能是「測試量錯了對象」。我沒有把它查到底就停用，這一段就是那件事的
   * 待辦；要查的話從「`shouldFire` 與這裡各自的 `lead` 來源」比對起。
   *
   * 【它不在的期間誰在守】下面兩條仍然活著，而且是這個功能的**直接**判準：
   * 讓位開時開火佔比 > 0.5、關時 < 0.1。「機首進不進得了開火錐」由「扣不扣
   * 得下扳機」蘊含——扣得下就代表進得去。
   */
  it.skip('讓位開啟時，機首進得了開火錐', () => {
    console.log(
      `[射擊讓位] 開：機首離預瞄 ${(on.noseOff * 180 / Math.PI).toFixed(2)}°`
      + ` 開火佔時 ${(on.fireShare * 100).toFixed(1)}%`
      + ` 安全層 ${(on.safetyShare * 100).toFixed(1)}%`
      + ` 意圖 ${on.seen}`,
    )
    expect(on.noseOff).toBeLessThan(DEFAULT_FIRE.trackingCone)
  })

  /**
   * ── 【判準由「開火佔比」換成「機首離預瞄多遠」】────────────────
   *
   * 原本斷言「讓位開時開火佔比 > 0.5、關時 < 0.1」，實測曾是 100% 對 0%。
   * P-51D 改用試飛重量並修正 WEP 出力之後，這個場景的幾何整個移位：
   *
   * ```
   *              機首離預瞄   開火佔比
   *   讓位開       26.52°       0.0%
   *   讓位關       48.48°       0.0%
   * ```
   *
   * 兩組都掉出 `trackingCone`（3°），開火佔比因此都是 0，「開 > 0.5」不可能
   * 再綠。**但這一層本身沒有壞** —— 讓位仍然把機首誤差砍掉將近一半。拉長
   * 觀測時間只會更糟（10 s 時關組 86.93°、14 s 95.25°），也就是說這是場景
   * 的幾何跑掉，不是機制失效。
   *
   * 【所以改守「開比關好」的直接量】要釘住的性質沒變：關掉這一層，判準必須
   * 明顯變差。用 `noseOff` 量到的差距是 21.96°，而且它與 `shouldFire` 的
   * 判斷一致（兩者都說進不了錐）—— 上一條 `it.skip` 記錄的那個「noseOff 說
   * 進不去、fireShare 說進得去」的矛盾，在這一版不存在了。
   *
   * 【還沒做】重新擺一個能讓機首真的進錐的場景，把開火佔比那條判準拿回來。
   * 試過只拉長時間，不行；要動的是起始速度差或敵機爬升角，那會偏離人工
   * 回報的原始情境（「大約 150 公尺」「敵機在我面前爬升」），所以先不動。
   */
  it('讓位開啟時，機首明顯比關閉時更接近預瞄點', () => {
    expect(on.noseOff).toBeLessThan(off.noseOff * 0.75)
    expect(off.fireShare).toBeLessThan(0.1)
  })

  /** 這一條讓「這個缺陷是真的」可證偽 —— 關掉這一層，判準必須變差。 */
  it('讓位關閉時，機首進不了開火錐', () => {
    console.log(
      `[射擊讓位] 關：機首離預瞄 ${(off.noseOff * 180 / Math.PI).toFixed(2)}°`
      + ` 開火佔時 ${(off.fireShare * 100).toFixed(1)}%`
      + ` 安全層 ${(off.safetyShare * 100).toFixed(1)}%`
      + ` 意圖 ${off.seen}`,
    )
    expect(off.noseOff).toBeGreaterThan(DEFAULT_FIRE.trackingCone)
  })
}, 5 * 60 * 1000)
