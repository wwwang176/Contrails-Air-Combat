import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { deathCamAim, DEATH_LOOK_TIME } from '../../src/camera/deathCam'

const DT = 1 / 60

/** 把視線轉到收斂為止，回傳實際跑了幾步。 */
function settle(aim: Vector3, from: Vector3, killer: Vector3, maxSteps = 600): number {
  for (let i = 0; i < maxSteps; i++) {
    deathCamAim(aim, from, killer, DT)
    const want = killer.clone().sub(from).normalize()
    if (aim.angleTo(want) < 1e-3) return i + 1
  }
  return maxSteps
}

describe('deathCamAim（M9 死亡鏡頭）', () => {
  it('朝擊殺者轉過去', () => {
    const aim = new Vector3(0, 0, -1)
    const from = new Vector3(0, 4000, 0)
    const killer = new Vector3(1000, 4000, 0)
    deathCamAim(aim, from, killer, DT)
    expect(aim.x).toBeGreaterThan(0)
    expect(aim.angleTo(new Vector3(1, 0, 0))).toBeLessThan(Math.PI / 2)
  })

  it('從正後方被打下來也轉得過去 —— 180° 不是奇點', () => {
    // 【為什麼這是最重要的一條】被咬住尾巴打下來是最常見的死法，而那正好
    // 是視線與目標差 180° 的情形。用 lerp + normalize 的話中途會經過零向量，
    // 正規化出 NaN，鏡頭從此壞掉。
    const aim = new Vector3(0, 0, -1)
    const from = new Vector3(0, 4000, 0)
    const killer = new Vector3(0, 4000, 800)
    const steps = settle(aim, from, killer)
    expect(steps).toBeLessThan(600)
    expect(Number.isFinite(aim.x + aim.y + aim.z)).toBe(true)
    expect(aim.z).toBeGreaterThan(0.99)
  })

  it('轉到之後停在那裡，不會過衝或抖動', () => {
    const aim = new Vector3(0, 0, -1)
    const from = new Vector3(0, 4000, 0)
    const killer = new Vector3(500, 4000, -500)
    settle(aim, from, killer)
    const want = killer.clone().sub(from).normalize()
    for (let i = 0; i < 120; i++) deathCamAim(aim, from, killer, DT)
    expect(aim.angleTo(want)).toBeLessThan(1e-3)
  })

  it('恆是單位向量', () => {
    const aim = new Vector3(0, 0, -1)
    const from = new Vector3(0, 4000, 0)
    const killer = new Vector3(-300, 3800, 900)
    for (let i = 0; i < 200; i++) {
      deathCamAim(aim, from, killer, DT)
      expect(aim.length()).toBeCloseTo(1, 6)
    }
  })

  it('沒有兇手時視線不動 —— 自摔就定定看著自己的火球', () => {
    const aim = new Vector3(0, 0, -1)
    const before = aim.clone()
    deathCamAim(aim, new Vector3(0, 4000, 0), null, DT)
    expect(aim.distanceTo(before)).toBe(0)
  })

  it('兇手就在死亡點上時視線不動 —— 方向未定義，不要亂轉', () => {
    const aim = new Vector3(0, 0, -1)
    const before = aim.clone()
    const p = new Vector3(0, 4000, 0)
    deathCamAim(aim, p, p.clone(), DT)
    expect(aim.distanceTo(before)).toBe(0)
  })

  it('dt = 0 時不動 —— 暫停的那一幀不該偷轉', () => {
    const aim = new Vector3(0, 0, -1)
    const before = aim.clone()
    deathCamAim(aim, new Vector3(0, 4000, 0), new Vector3(1000, 4000, 0), 0)
    expect(aim.distanceTo(before)).toBe(0)
  })

  it('一個時間常數之後轉過去大約 63%', () => {
    // 【為什麼要釘住這個】它是「LERP」這個要求的可觀測定義。改了時間常數
    // 卻沒有人發現的話，鏡頭會從「轉過去」變成「瞬移」或「幾乎不動」。
    const aim = new Vector3(0, 0, -1)
    const from = new Vector3(0, 4000, 0)
    const killer = new Vector3(1000, 4000, 0)
    const total = aim.angleTo(killer.clone().sub(from).normalize())
    const steps = Math.round(DEATH_LOOK_TIME / DT)
    for (let i = 0; i < steps; i++) deathCamAim(aim, from, killer, DT)
    const done = 1 - aim.angleTo(killer.clone().sub(from).normalize()) / total
    expect(done).toBeGreaterThan(0.55)
    expect(done).toBeLessThan(0.70)
  })
})
