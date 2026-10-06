import { AdditiveBlending, NormalBlending, type Texture } from 'three'
import { FIRE_CHUNK_SIZE } from './chunks'
import { createParticles, type Particles } from './particles'
import { FIRE_FOG } from './fireFog'
import {
  SMOKE_ALPHA, SMOKE_DRAG, SMOKE_GRAVITY, SMOKE_LIFE, SMOKE_LIFE_JITTER,
  SMOKE_SIZE_FROM, SMOKE_SIZE_TO,
} from './smoke'
import { blastSmokeColor, dustColor, fireGlowColor, mistColor } from './blastColors'

/** 揚塵的壽命，s。比黑煙短 —— 土會落下 */
export const DUST_LIFE = 3.2
export const DUST_LIFE_JITTER = 0.3
export const DUST_SIZE_FROM = 4
/**
 * 死亡直徑，m。
 *
 * 【上界是火球，而且要明顯小】塵比爆炸本身大的話，讀起來是「一團土裡面
 * 有一點火」—— 主角變成配角。火球的團徑約 30 m；這裡乘上配方的 0.8 倍
 * 之後單顆 11 m，散開之後約 16 m，是火球的一半。
 */
export const DUST_SIZE_TO = 14
/**
 * 往上，m/s²。
 *
 * 【土在爆炸的頭三秒是被熱氣帶著上升的】它確實會落下，但那是幾十秒的事。
 * 負值會讓塵在 10 m 內煞停，成為一塊貼在地上的餅。
 */
export const DUST_GRAVITY = 2
/** 終端上升速度 = gravity / drag。1.15 之下是 1.7 m/s，柱子撐得住三秒 */
export const DUST_DRAG = 1.15
export const DUST_ALPHA = 0.72
/** 一次墜地 24 顆，池子夠十幾次同時活著 */
export const DUST_CAPACITY = 512

/** 深咖啡色。沙土色在綠地上讀起來像煙不像土 */
export function createDust(
  capacity: number = DUST_CAPACITY, pace = 1, alphaMap?: Texture,
): Particles {
  return createParticles({
    capacity,
    alphaMap,
    blending: NormalBlending,
    wind: true,
    life: DUST_LIFE * pace,
    lifeJitter: DUST_LIFE_JITTER,
    sizeFrom: DUST_SIZE_FROM,
    sizeTo: DUST_SIZE_TO,
    gravity: DUST_GRAVITY,
    drag: DUST_DRAG,
    alphaFrom: DUST_ALPHA,
    shadeJitter: DUST_SHADE,
    riseSpan: DUST_RISE_SPAN,
    riseRange: BLAST_RISE_RANGE,
    color: dustColor,
  })
}

/** 逐顆的亮度衰減幅度。0.5 = 0.5×~1×。見 `particleShade` */
export const BLAST_SMOKE_SHADE = 0.5
export const DUST_SHADE = 0.45

/**
 * 高度明暗：升到這麼高算「頂」，m。
 *
 * 【煙比塵高】煙的終端上升是 3 m/s、塵只有 1.7 m/s —— 兩者能爬的高度不同，
 * 量尺也就不同。用同一個值的話，塵永遠停在梯度底端、整團一律暗。
 */
export const BLAST_SMOKE_RISE_SPAN = 22
export const DUST_RISE_SPAN = 12
/** 底與頂的亮度落差。0.5 = 底 0.5×、頂 1×（見 `particleRiseShade`：只變暗） */
export const BLAST_RISE_RANGE = 0.5

/**
 * 煙出生時的顏色 —— **幾乎純黑**，接的是燒完的火球那一刻的顏色。
 */
/**
 * 爆炸專用的黑煙池。
 *
 * 【為什麼不共用 `createSmoke`】那一支是飛機的拖煙與擊墜煙，壽命是寫死的
 * `SMOKE_LIFE`。爆炸要能整組調快調慢（`pace`），而池的壽命是建構時決定的
 * —— 共用就等於連飛機的拖煙一起改。其餘每一個參數都直接引用同一組常數。
 */
export function createBlastSmoke(
  capacity = 2048, pace = 1, alphaMap?: Texture,
): Particles {
  return createParticles({
    capacity,
    alphaMap,
    blending: NormalBlending,
    wind: true,
    life: SMOKE_LIFE * pace,
    lifeJitter: SMOKE_LIFE_JITTER,
    sizeFrom: SMOKE_SIZE_FROM,
    sizeTo: SMOKE_SIZE_TO,
    gravity: SMOKE_GRAVITY,
    drag: SMOKE_DRAG,
    alphaFrom: SMOKE_ALPHA,
    shadeJitter: BLAST_SMOKE_SHADE,
    riseSpan: BLAST_SMOKE_RISE_SPAN,
    riseRange: BLAST_RISE_RANGE,
    color: blastSmokeColor,
  })
}

