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
 * **這些是「修補前的現況」，不是目標值。**
 *
 * 每一批修補完成後這些門檻會被大幅超越；Task 10 會依實測一次收緊。
 * 在此之前它們的作用是「不准比現在更糟」—— 避免某一批把另一批的成果
 * 吃掉。
 *
 * 修補前的實測（2026-08-05，本檔無亂數、逐場可重現）：
 *
 * | 開局        | belowStall | safetyShare | longestExtend | steepShare | offNose |
 * |-------------|-----------:|------------:|--------------:|-----------:|--------:|
 * | 對頭 @1000  |      4.41% |       1.42% |       49.75 s |     18.90% |  44.05% |
 * | 平行 @1000  |      2.25% |       0.25% |       28.50 s |      9.33% |  41.88% |
 * | 側舷 @1000  |      8.66% |       5.33% |       57.25 s |     10.82% |  90.42% |
 * | 對頭 @4000  |     22.23% |       6.74% |        0.00 s |     27.39% |  60.37% |
 * | 平行 @4000  |      2.58% |       0.58% |        1.00 s |      3.33% |  32.97% |
 * | 側舷 @4000  |      4.08% |       2.00% |       46.00 s |     19.57% |  21.90% |
 *
 * 【三個門檻各守一個缺陷】`belowStall` 守缺陷 3（追擊時吊到失速），最差的
 * 是對頭 @4000 的 22%；`longestExtend` 守缺陷 4（一千公尺線上的震盪），最差
 * 的是側舷 @1000 的 57 秒；`offNose` 守缺陷 2（掉頭追後方），最差的是側舷
 * @1000 的 90%。**三個最差值分別出現在三個不同的開局** —— 六場一場都不能少。
 *
 * `safetyShare` 現在量到的全是撞地分支；Task 3 之後它會多出失速那一份，
 * 屆時它就是 Task 2 那一層的品質指標（每觸發一次代表瞄準點層失職一次）。
 */
const BASELINE = {
  belowStall: 0.30,
  longestExtend: 60,
  offNose: 0.95,
}

describe('AI 機動品質（1v1、300 秒、子彈無傷害）', () => {
  for (const o of OPENINGS) {
    it(`${o.name}`, () => {
      const m = duel(o.blue, o.red)
      expect(m.belowStall).toBeLessThanOrEqual(BASELINE.belowStall)
      expect(m.longestExtend).toBeLessThanOrEqual(BASELINE.longestExtend)
      expect(m.offNose).toBeLessThanOrEqual(BASELINE.offNose)
    }, 60000)
  }

  it('決定性：同一組開局跑兩次結果完全相同', () => {
    const a = duel(OPENINGS[0]!.blue, OPENINGS[0]!.red)
    const b = duel(OPENINGS[0]!.blue, OPENINGS[0]!.red)
    expect(a).toEqual(b)
  }, 60000)
})
