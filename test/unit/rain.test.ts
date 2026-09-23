import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createRain, rainApparentVelocity, RAIN_VELOCITY } from '../../src/render/rain'

/**
 * # 雨
 *
 * 守的是雨絲跟著鏡頭轉的那一條算式，與每幀寫進 shader 的數字。畫面好不好看
 * 由試玩判斷。
 */

const DT = 1 / 60
const still = new Vector3()

describe('雨絲的方向：雨滴這一幀在鏡頭眼裡的移動', () => {
  it('鏡頭停著：就是雨的落速，幾乎直的往下', () => {
    const v = rainApparentVelocity(still, DT, DT, new Vector3())
    expect(v.y).toBeCloseTo(RAIN_VELOCITY.y, 9)
    expect(Math.abs(v.y)).toBeGreaterThan(Math.hypot(v.x, v.z) * 2)
  })

  it('高速往前（−Z）飛：雨迎面而來，幾乎水平、朝 +Z', () => {
    const v = rainApparentVelocity(new Vector3(0, 0, -200 * DT), DT, DT, new Vector3())
    expect(v.z).toBeGreaterThan(150)
    expect(Math.abs(v.y)).toBeLessThan(v.z * 0.1)
  })

  it('暫停中移動鏡頭：雨不落，只剩鏡頭的反向移動', () => {
    const v = rainApparentVelocity(new Vector3(5, 0, 0), 0, DT, new Vector3())
    expect(v.x).toBeCloseTo(-5 / DT, 6)
    expect(v.y).toBeCloseTo(0, 12)
  })

  it('慢動作（世界走得比真實慢）：雨落得比較慢', () => {
    const v = rainApparentVelocity(still, DT * 0.25, DT, new Vector3())
    expect(v.y).toBeCloseTo(RAIN_VELOCITY.y * 0.25, 9)
  })
})

describe('每幀寫進 shader 的數字', () => {
  it('鏡頭位置照寫；第一幀還沒有位移，當作停著', () => {
    const rain = createRain()
    try {
      const cam = new Vector3(1200, 800, -3000)
      rain.update(cam, DT, DT)
      expect(rain.uniforms.uCam.value.toArray()).toEqual(cam.toArray())
      expect(rain.uniforms.uRel.value.y).toBeCloseTo(RAIN_VELOCITY.y, 9)
    } finally {
      rain.dispose()
    }
  })

  it('上帝視角以 900 m/s 飛：雨絲跟著轉成迎面，不會被當成瞬移而變回直的', () => {
    const rain = createRain()
    try {
      const cam = new Vector3()
      rain.update(cam, DT, DT)
      for (let i = 0; i < 60; i++) {
        cam.z -= 900 * DT
        rain.update(cam, DT, DT)
      }
      const rel = rain.uniforms.uRel.value
      expect(rel.z).toBeGreaterThan(800)
      expect(Math.abs(rel.y)).toBeLessThan(rel.z * 0.05)
    } finally {
      rain.dispose()
    }
  })

  it('一幀跳過半個方盒（換鏡頭）不算速度', () => {
    const rain = createRain()
    try {
      const cam = new Vector3()
      rain.update(cam, DT, DT)
      rain.update(cam, DT, DT)
      const before = rain.uniforms.uRel.value.clone()
      cam.x += 500
      rain.update(cam, DT, DT)
      expect(rain.uniforms.uRel.value.toArray()).toEqual(before.toArray())
    } finally {
      rain.dispose()
    }
  })

  it('飄移量永遠在一個方盒之內，而且時間走一點它就只走一點（下了一整天也不跳）', () => {
    const rain = createRain()
    try {
      const cam = new Vector3()
      for (let i = 0; i < 24; i++) rain.update(cam, 3600, 3600)
      const a = rain.uniforms.uDrift.value.clone()
      rain.update(cam, 0.1, 0.1)
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
