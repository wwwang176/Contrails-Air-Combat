import { describe, expect, it } from 'vitest'
import type { BufferAttribute } from 'three'
import { ARC_GRAVITY, arcAt, solveArc, type ArcPoint, type ArcShot } from '../../src/render/arc'
import {
  ARC_TRAIL_CAPACITY, ARC_TRAIL_RINGS, ARC_TRAIL_SECONDS, ARC_TRAIL_SIDES, createArcTrails,
} from '../../src/render/arcTrails'

const DEG = Math.PI / 180
const VERTS = ARC_TRAIL_RINGS * ARC_TRAIL_SIDES

function shot(dx: number, dz: number, dy = 0): ArcShot {
  const s: ArcShot = { x0: 0, y0: 0, z0: 0, vx: 0, vy: 0, vz: 0, flight: 0 }
  expect(solveArc(0, 0, 0, dx, dy, dz, 60 * DEG, s)).toBe(true)
  return s
}

const read = (trails: ReturnType<typeof createArcTrails>) => {
  const g = trails.object.geometry
  const pos = (g.getAttribute('position') as BufferAttribute).array as Float32Array
  const alp = (g.getAttribute('aAlpha') as BufferAttribute).array as Float32Array
  return { pos, alp }
}

/** 第 `slot` 條的第 `ring` 環的中心（四個側面頂點的平均）與半徑（到中心的平均距離） */
function ring(pos: Float32Array, slot: number, r: number): { c: ArcPoint; radius: number } {
  const o = (slot * VERTS + r * ARC_TRAIL_SIDES) * 3
  let x = 0
  let y = 0
  let z = 0
  for (let s = 0; s < ARC_TRAIL_SIDES; s++) {
    x += pos[o + s * 3]!
    y += pos[o + s * 3 + 1]!
    z += pos[o + s * 3 + 2]!
  }
  const c = { x: x / ARC_TRAIL_SIDES, y: y / ARC_TRAIL_SIDES, z: z / ARC_TRAIL_SIDES }
  let radius = 0
  for (let s = 0; s < ARC_TRAIL_SIDES; s++) {
    radius += Math.hypot(pos[o + s * 3]! - c.x, pos[o + s * 3 + 1]! - c.y, pos[o + s * 3 + 2]! - c.z)
  }
  return { c, radius: radius / ARC_TRAIL_SIDES }
}

const noop = (): void => {}

