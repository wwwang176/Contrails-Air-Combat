import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { createGroundTarget, groundTopOf, resetGroundTarget } from '../../src/world/groundTargets'
import { createGroundMotion, stepGroundMotion } from '../../src/world/groundMotion'
import { createGroundBattery, GROUND_LIGHT_FLAK_SPEC, stepGunPlatform } from '../../src/world/shipGuns'
import { Projectiles } from '../../src/world/Projectiles'
import { createFlak } from '../../src/world/flak'
import type { TurretCombatant } from '../../src/world/turrets'

/**
 * # 沿路線移動的地面目標
 *
 * 守的是車輛那一層的約定：出發前停在集結位置、出發後照車速走、貼著地面、
 * 死了不動、走完退場但不算摧毀、重開回到集結位置。防空車移動之後砲火從
 * 新位置打出去。
 */

const PATH = [{ x: 0, z: 0 }, { x: 0, z: -1000 }, { x: -500, z: -1500 }]
const CAR = { speed: 10, turnRadius: 25, turnRate: 10 / 25 }
const ground = (x: number, _z: number): number => 5 + x * 0.001

function vehicle(startS: number, departAt: number, unit: 'truck' | 'flakLight' = 'truck') {
  const m = createGroundMotion(PATH, CAR, startS, departAt)
  const t = createGroundTarget(0, unit, 'red', 0, 0, 0, m)
  stepGroundMotion(t, 0, ground)
  return t
}

function overhead(x: number, y: number, z: number): TurretCombatant {
  return {
    index: 0, team: 'blue', alive: true, hp: 100,
    aircraft: {
      spec: { turrets: [] },
      state: { position: new Vector3(x, y, z), velocity: new Vector3(0, 0, 0), orientation: new Quaternion() },
    },
    turretStates: [], turretCooldowns: new Float32Array(0),
  } as unknown as TurretCombatant
}

describe('地面目標沿路線移動', () => {
  it('出發前停在集結位置、speed 為 0', () => {
    const t = vehicle(200, 30)
    const z0 = t.position.z
    expect(z0).toBeCloseTo(-200, 6)
    stepGroundMotion(t, 10, ground)
    expect(t.position.z).toBe(z0)
    expect(t.speed).toBe(0)
  })

  it('出發之後每秒前進 speed 公尺，speed 讀得到車速', () => {
    const t = vehicle(0, 0)
    stepGroundMotion(t, 10, ground)
    expect(t.position.z).toBeCloseTo(-100, 6)
    expect(t.speed).toBe(10)
  })

  it('高度等於地面、impactY 跟著動', () => {
    const t = vehicle(0, 0)
    stepGroundMotion(t, 110, ground)
    expect(t.position.y).toBe(ground(t.position.x, t.position.z))
    expect(t.impactY).toBeCloseTo(t.position.y + groundTopOf(t.unit), 9)
  })

  it('航向沿路線：第一段朝 −Z，轉過彎之後朝最後一段', () => {
    const t = vehicle(0, 0)
    stepGroundMotion(t, 5, ground)
    const fwd = new Vector3(0, 0, -1).applyQuaternion(t.orientation)
    expect(fwd.z).toBeCloseTo(-1, 6)
    stepGroundMotion(t, 130, ground)
    fwd.set(0, 0, -1).applyQuaternion(t.orientation)
    const want = new Vector3(-500, 0, -500).normalize()
    expect(fwd.dot(want)).toBeCloseTo(1, 6)
  })

  it('死了就不動', () => {
    const t = vehicle(0, 0)
    stepGroundMotion(t, 5, ground)
    t.alive = false
    const z = t.position.z
    stepGroundMotion(t, 50, ground)
    expect(t.position.z).toBe(z)
    expect(t.speed).toBe(0)
  })

  it('走完就退場：arrived 為真、alive 為假、不再動', () => {
    const t = vehicle(0, 0)
    stepGroundMotion(t, 1e4, ground)
    expect(t.arrived).toBe(true)
    expect(t.alive).toBe(false)
    expect(t.speed).toBe(0)
  })

  it('重開回到集結位置與開局狀態', () => {
    const t = vehicle(100, 0)
    stepGroundMotion(t, 1e4, ground)
    resetGroundTarget(t)
    expect(t.arrived).toBe(false)
    expect(t.alive).toBe(true)
    expect(t.speed).toBe(0)
    stepGroundMotion(t, 0, ground)
    expect(t.position.z).toBeCloseTo(-100, 6)
  })

  it('防空車移動之後，砲台打出去的彈丸從車的新位置出膛', () => {
    const t = vehicle(0, 0, 'flakLight')
    t.guns = createGroundBattery(GROUND_LIGHT_FLAK_SPEC, 'autocannon', GROUND_LIGHT_FLAK_SPEC.caliber)
    stepGroundMotion(t, 40, ground)
    expect(t.position.z).toBeCloseTo(-400, 6)
    const p = new Projectiles(512)
    const flak = createFlak()
    const dt = 1 / 240
    const air = [overhead(t.position.x, 900, t.position.z)]
    for (let i = 0; i < 3 * 240 && p.live === 0; i++) {
      stepGunPlatform(t, air, p, flak, 40 + i * dt, dt, [t])
    }
    expect(p.live).toBeGreaterThan(0)
    let k = -1
    for (let i = 0; i < p.capacity; i++) if (p.owner[i] !== -1) { k = i; break }
    expect(Math.hypot(p.x[k]! - t.position.x, p.z[k]! - t.position.z)).toBeLessThan(30)
  })

  it('沒有 motion 的地面目標完全不受影響', () => {
    const t = createGroundTarget(0, 'truck', 'red', 12, 34, 0)
    stepGroundMotion(t, 100, ground)
    expect(t.position.x).toBe(12)
    expect(t.position.z).toBe(34)
    expect(t.speed).toBe(0)
  })
})
