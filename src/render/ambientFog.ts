import { Color, NormalBlending, type Texture } from 'three'
import type { MissionAmbientFog } from '../battle/missions/types'
import { hash01 } from '../core/hash'
import { createParticles } from './particles'

const TWO_PI = Math.PI * 2

/** 環境霧：晨霧、工業薄霧與戰場懸浮塵霧共用的生命週期，不與事件煙霧搶池格。 */
export const AMBIENT_FOG_LIFE = 40
export const AMBIENT_FOG_LIFE_JITTER = 0.3
export const AMBIENT_FOG_FADE_IN = 3
/** 整場往同一個方向漂，m/s（世界 x、z），與緩緩上升，m/s */
const AMBIENT_FOG_DRIFT_X = 2
const AMBIENT_FOG_DRIFT_Z = 1.5
const AMBIENT_FOG_RISE = 0.3
/** 開場補上已經飄了一輪的塵團：以這個步長把池子推進一個最長壽命，s */
const AMBIENT_FOG_WARM_STEP = 0.5

/**
 * 第 k 顆霧團的出生位置。出處不可為空；同一序號永遠得到同一個位置。
 */
export function ambientFogSpot(
  k: number, config: MissionAmbientFog,
  out: { x: number; z: number; lift: number },
): void {
  const { places, spread, liftMin, liftMax } = config
  const p = places[Math.min(places.length - 1, Math.floor(hash01(k * 3 + 1) * places.length))]!
  const a = hash01(k * 3 + 2) * TWO_PI
  const r = Math.sqrt(hash01(k * 3 + 3)) * spread
  out.x = p.x + Math.cos(a) * r
  out.z = p.z + Math.sin(a) * r
  out.lift = liftMin + hash01(k * 5 + 7) * (liftMax - liftMin)
}

/** 每場一個專用池；出處為空時不配置粒子。顏色不依賴全域高度霧狀態。 */
export function createAmbientFog(
  config: MissionAmbientFog, sceneFogColor: Color, smokeTexture?: Texture,
) {
  const { every } = config
  // 最長壽命也放得下，避免新霧覆蓋尚未淡完的舊霧。
  const capacity = Math.ceil(AMBIENT_FOG_LIFE * (1 + AMBIENT_FOG_LIFE_JITTER) / every) + 16
  const tint = new Color(config.tint).lerp(sceneFogColor, config.skyMix ?? 0.25).multiplyScalar(config.shade ?? 1)
  const clouds = config.places.length === 0 ? null : createParticles({
    capacity, alphaMap: smokeTexture, blending: NormalBlending, wind: true,
    cameraSmoke: true,
    life: AMBIENT_FOG_LIFE, lifeJitter: AMBIENT_FOG_LIFE_JITTER,
    sizeFrom: config.sizeFrom, sizeTo: config.sizeTo,
    gravity: 0, drag: 0, alphaFrom: config.alpha,
    fadeIn: AMBIENT_FOG_FADE_IN,
    shadeJitter: config.shadeJitter ?? 0.12,
    color: (_t, out) => { out.copy(tint) },
  })
  if (clouds !== null) {
    clouds.object.name = 'ambientFog'
    // 畫在其他粒子之前：爆炸與煙疊在塵團上，不被它蓋住
    clouds.object.renderOrder = -5
  }
  let cloudClock = 0
  let cloudCount = 0
  let warmed = false
  const cloudSpot = { x: 0, z: 0, lift: 0 }
  /** 塵團：到點就放，再把池子往前推一幀。熱路徑：不配置 */
  function stepClouds(dt: number, groundAt: (x: number, z: number) => number): void {
    if (clouds === null) return
    cloudClock -= dt
    while (cloudClock <= 0) {
      cloudClock += every
      ambientFogSpot(cloudCount++, config, cloudSpot)
      clouds.emit(
        cloudSpot.x, groundAt(cloudSpot.x, cloudSpot.z) + cloudSpot.lift, cloudSpot.z,
        AMBIENT_FOG_DRIFT_X, AMBIENT_FOG_RISE, AMBIENT_FOG_DRIFT_Z,
      )
    }
    clouds.step(dt)
  }

  return {
    object: clouds?.object ?? null,
    update(dt: number, groundAt: (x: number, z: number) => number): void {
      // 第一次拿到地形才預熱；所有關卡開場都有不同年齡的霧，重置後亦同。
      if (!warmed) {
        for (let t = 0; t < AMBIENT_FOG_LIFE * (1 + AMBIENT_FOG_LIFE_JITTER); t += AMBIENT_FOG_WARM_STEP) {
          stepClouds(AMBIENT_FOG_WARM_STEP, groundAt)
        }
        warmed = true
      }
      stepClouds(dt, groundAt)
    },
    reset(): void {
      clouds?.reset()
      cloudClock = 0
      cloudCount = 0
      warmed = false
    },
    dispose(): void { clouds?.dispose() },
  }
}
