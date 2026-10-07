import { Color, NormalBlending, Vector3, type Texture } from 'three'
import { hash01 } from '../core/hash'
import { createParticles, type Particles } from './particles'
import { coneDirection } from './scatter'

/**
 * 子彈打進地面 —— 土柱＋土塊＋煙塵。
 *
 * ```
 *   土塊   小、實心、走拋物線落回地面        「地面被打出東西來」
 *   土柱   中、往上衝後被阻尼停住、短命      瞬間的那一柱
 *   煙塵   大、貼著地面慢慢膨脹、順風飄      留在地上的落點記號
 * ```
 *
 * 【錐軸是世界 +Y，不是地表法線】與水花同一個理由：往上最好讀，而且俯衝角度
 * 從幾度到七十度都有，跟著子彈或坡面斜的話淺角掃射時整柱貼地，從空中看不見。
 *
 * 【雪地是白的、夾土】雪原上打下去的是雪粉，土塊有一部分是底下翻出來的深色
 * 泥土（`mixRatio`）。只噴白的讀不出「打進地裡」，只噴土色則在雪地上不對。
 */

export type DirtSurface = 'soil' | 'snow'

/** 每一發的配方。**發射時用**，改它不必重建池 */
export interface DirtImpactParams {
  readonly clodCount: number
  /** 初速，m/s。土塊走拋物線：滿高約 v² / 2g */
  readonly clodSpeed: number
  /** 噴射錐的半角，rad */
  readonly clodCone: number
  /** 直徑倍率 */
  readonly clodSize: number
  readonly spoutCount: number
  /** 最快那一顆的初速，m/s。每顆在 `SPOUT_SPEED_MIN`～1 倍之間，疊成一柱 */
  readonly spoutSpeed: number
  readonly spoutCone: number
  readonly spoutSize: number
  readonly dustCount: number
  readonly dustSpeed: number
  readonly dustCone: number
  readonly dustSize: number
  /** 雪地上土塊有幾成是深色泥土。土地上不用 */
  readonly mixRatio: number
}

export const DIRT_IMPACT: DirtImpactParams = {
  clodCount: 6,
  clodSpeed: 11,
  clodCone: (22 * Math.PI) / 180,
  clodSize: 1,
  spoutCount: 8,
  spoutSpeed: 54,
  spoutCone: (10 * Math.PI) / 180,
  spoutSize: 1,
  dustCount: 4,
  dustSpeed: 2,
  dustCone: (70 * Math.PI) / 180,
  dustSize: 1,
  mixRatio: 0.35,
}

/** 池的壽命與膨脹。**建構時固定**，改它要重建池 */
export interface DirtPoolTune {
  /** 土塊壽命，s。要夠它落回地面 */
  readonly clodLife: number
  readonly spoutLife: number
  /** 土柱一顆的直徑，出生 → 死亡，m */
  readonly spoutFrom: number
  readonly spoutTo: number
  /** 土柱的阻尼，s⁻¹。最快那一顆停在約 `spoutSpeed / spoutDrag` 公尺高 */
  readonly spoutDrag: number
  /** 煙塵壽命，s。這就是落點記號在地上留多久 */
  readonly dustLife: number
  readonly dustFrom: number
  readonly dustTo: number
  readonly dustAlpha: number
}

export const DIRT_POOL_TUNE: DirtPoolTune = {
  clodLife: 1.3,
  spoutLife: 0.8,
  spoutFrom: 1.6,
  spoutTo: 3.5,
  spoutDrag: 6,
  dustLife: 4,
  dustFrom: 2.5,
  dustTo: 8,
  dustAlpha: 0.85,
}

/** 每一柱的最慢一顆佔最快的比例。比例越低柱子越從地面接起來 */
export const SPOUT_SPEED_MIN = 0.3

/** 土塊的直徑，m。一個像素大的東西才看得出拋物線 */
const CLOD_SIZE = 0.35

interface SurfaceColors {
  readonly clod: number
  readonly spout: number
  readonly dust: number
  /** 夾在裡面的深色土塊。null = 不夾 */
  readonly mix: number | null
}

/**
 * 色值都是 sRGB 起始值，拿眼睛校。
 *
 * 【煙塵比土柱淺】煙塵是揚起來的細粉，在空氣裡散開之後偏灰偏亮；土柱是
 * 剛翻起的濕土，比較深。兩者同色的話分不出哪一團是剛打的。
 */
export const DIRT_COLORS: Record<DirtSurface, SurfaceColors> = {
  soil: { clod: 0x3b2a1b, spout: 0x5a4532, dust: 0xb3a38c, mix: null },
  snow: { clod: 0xeef1f4, spout: 0xe6eaee, dust: 0xf2f4f6, mix: 0x3b2a1b },
}

