import { describe, it, expect } from 'vitest'
import { Color, InstancedMesh, Matrix4, Quaternion, SRGBColorSpace, Vector3 } from 'three'
import {
  createFireball, emitFireball, fireballColor,
  FIREBALL_COUNT, FIREBALL_INHERIT, FIREBALL_LIFE, FIREBALL_SIZE_FROM, FIREBALL_SPEED,
} from '../../src/render/fireball'
import { createKills, pushKill } from '../../src/world/kills'

function positionOf(mesh: InstancedMesh, i: number): Vector3 {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const p = new Vector3()
  m.decompose(p, new Quaternion(), new Vector3())
  return p
}

describe('fireballColor —— 白到橘到暗紅（M8 spec §5）', () => {
  const c = new Color()
  const srgb = { r: 0, g: 0, b: 0 }

  /**
   * 【為什麼要在 sRGB 空間讀回】色標是用 sRGB 寫的（橘色 (1,.45,.05)），而
   * `Color` 內部存線性值。直接讀 `c.r/c.g/c.b` 讀到的是轉換後的線性值，
   * 斷言就會綁在內部表示法上而不是作者的意圖。
   */
  const read = (t: number) => { fireballColor(t, c); c.getRGB(srgb, SRGBColorSpace); return srgb }

  it('出生是近白的熱色', () => {
    const v = read(0)
    expect(v.r).toBeCloseTo(1, 3)
    expect(v.g).toBeGreaterThan(0.9)
    expect(v.b).toBeGreaterThan(0.7)
  })

  it('中段是橘的 —— 紅遠大於綠、綠遠大於藍', () => {
    // 【為什麼不能用兩點內插】白 (1,.95,.8) 直接線性內插到暗紅 (.25,.02,0)，
    // 中點是 (.63,.49,.4) —— 那是脫色的土黃，不是火。
    const v = read(0.5)
    expect(v.r).toBeGreaterThan(v.g * 1.8)
    expect(v.g).toBeGreaterThan(v.b * 3)
  })

  it('四分之三處是暗紅 —— 火在冷卻', () => {
    const v = read(0.75)
    expect(v.r).toBeLessThan(0.4)
    expect(v.r).toBeGreaterThan(0.1)
    expect(v.g).toBeLessThan(0.1)
  })

  it('末段收到全黑 —— 火是熄掉的，不是帶著橘紅淡出去', () => {
    // 【專案負責人的要求】「紅色火焰要轉成黑色後才可以消失，等於是燃燒感」。
    // 加法混合畫不出黑（dst + 0 等於沒加），所以這裡能做的是讓火自己熄掉；
    // 真正看得見的黑由 emitKillSmoke 那團煙負責（見 smoke.ts）。
    const v = read(1)
    expect(v.r).toBeCloseTo(0, 4)
    expect(v.g).toBeCloseTo(0, 4)
    expect(v.b).toBeCloseTo(0, 4)
  })

  it('橘紅那一段撐得夠久 —— 不是一出生就往黑衝', () => {
    // 壽命過半時仍然是有顏色的火，不是已經快黑了
    const v = read(0.5)
    expect(v.r + v.g + v.b).toBeGreaterThan(0.8)
  })

  it('亮度全程單調遞減 —— 火球只會變暗不會回頭', () => {
    // 出生亮度是 1 + 0.95 + 0.8 = 2.75，所以初值要用 Infinity 而不是隨手
    // 挑的上界
    let prev = Infinity
    for (let i = 0; i <= 20; i++) {
      const v = read(i / 20)
      const lum = v.r + v.g + v.b
      expect(lum).toBeLessThanOrEqual(prev + 1e-9)
      prev = lum
    }
  })
})

describe('emitFireball', () => {
  it('一筆擊墜事件生 FIREBALL_COUNT 顆', () => {
    const pool = createFireball(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    emitFireball(pool, e)
    pool.step(0.01)
    expect(pool.live).toBe(FIREBALL_COUNT)
    pool.dispose()
  })

  it('兩筆事件生兩倍', () => {
    const pool = createFireball(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    pushKill(e, 500, 1000, 0, 0, 0, 0, 1)
    emitFireball(pool, e)
    pool.step(0.01)
    expect(pool.live).toBe(FIREBALL_COUNT * 2)
    pool.dispose()
  })

  it('生在事件的位置上', () => {
    const pool = createFireball(64)
    const e = createKills(4)
    pushKill(e, 300, 1000, -700, 0, 0, 0, 0)
    emitFireball(pool, e)
    pool.step(0.001)
    for (let i = 0; i < FIREBALL_COUNT; i++) {
      // 0.001 s 內最多飛 FIREBALL_SPEED × 0.001 = 0.015 m
      expect(positionOf(pool.object, i).distanceTo(new Vector3(300, 1000, -700)))
        .toBeLessThan(0.05)
    }
    pool.dispose()
  })

  it('繼承一半的母機速度 —— 火球會跟著往前衝', () => {
    // 【為什麼要繼承】完全靜止的話，一架 150 m/s 的飛機在火球 0.5 s 的壽命
    // 內會飛出 75 m，畫面上是「爆炸發生在飛機後面」（M8 spec §5）。
    const pool = createFireball(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, -200, 0)
    emitFireball(pool, e)
    pool.step(0.05)
    // 質心應該往 −Z 移動了約 0.5 × 200 × 0.05 = 5 m（阻尼會略減）
    let sumZ = 0
    for (let i = 0; i < FIREBALL_COUNT; i++) sumZ += positionOf(pool.object, i).z
    const meanZ = sumZ / FIREBALL_COUNT
    expect(meanZ).toBeLessThan(-3)
    expect(meanZ).toBeGreaterThan(-6)
    expect(FIREBALL_INHERIT).toBe(0.5)
    pool.dispose()
  })

  it('等向噴射 —— 有粒子往上也有往下', () => {
    const pool = createFireball(256)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    emitFireball(pool, e)
    pool.step(0.05)
    let hi = 0
    let lo = 0
    for (let i = 0; i < FIREBALL_COUNT; i++) {
      const y = positionOf(pool.object, i).y
      if (y > 1000.1) hi++
      if (y < 999.9) lo++
    }
    expect(hi).toBeGreaterThan(0)
    expect(lo).toBeGreaterThan(0)
    pool.dispose()
  })

  it('壽命內就死光 —— 不會有殘留的火球', () => {
    const pool = createFireball(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    emitFireball(pool, e)
    pool.step(FIREBALL_LIFE + 0.01)
    expect(pool.live).toBe(0)
    pool.dispose()
  })

  it('起始直徑是 FIREBALL_SIZE_FROM', () => {
    const pool = createFireball(64)
    const e = createKills(4)
    pushKill(e, 0, 0, 0, 0, 0, 0, 0)
    emitFireball(pool, e)
    pool.step(0.0001)
    const m = new Matrix4()
    pool.object.getMatrixAt(0, m)
    const s = new Vector3()
    m.decompose(new Vector3(), new Quaternion(), s)
    expect(s.x).toBeCloseTo(FIREBALL_SIZE_FROM, 1)
    pool.dispose()
  })

  it('速度是 FIREBALL_SPEED —— 常數沒有被悄悄改掉', () => {
    expect(FIREBALL_SPEED).toBe(15)
  })
})
