import { Color, NormalBlending, Vector3, type Texture } from 'three'
import { hash01 } from '../core/hash'
import { createParticles, type Particles } from './particles'
import { coneDirection } from './scatter'
import { IMPACT_STRIDE, pushImpact, type ImpactEvents } from '../world/events'
import type { TerrainKind } from '../world/terrainKind'

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
  clodCount: 5,
  clodSpeed: 12,
  clodCone: (38 * Math.PI) / 180,
  clodSize: 1,
  spoutCount: 4,
  spoutSpeed: 54,
  spoutCone: (10 * Math.PI) / 180,
  spoutSize: 1,
  dustCount: 1,
  dustSpeed: 2,
  dustCone: (70 * Math.PI) / 180,
  dustSize: 0.8,
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
  spoutLife: 0.55,
  spoutFrom: 1.6,
  spoutTo: 3.5,
  spoutDrag: 6,
  dustLife: 1.75,
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
  /** 夾在裡面的深色土塊。土地上不發射，這一格只是讓池有個顏色 */
  readonly mix: number
}

/**
 * 色值都是 sRGB 起始值，拿眼睛校。
 *
 * 【煙塵比土柱淺】煙塵是揚起來的細粉，在空氣裡散開之後偏灰偏亮；土柱是
 * 剛翻起的濕土，比較深。兩者同色的話分不出哪一團是剛打的。
 */
export const DIRT_COLORS: Record<DirtSurface, SurfaceColors> = {
  soil: { clod: 0x3b2a1b, spout: 0x5a4532, dust: 0xb3a38c, mix: 0x3b2a1b },
  snow: { clod: 0xeef1f4, spout: 0xe6eaee, dust: 0xf2f4f6, mix: 0x3b2a1b },
}

/**
 * 離相機超過這個距離的命中不噴，m。
 *
 * 1,920 px、65° 視野下 1 px 約 5.9e-4 rad（見 `sparks.ts`）：1,500 m 處 1 px
 * 約 0.9 m，煙塵約 9 px、土柱約 4 px，再遠就讀不出來了。
 */
export const DIRT_CULL = 1500

/**
 * 池的容量。一架六挺掃射每秒約 80 發落地，存活數是土塊約 520（雪地上其中約
 * 180 顆在夾土池）、土柱約 180、煙塵約 140。
 *
 * 【不要隨手加大】`createParticles.step` 每幀掃完整容量，GPU 每幀畫滿容量的
 * 實例 —— 固定成本跟著容量走，不是存活數。滿了覆蓋最舊的，那幾顆快燒完了。
 */
const CAPACITY = { clods: 1024, mixClods: 512, spout: 512, dust: 512 } as const

/** 雪地就是 `winterSteppe` 季節的地圖（`render/terrain.ts`）。新增冬季地圖要一起改這裡 */
export function dirtSurfaceOf(kind: TerrainKind): DirtSurface {
  return kind === 'rzhev' ? 'snow' : 'soil'
}

export interface DirtPools {
  readonly clods: Particles
  /** 雪地上的深色土塊。土地上不發射 */
  readonly mixClods: Particles
  readonly spout: Particles
  readonly dust: Particles
}

export type MutableDirtParams = { -readonly [K in keyof DirtImpactParams]: number }

export interface DirtImpacts {
  /** 四池。場景加各池的 `object` */
  readonly pools: DirtPools
  /** 每一發的配方，`emit` 每次讀它。展示區直接改這一份 */
  readonly params: MutableDirtParams
  /** 換地表只改顏色，池不重建 */
  setSurface(s: DirtSurface): void
  /**
   * 依地形命中事件發射。熱路徑：不配置。
   *
   * @param waterAt       水面高度（`Terrain.waterAt`），沒有水是 −Infinity
   * @param riverSplashes 落點在河面以下的推到這裡，高度是水面，交給水柱
   */
  emit(
    events: ImpactEvents, cameraX: number, cameraY: number, cameraZ: number,
    waterAt: (x: number, z: number) => number, riverSplashes: ImpactEvents,
  ): void
  /** 積分一幀。**在渲染幀率呼叫，不在物理步** */
  step(dt: number): void
  /** 四池歸零、種子歸零 */
  reset(): void
  dispose(): void
}

