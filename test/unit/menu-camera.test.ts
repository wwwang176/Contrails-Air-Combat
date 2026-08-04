import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  menuCameraPose, MENU_CAMERA_ALTITUDE, MENU_CAMERA_YAW_RATE,
} from '../../src/app/menuCamera'

function pose(t: number) {
  const out = { position: new Vector3(), target: new Vector3() }
  menuCameraPose(t, out)
  return out
}

describe('menuCameraPose（M10 spec §9.4）', () => {
  it('相機恆在海面之上', () => {
    // 【為什麼要守】掉到海面下的話 landing 的背景會變成一片深藍，
    // 而那個 bug 只有在特定的時間點才看得到。
    for (let t = 0; t < 600; t += 0.37) {
      expect(pose(t).position.y).toBeGreaterThan(MENU_CAMERA_ALTITUDE * 0.5)
    }
  })

  it('注視點大致在地平線 —— 不會看天也不會看海底', () => {
    for (let t = 0; t < 600; t += 1.7) {
      const p = pose(t)
      const drop = p.position.y - p.target.y
      const dist = Math.hypot(p.target.x - p.position.x, p.target.z - p.position.z)
      // 俯角在 ±20° 之內
      expect(Math.abs(Math.atan2(drop, dist))).toBeLessThan(20 * Math.PI / 180)
    }
  })

  it('位置是連續的 —— 相鄰兩幀不會跳', () => {
    const dt = 1 / 60
    for (let t = 0; t < 120; t += 1.3) {
      const a = pose(t).position
      const b = pose(t + dt).position
      // 一幀的位移遠小於整個場景尺度
      expect(a.distanceTo(b)).toBeLessThan(50)
    }
  })

  it('真的在轉 —— 一整圈之後回到起點附近', () => {
    const period = (Math.PI * 2) / MENU_CAMERA_YAW_RATE
    const a = pose(0).position
    const b = pose(period).position
    expect(a.distanceTo(b)).toBeLessThan(1)
    // 半圈時在對面
    const half = pose(period / 2).position
    expect(a.distanceTo(half)).toBeGreaterThan(10)
  })

  it('t = 0 也有定義', () => {
    const p = pose(0)
    expect(Number.isFinite(p.position.x + p.position.y + p.position.z)).toBe(true)
    expect(Number.isFinite(p.target.x + p.target.y + p.target.z)).toBe(true)
  })
})
