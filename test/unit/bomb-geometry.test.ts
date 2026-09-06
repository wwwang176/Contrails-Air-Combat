import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import {
  BOMB_BODY_RADIUS, BOMB_LENGTH, BOMB_SHAPE, TORPEDO_SHAPE,
  bombOrientation, createBombGeometry,
} from '../../src/render/bombs'

const geo = createBombGeometry()
const pos = geo.getAttribute('position')

/** 所有頂點，[半徑, 軸向] */
const V: [number, number][] = []
for (let i = 0; i < pos.count; i++) {
  V.push([Math.hypot(pos.getX(i), pos.getZ(i)), pos.getY(i)])
}

const NOSE = -BOMB_LENGTH / 2
const TAIL = BOMB_LENGTH / 2

describe('炸彈的幾何', () => {
  it('軸向長度就是 BOMB_LENGTH，而且以原點為中心', () => {
    const ys = V.map(([, y]) => y)
    expect(Math.min(...ys)).toBeCloseTo(NOSE, 6)
    expect(Math.max(...ys)).toBeCloseTo(TAIL, 6)
  })

  it('尖端在 −Y、尾在 +Y —— `setFromUnitVectors(TAIL, DIR)` 靠這條', () => {
    // 【壞了不會有錯誤】反過來的話炸彈倒著飛，而尾翼在前看起來一樣「有姿態」
    const noseR = Math.max(...V.filter(([, y]) => y < NOSE + 0.02).map(([r]) => r))
    const tailR = Math.max(...V.filter(([, y]) => y > TAIL - 0.02).map(([r]) => r))
    expect(noseR).toBeLessThan(0.05)
    expect(tailR).toBeGreaterThan(0.1)
  })

  it('最粗的一圈是彈體，而且在前半段', () => {
    let widest = 0
    let widestY = 0
    for (const [r, y] of V) {
      if (r > widest) { widest = r; widestY = y }
    }
    expect(widest).toBeCloseTo(BOMB_BODY_RADIUS, 6)
    expect(widestY).toBeLessThan(0)
  })

  it('尾翼不比彈體寬 —— 掛在彈艙裡的東西不會比自己的腰粗', () => {
    const fins = V.filter(([, y]) => y > 0.3)
    expect(Math.max(...fins.map(([r]) => r))).toBeLessThanOrEqual(BOMB_BODY_RADIUS + 1e-6)
  })

  it('是 lowpoly —— 三角形不超過 130 個', () => {
    const index = geo.getIndex()
    const tris = (index === null ? pos.count : index.count) / 3
    expect(tris).toBeLessThanOrEqual(130)
    // 【下界也要守】掉到剩幾個面就代表輪廓被寫壞了，而遠看仍是一個深灰的點
    expect(tris).toBeGreaterThan(60)
  })

  it('有法線 —— MeshLambertMaterial 少了它整批全黑', () => {
    expect(geo.getAttribute('normal')).toBeDefined()
  })
})

describe('炸彈的姿態', () => {
  const q = new Quaternion()
  /** 模型的尖端是局部 −Y。轉到世界之後應該與速度同向 */
  const nose = (vx: number, vy: number, vz: number): Vector3 => {
    bombOrientation(vx, vy, vz, q)
    return new Vector3(0, -1, 0).applyQuaternion(q)
  }

  it('尖端朝速度 —— 不是尾巴', () => {
    const cases: readonly (readonly [number, number, number])[] = [
      [0, -1, 0],       // 垂直落下
      [0, 0, -1],       // 剛投出，水平
      [90, -30, 0],     // 前拋中
      [-40, -120, 60],  // 落地前
      [0, 1, 0],        // 退化：速度朝正上方
    ]
    for (const [vx, vy, vz] of cases) {
      const v = new Vector3(vx, vy, vz).normalize()
      expect(nose(vx, vy, vz).dot(v)).toBeCloseTo(1, 6)
    }
  })

  it('輸出是單位四元數', () => {
    bombOrientation(90, -30, 12, q)
    expect(q.length()).toBeCloseTo(1, 9)
  })
})

/**
 * 頂點陣列的逐位元指紋。**只比頂點數與包圍盒抓不到頂點重排或局部變形。**
 *
 * 【怎麼用】這個值變了，就是幾何真的變了。若那是有意的改動，重新量一次
 * 並更新常數；若不是，那就是回歸。
 */
function fingerprint(geo: BufferGeometry): number {
  const a = geo.getAttribute('position').array
  let h = 0
  for (let i = 0; i < a.length; i++) {
    const u = new Uint32Array(new Float64Array([a[i] as number]).buffer)
    h = (Math.imul(h ^ u[0]!, 0x01000193) ^ u[1]!) >>> 0
  }
  return h
}

describe('外型參數化', () => {
  /**
   * 【炸彈的倍率是 1】`x * 1` 在 IEEE754 下精確，所以把輪廓表改成「絕對
   * 尺寸 × 倍率」之後，炸彈的每一個頂點都不變。
   */
  it('炸彈的頂點與參數化之前逐位元相同', () => {
    expect(createBombGeometry().getAttribute('position').count).toBe(90)
    expect(geo.getIndex()!.count).toBe(252)
    expect(fingerprint(geo)).toBe(2423306638)
  })

  it('預設參數就是 BOMB_SHAPE', () => {
    expect(fingerprint(createBombGeometry(BOMB_SHAPE))).toBe(fingerprint(geo))
  })

  it('魚雷是拉長的炸彈：5.27 m × 0.45 m', () => {
    const t = createBombGeometry(TORPEDO_SHAPE)
    const p = t.getAttribute('position')
    let minY = Infinity
    let maxY = -Infinity
    let maxR = 0
    for (let i = 0; i < p.count; i++) {
      minY = Math.min(minY, p.getY(i))
      maxY = Math.max(maxY, p.getY(i))
      maxR = Math.max(maxR, Math.hypot(p.getX(i), p.getZ(i)))
    }
    expect(maxY - minY).toBeCloseTo(5.27, 2)
    expect(maxR * 2).toBeCloseTo(0.45, 2)
  })

  /**
   * 【面數不得跟著變】拉長不是細分。同樣 84 個三角形，只是比例不同。
   */
  it('魚雷與炸彈的面數相同 —— 拉長不加面', () => {
    const t = createBombGeometry(TORPEDO_SHAPE)
    expect(t.getAttribute('position').count).toBe(geo.getAttribute('position').count)
    expect(t.getIndex()!.count).toBe(geo.getIndex()!.count)
  })

  it('魚雷的尖端也在 −Y —— 姿態公式共用', () => {
    const p = createBombGeometry(TORPEDO_SHAPE).getAttribute('position')
    let noseR = 0
    let tailR = 0
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getZ(i))
      if (p.getY(i) < -2.5) noseR = Math.max(noseR, r)
      if (p.getY(i) > 2.5) tailR = Math.max(tailR, r)
    }
    expect(noseR).toBeLessThan(0.06)
    expect(tailR).toBeGreaterThan(0.1)
  })
})
