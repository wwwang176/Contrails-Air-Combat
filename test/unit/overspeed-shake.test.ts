import { describe, it, expect } from 'vitest'
import { PerspectiveCamera } from 'three'
import {
  OVERSPEED_FULL, OVERSPEED_ONSET, OVERSPEED_SHAKE, SHAKE_SECONDS,
  applyCameraShake, createCameraShake, overspeedShake, stepCameraShake,
} from '../../src/camera/cameraShake'

/**
 * # 超速的持續搖晃
 *
 * 【與爆炸震動的差別】爆炸是一次性的 `trauma`，會衰減；超速是每幀由速度直接
 * 算出來的 `sustained`，不衰減。兩者取最大值，不疊加 —— 超速時遇到爆炸，
 * 畫面不會一口氣衝到滿格。
 */

/** 相機姿態被轉了多少，弧度 */
function angleOf(shake: ReturnType<typeof createCameraShake>): number {
  const cam = new PerspectiveCamera()
  applyCameraShake(shake, cam)
  return 2 * Math.acos(Math.min(1, Math.abs(cam.quaternion.w)))
}

describe('overspeedShake：由 vneRatio 換算', () => {
  it('HUD 亮 OVERSPEED 之前完全不搖', () => {
    expect(overspeedShake(0)).toBe(0)
    expect(overspeedShake(0.5)).toBe(0)
    expect(overspeedShake(OVERSPEED_ONSET)).toBe(0)
  })

  it('到 OVERSPEED 轉紅升到上限', () => {
    expect(overspeedShake(OVERSPEED_FULL)).toBeCloseTo(OVERSPEED_SHAKE, 12)
  })

  /** 紅字只是「更危險」的提示，搖晃不跟著再加重 */
  it('紅字區間搖得與黃字頂端一樣，超過 Vne 也不再增加', () => {
    expect(overspeedShake(0.97)).toBe(OVERSPEED_SHAKE)
    expect(overspeedShake(1)).toBe(OVERSPEED_SHAKE)
    expect(overspeedShake(1.3)).toBe(OVERSPEED_SHAKE)
  })

  /** 門檻與 HUD 的變色綁在一起（`hud/widgets/energy.ts` 的 0.85／0.95） */
  it('起點與上限點落在 HUD 的黃、紅兩個門檻', () => {
    expect(OVERSPEED_ONSET).toBe(0.85)
    expect(OVERSPEED_FULL).toBe(0.95)
  })

  it('中間單調增加', () => {
    let prev = 0
    for (let r = OVERSPEED_ONSET; r <= OVERSPEED_FULL; r += 0.01) {
      const s = overspeedShake(r)
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
    }
  })

  /**
   * 【上限不能太大】它是一直持續的。幅度大到準星離開目標的話，玩家會覺得
   * 是操縱在飄 —— `SHAKE_MAX_ANGLE` 那一段的警告。
   */
  it('上限小於爆炸滿格', () => {
    expect(OVERSPEED_SHAKE).toBeLessThan(1)
  })
})

describe('sustained 與 trauma', () => {
  it('只有 sustained 時照樣會搖', () => {
    const s = createCameraShake()
    s.sustained = OVERSPEED_SHAKE
    expect(angleOf(s)).toBeGreaterThan(0)
  })

  it('兩者取最大值，不疊加', () => {
    const both = createCameraShake()
    both.phase = 0.37
    both.trauma = 0.3
    both.sustained = 0.5
    const onlyBig = createCameraShake()
    onlyBig.phase = 0.37
    onlyBig.trauma = 0.5
    expect(angleOf(both)).toBeCloseTo(angleOf(onlyBig), 12)
  })

  /** 衰減只屬於爆炸。sustained 衰減的話，穩定超速時搖晃會一閃一閃 */
  it('stepCameraShake 不衰減 sustained', () => {
    const s = createCameraShake()
    s.sustained = 0.4
    stepCameraShake(s, SHAKE_SECONDS * 2)
    expect(s.sustained).toBe(0.4)
  })

  it('reset 清空 sustained', () => {
    const s = createCameraShake()
    s.sustained = 0.4
    s.reset()
    expect(s.sustained).toBe(0)
  })
})

describe('main.ts 的接線', () => {
  const SOURCES = import.meta.glob('../../src/main.ts', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>
  const MAIN = Object.values(SOURCES)[0]!

  /** 排在套用之後的話，這一幀用的是上一幀的速度 —— 更糟的是換場那一幀 */
  it('每幀由速度寫入 sustained，排在套用震動之前', () => {
    const write = MAIN.indexOf('cameraShake.sustained =')
    const apply = MAIN.indexOf('applyCameraShake(cameraShake')
    expect(write).toBeGreaterThan(0)
    expect(MAIN.slice(write, apply)).toContain('overspeedShake(')
    expect(apply).toBeGreaterThan(write)
  })
})
