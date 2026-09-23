import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createRain, rainRelativeVelocity, RAIN_VELOCITY } from '../../src/render/rain'

/**
 * # 雨
 *
 * 守的是雨絲跟著鏡頭轉的那一條算式，與每幀寫進 shader 的數字。畫面好不好看
 * 由試玩判斷。
 */

describe('雨絲的方向', () => {
  it('鏡頭停著：雨絲幾乎是直的往下', () => {
    const v = rainRelativeVelocity(new Vector3(), new Vector3())
    expect(v.y).toBeLessThan(0)
    expect(Math.abs(v.y)).toBeGreaterThan(Math.hypot(v.x, v.z) * 2)
  })

  it('高速往前（−Z）飛：雨迎面而來，雨絲轉成幾乎水平、朝 +Z', () => {
    const v = rainRelativeVelocity(new Vector3(0, 0, -200), new Vector3())
    expect(v.z).toBeGreaterThan(150)
    expect(Math.abs(v.y)).toBeLessThan(v.z * 0.1)
  })

  it('往上爬：雨落得更快（相對速度的垂直分量變大）', () => {
    const still = rainRelativeVelocity(new Vector3(), new Vector3())
    const climb = rainRelativeVelocity(new Vector3(0, 30, 0), new Vector3())
    expect(climb.y).toBeLessThan(still.y - 29)
  })
})

describe('每幀寫進 shader 的數字', () => {
  it('鏡頭位置與相對速度照寫', () => {
    const rain = createRain()
    try {
      const cam = new Vector3(1200, 800, -3000)
      const vel = new Vector3(10, 0, -150)
      rain.update(cam, vel, 5)
      expect(rain.uniforms.uCam.value.toArray()).toEqual(cam.toArray())
      expect(rain.uniforms.uRel.value.toArray()).toEqual(rainRelativeVelocity(vel, new Vector3()).toArray())
    } finally {
      rain.dispose()
    }
  })

  it('飄移量永遠在一個方盒之內，而且時間走一點它就只走一點（下了一整天也不跳）', () => {
    const rain = createRain()
    try {
      const cam = new Vector3()
      const vel = new Vector3()
      const t = 86_400
      rain.update(cam, vel, t)
      const a = rain.uniforms.uDrift.value.clone()
      rain.update(cam, vel, t + 0.1)
      const b = rain.uniforms.uDrift.value.clone()
      for (const k of ['x', 'y', 'z'] as const) {
        expect(Math.abs(a[k])).toBeLessThan(70)
        // 走 0.1 s 的差，或剛好繞過一個方盒
        const d = b[k] - a[k]
        const step = RAIN_VELOCITY[k] * 0.1
        expect(Math.min(Math.abs(d - step), Math.abs(Math.abs(d - step) - 70))).toBeLessThan(1e-6)
      }
    } finally {
      rain.dispose()
    }
  })

  it('不做視錐裁切 —— 位置全在 shader 裡算，包圍球是假的', () => {
    const rain = createRain()
    try {
      expect(rain.object.frustumCulled).toBe(false)
    } finally {
      rain.dispose()
    }
  })
})
