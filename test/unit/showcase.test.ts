import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  createFlightPose, createOrbitState, showcaseCamera, showcaseDistance, showcaseFlight,
  showcaseQuaternion, stepOrbit,
  ALT_WOBBLE, AUTO_SPIN, DRIFT_WOBBLE, FOLLOW_DT_CAP,
  SHOWCASE_ALTITUDE, SHOWCASE_MAX_DISTANCE, SHOWCASE_PITCH_LIMIT, SHOWCASE_RADIUS,
} from '../../src/app/showcase'
import { ALL_SPECS } from '../../src/battle/skirmish'
import { CAMERA_FOV_DEG } from '../../src/render/scene'

/**
 * 機庫展示場的擺位。**沒有物理** —— 高度只在一條正弦帶裡走，飛機不可能掉進
 * 海裡；會掉下去的是相機，而那由俯仰的界擋住。這一支就守這兩件事，外加機首
 * 朝著飛行方向、機身往轉彎那一側傾。
 */
const NOSE = (yaw: number): Vector3 =>
  new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))

/** 左右擺動的基頻，rad/s。這幾條與它的值無關，取一個中間的就好 */
const ROLL_OMEGA = 0.5

const MAX_DISTANCE = SHOWCASE_MAX_DISTANCE

describe('showcaseFlight', () => {
  /**
   * 【為什麼是一條帶不是一個定值】飛機會上下起伏（`ALT_WOBBLE`），但那是
   * 一條正弦而不是模擬 —— 它永遠回得來。要守的是「飛十分鐘也不會愈掉愈低」。
   */
  it('高度只在起伏的那條帶裡走，飛十分鐘都回得來', () => {
    for (let t = 0; t <= 600; t += 0.37) {
      const pose = createFlightPose()
      showcaseFlight(t, ROLL_OMEGA, pose)
      expect(Math.abs(pose.position.y - SHOWCASE_ALTITUDE)).toBeLessThanOrEqual(ALT_WOBBLE)
    }
  })

  it('一直在同一片海上：平均航跡恆在圓上，飛機只在它旁邊飄', () => {
    for (let t = 0; t <= 600; t += 7) {
      const pose = createFlightPose()
      showcaseFlight(t, ROLL_OMEGA, pose)
      expect(Math.hypot(pose.centre.x, pose.centre.z)).toBeCloseTo(SHOWCASE_RADIUS, 6)
      expect(pose.position.distanceTo(pose.centre)).toBeLessThanOrEqual(DRIFT_WOBBLE + ALT_WOBBLE)
    }
  })

  /**
   * 【為什麼要這一條】`yaw` 與圓上的位置差 π/2，寫錯正負或漏掉那一項都
   * 不會有任何錯誤 —— 飛機照樣繞圈，只是側著飛，讀起來像在飄。
   */
  it('機首朝著飛行方向 —— 連上下起伏那一段也是', () => {
    const a = createFlightPose()
    const b = createFlightPose()
    const nose = new Vector3()
    for (let t = 0; t <= 300; t += 11) {
      showcaseFlight(t, ROLL_OMEGA, a)
      showcaseFlight(t + 0.01, ROLL_OMEGA, b)
      const velocity = b.position.clone().sub(a.position).normalize()
      // 【比的是三維的機首，不是水平投影】起伏那一段的爬升率要由機首的
      // 俯仰角帶著；只比水平的話，飛機平著平移升降也會過關
      nose.set(0, 0, -1).applyQuaternion(showcaseQuaternion(a, new Quaternion()))
      expect(velocity.dot(nose)).toBeGreaterThan(0.9999)
    }
  })

  it('機身往轉彎那一側傾，不是往外側', () => {
    const pose = createFlightPose()
    const up = new Vector3()
    const toCentre = new Vector3()
    for (let t = 0; t <= 300; t += 11) {
      showcaseFlight(t, ROLL_OMEGA, pose)
      up.set(0, 1, 0).applyQuaternion(showcaseQuaternion(pose, new Quaternion()))
      // 機頂往哪一邊倒：只看水平分量，與「圓心在哪一邊」比對
      toCentre.set(-pose.position.x, 0, -pose.position.z).normalize()
      expect(up.x * toCentre.x + up.z * toCentre.z).toBeGreaterThan(0)
    }
  })
})

/**
 * 鏡頭距離。**同一類裡固定** —— 照翼展各配一個的話每台都剛好塞滿畫面，
 * 體型差就消失了（見 `FIGHTER_DISTANCE` 的註解）。
 */
