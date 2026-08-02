import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { slewAimWorld } from '../../src/input/aim'
import { CRUISE_THROTTLE, createInputState } from '../../src/input/InputState'
import { applyThrottleRate, THROTTLE_RATE } from '../../src/input/throttle'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { DEG } from '../../src/core/math'

const FOV = 65 * DEG

describe('createInputState', () => {
  it('初始值合理', () => {
    const s = createInputState()
    // 瞄準點以「世界座標的單位向量」保存，初始為機首方向（姿態為單位四元數
    // 時即 −Z）。累積的滑鼠位移每幀消費後歸零。
    expect(s.aimWorld.x).toBe(0)
    expect(s.aimWorld.y).toBe(0)
    expect(s.aimWorld.z).toBe(-1)
    expect(s.aimDeltaX).toBe(0)
    expect(s.aimDeltaY).toBe(0)
    expect(s.throttle).toBeGreaterThan(0)
    expect(s.throttle).toBeLessThanOrEqual(1.1)
    expect(s.lookActive).toBe(false)
    expect(s.viewMode).toBe('third')
  })
})

/**
 * 世界固定瞄準點（專案負責人裁決，見 task-20-report.md §13）。
 *
 * 滑鼠位移把一個「世界座標」的方向向量繞相機的右／上軸旋轉，飛機再飛到
 * 它身上並停住——兩個準星真的會合。代價是「維持轉彎需要持續移動滑鼠」，
 * 這是被明示後選擇的取捨。
 *
 * 【不再有任何夾制】（專案負責人裁決：玩家應該可以自由轉）
 * 原本的機首圓錐、畫面矩形、單幀位移上限都是「準星不能離開畫面」的產物。
 * 相機改成跟著瞄準點走之後那個前提消失了，三道全部移除。
 */
describe('slewAimWorld', () => {
  const CAM = new Quaternion() // 世界軸對齊的相機
  const nose = () => new Vector3(0, 0, -1)
  const aimAtNose = () => new Vector3(0, 0, -1)
  const angleTo = (a: Vector3, b: Vector3) => a.angleTo(b)

  it('零位移不改變瞄準向量——這是自由視角不影響飛行的前提', () => {
    const aim = new Vector3(0.1, 0.05, -1).normalize()
    const before = aim.clone()
    slewAimWorld(aim, 0, 0, CAM, FOV)
    expect(aim.distanceTo(before)).toBeLessThan(1e-12)
  })

  it('滑鼠右移把瞄準點推向機首右方（+X）', () => {
    const aim = aimAtNose()
    slewAimWorld(aim, 0.1, 0, CAM, FOV)
    expect(aim.x).toBeGreaterThan(0)
    expect(Math.abs(aim.y)).toBeLessThan(1e-12)
  })

  it('滑鼠上移把瞄準點推向上方（+Y）', () => {
    const aim = aimAtNose()
    slewAimWorld(aim, 0, 0.1, CAM, FOV)
    expect(aim.y).toBeGreaterThan(0)
    expect(Math.abs(aim.x)).toBeLessThan(1e-12)
  })

  it('偏移角 = 位移量 × 半個 FOV，全程線性', () => {
    for (const delta of [0.1, 0.9, 2.5]) {
      const aim = aimAtNose()
      slewAimWorld(aim, delta, 0, CAM, FOV)
      expect(angleTo(aim, nose())).toBeCloseTo(delta * (FOV / 2), 9)
    }
  })

  it('位移可累積：連續兩次小位移等於一次大位移', () => {
    const a = aimAtNose()
    slewAimWorld(a, 0.05, 0, CAM, FOV)
    slewAimWorld(a, 0.05, 0, CAM, FOV)
    const b = aimAtNose()
    slewAimWorld(b, 0.1, 0, CAM, FOV)
    expect(a.distanceTo(b)).toBeLessThan(1e-9)
  })

  it('可以轉到機首後方——沒有任何角度上限', () => {
    const aim = aimAtNose()
    // 位移 π/halfFov 恰好等於轉 180°
    slewAimWorld(aim, Math.PI / (FOV / 2), 0, CAM, FOV)
    expect(angleTo(aim, nose())).toBeCloseTo(Math.PI, 6)
  })

  it('持續同向推進可以繞完一整圈並回到原處', () => {
    const aim = aimAtNose()
    const step = 0.05
    const turns = Math.round((2 * Math.PI) / (step * (FOV / 2)))
    for (let i = 0; i < turns; i++) slewAimWorld(aim, step, 0, CAM, FOV)
    // 整圈的離散步數不見得整除，容許最後一步的殘差
    expect(angleTo(aim, nose())).toBeLessThan(step * (FOV / 2) + 1e-9)
  })

  it('瞄準點是世界固定的：只有滑鼠能動它', () => {
    const aim = aimAtNose()
    slewAimWorld(aim, 0.1, 0, CAM, FOV)
    const parked = aim.clone()
    // 機首自己轉到哪裡都與它無關——夾制移除後連「被拖回邊界」都不會發生
    slewAimWorld(aim, 0, 0, CAM, FOV)
    expect(aim.distanceTo(parked)).toBeLessThan(1e-12)
  })

  it('旋轉軸取自相機而非寫死世界軸：相機側滾 90° 時，「右移」在世界座標裡是往上', () => {
    // 相機繞自身前方（−Z）側滾 90°：相機右軸 (1,0,0) → 世界 (0,1,0)，
    // 相機上軸 (0,1,0) → 世界 (−1,0,0)。玩家看到的「右」就是世界的「上」。
    const cam = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
    const aim = aimAtNose()
    slewAimWorld(aim, 0.1, 0, cam, FOV)
    expect(aim.y).toBeGreaterThan(0.01) // 世界座標往上
    expect(Math.abs(aim.x)).toBeLessThan(1e-9) // 完全沒有往世界的右邊跑
    // 同一位移在世界軸對齊的相機下則是純粹往右——兩者不可能同時成立於
    // 「寫死世界軸」的實作
    const ref = aimAtNose()
    slewAimWorld(ref, 0.1, 0, CAM, FOV)
    expect(ref.x).toBeGreaterThan(0.01)
    expect(Math.abs(ref.y)).toBeLessThan(1e-9)
  })

  it('維持單位長度並回傳同一參考', () => {
    const aim = aimAtNose()
    expect(slewAimWorld(aim, 0.2, -0.1, CAM, FOV)).toBe(aim)
    expect(aim.length()).toBeCloseTo(1, 12)
  })
})