/**
 * 火轉煙的那一批 —— **每一塊火球淡出時在原地留下的一顆煙**。
 *
 * 【為什麼不能用 `createBlastSmoke`】那一支是配方裡的 `smokeCount` 那批，
 * 尺寸從 2 長到 9（四倍半）。這裡的煙要**一出生就等於那一塊火球的直徑**，
 * 所以 `sizeFrom` 是 1（呼叫端把直徑直接當倍率傳進來），而且只長到 2.2 倍
 * ——用四倍半的曲線接手，煙會比那塊火球大四倍。
 *
 * 【壽命比配方的煙短】它接的是火，不是爆炸的煙柱。
 */
export const EMBER_LIFE = 1.4
export const EMBER_SIZE_FROM = 1
export const EMBER_SIZE_TO = 2.2
export const EMBER_CAPACITY = 1024

export function createEmberSmoke(
  capacity = EMBER_CAPACITY, pace = 1, alphaMap?: Texture,
): Particles {
  return createParticles({
    capacity,
    alphaMap,
    blending: NormalBlending,
    wind: true,
    life: EMBER_LIFE * pace,
    lifeJitter: SMOKE_LIFE_JITTER,
    sizeFrom: EMBER_SIZE_FROM,
    sizeTo: EMBER_SIZE_TO,
    gravity: SMOKE_GRAVITY,
    drag: SMOKE_DRAG,
    alphaFrom: SMOKE_ALPHA,
    shadeJitter: BLAST_SMOKE_SHADE,
    riseSpan: BLAST_SMOKE_RISE_SPAN,
    riseRange: BLAST_RISE_RANGE,
    color: blastSmokeColor,
  })
}

/**
 * 火球的光暈 —— **加法混合的圓片**，疊在球塊上。
 *
 * 【加法混合】背後的顏色**加上**橘光，而不是被換掉 —— 讀起來是光而不是
 * 一片橘色的塑膠。代價是明亮的背景（天空 0.6–0.8）會把它吃掉，襯著地面
 * 與海面才明顯。
 *
 * 【壽命比球塊短】火還在燒的時候熱輝最亮，球塊還沒消失光就已經退掉了。
 */
export const GLOW_LIFE_RATIO = 0.6
/** 出生／死亡直徑，相對火球的峰值直徑 */
export const GLOW_SIZE_FROM = FIRE_CHUNK_SIZE * 0.9
export const GLOW_SIZE_TO = FIRE_CHUNK_SIZE * 1.5
export const GLOW_CAPACITY = 512

export function createFireGlow(
  capacity = GLOW_CAPACITY, pace = 1, life = 0.85, alphaFrom = 0.55,
): Particles {
  return createParticles({
    capacity,
    blending: AdditiveBlending,
    life: life * GLOW_LIFE_RATIO * pace,
    sizeFrom: GLOW_SIZE_FROM,
    sizeTo: GLOW_SIZE_TO,
    gravity: 3,
    drag: 3.2,
    alphaFrom,
    color: fireGlowColor,
    fog: FIRE_FOG,
  })
}

/**
 * 水霧 —— **水柱塌下時接手它的體積**。
 *
 * 【與煙相反的方向】煙是熱的、往上；水霧是被拋起來的水滴，往下沉而且往外
 * 攤開。`gravity` 因此是負的。
 *
 * 【白色】它是水不是煙。顏色與 `spray.ts` 的水花同一個 `WATER_COLOR`。
 */
export const MIST_LIFE = 2.6
export const MIST_LIFE_JITTER = 0.3
export const MIST_SIZE_FROM = 1
export const MIST_SIZE_TO = 3.2
/** 往下沉，m/s²。終端速度 = gravity / drag = 2.2 m/s */
export const MIST_GRAVITY = -3.3
export const MIST_DRAG = 1.5
export const MIST_ALPHA = 0.6
export const MIST_SHADE = 0.3
export const MIST_CAPACITY = 1024
/** 水霧的顏色。`spray.ts` 的 `WATER_COLOR` 同一個值 */
export function createWaterMist(
  capacity = MIST_CAPACITY, pace = 1, alphaMap?: Texture,
): Particles {
  return createParticles({
    capacity,
    alphaMap,
    blending: NormalBlending,
    life: MIST_LIFE * pace,
    lifeJitter: MIST_LIFE_JITTER,
    sizeFrom: MIST_SIZE_FROM,
    sizeTo: MIST_SIZE_TO,
    gravity: MIST_GRAVITY,
    drag: MIST_DRAG,
    alphaFrom: MIST_ALPHA,
    shadeJitter: MIST_SHADE,
    color: mistColor,
  })
}
