import { describe, it, expect } from 'vitest'
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import {
  createSplashes, splashScale,
  SPLASH_HEIGHT, SPLASH_LIFE, SPLASH_RADIUS, SPLASH_RISE, SPLASH_TOP_RATIO,
} from '../../src/render/splash'
import { createImpacts, pushImpact } from '../../src/world/events'

function instance(mesh: InstancedMesh, i: number) {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  m.decompose(position, quaternion, scale)
  return { position, quaternion, scale }
}

/** 平海面：高度恆為 0。 */
const FLAT = (): number => 0

describe('splashScale —— 抽起再落下（M7 spec §7.1）', () => {
  it('壽命之外是 0', () => {
    expect(splashScale(-0.1)).toBe(0)
    expect(splashScale(SPLASH_LIFE)).toBe(0)
    expect(splashScale(SPLASH_LIFE + 1)).toBe(0)
  })

  it('剛出生是 0，抽到頂是 1', () => {
    expect(splashScale(0)).toBe(0)
    expect(splashScale(SPLASH_LIFE * SPLASH_RISE)).toBeCloseTo(1, 9)
  })

  it('前段單調上升', () => {
    let prev = -1
    for (let i = 0; i <= 10; i++) {
      const v = splashScale((SPLASH_LIFE * SPLASH_RISE * i) / 10)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('後段單調下降到 0', () => {
    const start = SPLASH_LIFE * SPLASH_RISE
    let prev = 2
    for (let i = 0; i <= 10; i++) {
      const v = splashScale(start + ((SPLASH_LIFE - start) * i) / 10)
      expect(v).toBeLessThanOrEqual(prev)
      prev = v
    }
    expect(prev).toBeCloseTo(0, 9)
  })

  it('抽起比落下快 —— 水柱是「噴」出來的', () => {
    // 前 30% 的壽命走完全程，後 70% 才落回去
    expect(SPLASH_RISE).toBeLessThan(0.5)
  })
})

describe('createSplashes', () => {
  it('整池只有一個 InstancedMesh —— 1 個 draw call', () => {
    const s = createSplashes(16)
    expect(s.object).toBeInstanceOf(InstancedMesh)
    let objects = 0
    s.object.traverse(() => objects++)
    expect(objects).toBe(1)
    expect(s.object.count).toBe(16)
    s.dispose()
  })

  it('建立時全部是死的、縮放為 0', () => {
    const s = createSplashes(8)
    expect(s.live).toBe(0)
    for (let i = 0; i < 8; i++) expect(instance(s.object, i).scale.y).toBe(0)
    s.dispose()
  })

  it('幾何以底面為原點 —— 只縮放 Y 就是從水面長出來', () => {
    // 【為什麼不是以中心為原點】以中心為原點的話，縮放 Y 會讓柱子從中間
    // 往兩邊長，下半截埋進水裡。
    const s = createSplashes(1)
    const pos = s.object.geometry.getAttribute('position')
    let yMin = Infinity
    let yMax = -Infinity
    for (let i = 0; i < pos.count; i++) {
      yMin = Math.min(yMin, pos.getY(i))
      yMax = Math.max(yMax, pos.getY(i))
    }
    expect(yMin).toBeCloseTo(0, 6)
    expect(yMax).toBeCloseTo(SPLASH_HEIGHT, 6)
    s.dispose()
  })

  it('底部的半徑是 SPLASH_RADIUS，頂端收緊', () => {
    // 【為什麼要收緊】人工驗收的回饋是「太小」，而 4 m 高配 0.25 m 半徑
    // 是 8:1 的細針 —— 與槍焰同一個成因：細長的東西在畫面上讀起來是
    // 一條線，不是一個東西。上方收緊之後才像一柱噴起來的水。
    const s = createSplashes(1)
    const pos = s.object.geometry.getAttribute('position')
    let bottomR = 0
    let topR = 0
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i))
      // 幾何已經平移成「底面在 y = 0」
      if (pos.getY(i) < SPLASH_HEIGHT * 0.5) bottomR = Math.max(bottomR, r)
      else topR = Math.max(topR, r)
    }
    expect(bottomR).toBeCloseTo(SPLASH_RADIUS, 6)
    expect(topR).toBeCloseTo(SPLASH_RADIUS * SPLASH_TOP_RATIO, 6)
    expect(topR).toBeLessThan(bottomR)
    s.dispose()
  })

  it('高寬比不會細成一根線', () => {
    // 12 m / 1.6 m = 7.5:1。原本的 4 m / 0.5 m 是 8:1 但絕對尺寸只有
    // 四分之一 —— 決定「讀不讀得出來」的是絕對尺寸，比例只是形狀。
    expect(SPLASH_HEIGHT / (SPLASH_RADIUS * 2)).toBeLessThan(10)
  })
})

