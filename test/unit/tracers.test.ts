import { describe, it, expect } from 'vitest'
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import {
  createTracers, TRACER_LENGTH, TRACER_RADIUS, TRACER_TAPER,
} from '../../src/render/tracers'
import { Projectiles, PROJECTILE_LIFETIME } from '../../src/world/Projectiles'

/** 讀出第 i 個實例的位置／旋轉／縮放。 */
function instance(mesh: InstancedMesh, i: number) {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  m.decompose(position, quaternion, scale)
  return { position, quaternion, scale }
}

/** 第 i 發曳光在世界座標的頭端與尾端。 */
function ends(mesh: InstancedMesh, i: number) {
  const { position, quaternion, scale } = instance(mesh, i)
  // 幾何沿 +Z、長度 1、以原點為中心；+Z 端是頭
  const axis = new Vector3(0, 0, 1).applyQuaternion(quaternion).multiplyScalar(scale.z / 2)
  return { head: position.clone().add(axis), tail: position.clone().sub(axis), scale }
}

describe('createTracers', () => {
  it('整池只有一個 InstancedMesh —— 1 個 draw call', () => {
    // 【為什麼這一條值得測】曳光彈最直覺的寫法是一發一個物件，4,000 發就是
    // 4,000 次 draw call。那不是「慢一點」，那是掉到個位數 FPS。
    const t = createTracers(64)
    expect(t.object).toBeInstanceOf(InstancedMesh)
    let objects = 0
    t.object.traverse(() => objects++)
    expect(objects).toBe(1)
    // 【看緩衝而不是 count】`count` 是「這一幀畫幾個」，空池時是 0。
    // 這一條問的是「整池是不是一個物件」，那對應的是緩衝的容量
    expect(t.object.instanceMatrix.count).toBe(64)
    t.dispose()
  })

  it('實例矩陣緩衝在建立時就配足容量（之後每幀只寫入，不重配）', () => {
    const t = createTracers(64)
    const buffer = t.object.instanceMatrix
    expect(buffer.count).toBe(64)
    const p = new Projectiles(64)
    p.spawn(0, 0, 0, 0, 0, -887, 6, 0, 0, PROJECTILE_LIFETIME)
    t.update(p)
    expect(t.object.instanceMatrix).toBe(buffer)
    t.dispose()
  })

  it('建立時全部收成 0，第一幀不會在原點出現一叢', () => {
    const t = createTracers(8)
    for (let i = 0; i < 8; i++) expect(instance(t.object, i).scale.z).toBe(0)
    t.dispose()
  })
})

describe('曳光彈的幾何', () => {
  it('粗細是世界單位——這正是換掉 LineSegments 的理由', () => {
    // LineBasicMaterial 的 linewidth 在 WebGL 上恆為 1 個裝置像素，遠近一樣粗。
    // 半徑烘在幾何裡、只有長度靠縮放，所以 X/Y 的縮放必須恆為 1。
    const t = createTracers(4)
    const p = new Projectiles(4)
    p.spawn(0, 0, 0, 0, 0, -887, 6, 0, 0, PROJECTILE_LIFETIME)
    for (let i = 0; i < 8; i++) p.step(1 / 240)
    t.update(p)
    const { scale } = instance(t.object, 0)
    expect(scale.x).toBeCloseTo(1, 9)
    expect(scale.y).toBeCloseTo(1, 9)
    t.dispose()
  })

  it('頭端比尾端粗（錐狀，讀得出方向）', () => {
    expect(TRACER_TAPER).toBeGreaterThan(0)
    expect(TRACER_TAPER).toBeLessThan(1)
    const t = createTracers(1)
    const pos = t.object.geometry.getAttribute('position')
    // 幾何沿 +Z：找出 z 最大與最小那一圈的半徑
    let headR = 0
    let tailR = 0
    let zMax = -Infinity
    let zMin = Infinity
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i)
      const r = Math.hypot(pos.getX(i), pos.getY(i))
      if (z > zMax) { zMax = z; headR = r }
      if (z < zMin) { zMin = z; tailR = r }
    }
    expect(headR).toBeCloseTo(TRACER_RADIUS, 5)
    expect(tailR).toBeCloseTo(TRACER_RADIUS * TRACER_TAPER, 5)
    t.dispose()
  })
})

