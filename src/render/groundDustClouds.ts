import { NormalBlending, type Color, type Texture } from 'three'
import { hash01 } from '../core/hash'
import { BATTLE_FOG } from './heightFog'
import { createParticles } from './particles'

const TWO_PI = Math.PI * 2

/**
 * 塵團：有人活動的地方（`theater.dusts`）持續冒出又大又淡的塵，慢慢長大、往同一個方向飄散。高度霧只染得到
 * 有幾何的像素，側看沒有一團看得見的霧，塵團補這個。**起始值，由試飛裁定。**
 *
 * 每 `DUST_CLOUD_EVERY` 秒在某一處放一顆。出生只有 `SIZE_FROM`、不透明度從出生起線性淡出，所以不會
 * 突然冒出一大塊。顏色讀高度霧的色調（`BATTLE_FOG.b`），塵團與霧是同一種灰黃。
 */
export const DUST_CLOUD_EVERY = 0.15
export const DUST_CLOUD_LIFE = 40
export const DUST_CLOUD_LIFE_JITTER = 0.3
export const DUST_CLOUD_SIZE_FROM = 30
export const DUST_CLOUD_SIZE_TO = 200
/** 出生時最濃的不透明度 */
export const DUST_CLOUD_ALPHA = 0.35
/** 顏色相對於高度霧色調的倍率：塵團比地面亮，但不能亮到像白煙 */
export const DUST_CLOUD_SHADE = 0.85
/** 出處周圍散佈的半徑 m，與離地高度的範圍 m：貼地的低霧，不是高空的雲 */
export const DUST_CLOUD_SPREAD = 70
export const DUST_CLOUD_LIFT_MIN = 8
export const DUST_CLOUD_LIFT_MAX = 40
/** 整場往同一個方向漂，m/s（世界 x、z），與緩緩上升，m/s */
export const DUST_CLOUD_DRIFT_X = 2
export const DUST_CLOUD_DRIFT_Z = 1.5
export const DUST_CLOUD_RISE = 0.3
/**
 * 池子要裝得下最壞情況的同時存活數（每一顆都抽到最長壽命）；不夠的話環形緩衝覆蓋最舊的，
 * 一團正在飄的塵會憑空消失
 */
export const DUST_CLOUD_CAPACITY = Math.ceil((DUST_CLOUD_LIFE * (1 + DUST_CLOUD_LIFE_JITTER)) / DUST_CLOUD_EVERY) + 16
/** 開場補上已經飄了一輪的塵團：以這個步長把池子推進一個最長壽命，s */
const DUST_CLOUD_WARM_STEP = 0.5

/**
 * 第 `k` 顆塵團的出生位置：從 `places` 挑一處，在它周圍 `DUST_CLOUD_SPREAD` 內取點，離地高度
 * 落在 `LIFT_MIN`～`LIFT_MAX`。結果寫進 `out`。`places` 不可為空。純函數：同一個 `k` 永遠同一點
 */
export function dustCloudSpot(
  k: number, places: readonly { readonly x: number; readonly z: number }[],
  out: { x: number; z: number; lift: number },
): void {
  const p = places[Math.min(places.length - 1, Math.floor(hash01(k * 3 + 1) * places.length))]!
  const a = hash01(k * 3 + 2) * TWO_PI
  const r = Math.sqrt(hash01(k * 3 + 3)) * DUST_CLOUD_SPREAD
  out.x = p.x + Math.cos(a) * r
  out.z = p.z + Math.sin(a) * r
  out.lift = DUST_CLOUD_LIFT_MIN + hash01(k * 5 + 7) * (DUST_CLOUD_LIFT_MAX - DUST_CLOUD_LIFT_MIN)
}

/** 塵團的顏色：高度霧的色調（線性色，`setBattleFog` 寫進去的就是線性值）乘一個壓暗的倍率 */
function dustCloudColor(_t: number, out: Color): void {
  out.setRGB(BATTLE_FOG.b.x * DUST_CLOUD_SHADE, BATTLE_FOG.b.y * DUST_CLOUD_SHADE, BATTLE_FOG.b.z * DUST_CLOUD_SHADE)
}

/** 塵團池：到點放出、開場預熱、重置與回收。`dusts` 為空時不建池，`object` 為 null */
export function createGroundDustClouds(
  dusts: readonly { readonly x: number; readonly z: number }[], smokeTexture?: Texture,
) {
  /** 塵團。卡片沒有出處就沒有這個池 */
  const clouds = dusts.length === 0 ? null : createParticles({
    capacity: DUST_CLOUD_CAPACITY, alphaMap: smokeTexture, blending: NormalBlending, wind: true,
    life: DUST_CLOUD_LIFE, lifeJitter: DUST_CLOUD_LIFE_JITTER,
    sizeFrom: DUST_CLOUD_SIZE_FROM, sizeTo: DUST_CLOUD_SIZE_TO,
    gravity: 0, drag: 0, alphaFrom: DUST_CLOUD_ALPHA, shadeJitter: 0.3, color: dustCloudColor,
  })
  if (clouds !== null) {
    clouds.object.name = 'groundBattle.dustClouds'
    // 畫在其他粒子之前：爆炸與煙疊在塵團上，不被它蓋住
    clouds.object.renderOrder = -5
  }
  let cloudClock = 0
  let cloudCount = 0
  const cloudSpot = { x: 0, z: 0, lift: 0 }
  /** 塵團：到點就放，再把池子往前推一幀。熱路徑：不配置 */
  function stepClouds(dt: number, groundAt: (x: number, z: number) => number): void {
    if (clouds === null) return
    cloudClock -= dt
    while (cloudClock <= 0) {
      cloudClock += DUST_CLOUD_EVERY
      dustCloudSpot(cloudCount++, dusts, cloudSpot)
      clouds.emit(
        cloudSpot.x, groundAt(cloudSpot.x, cloudSpot.z) + cloudSpot.lift, cloudSpot.z,
        DUST_CLOUD_DRIFT_X, DUST_CLOUD_RISE, DUST_CLOUD_DRIFT_Z,
      )
    }
    clouds.step(dt)
  }

  return {
    object: clouds?.object ?? null,
    step: stepClouds,
    warm(groundAt: (x: number, z: number) => number): void {
      for (let t = 0; t < DUST_CLOUD_LIFE * (1 + DUST_CLOUD_LIFE_JITTER); t += DUST_CLOUD_WARM_STEP) {
        stepClouds(DUST_CLOUD_WARM_STEP, groundAt)
      }
    },
    reset(): void {
      clouds?.reset()
      cloudClock = 0
      cloudCount = 0
    },
    dispose(): void { clouds?.dispose() },
  }
}
