import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { aimDirectionBody, clampToCircle, maxAimAngle, slewAimWorld } from '../../src/input/aim'
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
 */
describe('maxAimAngle', () => {
  it('等於 AIM_RADIUS × 半個 FOV', () => {
    expect(maxAimAngle(FOV)).toBeCloseTo(AIM_RADIUS * (FOV / 2), 12)
  })

  it('遠小於半個 FOV：準星不可能離開畫面', () => {
    expect(maxAimAngle(FOV)).toBeLessThan(FOV / 2)
  })
})

describe('slewAimWorld', () => {
  const CAM = new Quaternion() // 世界軸對齊的相機（目前的暫時跟隨相機）
  const nose = () => new Vector3(0, 0, -1)
  const aimAtNose = () => new Vector3(0, 0, -1)
  const angleTo = (a: Vector3, b: Vector3) => a.angleTo(b)

  it('零位移不改變瞄準向量——這是自由視角不影響飛行的前提', () => {
    // 圓錐內的瞄準點（6.4° < maxAimAngle 11.38°）：零位移時必須一動也不動。
    // 圓錐外的情形另有測試——那時它「應該」被拖回邊界。
    const aim = new Vector3(0.1, 0.05, -1).normalize()
    expect(aim.angleTo(new Vector3(0, 0, -1))).toBeLessThan(maxAimAngle(FOV))
    const before = aim.clone()
    slewAimWorld(aim, 0, 0, CAM, nose(), FOV)
    expect(aim.distanceTo(before)).toBeLessThan(1e-12)
  })

  it('滑鼠右移把瞄準點推向機首右方（+X）', () => {
    const aim = aimAtNose()
    slewAimWorld(aim, 0.1, 0, CAM, nose(), FOV)
    expect(aim.x).toBeGreaterThan(0)
    expect(Math.abs(aim.y)).toBeLessThan(1e-12)
  })

  it('滑鼠上移把瞄準點推向上方（+Y）', () => {
    const aim = aimAtNose()
    slewAimWorld(aim, 0, 0.1, CAM, nose(), FOV)
    expect(aim.y).toBeGreaterThan(0)
    expect(Math.abs(aim.x)).toBeLessThan(1e-12)
  })

  it('未觸及夾制時，偏移角 = 位移量 × 半個 FOV', () => {
    const aim = aimAtNose()
    const delta = 0.1 // < AIM_RADIUS，不會被夾
    slewAimWorld(aim, delta, 0, CAM, nose(), FOV)
    expect(angleTo(aim, nose())).toBeCloseTo(delta * (FOV / 2), 9)
  })

  it('位移可累積：連續兩次小位移等於一次大位移', () => {
    const a = aimAtNose()
    slewAimWorld(a, 0.05, 0, CAM, nose(), FOV)
    slewAimWorld(a, 0.05, 0, CAM, nose(), FOV)
    const b = aimAtNose()
    slewAimWorld(b, 0.1, 0, CAM, nose(), FOV)
    expect(a.distanceTo(b)).toBeLessThan(1e-9)
  })

  it('夾制在 maxAimAngle 的「圓錐」內', () => {
    const aim = aimAtNose()
    slewAimWorld(aim, 99, 0, CAM, nose(), FOV)
    expect(angleTo(aim, nose())).toBeCloseTo(maxAimAngle(FOV), 9)
  })

  it('對角線與軸向的夾制角相同——圓錐而非方錐', () => {
    const axis = aimAtNose()
    slewAimWorld(axis, 99, 0, CAM, nose(), FOV)
    const diagonal = aimAtNose()
    slewAimWorld(diagonal, 99, 99, CAM, nose(), FOV)
    expect(angleTo(diagonal, nose())).toBeCloseTo(angleTo(axis, nose()), 9)
    expect(angleTo(diagonal, nose())).toBeCloseTo(maxAimAngle(FOV), 9)
  })

  it('暴力甩鼠不會把瞄準點甩到反方向', () => {
    // 未設單幀位移上限時，dx = 6 等於一幀轉 195°：瞄準向量繞過機首後方，
    // 圓錐夾制沿大圓拉回時會落在**左**邊——玩家往右甩、飛機往左轉。
    const aim = aimAtNose()
    slewAimWorld(aim, 6, 0, CAM, nose(), FOV)
    expect(aim.x).toBeGreaterThan(0)
    expect(angleTo(aim, nose())).toBeCloseTo(maxAimAngle(FOV), 9)
  })

  it('恰好 180° 的暴力位移不會讓瞄準點塌回機首', () => {
    // 180° 時瞄準向量與機首反向，nose × aim = 0，方位角數學上不定，
    // 夾制只能退回機首 → 誤差角塌成 0，轉彎中途莫名其妙停住。
    // 單幀位移上限讓這個奇點根本到不了。
    const aim = aimAtNose()
    slewAimWorld(aim, Math.PI / (FOV / 2), 0, CAM, nose(), FOV)
    expect(angleTo(aim, nose())).toBeCloseTo(maxAimAngle(FOV), 9)
  })

  it('單幀位移上限本身也是圓形的：斜向與軸向的上限角相同', () => {
    const axis = aimAtNose()
    slewAimWorld(axis, 9, 0, CAM, nose(), FOV)
    const diag = aimAtNose()
    slewAimWorld(diag, 9, 9, CAM, nose(), FOV)
    expect(angleTo(axis, nose())).toBeCloseTo(maxAimAngle(FOV), 9)
    expect(angleTo(diag, nose())).toBeCloseTo(maxAimAngle(FOV), 9)
  })

  it('無論怎麼推，瞄準點都不會跑到機首後方', () => {
    const aim = aimAtNose()
    for (let i = 0; i < 200; i++) {
      slewAimWorld(aim, 5, 3, CAM, nose(), FOV)
      expect(aim.dot(nose())).toBeGreaterThan(0) // 恆在機首前半球
      expect(angleTo(aim, nose())).toBeLessThan(maxAimAngle(FOV) + 1e-9)
    }
  })

  it('瞄準點是世界固定的：機首自己轉動時它待在原地（只要仍在圓錐內）', () => {
    const aim = aimAtNose()
    slewAimWorld(aim, 0.1, 0, CAM, nose(), FOV)
    const parked = aim.clone()
    // 機首往瞄準點方向轉了 2°，仍在圓錐內
    const turned = nose().applyAxisAngle(new Vector3(0, 1, 0), -2 * DEG)
    slewAimWorld(aim, 0, 0, CAM, turned, FOV)
    expect(aim.distanceTo(parked)).toBeLessThan(1e-12)
  })

  it('機首偏離超過圓錐時，瞄準點被拖回邊界（永遠追得到）', () => {
    const aim = aimAtNose()
    const turned = nose().applyAxisAngle(new Vector3(0, 1, 0), 60 * DEG)
    slewAimWorld(aim, 0, 0, CAM, turned, FOV)
    expect(angleTo(aim, turned)).toBeCloseTo(maxAimAngle(FOV), 9)
  })

  it('旋轉軸取自相機而非寫死世界軸：相機側滾 90° 時，「右移」在世界座標裡是往上', () => {
    // 相機繞自身前方（−Z）側滾 90°：相機右軸 (1,0,0) → 世界 (0,1,0)，
    // 相機上軸 (0,1,0) → 世界 (−1,0,0)。玩家看到的「右」就是世界的「上」。
    const cam = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
    const aim = aimAtNose()
    slewAimWorld(aim, 0.1, 0, cam, nose(), FOV)
    expect(aim.y).toBeGreaterThan(0.01) // 世界座標往上
    expect(Math.abs(aim.x)).toBeLessThan(1e-9) // 完全沒有往世界的右邊跑
    // 同一位移在世界軸對齊的相機下則是純粹往右——兩者不可能同時成立於
    // 「寫死世界軸」的實作
    const ref = aimAtNose()
    slewAimWorld(ref, 0.1, 0, CAM, nose(), FOV)
    expect(ref.x).toBeGreaterThan(0.01)
    expect(Math.abs(ref.y)).toBeLessThan(1e-9)
  })

  it('維持單位長度並回傳同一參考', () => {
    const aim = aimAtNose()
    expect(slewAimWorld(aim, 0.2, -0.1, CAM, nose(), FOV)).toBe(aim)
    expect(aim.length()).toBeCloseTo(1, 12)
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
