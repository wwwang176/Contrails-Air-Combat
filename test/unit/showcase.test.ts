import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  createFlightPose, showcaseCamera, showcaseFlight, showcaseQuaternion,
  SHOWCASE_ALTITUDE, SHOWCASE_DISTANCE_SPANS, SHOWCASE_PITCH_LIMIT, SHOWCASE_RADIUS,
} from '../../src/app/showcase'
import { ALL_SPECS } from '../../src/battle/skirmish'

/**
 * 機庫展示場的擺位。**沒有物理** —— 高度是常數，所以飛機不可能掉進海裡；
 * 會掉下去的是相機，而那由俯仰的界擋住。這一支就守這兩件事，外加機首朝著
 * 飛行方向、機身往轉彎那一側傾。
 */
const NOSE = (yaw: number): Vector3 =>
  new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))

/** 場上最大的翼展，決定相機最遠會離飛機多遠 */
const MAX_DISTANCE = Math.max(...ALL_SPECS.map((s) => s.wing.span)) * SHOWCASE_DISTANCE_SPANS

describe('showcaseFlight', () => {
  it('高度鎖死 —— 飛十分鐘一公分都不掉', () => {
    for (let t = 0; t <= 600; t += 0.37) {
      const pose = createFlightPose()
      showcaseFlight(t, pose)
      expect(pose.position.y).toBe(SHOWCASE_ALTITUDE)
    }
  })

  it('一直在同一片海上：離圓心恆為繞行半徑', () => {
    for (let t = 0; t <= 600; t += 7) {
      const pose = createFlightPose()
      showcaseFlight(t, pose)
      expect(Math.hypot(pose.position.x, pose.position.z)).toBeCloseTo(SHOWCASE_RADIUS, 6)
    }
  })

  /**
   * 【為什麼要這一條】`yaw` 與圓上的位置差 π/2，寫錯正負或漏掉那一項都
   * 不會有任何錯誤 —— 飛機照樣繞圈，只是側著飛，讀起來像在飄。
   */
  it('機首朝著飛行方向', () => {
    const a = createFlightPose()
    const b = createFlightPose()
    for (let t = 0; t <= 300; t += 11) {
      showcaseFlight(t, a)
      showcaseFlight(t + 0.05, b)
      const velocity = b.position.clone().sub(a.position).normalize()
      expect(velocity.dot(NOSE(a.yaw))).toBeGreaterThan(0.9999)
    }
  })

  it('機身往轉彎那一側傾，不是往外側', () => {
    const pose = createFlightPose()
    const up = new Vector3()
    const toCentre = new Vector3()
    for (let t = 0; t <= 300; t += 11) {
      showcaseFlight(t, pose)
      up.set(0, 1, 0).applyQuaternion(showcaseQuaternion(pose, new Quaternion()))
      // 機頂往哪一邊倒：只看水平分量，與「圓心在哪一邊」比對
      toCentre.set(-pose.position.x, 0, -pose.position.z).normalize()
      expect(up.x * toCentre.x + up.z * toCentre.z).toBeGreaterThan(0)
    }
  })
})

describe('showcaseCamera', () => {
  const pose = createFlightPose()
  showcaseFlight(42, pose)

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

  it('永遠看著飛機，而且距離就是給的那個', () => {
    const out = { position: new Vector3(), target: new Vector3() }
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.3) {
      showcaseCamera(pose, yaw, 0.2, 30, out)
      expect(out.target.equals(pose.position)).toBe(true)
      expect(out.position.distanceTo(out.target)).toBeCloseTo(30, 6)
    }
  })

  it('拖到 0 是機尾、π 是機首', () => {
    const out = { position: new Vector3(), target: new Vector3() }
    showcaseCamera(pose, 0, 0, 30, out)
    const behind = out.position.clone().sub(pose.position).normalize()
    expect(behind.dot(NOSE(pose.yaw))).toBeCloseTo(-1, 6)
    showcaseCamera(pose, Math.PI, 0, 30, out)
    const ahead = out.position.clone().sub(pose.position).normalize()
    expect(ahead.dot(NOSE(pose.yaw))).toBeCloseTo(1, 6)
  })
})
