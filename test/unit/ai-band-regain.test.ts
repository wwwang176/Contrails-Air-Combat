import { describe, it, expect } from 'vitest'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { Vector3 } from 'three'
import { createSituation, evaluateGeometry } from '../../src/ai/assess'
import {
  buildEngageBasis, createBandState, createDefendState, createEngageBasis, DEFAULT_STEER,
  stepBand, steerCommand, type Knobs,
} from '../../src/ai/steer'
import { createCommand } from '../../src/control/Controller'
import { NO_INTERCEPT } from '../../src/world/lead'
import { PROJECTILE_LIFETIME } from '../../src/world/Projectiles'
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

/** 記下 `perch` = ALT，掉到敵人那一層重新上鎖 → 回升中 */
function regaining(): Rig {
  const r = rig()
  lock(r)
  release(r)
  r.self.state.position.y = ENEMY_ALT
  r.sit.altitudeAdvantage = 0
  lock(r)
  return r
}

describe('空層鎖的回升：到達', () => {
  it('到達那一步鎖剛好放開 → 記憶照樣清掉，之後下降不會再爬回去', () => {
    const r = regaining()
    expect(r.band.kind).toBe('regain')
    r.self.state.position.y = ALT - DEFAULT_STEER.bandTolerance / 2
    r.sit.aspectAngle = 150 * DEG
    release(r)
    expect(Number.isNaN(r.band.perch)).toBe(true)
    r.self.state.position.y = ALT - 400
    lock(r)
    expect(r.band.kind).not.toBe('regain')
  })

  it('被 extend 打斷期間爬到那一層 → 記憶清掉', () => {
    const r = regaining()
    r.self.state.position.y = ALT
    stepBand(r.band, false, r.sit, r.basis, r.self, DT)
    expect(Number.isNaN(r.band.perch)).toBe(true)
    r.self.state.position.y = ALT - 400
    lock(r)
    expect(r.band.kind).not.toBe('regain')
  })
})

describe('空層鎖的回升：目標要跑掉了', () => {
  /** 自己射程的 `bandRegainEscape` 倍，m */
  const escape = (spec: AircraftSpec = P51D) =>
    DEFAULT_STEER.bandRegainEscape * spec.battery.sight.muzzleVelocity * PROJECTILE_LIFETIME

  it('在射程的 bandRegainEscape 倍外而且還在拉開 → 放棄回升，改從現在的高度接敵', () => {
    const r = regaining()
    r.sit.range = escape() + 200
    r.sit.closureRate = -20
    lock(r)
    expect(r.band.kind).not.toBe('regain')
    expect(Number.isNaN(r.band.perch)).toBe(true)
    expect(r.band.anchor).toBe(ENEMY_ALT)
  })

  it('一樣遠但正在接近（他沒在跑）→ 回升照舊', () => {
    const r = regaining()
    r.sit.range = escape() + 200
    r.sit.closureRate = 20
    lock(r)
    expect(r.band.kind).toBe('regain')
  })

  it('還在射程的 bandRegainEscape 倍內，即使在拉開 → 回升照舊', () => {
    const r = regaining()
    r.sit.range = escape() - 200
    r.sit.closureRate = -20
    lock(r)
    expect(r.band.kind).toBe('regain')
  })
})

describe('空層鎖的回升：往上拉設下的（forced）不讓位', () => {
  it('目標就在機鼻前方射程內 → 打完一擊的回升讓位，往上拉的照樣拉', () => {
    const yielding = regaining()
    yielding.band.kind = 'off'
    yielding.sit.aspectAngle = 0
    release(yielding)
    expect(yielding.band.kind).toBe('off')

    const forced = regaining()
    forced.band.kind = 'off'
    forced.band.forced = true
    forced.sit.aspectAngle = 0
    release(forced)
    expect(forced.band.kind).toBe('regain')
  })
})

describe('空層鎖的回升：鎖還鎖著時設下往上拉', () => {
  it('stepAirPass 在平飛鎖還鎖著時設下回升 → 下一步就切進回升、基準換成那一層', () => {
    const r = rig()
    lock(r)
    expect(r.band.kind).toBe('level')
    r.band.perch = ALT + 600
    r.band.forced = true
    lock(r)
    expect(r.band.kind).toBe('regain')
    expect(r.band.anchor).toBe(ALT + 600)
    expect(r.band.altitude).toBe(ALT + 600)
    expect(r.band.regainTime).toBeGreaterThan(0)
  })
})

describe('空層鎖的回升：卸載把拉桿收掉時不加回去', () => {
  it('失速餘裕見底（unload、拉桿係數 0）→ 回升不把機首往上抬', () => {
    const self = new Aircraft(P51D, 4000, 180)
    self.update(new Vector3(0, 0, -1), 0.7, 1 / 240)
    self.state.position.set(0, 4000, 0)
    self.state.velocity.set(0, 0, -180)
    const target = new Aircraft(P51D, 4000, 180)
    target.state.position.set(0, 4000, -400)
    target.state.velocity.set(0, 0, -180)
    const sit = createSituation()
    evaluateGeometry(self, target, sit)
    sit.stallMargin = 1
    const basis = createEngageBasis()
    buildEngageBasis(self, target, basis)
    const knobs: Knobs = { leadLag: 0, vertical: 0, diveIas: 0 }
    const pitchOf = (band: ReturnType<typeof createBandState> | null) => {
      const cmd = createCommand()
      steerCommand('engage', 'unload', sit, basis, self, 0, knobs, createDefendState(), null, cmd,
        DEFAULT_STEER, false, band)
      return Math.asin(Math.max(-1, Math.min(1, cmd.aimWorld.y)))
    }
    const band = createBandState()
    band.kind = 'regain'
    band.hold = 1
    band.altitude = 4600
    band.forced = true
    expect(pitchOf(band)).toBeLessThanOrEqual(pitchOf(null) + 1e-9)
  })
})

describe('空層鎖的回升：時間上限', () => {
  it('鎖每一步放開又重鎖，每一個回升的步照樣計時，到上限就放棄', () => {
    const r = regaining()
    const steps = Math.ceil((2 * DEFAULT_STEER.bandRegainMax + 1) / DT)
    for (let i = 0; i < steps && !Number.isNaN(r.band.perch); i++) {
      stepBand(r.band, i % 2 === 0, r.sit, r.basis, r.self, DT)
    }
    expect(Number.isNaN(r.band.perch)).toBe(true)
  })

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
