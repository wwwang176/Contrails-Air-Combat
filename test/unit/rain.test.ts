import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  createRain, rainApparentVelocity, RAIN_VELOCITY, SPLASH_CONE, SPLASH_HEIGHT, SPLASH_RADIUS,
} from '../../src/render/rain'

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

  it('一般視角以 300 m/s 飛：雨絲跟著轉成迎面', () => {
    const rain = createRain()
    try {
      const cam = new Vector3()
      rain.update(cam, DT, DT)
      for (let i = 0; i < 60; i++) {
        cam.z -= 300 * DT
        rain.update(cam, DT, DT)
      }
      const rel = rain.uniforms.uRel.value
      expect(rel.z).toBeGreaterThan(250)
      expect(Math.abs(rel.y)).toBeLessThan(rel.z * 0.1)
    } finally {
      rain.dispose()
    }
  })

  it('上帝視角怎麼飛，雨絲都是停著時的方向', () => {
    const rain = createRain()
    try {
      const cam = new Vector3()
      rain.update(cam, DT, DT, true)
      for (let i = 0; i < 60; i++) {
        cam.z -= 900 * DT
        cam.x += 200 * DT
        rain.update(cam, DT, DT, true)
      }
      const rel = rain.uniforms.uRel.value
      expect(rel.x).toBeCloseTo(RAIN_VELOCITY.x, 6)
      expect(rel.y).toBeCloseTo(RAIN_VELOCITY.y, 6)
      expect(rel.z).toBeCloseTo(RAIN_VELOCITY.z, 6)
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

  /** 一朵水花最遠濺出去多少，m：拋物線射程 4 × 最高點 × tan(錐的半頂角) */
  const MAX_RUN = 4 * SPLASH_HEIGHT[1] * Math.tan(SPLASH_CONE)

  it('地上的水花：鏡頭低空時出現在正下方的圓內、貼著地面彈起不超過上限', () => {
    const rain = createRain()
    try {
      const ground = (x: number, z: number): number => 20 + 0.1 * x - 0.05 * z
      const cam = new Vector3(300, 70, -200)
      rain.update(cam, DT, DT, false, ground)
      expect(rain.splash.visible).toBe(true)
      const p = rain.splash.geometry.getAttribute('position')
      expect(p.count).toBeGreaterThan(100)
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i)
        const z = p.getZ(i)
        expect(Math.hypot(x - cam.x, z - cam.z)).toBeLessThanOrEqual(SPLASH_RADIUS + MAX_RUN)
        // 【斜坡上】濺出去之後那一點的地面高度差最多 |坡度| × 射程
        const h = p.getY(i) - ground(x, z)
        expect(h).toBeGreaterThanOrEqual(-0.12 * MAX_RUN - 1e-4)
        expect(h).toBeLessThanOrEqual(SPLASH_HEIGHT[1] + 0.12 * MAX_RUN + 1e-4)
      }
    } finally {
      rain.dispose()
    }
  })

  it('水花往旁邊濺（錐裡隨機的方向），而且不會濺得比錐的射程遠', () => {
    const rain = createRain()
    try {
      const cam = new Vector3(0, 30, 0)
      rain.update(cam, DT, DT, false, () => 0)
      const a = Array.from(rain.splash.geometry.getAttribute('position').array)
      rain.update(cam, DT / 4, DT, false, () => 0)
      const b = Array.from(rain.splash.geometry.getAttribute('position').array)
      let moved = 0
      const dirs = new Set<number>()
      for (let i = 0; i < a.length / 3; i++) {
        const dx = b[i * 3]! - a[i * 3]!
        const dz = b[i * 3 + 2]! - a[i * 3 + 2]!
        const d = Math.hypot(dx, dz)
        // 【同一朵才比】換了位置的那幾朵跳過
        if (d > 1) continue
        // 最快的一朵：射程除以最短壽命
        expect(d).toBeLessThanOrEqual((MAX_RUN / 0.25) * (DT / 4) + 1e-5)
        if (d > 1e-5) {
          moved++
          dirs.add(Math.floor(((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI)) * 8) % 8)
        }
      }
      expect(moved).toBeGreaterThan(100)
      // 八個方位都有 —— 方向是隨機的，不是全部往同一邊
      expect(dirs.size).toBe(8)
    } finally {
      rain.dispose()
    }
  })

  it('鏡頭離地 100 m 以上看不到水花；沒給地面高度也沒有', () => {
    const rain = createRain()
    try {
      rain.update(new Vector3(0, 130, 0), DT, DT, false, () => 20)
      expect(rain.splash.visible).toBe(false)
      rain.update(new Vector3(0, 30, 0), DT, DT, false, () => 20)
      expect(rain.splash.visible).toBe(true)
      rain.update(new Vector3(0, 30, 0), DT, DT)
      expect(rain.splash.visible).toBe(false)
    } finally {
      rain.dispose()
    }
  })

  it('暫停（世界時間不走）時水花停住', () => {
    const rain = createRain()
    try {
      const cam = new Vector3(0, 30, 0)
      rain.update(cam, DT, DT, false, () => 0)
      const before = Array.from(rain.splash.geometry.getAttribute('position').array)
      rain.update(cam, 0, DT, false, () => 0)
      expect(Array.from(rain.splash.geometry.getAttribute('position').array)).toEqual(before)
    } finally {
      rain.dispose()
    }
  })

  it('雨絲與水花都不做視錐裁切 —— 位置是逐幀寫的或在 shader 裡算，包圍球是假的', () => {
    const rain = createRain()
    try {
      expect(rain.object.children.length).toBe(2)
      for (const o of rain.object.children) expect(o.frustumCulled).toBe(false)
    } finally {
      rain.dispose()
    }
  })
})