describe('applyThrottleRate', () => {
  it('單步：僅 W 依 THROTTLE_RATE·dt 增加', () => {
    const dt = 1 / 240
    const t = applyThrottleRate(CRUISE_THROTTLE, true, false, dt)
    expect(t).toBeCloseTo(CRUISE_THROTTLE + THROTTLE_RATE * dt, 12)
  })

  it('單步：僅 S 依 THROTTLE_RATE·dt 減少', () => {
    const dt = 1 / 240
    const t = applyThrottleRate(CRUISE_THROTTLE, false, true, dt)
    expect(t).toBeCloseTo(CRUISE_THROTTLE - THROTTLE_RATE * dt, 12)
  })

  it('持續 W：上升到 WEP_THROTTLE 後不再超過', () => {
    let t = CRUISE_THROTTLE
    const dt = 1 / 240
    for (let i = 0; i < 2000; i++) t = applyThrottleRate(t, true, false, dt)
    expect(t).toBeCloseTo(WEP_THROTTLE, 12)
    // 再推一步，確認確實停在天花板，不會繼續往上加
    t = applyThrottleRate(t, true, false, dt)
    expect(t).toBe(WEP_THROTTLE)
  })

  it('持續 S：下降到 0 後不再低於 0', () => {
    let t = CRUISE_THROTTLE
    const dt = 1 / 240
    for (let i = 0; i < 2000; i++) t = applyThrottleRate(t, false, true, dt)
    expect(t).toBeCloseTo(0, 12)
    t = applyThrottleRate(t, false, true, dt)
    expect(t).toBe(0)
  })

  it('從巡航到 WEP 的爬升時間符合 (WEP_THROTTLE − CRUISE_THROTTLE) / THROTTLE_RATE', () => {
    const dt = 1 / 240
    let t = CRUISE_THROTTLE
    let steps = 0
    // 尚未到達天花板前持續累加步數；一旦達到（含浮點誤差）即停止
    while (t < WEP_THROTTLE - 1e-9) {
      t = applyThrottleRate(t, true, false, dt)
      steps++
    }
    const measuredSeconds = steps * dt
    const expectedSeconds = (WEP_THROTTLE - CRUISE_THROTTLE) / THROTTLE_RATE
    expect(measuredSeconds).toBeCloseTo(expectedSeconds, 6)
  })
})
