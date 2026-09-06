import { describe, it, expect } from 'vitest'
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import {
  bulletPoints, createSplashes, splashScale, splashSize,
  SPLASH_FALL_SECONDS, SPLASH_HEIGHT, SPLASH_HEIGHT_MAX, SPLASH_HEIGHT_MIN,
  SPLASH_JET_SECONDS, SPLASH_LIFE, SPLASH_RADIUS, SPLASH_SHOULDER, SPLASH_TOP_RATIO,
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
    expect(splashScale(SPLASH_JET_SECONDS)).toBeCloseTo(1, 9)
  })

  it('前段單調上升', () => {
    let prev = -1
    for (let i = 0; i <= 10; i++) {
      const v = splashScale((SPLASH_JET_SECONDS * i) / 10)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('後段單調下降到 0', () => {
    let prev = 2
    for (let i = 0; i <= 10; i++) {
      const v = splashScale(SPLASH_JET_SECONDS + (SPLASH_FALL_SECONDS * i) / 10)
      expect(v).toBeLessThanOrEqual(prev)
      prev = v
    }
    expect(prev).toBeCloseTo(0, 9)
  })

  it('抽起比落下快 —— 水柱是「噴」出來的', () => {
    expect(SPLASH_JET_SECONDS).toBeLessThan(SPLASH_FALL_SECONDS)
  })

  it('壽命就是兩段之和 —— 沒有第三個要對齊的數字', () => {
    expect(SPLASH_LIFE).toBeCloseTo(SPLASH_JET_SECONDS + SPLASH_FALL_SECONDS, 9)
  })
})

describe('createSplashes', () => {
  it('整池只有一個 InstancedMesh —— 1 個 draw call', () => {
    const s = createSplashes(16)
    expect(s.object).toBeInstanceOf(InstancedMesh)
    let objects = 0
    s.object.traverse(() => objects++)
    expect(objects).toBe(1)
    // 【看緩衝而不是 count】`count` 是「這一幀畫幾個」，空池時是 0
    expect(s.object.instanceMatrix.count).toBe(16)
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

  it('底部的半徑是 SPLASH_RADIUS，肩部微收', () => {
    const s = createSplashes(1)
    const pos = s.object.geometry.getAttribute('position')
    let bottomR = 0
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 0.01) bottomR = Math.max(bottomR, Math.hypot(pos.getX(i), pos.getZ(i)))
    }
    expect(bottomR).toBeCloseTo(SPLASH_RADIUS, 6)
    expect(SPLASH_TOP_RATIO).toBeLessThan(1)
    s.dispose()
  })

  it('是子彈型 —— 柱身微收、上方圓潤收到一點', () => {
    // 【為什麼測剖面而不是網格頂點】LatheGeometry 只在剖面點上產生頂點，
    // 柱身那一整段中間一個頂點也沒有。把網格頂點依高度分箱的話，柱身的
    // 箱子全是空的，差值會算出 1.8（= 0.8 − (−1) 的初值）。
    const p = bulletPoints()
    // 底部
    expect(p[0]!.x).toBeCloseTo(SPLASH_RADIUS, 6)
    expect(p[0]!.y).toBeCloseTo(0, 6)
    // 肩部：柱身只微收
    expect(p[1]!.x).toBeCloseTo(SPLASH_RADIUS * SPLASH_TOP_RATIO, 6)
    expect(p[1]!.y).toBeCloseTo(SPLASH_HEIGHT * SPLASH_SHOULDER, 6)
    expect(p[0]!.x - p[1]!.x).toBeLessThan(SPLASH_RADIUS * 0.3)
    // 頂點：收到一點，不是平頂
    const top = p[p.length - 1]!
    expect(top.x).toBeCloseTo(0, 5)
    expect(top.y).toBeCloseTo(SPLASH_HEIGHT, 5)
  })

  it('圓頭的收斂逐段變快 —— 那正是「圓」與「收尖的錐」的差別', () => {
    // 直線錐每一段收一樣多；圓弧則越靠頂端收得越快。
    const p = bulletPoints()
    const nose = p.slice(1) // 肩部起
    const drops: number[] = []
    for (let i = 1; i < nose.length; i++) drops.push(nose[i - 1]!.x - nose[i]!.x)
    // 每一段的收斂量都必須大於前一段
    for (let i = 1; i < drops.length; i++) {
      expect(drops[i]!).toBeGreaterThan(drops[i - 1]!)
    }
  })

  it('剖面沿著高度單調上升 —— 不會自己穿過自己', () => {
    const p = bulletPoints()
    for (let i = 1; i < p.length; i++) {
      expect(p[i]!.y).toBeGreaterThan(p[i - 1]!.y)
      expect(p[i]!.x).toBeLessThanOrEqual(p[i - 1]!.x + 1e-9)
    }
  })

  it('每一根的高度不一樣 —— 十根一樣高讀起來是一排柵欄', () => {
    const heights = new Set<number>()
    for (let i = 0; i < 10; i++) heights.add(Number(splashSize(i).height.toFixed(6)))
    expect(heights.size).toBe(10)
  })

  it('高度倍率恆落在設定的範圍內，而且高的也比較粗', () => {
    let minH = Infinity
    let maxH = -Infinity
    let rAtMin = 0
    let rAtMax = 0
    for (let i = 0; i < 500; i++) {
      const sz = splashSize(i)
      expect(sz.height).toBeGreaterThanOrEqual(SPLASH_HEIGHT_MIN - 1e-9)
      expect(sz.height).toBeLessThanOrEqual(SPLASH_HEIGHT_MAX + 1e-9)
      if (sz.height < minH) { minH = sz.height; rAtMin = sz.radius }
      if (sz.height > maxH) { maxH = sz.height; rAtMax = sz.radius }
    }
    // 【為什麼高的要比較粗】只變高度的話，高的那幾根會變成針
    expect(rAtMax).toBeGreaterThan(rAtMin)
  })

  it('同一格恆得同一個尺寸 —— 純函數，重播可重現', () => {
    for (let i = 0; i < 50; i++) {
      expect(splashSize(i).height).toBe(splashSize(i).height)
      expect(splashSize(i).radius).toBe(splashSize(i).radius)
    }
  })

  it('高寬比不會細成一根線', () => {
    // 12 m / 1.6 m = 7.5:1。原本的 4 m / 0.5 m 是 8:1 但絕對尺寸只有
    // 四分之一 —— 決定「讀不讀得出來」的是絕對尺寸，比例只是形狀。
    // 最細的那一根（高度倍率最小、半徑倍率也最小）也要守得住。
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
    s.step(SPLASH_JET_SECONDS)
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

    s.step(SPLASH_JET_SECONDS)
    const peak = instance(s.object, 0).scale.y
    // 抽到頂時的 Y 縮放 = 1 × 這一格的高度倍率
    expect(peak).toBeCloseTo(splashSize(0).height, 5)

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
    s.step(SPLASH_JET_SECONDS)
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