describe('showcaseDistance', () => {
  it('同一類的九台只有兩個值，而且轟炸機比較遠', () => {
    const byRole = new Map<string, Set<number>>()
    for (const s of ALL_SPECS) {
      const set = byRole.get(s.role) ?? new Set<number>()
      set.add(showcaseDistance(s.role))
      byRole.set(s.role, set)
    }
    expect(byRole.get('fighter')!.size).toBe(1)
    expect(byRole.get('bomber')!.size).toBe(1)
    expect(showcaseDistance('bomber')).toBeGreaterThan(showcaseDistance('fighter'))
  })

  it('沒有一台超過護欄掃描用的上界', () => {
    for (const s of ALL_SPECS) {
      expect(showcaseDistance(s.role), s.id).toBeLessThanOrEqual(SHOWCASE_MAX_DISTANCE)
    }
  })

  /**
   * 【為什麼要這一條】距離固定之後，畫面上的大小就是翼展比 —— 而拉近是
   * 可調的。最大的那一台仍然要留得下邊，否則它兩端出畫面。
   *
   * 【為什麼用 4:3 算】它是合理範圍內最窄的螢幕。寬螢幕只會更寬鬆，所以
   * 這一條在 4:3 上成立就到處成立。
   */
  it('每一類最大的那一台，翼展不超過畫面寬的一半', () => {
    const frameWidthAt = (distance: number): number =>
      2 * Math.tan((CAMERA_FOV_DEG * Math.PI) / 360) * distance * (4 / 3)
    for (const role of ['fighter', 'bomber'] as const) {
      const widest = Math.max(...ALL_SPECS.filter((s) => s.role === role).map((s) => s.wing.span))
      expect(widest / frameWidthAt(showcaseDistance(role)), role).toBeLessThan(0.5)
    }
  })
})

describe('showcaseCamera', () => {
  const pose = createFlightPose()
  showcaseFlight(42, ROLL_OMEGA, pose)

  it('不管怎麼拖，相機都離海面遠得很', () => {
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.1) {
      for (let pitch = -SHOWCASE_PITCH_LIMIT; pitch <= SHOWCASE_PITCH_LIMIT; pitch += 0.05) {
        const out = { position: new Vector3(), target: new Vector3() }
        showcaseCamera(pose, yaw, pitch, MAX_DISTANCE, out)
        expect(out.position.y).toBeGreaterThan(SHOWCASE_ALTITUDE - MAX_DISTANCE - 1)
        expect(out.position.y).toBeGreaterThan(100)
      }
    }
  })

  /**
   * 【看的是平均航跡，不是飛機】盯著飛機的話，起伏與左右飄移都會被相機
   * 同步跟掉，畫面上一動也不動（見 `ALT_WOBBLE`）。
   */
  it('看著平均航跡上的那一點，距離就是給的那個', () => {
    const out = { position: new Vector3(), target: new Vector3() }
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.3) {
      showcaseCamera(pose, yaw, 0.2, 30, out)
      expect(out.target.equals(pose.centre)).toBe(true)
      expect(out.target.y).toBe(SHOWCASE_ALTITUDE)
      expect(out.position.distanceTo(out.target)).toBeCloseTo(30, 6)
    }
  })

  it('拖到 0 是機尾、π 是機首', () => {
    const out = { position: new Vector3(), target: new Vector3() }
    showcaseCamera(pose, 0, 0, 30, out)
    const behind = out.position.clone().sub(out.target).normalize()
    expect(behind.dot(NOSE(pose.yaw))).toBeCloseTo(-1, 6)
    showcaseCamera(pose, Math.PI, 0, 30, out)
    const ahead = out.position.clone().sub(out.target).normalize()
    expect(ahead.dot(NOSE(pose.yaw))).toBeCloseTo(1, 6)
  })
})

describe('stepOrbit', () => {
  /**
   * 【分頁切回來那一幀】背景分頁的 requestAnimationFrame 是整個暫停，回來的
   * 第一幀帶著整段離開的秒數。自轉照單全收的話 `wantYaw` 一口氣往前跳好幾
   * 圈，而平滑會在接下來半秒把那幾圈追完 —— 畫面上就是飛機在快速旋轉。
   */
  it('一幀 300 秒，自轉最多只前進一個上限的量', () => {
    const s = createOrbitState()
    const before = s.wantYaw
    stepOrbit(s, 300, false)
    expect(s.wantYaw - before).toBeLessThanOrEqual(AUTO_SPIN * FOLLOW_DT_CAP + 1e-12)
  })

  it('長幀之後鏡頭不會在接下來幾幀追轉好幾圈', () => {
    const s = createOrbitState()
    stepOrbit(s, 300, false)
    const start = s.orbitYaw
    for (let i = 0; i < 60; i++) stepOrbit(s, 1 / 60, false)
    // 正常一秒的自轉是 AUTO_SPIN；留一個平滑的餘裕，但絕不是幾圈
    expect(Math.abs(s.orbitYaw - start)).toBeLessThan(AUTO_SPIN * 2)
  })

  it('拖曳時不自轉', () => {
    const s = createOrbitState()
    const before = s.wantYaw
    stepOrbit(s, 1, true)
    expect(s.wantYaw).toBe(before)
  })

  it('正常幀率下自轉照原本的速度走', () => {
    const s = createOrbitState()
    const before = s.wantYaw
    for (let i = 0; i < 60; i++) stepOrbit(s, 1 / 60, false)
    expect(s.wantYaw - before).toBeCloseTo(AUTO_SPIN, 9)
  })
})
