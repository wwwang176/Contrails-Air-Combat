import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  createFlightPose, showcaseCamera, showcaseDistance, showcaseFlight, showcaseQuaternion,
  SHOWCASE_ALTITUDE, SHOWCASE_MAX_DISTANCE, SHOWCASE_PITCH_LIMIT, SHOWCASE_RADIUS,
} from '../../src/app/showcase'
import { ALL_SPECS } from '../../src/battle/skirmish'

/**
 * 機庫展示場的擺位。**沒有物理** —— 高度是常數，所以飛機不可能掉進海裡；
 * 會掉下去的是相機，而那由俯仰的界擋住。這一支就守這兩件事，外加機首朝著
 * 飛行方向、機身往轉彎那一側傾。
 */
const NOSE = (yaw: number): Vector3 =>
  new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))

const MAX_DISTANCE = SHOWCASE_MAX_DISTANCE

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
   * 【為什麼要這一條】距離固定之後，畫面上的大小就是翼展比。最大的那一台
   * 仍然要留得下邊 —— 距離小於翼展的話它會兩端出畫面。
   */
  it('每一類最大的那一台仍然放得進畫面', () => {
    for (const role of ['fighter', 'bomber'] as const) {
      const widest = Math.max(...ALL_SPECS.filter((s) => s.role === role).map((s) => s.wing.span))
      expect(showcaseDistance(role)).toBeGreaterThan(widest * 1.4)
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