describe('曳光彈的位置與長度', () => {
  it('存活的彈丸畫成一段長度為 TRACER_LENGTH、與速度同向的實例', () => {
    const t = createTracers(4)
    const p = new Projectiles(4)
    p.spawn(100, 200, 300, 0, 0, -887, 6, 0, 0, PROJECTILE_LIFETIME)
    // 飛滿 14 m 以上，尾巴才會長到全長（見下一條）
    for (let i = 0; i < 8; i++) p.step(1 / 240)
    t.update(p)

    const { head, tail, scale } = ends(t.object, 0)
    // 頭在彈丸目前位置，尾在後方 TRACER_LENGTH 處
    expect(head.x).toBeCloseTo(p.x[0]!, 3)
    expect(head.y).toBeCloseTo(p.y[0]!, 3)
    expect(head.z).toBeCloseTo(p.z[0]!, 3)
    expect(scale.z).toBeCloseTo(TRACER_LENGTH, 4)
    expect(head.distanceTo(tail)).toBeCloseTo(TRACER_LENGTH, 4)
    expect(tail.z).toBeGreaterThan(head.z)   // 尾巴在後方（+Z）
    t.dispose()
  })

  it('剛出膛的曳光不會長過它實際飛過的距離', () => {
    // 【這是實際看得到的缺陷】固定 14 m 的話，第一發一出膛尾端就落在槍口
    // 後方——穿進自己的機身、一路拖到機尾外面，看起來像機尾在噴火。
    const t = createTracers(4)
    const p = new Projectiles(4)
    const i = p.spawn(0, 0, 0, 0, 0, -887, 6, 0, 0, PROJECTILE_LIFETIME)
    const len = (): number => {
      t.update(p)
      return instance(t.object, 0).scale.z
    }

    // 尚未推進：長度 0，槍口前方不該憑空出現一條線
    expect(len()).toBe(0)

    // 每一步的曳光長度都必須等於「已飛過的距離」，直到 14 m 為止
    for (let n = 1; n <= 6; n++) {
      p.step(1 / 240)
      const travelled = 887 * p.age[i]!
      expect(len()).toBeCloseTo(Math.min(TRACER_LENGTH, travelled), 3)
    }
    t.dispose()
  })

  it('斜向飛行時實例朝著速度方向', () => {
    const t = createTracers(4)
    const p = new Projectiles(4)
    const v = new Vector3(300, 200, -700)
    p.spawn(0, 0, 0, v.x, v.y, v.z, 6, 0, 0, PROJECTILE_LIFETIME)
    for (let i = 0; i < 20; i++) p.step(1 / 240)
    t.update(p)
    const { head, tail } = ends(t.object, 0)
    const axis = head.clone().sub(tail).normalize()
    expect(axis.dot(v.clone().normalize())).toBeCloseTo(1, 6)
    t.dispose()
  })

  it('空槽位縮放到 0（畫不出東西，不必另外剔除）', () => {
    const t = createTracers(4)
    const p = new Projectiles(4)
    p.spawn(0, 0, 0, 0, 0, -887, 6, 0, 0, PROJECTILE_LIFETIME)
    t.update(p)
    for (let i = 1; i < 4; i++) expect(instance(t.object, i).scale.z).toBe(0)
    t.dispose()
  })

  it('彈丸回收之後那一格立刻縮成 0', () => {
    const t = createTracers(4)
    const p = new Projectiles(4)
    const i = p.spawn(0, 0, 0, 0, 0, -887, 6, 0, 0, PROJECTILE_LIFETIME)
    for (let n = 0; n < 8; n++) p.step(1 / 240)
    t.update(p)
    expect(instance(t.object, 0).scale.z).toBeGreaterThan(0)
    p.kill(i)
    t.update(p)
    expect(instance(t.object, 0).scale.z).toBe(0)
    t.dispose()
  })

  it('速度為 0 時不產生 NaN', () => {
    const t = createTracers(4)
    const p = new Projectiles(4)
    p.spawn(1, 2, 3, 0, 0, 0, 6, 0, 0, PROJECTILE_LIFETIME)
    p.step(1 / 240)
    t.update(p)
    const { position, scale } = instance(t.object, 0)
    expect(Number.isFinite(position.length())).toBe(true)
    expect(scale.z).toBe(0)
    t.dispose()
  })

  it('容量大於彈丸池時不會越界', () => {
    const t = createTracers(8)
    const p = new Projectiles(4)
    p.spawn(0, 0, 0, 0, 0, -887, 6, 0, 0, PROJECTILE_LIFETIME)
    expect(() => t.update(p)).not.toThrow()
    t.dispose()
  })
})
