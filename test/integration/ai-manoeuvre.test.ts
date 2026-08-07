import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createSituation, evaluateEnergy, evaluateGeometry } from '../../src/ai/assess'
import { P51D } from '../../src/specs/p51d'
import { DEG } from '../../src/core/math'
import type { Battery } from '../../src/weapons/types'
import type { AircraftSpec } from '../../src/specs/types'

const DT = 1 / 240
const SECONDS = 300
const FWD = new Vector3(0, 0, -1)

/**
 * 同一副武器，單發傷害歸零。彈道、初速、射速、匯聚、預瞄用的 `sight`
 * 全部不動。
 *
 * 【為什麼要這樣做】AI 的決策輸入（預瞄解、`shotInstant`、`threatInstant`、
 * 開火紀律）一個字都不變，但仗打不完，觀察窗因此不會被提早結束的戰鬥
 * 截斷。調查時 1000 m 的兩場原本 92 秒與 176 秒就分出勝負，看不到穩態
 * 行為（spec §8.2）。
 */
function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}
const P51_BLUNT: AircraftSpec = { ...P51D, battery: harmless(P51D.battery) }

interface Side {
  altitude: number
  /** 水平位移 [x, z]，m */
  offset: [number, number]
  headingDeg: number
}

interface Metrics {
  /** 速度低於 1G 失速速度的取樣比例 */
  belowStall: number
  /** 安全層介入的取樣比例 */
  safetyShare: number
  /** 單次 extend 的最長連續秒數 */
  longestExtend: number
  /** 航跡角超過 ±45° 的取樣比例 */
  steepShare: number
  /** 機首偏離目標超過 90° 的取樣比例 */
  offNose: number
}

const TAS = 200

function duel(blue: Side, red: Side): Metrics {
  const world = new World()
  const make = (s: Side): { a: Aircraft; pos: Vector3 } => {
    const a = new Aircraft(P51_BLUNT, s.altitude, TAS)
    const pos = new Vector3(s.offset[0], s.altitude, s.offset[1])
    const h = s.headingDeg * DEG
    const dir = new Vector3(-Math.sin(h), 0, -Math.cos(h))
    a.state.position.copy(pos)
    a.state.velocity.copy(dir).multiplyScalar(TAS)
    a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
    return { a, pos }
  }
  const b = make(blue)
  const r = make(red)
  const blueAi = new AiController()
  const redAi = new AiController()
  const bc = world.add(b.a, blueAi, 'blue', b.pos, blue.altitude, TAS)
  const rc = world.add(r.a, redAi, 'red', r.pos, red.altitude, TAS)
  blueAi.target = r.a
  redAi.target = b.a
  bc.respawnOnDestroy = false
  rc.respawnOnDestroy = false

  const sit = createSituation()
  const los = new Vector3()
  const nose = new Vector3()
  let samples = 0
  let belowStall = 0
  let safety = 0
  let steep = 0
  let offNose = 0
  let longestExtend = 0
  let currentExtend = 0

  const steps = Math.round(SECONDS / DT)
  for (let s = 0; s <= steps; s++) {
    // 【每 0.25 s 取樣一次】足以解析週期 20 s 的振盪，又不會讓統計成本
    // 主導測試時間
    if (s % 60 === 0) {
      evaluateGeometry(b.a, r.a, sit)
      evaluateEnergy(b.a, r.a, sit)
      samples++
      if (sit.speedMargin < 1) belowStall++
      if (blueAi.safetyActive) safety++
      const v = b.a.state.velocity
      const sp = v.length()
      const gamma = sp > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, v.y / sp))) : 0
      if (Math.abs(gamma) > 45 * DEG) steep++
      los.copy(r.a.state.position).sub(b.a.state.position)
      const range = los.length()
      if (range > 1e-3) {
        los.divideScalar(range)
        nose.copy(FWD).applyQuaternion(b.a.state.orientation)
        if (Math.acos(Math.max(-1, Math.min(1, nose.dot(los)))) > Math.PI / 2) offNose++
      }
      if (blueAi.intent === 'extend') {
        currentExtend += 0.25
        if (currentExtend > longestExtend) longestExtend = currentExtend
      } else {
        currentExtend = 0
      }
    }
    world.step(DT)
  }
  return {
    belowStall: belowStall / samples,
    safetyShare: safety / samples,
    longestExtend,
    steepShare: steep / samples,
    offNose: offNose / samples,
  }
}

/**
 * 六場開局：對頭／平行／**側舷** × 1000 m／4000 m。
 *
 * 【側舷不可省略】調查時對頭與平行跑了三場都沒暴露一千公尺死循環，
 * 換成側舷立刻出現且成為主導行為（`extend` 佔 59%）。**開局幾何決定
 * AI 掉進哪一種模式**（spec §4.6）。
 *
 * 【為什麼雙方同機種】異機種在調查中 20–39 秒就分出勝負，看不到穩態
 * 行為。同機種誰也咬不住誰，300 秒跑得完。
 */
const OPENINGS: { name: string; blue: Side; red: Side }[] = []
for (const altitude of [1000, 4000]) {
  OPENINGS.push(
    {
      name: `對頭 @${altitude} m`,
      blue: { altitude, offset: [0, 1500], headingDeg: 180 },
      red: { altitude, offset: [0, 0], headingDeg: 0 },
    },
    {
      name: `平行 @${altitude} m`,
      blue: { altitude, offset: [0, 0], headingDeg: 0 },
      red: { altitude, offset: [800, 0], headingDeg: 0 },
    },
    {
      name: `側舷 @${altitude} m`,
      blue: { altitude, offset: [0, 0], headingDeg: 0 },
      red: { altitude, offset: [-900, -200], headingDeg: 0 },
    },
  )
}

