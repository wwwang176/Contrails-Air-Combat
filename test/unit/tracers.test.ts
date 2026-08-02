import { describe, it, expect } from 'vitest'
import { LineSegments, Vector3, type BufferAttribute } from 'three'
import { createTracers, TRACER_LENGTH } from '../../src/render/tracers'
import { Projectiles } from '../../src/world/Projectiles'

describe('createTracers', () => {
  it('整池只有一個 LineSegments —— spec §10 的 1 個 draw call', () => {
    // 【為什麼這一條值得測】曳光彈最直覺的寫法是一發一個 Line 物件，
    // 4,000 發就是 4,000 次 draw call。那不是「慢一點」，那是掉到個位數 FPS。
    const t = createTracers(64)
    expect(t.object).toBeInstanceOf(LineSegments)
    let meshCount = 0
    t.object.traverse(() => meshCount++)
    expect(meshCount).toBe(1)
    t.dispose()
  })

  it('頂點緩衝在建立時就配足容量 × 2（之後每幀只寫入，不重配）', () => {
    const t = createTracers(64)
    expect(t.object.geometry.getAttribute('position').count).toBe(128)
    t.dispose()
  })

  it('存活的彈丸畫成一段長度為 TRACER_LENGTH、與速度同向的線段', () => {
    const t = createTracers(4)
    const p = new Projectiles(4)
    p.spawn(100, 200, 300, 0, 0, -887, 6, 0)
    t.update(p)

    const pos = t.object.geometry.getAttribute('position')
    const tail = new Vector3(pos.getX(0), pos.getY(0), pos.getZ(0))
    const head = new Vector3(pos.getX(1), pos.getY(1), pos.getZ(1))
    // 頭在彈丸目前位置，尾在後方 TRACER_LENGTH 處
    expect(head.toArray()).toEqual([100, 200, 300])
    expect(head.distanceTo(tail)).toBeCloseTo(TRACER_LENGTH, 4)
    expect(tail.z).toBeGreaterThan(head.z)   // 尾巴在後方（+Z）
    t.dispose()
  })

  it('空槽位收成一個點（退化線段畫不出東西，不必另外剔除）', () => {
    const t = createTracers(4)
    const p = new Projectiles(4)
    p.spawn(0, 0, 0, 0, 0, -887, 6, 0)
    t.update(p)
    const pos = t.object.geometry.getAttribute('position')
    for (let i = 1; i < 4; i++) {
      const a = new Vector3(pos.getX(i * 2), pos.getY(i * 2), pos.getZ(i * 2))
      const b = new Vector3(pos.getX(i * 2 + 1), pos.getY(i * 2 + 1), pos.getZ(i * 2 + 1))
      expect(a.distanceTo(b)).toBe(0)
    }
    t.dispose()
  })

  it('彈丸回收之後那一格立刻變成點', () => {
    const t = createTracers(4)
    const p = new Projectiles(4)
    const i = p.spawn(0, 0, 0, 0, 0, -887, 6, 0)
    t.update(p)
    p.kill(i)
    t.update(p)
    const pos = t.object.geometry.getAttribute('position')
    const a = new Vector3(pos.getX(0), pos.getY(0), pos.getZ(0))
    const b = new Vector3(pos.getX(1), pos.getY(1), pos.getZ(1))
    expect(a.distanceTo(b)).toBe(0)
    t.dispose()
  })

  it('update 之後標記 needsUpdate（否則畫面永遠停在第一幀）', () => {
    // 【為什麼看 version 而不是 needsUpdate】three.js 的 needsUpdate 是
    // **只寫**的存取器——setter 做的事就是 `version++`，而它根本沒有
    // getter，所以讀出來恆為 undefined。真正被上傳路徑檢查的是 version。
    const t = createTracers(4)
    const p = new Projectiles(4)
    const attr = t.object.geometry.getAttribute('position') as BufferAttribute
    const before = attr.version
    t.update(p)
    expect(attr.version).toBeGreaterThan(before)
    t.dispose()
  })

  it('零速度的彈丸不產生 NaN（normalize 除以 0）', () => {
    const t = createTracers(4)
    const p = new Projectiles(4)
    p.spawn(1, 2, 3, 0, 0, 0, 6, 0)
    t.update(p)
    const pos = t.object.geometry.getAttribute('position')
    for (let i = 0; i < 8 * 3; i++) expect(Number.isFinite(pos.array[i]!)).toBe(true)
    t.dispose()
  })

  it('frustumCulled 關閉 —— 包圍盒不會跟著逐幀更新的頂點走', () => {
    // 幾何的 boundingSphere 是建立時算的（全部在原點），開著剔除的話
    // 相機一離開原點附近，整條曳光彈會整批消失。
    const t = createTracers(4)
    expect(t.object.frustumCulled).toBe(false)
    t.dispose()
  })
})
