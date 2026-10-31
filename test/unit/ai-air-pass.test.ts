import { describe, it, expect } from 'vitest'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { anticipatesOvershoot, createAirPassState, stepAirPass } from '../../src/ai/airPass'
import { createSituation } from '../../src/ai/assess'
import { createBandState } from '../../src/ai/bandState'
import { DEFAULT_STEER } from '../../src/ai/steerConfig'
import { P51D } from '../../src/specs/p51d'

/**
 * 飛過頭就往上拉：從後方上膛、飛過去就把回升的高度設成現在加 `airPassZoom`。
 * 拉起本身由空層鎖的回升做（`ai-band-regain.test.ts`）；會不會真的改善行為由
 * 靶機情境驗（`test/integration/ai-air-pass.test.ts`）。
 */

const DEG = Math.PI / 180
const TAS = 180
const ALT = 3000

function rig(targetSpeed = TAS / 1.2) {
  const self = new Aircraft(P51D, ALT, TAS)
  self.state.position.set(0, ALT, 0)
  self.state.velocity.set(0, 0, -TAS)
  const target = new Aircraft(P51D, ALT, targetSpeed)
  target.state.position.set(0, ALT, -300)
  target.state.velocity.set(0, 0, -targetSpeed)
  return { self, target, state: createAirPassState(), band: createBandState() }
}

type Rig = ReturnType<typeof rig>

describe('提前 high yo-yo', () => {
  const situation = () => Object.assign(createSituation(), {
    range: 400, closureRate: 80, angleOffTail: 10 * DEG, aspectAngle: 10 * DEG, cornerRatio: 2,
  })

  it('五秒內衝過頭、尾追且有動能：可在原本三秒觸發點之前拉起', () => {
    const r = rig(), sit = situation()
    arm(r)
    expect(anticipatesOvershoot(sit, r.self)).toBe(true)
    expect(stepAirPass(r.state, r.band, r.self, r.target, 400, 80, 0.5, 10 * DEG, 0.2, true)).toBe(false)
    expect(stepAirPass(r.state, r.band, r.self, r.target, 400, 80, 0.5, 10 * DEG, 0.2, true,
      DEFAULT_STEER, anticipatesOvershoot(sit, r.self))).toBe(true)
  })

  it.each([
    {angleOffTail: Math.PI}, {angleOffTail: Math.PI / 2}, {aspectAngle: Math.PI},
    {closureRate: -20}, {range: 1200}, {cornerRatio: 1.1}, {cornerRatio: NaN},
  ])('迎頭／橫越／目標在身後／遠離／太遠／動能不足不提前：%j', change => {
    expect(anticipatesOvershoot(Object.assign(situation(), change), rig().self)).toBe(false)
  })

  it('提前預判仍不能跳過尾追上膛、相對速度與外部防禦閘門', () => {
    const r = rig()
    const early = (allowed = true) => stepAirPass(r.state, r.band, r.self, r.target, 400, 80,
      0.5, 10 * DEG, 0.2, allowed, DEFAULT_STEER, true)
    expect(early()).toBe(false)
    expect(early(false)).toBe(false)
    r.target.state.velocity.copy(r.self.state.velocity)
    arm(r)
    expect(early()).toBe(false)
    expect(Number.isNaN(r.band.perch)).toBe(true)
  })
})

/** 追上：在射程內、接近中 */
const arm = (r: Rig, aot = 10 * DEG, allowed = true) =>
  stepAirPass(r.state, r.band, r.self, r.target, 300, 30, 0.5, aot, 0.2, allowed)

/** 飛過最近點：接近速度翻負 */
const pass = (r: Rig, allowed = true) =>
  stepAirPass(r.state, r.band, r.self, r.target, 60, -30, 0.5, 170 * DEG, 0.2, allowed)

describe('飛過頭就往上拉', () => {
  it('從後方上膛、飛過去、比目標快一成以上 → 回升的高度設成現在加 airPassZoom', () => {
    const r = rig()
    expect(arm(r)).toBe(false)
    expect(Number.isNaN(r.band.perch)).toBe(true)
    expect(pass(r)).toBe(true)
    expect(r.band.perch).toBe(ALT + DEFAULT_STEER.airPassZoom)
    expect(r.band.regainTime).toBe(0)
  })

  it('還沒飛過去（仍在接近、也還沒近到 overshootRange）→ 不拉', () => {
    const r = rig()
    arm(r)
    expect(stepAirPass(r.state, r.band, r.self, r.target, 200, 30, 0.3, 10 * DEG, 0.5, true)).toBe(false)
    expect(Number.isNaN(r.band.perch)).toBe(true)
  })

  it('預估 airPassLead 秒內撞上就先拉，不等飛過去', () => {
    const r = rig()
    arm(r)
    const closing = 40
    const just = DEFAULT_STEER.airPassLead * closing
    expect(stepAirPass(r.state, r.band, r.self, r.target, just + 20, closing, 0.2, 10 * DEG, 0.2, true)).toBe(false)
    expect(stepAirPass(r.state, r.band, r.self, r.target, just - 20, closing, 0.2, 10 * DEG, 0.2, true)).toBe(true)
    expect(r.band.forced).toBe(true)
  })

  it('目標急轉到機鼻跟不上（追蹤比到 airPassTrackRatio）→ 不等飛過頭就拉', () => {
    const r = rig()
    arm(r)
    expect(stepAirPass(
      r.state, r.band, r.self, r.target, 250, 40, 0.3, 30 * DEG, DEFAULT_STEER.airPassTrackRatio, true,
    )).toBe(true)
    expect(r.band.perch).toBe(ALT + DEFAULT_STEER.airPassZoom)
  })

  it('速度差不到 airPassSpeedRatio → 不拉', () => {
    const r = rig(TAS / (DEFAULT_STEER.airPassSpeedRatio - 0.05))
    arm(r)
    expect(pass(r)).toBe(false)
    expect(Number.isNaN(r.band.perch)).toBe(true)
  })

  it('迎頭交會（上膛時在他機鼻前方）→ 不上膛、不拉', () => {
    const r = rig()
    arm(r, 170 * DEG)
    expect(pass(r)).toBe(false)
  })

  it('不准的時候（閃避、命令、轉彎比他好很多、已經有要回去的高度）→ 不拉', () => {
    const r = rig()
    arm(r)
    expect(pass(r, false)).toBe(false)
    expect(Number.isNaN(r.band.perch)).toBe(true)
  })

  it('換目標就不沿用上一個目標的上膛', () => {
    const r = rig()
    arm(r)
    const other = new Aircraft(P51D, ALT, TAS / 1.2)
    other.state.velocity.set(0, 0, -TAS / 1.2)
    expect(stepAirPass(r.state, r.band, r.self, other, 60, -30, 0.5, 170 * DEG, 0.2, true)).toBe(false)
  })
})
