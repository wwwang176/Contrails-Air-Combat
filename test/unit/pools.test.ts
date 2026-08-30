import { describe, it, expect } from 'vitest'
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import { createTracers } from '../../src/render/tracers'
import { createSparks } from '../../src/render/sparks'
import { createSplashes } from '../../src/render/splash'
import { createMuzzles, createTurretMuzzles } from '../../src/render/muzzle'
import { Projectiles } from '../../src/world/Projectiles'
import { createImpacts, pushImpact } from '../../src/world/events'

/**
 * **實例池的上傳閘與 `count`**。
 *
 * 【它在守什麼】這幾個池每幀無條件跑滿整個容量、寫完再無條件
 * `needsUpdate = true`。對正在被 GPU 讀的緩衝呼叫 `bufferSubData` 會強迫
 * 管線同步 —— 貴的是那個動作本身，不是 685 KB 的頻寬（`backlog §11.8`）。
 *
 * 兩條不變量：
 *
 * ```
 *   整池全死          不上傳，而且 count 收到 0（頂點著色器一格都不跑）
 *   有任何一格動過    一定上傳
 * ```
 *
 * **第二條比第一條重要。**漏標 `touched` 的症狀是那一層停在上一幀 ——
 * 曳光彈不動、火花凍住 —— 而那個缺陷在靜態截圖上看不出來。
 */

/**
 * 上傳的次數。
 *
 * 【為什麼不看 `needsUpdate`】three 的 `BufferAttribute.needsUpdate` 只有
 * setter，讀出來永遠是 `undefined`。真正被記下來的是 `version` —— 每設一次
 * `needsUpdate = true` 就加一。
 */
function uploads(a: { version: number }): number {
  return a.version
}

/** 第 i 個實例的縮放。全零 = 這一格畫不出東西。 */
function scaleOf(mesh: InstancedMesh, i: number): Vector3 {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const s = new Vector3()
  m.decompose(new Vector3(), new Quaternion(), s)
  return s
}

describe('曳光彈池', () => {
  it('剛建立時 count 是 0', () => {
    const t = createTracers(64)
    expect(t.object.count).toBe(0)
    t.dispose()
  })

  it('整池全死時不上傳，而且不畫', () => {
    const t = createTracers(64)
    const p = new Projectiles(64)
    t.update(p)
    expect(t.object.count).toBe(0)
    const vt = uploads(t.object.instanceMatrix)
    t.update(p)
    expect(uploads(t.object.instanceMatrix)).toBe(vt)
    expect(t.object.count).toBe(0)
    t.dispose()
  })

  it('有東西動時一定上傳', () => {
    const t = createTracers(64)
    const p = new Projectiles(64)
    t.update(p)
    const vt = uploads(t.object.instanceMatrix)
    // 前三格空著，第 3 格生一發（spawn 由 0 起算，所以先丟三發再殺掉）
    for (let i = 0; i < 3; i++) { p.spawn(0, 0, 0, 0, 0, -887, 6, 0); p.kill(i) }
    p.spawn(10, 20, 30, 0, 0, -887, 6, 0)
    p.step(0.02)
    t.update(p)
    expect(uploads(t.object.instanceMatrix)).toBeGreaterThan(vt)
    expect(t.object.count).toBe(4)
    expect(scaleOf(t.object, 3).z).toBeGreaterThan(0)
    t.dispose()
  })

  it('死掉的那一格會被歸零', () => {
    const t = createTracers(64)
    const p = new Projectiles(64)
    p.spawn(10, 20, 30, 0, 0, -887, 6, 0)
    p.spawn(40, 50, 60, 0, 0, -887, 6, 0)
    p.step(0.02)
    t.update(p)
    expect(scaleOf(t.object, 0).z).toBeGreaterThan(0)
    p.kill(0)
    t.update(p)
    expect(scaleOf(t.object, 0).z).toBe(0)
    // 活著的那一格仍然在，count 還是 2
    expect(scaleOf(t.object, 1).z).toBeGreaterThan(0)
    expect(t.object.count).toBe(2)
    t.dispose()
  })

  it('走一段腳本之後，畫得出來的那一批永遠恰好是活著的那一批', () => {
    // 【它在守什麼】這一項的承諾是「畫面一個像素都不動」。等價的說法是：
    // 任何一幀，`[0, count)` 裡縮放非零的格子恰好是那一幀活著的彈丸 ——
    // 少一個就是彈丸憑空消失，多一個就是死掉的彈丸留在畫面上。
    const t = createTracers(32)
    const p = new Projectiles(32)
    const script: (() => void)[] = [
      () => { p.spawn(0, 0, 0, 0, 0, -887, 6, 0) },
      () => { p.spawn(5, 0, 0, 0, 0, -887, 6, 1) },
      () => { p.kill(0) },
      () => { p.spawn(9, 0, 0, 0, 0, -887, 6, 0) },
      () => { p.kill(2) },
      () => { p.kill(1) },
      () => { p.spawn(3, 0, 0, 0, 0, -887, 6, 1) },
    ]
    for (const act of script) {
      act()
      p.step(0.02)
      t.update(p)
      // 期望：owner ≠ −1 而且已經飛了一段（length > 0）的那些
      const want = new Set<number>()
      for (let i = 0; i < 32; i++) {
        if (p.owner[i] === -1) continue
        const speed = Math.hypot(p.vx[i]!, p.vy[i]!, p.vz[i]!)
        if (speed * p.age[i]! > 0) want.add(i)
      }
      const drawn = new Set<number>()
      for (let i = 0; i < t.object.count; i++) {
        if (scaleOf(t.object, i).z !== 0) drawn.add(i)
      }
      expect([...drawn].sort()).toEqual([...want].sort())
    }
    t.dispose()
  })
})