export interface DirtPools {
  readonly clods: Particles
  /** 雪地上的深色土塊。土地上是 null */
  readonly mixClods: Particles | null
  readonly spout: Particles
  readonly dust: Particles
}

/**
 * 建一組池。換地表要重建 —— 顏色在建構時就烘進 `color` 回呼。
 *
 * @param dustTex 煙塵的不透明度貼圖（`textures/smoke.png`）。省略時是軟邊圓
 */
export function createDirtPools(
  surface: DirtSurface, tune: DirtPoolTune = DIRT_POOL_TUNE, dustTex?: Texture,
  capacity = 2048,
): DirtPools {
  const c = DIRT_COLORS[surface]
  const solid = (hex: number, life: number): Particles => {
    const tint = new Color(hex)
    return createParticles({
      capacity,
      blending: NormalBlending,
      life,
      lifeJitter: 0.2,
      sizeFrom: CLOD_SIZE,
      sizeTo: CLOD_SIZE,
      gravity: -9.80665,
      drag: 0.4,
      alphaFrom: 1,
      shadeJitter: 0.35,
      color: (_t, out) => { out.copy(tint) },
    })
  }
  const spoutTint = new Color(c.spout)
  const dustTint = new Color(c.dust)
  return {
    clods: solid(c.clod, tune.clodLife),
    mixClods: c.mix === null ? null : solid(c.mix, tune.clodLife),
    spout: createParticles({
      capacity,
      blending: NormalBlending,
      life: tune.spoutLife,
      lifeJitter: 0.25,
      sizeFrom: tune.spoutFrom,
      sizeTo: tune.spoutTo,
      gravity: -4,
      drag: tune.spoutDrag,
      alphaFrom: 0.9,
      shadeJitter: 0.3,
      color: (_t, out) => { out.copy(spoutTint) },
    }),
    dust: createParticles({
      capacity,
      blending: NormalBlending,
      life: tune.dustLife,
      lifeJitter: 0.3,
      sizeFrom: tune.dustFrom,
      sizeTo: tune.dustTo,
      gravity: 0.25,
      drag: 1.5,
      alphaFrom: tune.dustAlpha,
      shadeJitter: 0.25,
      riseSpan: 4,
      riseRange: 0.3,
      wind: true,
      alphaMap: dustTex,
      color: (_t, out) => { out.copy(dustTint) },
    }),
  }
}

export function dirtPoolList(p: DirtPools): Particles[] {
  return p.mixClods === null ? [p.clods, p.spout, p.dust] : [p.clods, p.mixClods, p.spout, p.dust]
}

const DIR = new Vector3()

/**
 * 一發打進地面。熱路徑：不配置。
 *
 * @param seed 這一發的種子。**每一發要不同** —— 用序號遞增，同一個種子的兩發
 *             長得一模一樣
 */
export function emitDirtImpact(
  pools: DirtPools, p: DirtImpactParams, x: number, y: number, z: number, seed: number,
): void {
  const base = seed * 37
  for (let k = 0; k < p.clodCount; k++) {
    coneDirection(0, 1, 0, p.clodCone, base + k, DIR)
    const v = p.clodSpeed * (0.6 + 0.4 * hash01(base + k + 0x51))
    const mixed = pools.mixClods !== null && hash01(base + k + 0x9e3) < p.mixRatio
    ;(mixed ? pools.mixClods! : pools.clods).emit(
      x, y, z, DIR.x * v, DIR.y * v, DIR.z * v, p.clodSize,
    )
  }
  for (let k = 0; k < p.spoutCount; k++) {
    coneDirection(0, 1, 0, p.spoutCone, base + 11 + k, DIR)
    // 【一柱裡快慢不一】同速的話全部停在同一個高度，是一團而不是一柱
    const s = p.spoutCount > 1 ? k / (p.spoutCount - 1) : 1
    const v = p.spoutSpeed * (SPOUT_SPEED_MIN + (1 - SPOUT_SPEED_MIN) * s)
    pools.spout.emit(x, y, z, DIR.x * v, DIR.y * v, DIR.z * v, p.spoutSize)
  }
  for (let k = 0; k < p.dustCount; k++) {
    coneDirection(0, 1, 0, p.dustCone, base + 23 + k, DIR)
    pools.dust.emit(
      x, y + 0.5, z, DIR.x * p.dustSpeed, DIR.y * p.dustSpeed, DIR.z * p.dustSpeed, p.dustSize,
    )
  }
}