describe('發射與步進（M7 spec §7.1）', () => {
  it('一個事件生一根柱子', () => {
    const s = createSplashes(16)
    const e = createImpacts(4)
    pushImpact(e, 10, 0, 20, 0, 1, 0)
    s.emit(e, FLAT, 0)
    expect(s.live).toBe(1)
    s.dispose()
  })

  it('底部擺在浪高上，不是固定 y = 0', () => {
    // 【為什麼】海面振幅 ±2.15 m —— 固定在 0 的話，波谷上會有一截
    // 埋進水裡、波峰上會整根浮在空中。
    const s = createSplashes(16)
    const e = createImpacts(4)
    pushImpact(e, 10, 0, 20, 0, 1, 0)
    s.emit(e, () => 1.75, 0)
    s.step(SPLASH_LIFE * SPLASH_RISE)
    const p = instance(s.object, 0).position
    expect(p.x).toBeCloseTo(10, 6)
    expect(p.y).toBeCloseTo(1.75, 6)
    expect(p.z).toBeCloseTo(20, 6)
    s.dispose()
  })

  it('高度先漲後落，壽命結束縮成 0', () => {
    const s = createSplashes(16)
    const e = createImpacts(4)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    s.emit(e, FLAT, 0)

    s.step(SPLASH_LIFE * SPLASH_RISE)
    const peak = instance(s.object, 0).scale.y
    expect(peak).toBeCloseTo(1, 6)

    s.step(SPLASH_LIFE * 0.5)
    const falling = instance(s.object, 0).scale.y
    expect(falling).toBeGreaterThan(0)
    expect(falling).toBeLessThan(peak)

    s.step(SPLASH_LIFE)
    expect(instance(s.object, 0).scale.y).toBe(0)
    expect(s.live).toBe(0)
    s.dispose()
  })

  it('柱子恆為垂直 —— 不隨任何東西旋轉', () => {
    const s = createSplashes(16)
    const e = createImpacts(4)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    s.emit(e, FLAT, 0)
    s.step(SPLASH_LIFE * SPLASH_RISE)
    const q = instance(s.object, 0).quaternion
    expect(q.angleTo(new Quaternion())).toBeCloseTo(0, 9)
    s.dispose()
  })

  it('池子滿了覆蓋最舊的', () => {
    const s = createSplashes(2)
    const e = createImpacts(8)
    for (let k = 0; k < 5; k++) pushImpact(e, k, 0, 0, 0, 1, 0)
    s.emit(e, FLAT, 0)
    expect(s.live).toBe(2)
    s.dispose()
  })

  it('連續五秒不產生 NaN', () => {
    const s = createSplashes(16)
    const e = createImpacts(4)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    s.emit(e, FLAT, 0)
    for (let i = 0; i < 300; i++) s.step(1 / 60)
    const inst = instance(s.object, 0)
    expect(Number.isFinite(inst.position.length())).toBe(true)
    expect(Number.isFinite(inst.scale.length())).toBe(true)
    s.dispose()
  })
})