describe('火花池', () => {
  it('剛建立時 count 是 0', () => {
    const s = createSparks(64)
    expect(s.object.count).toBe(0)
    s.dispose()
  })

  it('整池全死時不上傳，而且不畫', () => {
    const s = createSparks(64)
    s.step(0.02)
    expect(s.object.count).toBe(0)
    const vs = uploads(s.object.instanceMatrix)
    s.step(0.02)
    expect(uploads(s.object.instanceMatrix)).toBe(vs)
    expect(s.object.count).toBe(0)
    s.dispose()
  })

  it('有東西動時一定上傳', () => {
    const s = createSparks(64)
    s.step(0.02)
    const vs = uploads(s.object.instanceMatrix)
    const ev = createImpacts(4)
    pushImpact(ev, 0, 0, 0, 0, 1, 0)
    s.emit(ev, 0, 0, 0)
    s.step(0.02)
    expect(uploads(s.object.instanceMatrix)).toBeGreaterThan(vs)
    expect(s.object.count).toBeGreaterThan(0)
    s.dispose()
  })

  it('走一段腳本之後，畫得出來的數量恰好等於活著的數量', () => {
    const s = createSparks(64)
    const ev = createImpacts(8)
    for (let frame = 0; frame < 40; frame++) {
      ev.count = 0
      if (frame % 7 === 0) pushImpact(ev, frame, 0, 0, 0, 1, 0)
      s.emit(ev, 0, 0, 0)
      s.step(0.02)
      let drawn = 0
      for (let i = 0; i < s.object.count; i++) if (scaleOf(s.object, i).z !== 0) drawn++
      expect(drawn).toBe(s.live)
    }
    s.dispose()
  })
})

describe('水花池', () => {
  it('剛建立時 count 是 0', () => {
    const s = createSplashes(64)
    expect(s.object.count).toBe(0)
    s.dispose()
  })

  it('整池全死時不上傳，而且不畫', () => {
    const s = createSplashes(64)
    s.step(0.02)
    expect(s.object.count).toBe(0)
    const vs = uploads(s.object.instanceMatrix)
    s.step(0.02)
    expect(uploads(s.object.instanceMatrix)).toBe(vs)
    expect(s.object.count).toBe(0)
    s.dispose()
  })

  it('有東西動時一定上傳', () => {
    const s = createSplashes(64)
    s.step(0.02)
    const vs = uploads(s.object.instanceMatrix)
    const ev = createImpacts(4)
    pushImpact(ev, 0, 0, 0, 0, 1, 0)
    s.emit(ev, () => 0, 0)
    s.step(0.02)
    expect(uploads(s.object.instanceMatrix)).toBeGreaterThan(vs)
    expect(s.object.count).toBeGreaterThan(0)
    s.dispose()
  })

  it('走一段腳本之後，畫得出來的數量恰好等於活著的數量', () => {
    const s = createSplashes(64)
    const ev = createImpacts(8)
    for (let frame = 0; frame < 40; frame++) {
      ev.count = 0
      if (frame % 5 === 0) pushImpact(ev, frame, 0, 0, 0, 1, 0)
      s.emit(ev, () => 0, 0)
      s.step(0.02)
      let drawn = 0
      for (let i = 0; i < s.object.count; i++) if (scaleOf(s.object, i).y !== 0) drawn++
      expect(drawn).toBe(s.live)
    }
    s.dispose()
  })
})

describe('槍焰池', () => {
  it('剛建立時 count 是 0', () => {
    const m = createMuzzles(4)
    const t = createTurretMuzzles(4)
    expect(m.object.count).toBe(0)
    expect(t.object.count).toBe(0)
    m.dispose()
    t.dispose()
  })

  it('沒有人開火時不上傳，而且不畫', () => {
    const m = createMuzzles(4)
    m.update([], [], [])
    expect(m.object.count).toBe(0)
    const vm = uploads(m.object.instanceMatrix)
    m.update([], [], [])
    expect(uploads(m.object.instanceMatrix)).toBe(vm)
    expect(m.object.count).toBe(0)
    m.dispose()
  })

  it('砲塔槍焰同樣：沒有人開火時不上傳', () => {
    const t = createTurretMuzzles(4)
    t.update([], [], [])
    const vt = uploads(t.object.instanceMatrix)
    t.update([], [], [])
    expect(uploads(t.object.instanceMatrix)).toBe(vt)
    expect(t.object.count).toBe(0)
    t.dispose()
  })
})
