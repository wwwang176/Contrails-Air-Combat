import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { aimDirectionBody, clampToCircle } from '../../src/input/aim'
import { AIM_RADIUS, CRUISE_THROTTLE, createInputState } from '../../src/input/InputState'
import { applyThrottleRate, THROTTLE_RATE } from '../../src/input/throttle'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { DEG } from '../../src/core/math'

const FOV = 65 * DEG

describe('aimDirectionBody', () => {
  it('準星在中心時方向為機首（機體 −Z）', () => {
    const d = aimDirectionBody(0, 0, FOV, new Vector3())
    expect(d.x).toBeCloseTo(0, 12)
    expect(d.y).toBeCloseTo(0, 12)
    expect(d.z).toBeCloseTo(-1, 12)
  })

  it('準星向右產生 +X 分量', () => {
    expect(aimDirectionBody(0.3, 0, FOV, new Vector3()).x).toBeGreaterThan(0)
  })

  it('準星向上產生 +Y 分量', () => {
    expect(aimDirectionBody(0, 0.3, FOV, new Vector3()).y).toBeGreaterThan(0)
  })

  it('回傳單位向量', () => {
    expect(aimDirectionBody(0.35, -0.2, FOV, new Vector3()).length()).toBeCloseTo(1, 12)
  })

  it('偏移角隨 FOV 增大而增大', () => {
    const narrow = aimDirectionBody(0.3, 0, 40 * DEG, new Vector3())
    const wide = aimDirectionBody(0.3, 0, 90 * DEG, new Vector3())
    expect(Math.abs(wide.x)).toBeGreaterThan(Math.abs(narrow.x))
  })

  it('夾制圓邊緣的偏移角小於半個 FOV', () => {
    const d = aimDirectionBody(AIM_RADIUS, 0, FOV, new Vector3())
    const angle = Math.acos(-d.z)
    expect(angle).toBeLessThan(FOV / 2)
  })

  it('寫入傳入的 out 並回傳同一參考', () => {
    const out = new Vector3()
    expect(aimDirectionBody(0.1, 0.1, FOV, out)).toBe(out)
  })
})

describe('createInputState', () => {
  it('初始值合理', () => {
    const s = createInputState()
    expect(s.aimX).toBe(0)
    expect(s.aimY).toBe(0)
    expect(s.throttle).toBeGreaterThan(0)
    expect(s.throttle).toBeLessThanOrEqual(1.1)
    expect(s.lookActive).toBe(false)
    expect(s.viewMode).toBe('third')
  })
})

describe('clampToCircle', () => {
  it('圓內的點原樣不變', () => {
    const p = clampToCircle(0.1, -0.05, AIM_RADIUS)
    expect(p.x).toBeCloseTo(0.1, 12)
    expect(p.y).toBeCloseTo(-0.05, 12)
  })

  it('圓外的點沿原方向投影到圓周上（角度不變、量值等於半徑）', () => {
    const x = 0.6
    const y = 0.8 // r = 1，明確在半徑 AIM_RADIUS(0.35) 之外
    const before = Math.atan2(y, x)
    const p = clampToCircle(x, y, AIM_RADIUS)
    const after = Math.atan2(p.y, p.x)
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(AIM_RADIUS, 12)
    expect(after).toBeCloseTo(before, 12)
  })

  it('對角線方向與軸向的圓外輸入，夾制後量值相同——這正是用圓而非方形夾制的意義', () => {
    const radius = 0.35
    const axisAligned = clampToCircle(10, 0, radius)
    const diagonal = clampToCircle(10, 10, radius)
    expect(Math.hypot(axisAligned.x, axisAligned.y)).toBeCloseTo(radius, 12)
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(radius, 12)
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