/**
 * 建一組。**建一次，換地圖用 `setSurface`**。
 *
 * @param dustTex 煙塵的不透明度貼圖（`textures/smoke.png`）。省略時是軟邊圓
 */
export function createDirtImpacts(
  tune: DirtPoolTune = DIRT_POOL_TUNE, dustTex?: Texture,
): DirtImpacts {
  // 【顏色由這四個物件持有】`color` 回呼每幀讀它們，`setSurface` 改寫它們
  const clodTint = new Color()
  const mixTint = new Color()
  const spoutTint = new Color()
  const dustTint = new Color()
  let surface: DirtSurface = 'soil'
  const setSurface = (s: DirtSurface): void => {
    surface = s
    const c = DIRT_COLORS[s]
    clodTint.set(c.clod)
    mixTint.set(c.mix)
    spoutTint.set(c.spout)
    dustTint.set(c.dust)
  }
  setSurface('soil')

  const solid = (tint: Color, capacity: number): Particles => createParticles({
    capacity,
    blending: NormalBlending,
    life: tune.clodLife,
    lifeJitter: 0.2,
    sizeFrom: CLOD_SIZE,
    sizeTo: CLOD_SIZE,
    gravity: -9.80665,
    drag: 0.4,
    alphaFrom: 1,
    shadeJitter: 0.35,
    color: (_t, out) => { out.copy(tint) },
  })
  const pools: DirtPools = {
    clods: solid(clodTint, CAPACITY.clods),
    mixClods: solid(mixTint, CAPACITY.mixClods),
    spout: createParticles({
      capacity: CAPACITY.spout,
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
      capacity: CAPACITY.dust,
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
  const list = [pools.clods, pools.mixClods, pools.spout, pools.dust]
  const params: MutableDirtParams = { ...DIRT_IMPACT }
  /** 這一場第幾發。種子用它 —— 同一個種子的兩發長得一模一樣 */
  let seed = 0

  return {
    pools,
    params,
    setSurface,
    emit(events, cx, cy, cz, waterAt, riverSplashes) {
      const d = events.data
      for (let e = 0; e < events.count; e++) {
        const o = e * IMPACT_STRIDE
        const x = d[o]!, y = d[o + 1]!, z = d[o + 2]!
        const dx = x - cx, dy = y - cy, dz = z - cz
        if (dx * dx + dy * dy + dz * dz > DIRT_CULL * DIRT_CULL) continue
        // 【河底不噴土】子彈穿過河面才打到河床，看得到的是水面上那一柱水
        const w = waterAt(x, z)
        if (w > y) {
          pushImpact(riverSplashes, x, w, z, 0, 1, 0)
          continue
        }
        emitDirtImpact(pools, params, surface === 'snow', x, y, z, seed++)
      }
    },
    step(dt) {
      for (const p of list) p.step(dt)
    },
    reset() {
      for (const p of list) p.reset()
      seed = 0
    },
    dispose() {
      for (const p of list) p.dispose()
    },
  }
}

const DIR = new Vector3()

/** 一發打進地面。熱路徑：不配置。`mix` = 這裡是雪地，土塊要夾泥土 */
function emitDirtImpact(
  pools: DirtPools, p: DirtImpactParams, mix: boolean,
  x: number, y: number, z: number, seed: number,
): void {
  const base = seed * 37
  for (let k = 0; k < p.clodCount; k++) {
    coneDirection(0, 1, 0, p.clodCone, base + k, DIR)
    const v = p.clodSpeed * (0.6 + 0.4 * hash01(base + k + 0x51))
    const mixed = mix && hash01(base + k + 0x9e3) < p.mixRatio
    ;(mixed ? pools.mixClods : pools.clods).emit(
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
