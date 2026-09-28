import { describe, it, expect } from 'vitest'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createSituation } from '../../src/ai/assess'
import { createBandState, createEngageBasis, DEFAULT_STEER, stepBand } from '../../src/ai/steer'
import { NO_INTERCEPT } from '../../src/world/lead'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import type { AircraftSpec } from '../../src/specs/types'

/**
 * 空層鎖的回升：什麼時候**不該**記下要回去的高度，以及回升的時間上限。
 * 會不會真的拉回去由靶機情境驗（`test/integration/ai-band-regain.test.ts`）。
 */

const DT = 1 / 240
const ALT = 3000
const ENEMY_ALT = 2000
const DEG = Math.PI / 180

function rig(spec: AircraftSpec = P51D) {
  const self = new Aircraft(spec, ALT, 180)
  self.state.position.set(0, ALT, 0)
  const sit = createSituation()
  sit.chaseAlt = ENEMY_ALT
  sit.altitudeAdvantage = ALT - ENEMY_ALT
  sit.cornerRatio = 1
  sit.aspectAngle = 0
  const basis = createEngageBasis()
  const band = createBandState()
  return { self, sit, basis, band }
}

type Rig = ReturnType<typeof rig>

/** 遠距離接敵：鎖住，基準是開局那一層 */
function lock(r: Rig): void {
  r.basis.interceptTime = NO_INTERCEPT
  stepBand(r.band, true, r.sit, r.basis, r.self, DT)
}

/** 目標進射程：讓位閘把鎖放開 */
function release(r: Rig, active = true): void {
  r.basis.interceptTime = 1.0
  stepBand(r.band, active, r.sit, r.basis, r.self, DT)
}

describe('空層鎖的回升：記下要回去的高度', () => {
  it('情境成立：比敵人高、對著他進射程 → 記下開局那一層', () => {
    const r = rig()
    lock(r)
    expect(r.band.kind).not.toBe('off')
    release(r)
    expect(r.band.kind).toBe('off')
    expect(r.band.perch).toBe(ALT)
  })

  it('擦身而過、目標在正後方時放開 → 不記', () => {
    const r = rig()
    lock(r)
    r.sit.aspectAngle = 150 * DEG
    r.band.kind = 'level'
    // 力道由讓位閘歸零（目標還在近距離），但這不是一次攻擊
    r.basis.interceptTime = 1.0
    stepBand(r.band, true, r.sit, r.basis, r.self, DT)
    expect(Number.isNaN(r.band.perch)).toBe(true)
  })

  it('因為 extend／defend 放開 → 不記', () => {
    const r = rig()
    lock(r)
    release(r, false)
    expect(Number.isNaN(r.band.perch)).toBe(true)
  })

  it('轟炸機 → 不記', () => {
    const r = rig(B17G)
    lock(r)
    release(r)
    expect(Number.isNaN(r.band.perch)).toBe(true)
  })

  it('高度優勢不到 bandRegainGap → 不記', () => {
    const r = rig()
    r.sit.chaseAlt = ALT - DEFAULT_STEER.bandRegainGap + 50
    lock(r)
    release(r)
    expect(Number.isNaN(r.band.perch)).toBe(true)
  })
})

describe('空層鎖的回升：時間上限', () => {
  it('中途被打斷不重算，累計到 bandRegainMax 就放棄、改貼敵', () => {
    const r = rig()
    lock(r)
    release(r)
    // 交會後掉到敵人那一層，重新上鎖 → 回升
    r.self.state.position.y = ENEMY_ALT
    r.sit.altitudeAdvantage = 0
    lock(r)
    expect(r.band.kind).toBe('regain')
    expect(r.band.altitude).toBe(ALT)
    const half = Math.round(DEFAULT_STEER.bandRegainMax / 2 / DT)
    for (let i = 0; i < half; i++) lock(r)
    // 被 extend 打斷一陣子（鎖放開），回來之後接著算，不是重新給一整份
    for (let i = 0; i < 240; i++) stepBand(r.band, false, r.sit, r.basis, r.self, DT)
    expect(r.band.kind).toBe('off')
    lock(r)
    expect(r.band.kind).toBe('regain')
    for (let i = 0; i < half + 2; i++) lock(r)
    expect(r.band.kind).toBe('level')
    expect(Number.isNaN(r.band.perch)).toBe(true)
    expect(r.band.altitude).toBe(ENEMY_ALT)
  })
})