describe('迫擊砲的白色尾流', () => {
  it('每一環的中心都在彈道上：頭端是彈頭、往後是更早的位置', () => {
    const trails = createArcTrails()
    const s = shot(1000, 0)
    trails.spawn(s)
    trails.step(10, noop)
    const { pos } = read(trails)
    const head = ring(pos, 0, ARC_TRAIL_RINGS - 1).c
    const p: ArcPoint = { x: 0, y: 0, z: 0 }
    arcAt(s, 10, p)
    expect(head.x).toBeCloseTo(p.x, 3)
    expect(head.y).toBeCloseTo(p.y, 3)
    expect(head.z).toBeCloseTo(p.z, 3)
    // 尾端是 `ARC_TRAIL_SECONDS` 之前的位置
    const tail = ring(pos, 0, 0).c
    arcAt(s, 10 - ARC_TRAIL_SECONDS, p)
    expect(tail.x).toBeCloseTo(p.x, 3)
    expect(tail.y).toBeCloseTo(p.y, 3)
    trails.dispose()
  })

  it('越往尾端越淡、越粗：頭端最濃最細', () => {
    const trails = createArcTrails()
    trails.spawn(shot(1000, 0))
    trails.step(10, noop)
    const { pos, alp } = read(trails)
    for (let r = 1; r < ARC_TRAIL_RINGS; r++) {
      expect(alp[r * ARC_TRAIL_SIDES]!).toBeGreaterThan(alp[(r - 1) * ARC_TRAIL_SIDES]!)
      expect(ring(pos, 0, r).radius).toBeLessThan(ring(pos, 0, r - 1).radius)
    }
    expect(alp[0]!).toBe(0)
    trails.dispose()
  })

  /** 發射的那一刻整條還沒拉開：粗細與濃度為 0，不留一個圓盤在砲口 */
  it('剛發射時窗口是零，管子不畫（沒有圓盤）', () => {
    const trails = createArcTrails()
    trails.spawn(shot(1000, 0))
    trails.step(0, noop)
    const { pos, alp } = read(trails)
    for (let r = 0; r < ARC_TRAIL_RINGS; r++) expect(ring(pos, 0, r).radius).toBe(0)
    expect(Math.max(...alp.subarray(0, VERTS))).toBe(0)
    trails.dispose()
  })

  it('頂點全部是有限的數，包括垂直落下與貼地的彈道', () => {
    const trails = createArcTrails()
    trails.spawn(shot(0, 300))
    trails.spawn(shot(1200, -900, -30))
    for (let t = 0; t < 40; t += 0.37) {
      trails.step(0.37, noop)
      const { pos, alp } = read(trails)
      expect(pos.every(Number.isFinite)).toBe(true)
      expect(alp.every(Number.isFinite)).toBe(true)
    }
    trails.dispose()
  })

  /** 落地之後頭端釘在落點，尾端一路追上來，整條慢慢收掉，不是瞬間消失 */
  it('落地那一步通報落點；之後頭端留在落點、尾流收掉，最後這一條空出來', () => {
    const trails = createArcTrails()
    const s = shot(600, 800)
    trails.spawn(s)
    const landed: ArcPoint[] = []
    const land = (x: number, y: number, z: number): void => { landed.push({ x, y, z }) }
    const dt = 0.25
    let t = 0
    while (t + dt < s.flight) { trails.step(dt, land); t += dt }
    expect(landed).toHaveLength(0)
    trails.step(dt, land)
    t += dt
    expect(landed).toHaveLength(1)
    expect(landed[0]!.x).toBeCloseTo(600, 6)
    expect(landed[0]!.y).toBeCloseTo(0, 6)
    expect(landed[0]!.z).toBeCloseTo(800, 6)
    // 之後不會再通報
    trails.step(2, land)
    expect(landed).toHaveLength(1)
    // 落地後 2 秒：頭端還在落點，管子比落地前短
    const head = ring(read(trails).pos, 0, ARC_TRAIL_RINGS - 1).c
    expect(head.x).toBeCloseTo(600, 3)
    expect(head.z).toBeCloseTo(800, 3)
    expect(trails.live).toBe(1)
    trails.step(ARC_TRAIL_SECONDS, land)
    expect(trails.live).toBe(0)
    const { pos, alp } = read(trails)
    for (let r = 0; r < ARC_TRAIL_RINGS; r++) expect(ring(pos, 0, r).radius).toBe(0)
    expect(Math.max(...alp.subarray(0, VERTS))).toBe(0)
    trails.dispose()
  })

  /** 開場時天上已經有的彈：從已經飛了幾秒的位置開始，落地的時刻是「飛行時間 − 已飛」之後 */
  it('帶著已飛的秒數發射：頭端在那一刻的位置，剩下的時間飛完就落地', () => {
    const trails = createArcTrails()
    const s = shot(1000, 0)
    trails.spawn(s, 10)
    trails.step(0, noop)
    const p: ArcPoint = { x: 0, y: 0, z: 0 }
    arcAt(s, 10, p)
    const head = ring(read(trails).pos, 0, ARC_TRAIL_RINGS - 1).c
    expect(head.x).toBeCloseTo(p.x, 3)
    expect(head.y).toBeCloseTo(p.y, 3)
    let landed = 0
    trails.step(s.flight - 10 - 0.5, () => { landed++ })
    expect(landed).toBe(0)
    trails.step(1, () => { landed++ })
    expect(landed).toBe(1)
    trails.dispose()
  })

  it('同時飛的彈互不相干：兩條各自在各自的那一段頂點', () => {
    const trails = createArcTrails()
    const a = shot(1000, 0)
    const b = shot(0, -700)
    trails.spawn(a)
    trails.spawn(b)
    trails.step(6, noop)
    const { pos } = read(trails)
    const p: ArcPoint = { x: 0, y: 0, z: 0 }
    arcAt(a, 6, p)
    expect(ring(pos, 0, ARC_TRAIL_RINGS - 1).c.x).toBeCloseTo(p.x, 3)
    arcAt(b, 6, p)
    expect(ring(pos, 1, ARC_TRAIL_RINGS - 1).c.z).toBeCloseTo(p.z, 3)
    expect(trails.live).toBe(2)
    trails.dispose()
  })

  it('池滿了新的一發蓋掉最舊的，不丟例外、不超出頂點', () => {
    const trails = createArcTrails(4)
    for (let k = 0; k < 7; k++) trails.spawn(shot(500 + k, 0))
    expect(trails.live).toBe(4)
    trails.step(1, noop)
    trails.dispose()
    expect(ARC_TRAIL_CAPACITY).toBeGreaterThanOrEqual(24)
  })

  it('reset 全部清空，之後可以再發', () => {
    const trails = createArcTrails()
    trails.spawn(shot(1000, 0))
    trails.step(5, noop)
    trails.reset()
    expect(trails.live).toBe(0)
    trails.spawn(shot(1000, 0))
    expect(trails.live).toBe(1)
    trails.dispose()
  })

  it('重力常數是物理的那一個（防止兩邊各抄一份而漂開）', () => {
    expect(ARC_GRAVITY).toBeCloseTo(9.81, 2)
  })
})