/**
 * **實測回填值**（本檔無亂數、逐場可重現）。
 *
 * ## 現值（2026-08-07，手感重調 + `brakeCornerRatio` 1.8 之後）
 *
 * | 開局        | belowStall | safetyShare | longestExtend | steepShare | offNose |
 * |-------------|-----------:|------------:|--------------:|-----------:|--------:|
 * | 對頭 @1000  |     0.083% |       0.00% |       39.00 s |      2.58% |  49.79% |
 * | 平行 @1000  |     0.083% |       0.00% |       38.00 s |      1.00% |  53.62% |
 * | 側舷 @1000  |     0.083% |       0.75% |       48.25 s |      3.25% |  67.19% |
 * | 對頭 @4000  |     0.083% |       0.00% |       29.00 s |      3.00% |  50.37% |
 * | 平行 @4000  |     0.083% |       0.00% |       29.75 s |      1.08% |  50.21% |
 * | 側舷 @4000  |     0.083% |       0.00% |       34.50 s |      4.08% |  43.21% |
 *
 * 【`brakeCornerRatio` 1.6 → 1.8 對這六場逐位元沒有影響】那六場是 P-51 對
 * P-51、TAS 200 起始，**衝不到 1.6 倍角落速度**，減速規則一次都沒觸發。
 * 它變的是高能量開局（`ai-duel-matrix` L4-C），不是這裡。
 *
 * 【手感重調對這六場是淨賺】與下面 2026-08-05 那張表比：`safetyShare`
 * 1.83% → 0.75%、`steepShare` 9.66% → 4.08%（都是最差值）；`longestExtend`
 * 42.50 → 48.25 s 與 `offNose` 64.36% → 67.19% 略退，但門檻餘裕仍有
 * 12% 與 21%。五個判準寫的都是**比值**，分母是飛機自己的氣動性能，所以
 * 手感倍率一動它們自動跟著走（見 `steer.ts` 的能量判準校準那一段）。
 *
 * ## 2026-08-05（AI 四缺陷修補後，手感重調**前**）
 *
 * | 開局        | belowStall | safetyShare | longestExtend | steepShare | offNose |
 * |-------------|-----------:|------------:|--------------:|-----------:|--------:|
 * | 對頭 @1000  |     0.083% |       1.83% |       37.00 s |      6.66% |  55.45% |
 * | 平行 @1000  |     0.083% |       0.67% |       35.00 s |      1.75% |  55.79% |
 * | 側舷 @1000  |     0.083% |       0.50% |       20.25 s |      4.16% |  49.29% |
 * | 對頭 @4000  |     0.083% |       0.00% |       26.25 s |      9.66% |  52.96% |
 * | 平行 @4000  |     0.083% |       0.00% |       16.25 s |      3.83% |  59.03% |
 * | 側舷 @4000  |     0.083% |       1.50% |       42.50 s |      8.41% |  64.36% |
 *
 * 對照修補**前**（同一組開局、同一份量測程式）：
 *
 * | 指標          | 修補前最差 | 修補後最差 | 門檻 |
 * |---------------|-----------:|-----------:|-----:|
 * | belowStall    |     22.23% |     0.083% | 0.01 |
 * | safetyShare   |      6.74% |      1.83% | 0.05 |
 * | longestExtend |    57.25 s |    42.50 s |   55 |
 * | steepShare    |     27.39% |      9.66% | 0.15 |
 * | offNose       |     90.42% |     64.36% | 0.85 |
 *
 * 【每個門檻都低於修補前的最差值】所以它們不是「把及格線降到現況」——
 * 舊行為在新門檻下每一條都會紅。
 *
 * 【`safetyShare` 這一條是後來補的，它差點被漏掉】調 `cornerEnter` 時量到
 * 一組 `belowStall` 一樣漂亮（0.08%）但 `safetyShare` 高達 **87%** 的設定
 * —— 失速數字好看是因為安全層一直在替它飛，那不是健康。少了這一條，
 * 「把飛行品質外包給安全層」會是一條沒有人看的退路。
 *
 * 【`steepShare` 同理】它守的是「AI 有沒有把自己吊起來」，與 `belowStall`
 * 互補：前者在失速**之前**就看得見，後者要等真的掉下去。
 */
const LIMITS = {
  belowStall: 0.01,
  safetyShare: 0.05,
  longestExtend: 55,
  steepShare: 0.15,
  offNose: 0.85,
}

describe('AI 機動品質（1v1、300 秒、子彈無傷害）', () => {
  for (const o of OPENINGS) {
    it(`${o.name}`, () => {
      const m = duel(o.blue, o.red)
      expect(m.belowStall).toBeLessThanOrEqual(LIMITS.belowStall)
      expect(m.safetyShare).toBeLessThanOrEqual(LIMITS.safetyShare)
      expect(m.longestExtend).toBeLessThanOrEqual(LIMITS.longestExtend)
      expect(m.steepShare).toBeLessThanOrEqual(LIMITS.steepShare)
      expect(m.offNose).toBeLessThanOrEqual(LIMITS.offNose)
    }, 60000)
  }

  it('決定性：同一組開局跑兩次結果完全相同', () => {
    const a = duel(OPENINGS[0]!.blue, OPENINGS[0]!.red)
    const b = duel(OPENINGS[0]!.blue, OPENINGS[0]!.red)
    expect(a).toEqual(b)
  }, 60000)
})
