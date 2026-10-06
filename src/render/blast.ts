import { Vector3 } from 'three'
import { jetFalloff, jetProfileRadius, type WaterJets } from './waterJets'
import type { Particles } from './particles'
import { coneDirection } from './scatter'
import { pushImpact, type ImpactEvents } from '../world/events'
import type { BurstEvents } from '../world/flak'
import { scaleBlast } from './blastScaling'
import { FLAK_BLAST, type BlastParams } from './blastRecipes'

export { BLAST_PACE, blastFireRadius, blastScale, BOMB_BLAST_SIZE, scaleBlast } from './blastScaling'

export { blastSmokeColor, dustColor, fireGlowColor, mistColor } from './blastColors'

export {
  type BlastParams, LAND_BLAST, WATER_BLAST, TORPEDO_BLAST, WRECK_WATER_BLAST,
  AIR_BLAST, FIRE_BLAST, FLAK_BLAST,
} from './blastRecipes'

export {
  DUST_LIFE, DUST_LIFE_JITTER, DUST_SIZE_FROM, DUST_SIZE_TO, DUST_GRAVITY,
  DUST_DRAG, DUST_ALPHA, DUST_CAPACITY, createDust, BLAST_SMOKE_SHADE,
  DUST_SHADE, BLAST_SMOKE_RISE_SPAN, DUST_RISE_SPAN, BLAST_RISE_RANGE, createBlastSmoke,
  EMBER_LIFE, EMBER_SIZE_FROM, EMBER_SIZE_TO, EMBER_CAPACITY, createEmberSmoke,
  GLOW_LIFE_RATIO, GLOW_SIZE_FROM, GLOW_SIZE_TO, GLOW_CAPACITY, createFireGlow,
  MIST_LIFE, MIST_LIFE_JITTER, MIST_SIZE_FROM, MIST_SIZE_TO, MIST_GRAVITY,
  MIST_DRAG, MIST_ALPHA, MIST_SHADE, MIST_CAPACITY, createWaterMist,
} from './blastParticles'

type ParticleEmitter = Pick<Particles, 'emit'>

/**
 * 炸彈落地的爆炸 —— **組成規則**，不是粒子系統本身。
 *
 * 【它為什麼獨立於 `World`】一次爆炸是五種既有粒子的一組配方，而配方是設計
 * 值：顆數、初速、噴出的錐角、尺寸倍率。把它寫成參數表，`blast.html` 那個
 * 展示區才調得動，而遊戲接上去時走的是同一支 `emitBlast`。
 *
 * 配方數值在 `blastRecipes.ts`，粒子池建構在 `blastParticles.ts`。
 * 這裡只把事件與配方轉成發射呼叫；傷害仍由世界層處理。
 */

/**
 * 這一場已經引爆過幾發。**種子用它，不用事件在這一幀的序號** —— 與
 * `emitFlakBursts` 同一條紀律：大部分幀只有一次引爆，序號恆為 0，每一朵
 * 孤立的爆炸會長得一模一樣。
 */
let flakBlastSeed = 0

/** 換一場時歸零，與 `resetFlakBurstSeed` 一起呼叫 */
export function resetFlakBlastSeed(): void {
  flakBlastSeed = 0
}

/**
 * 把這一幀的高砲引爆事件變成小爆炸。**呼叫端負責排空 `events`。**
 * 砲彈爆炸不繼承任何母體速度，所以不傳 `ivx/ivy/ivz`。
 */
export function emitFlakBlasts(pools: BlastPools, events: BurstEvents): void {
  for (let e = 0; e < events.count; e++) {
    // 【尺度是那一發自己帶的一格】`ShipGunSpec.burstBlast`：1 = 原配方。
    // `scaleBlast` 吃的是**當量比**，而尺度是它的立方根，所以這裡要立方
    const s = events.blast[e]!
    if (s === 1) {
      emitBlast(pools, FLAK_BLAST, events.x[e]!, events.y[e]!, events.z[e]!,
        (flakBlastSeed = (flakBlastSeed + 1) | 0))
      continue
    }
    scaleBlast(FLAK_BLAST, s * s * s, SCALED_FLAK)
    emitBlast(pools, SCALED_FLAK, events.x[e]!, events.y[e]!, events.z[e]!,
      (flakBlastSeed = (flakBlastSeed + 1) | 0))
  }
}

/** `emitFlakBlasts` 的暫存配方。**每幀可能上百朵，不在迴圈裡配置** */
const SCALED_FLAK: { -readonly [K in keyof BlastParams]: number } = { ...FLAK_BLAST }


/**
 * 一塊火球交棒給幾顆煙。
 *
 * 【一顆的話煙團的結構等於火球的結構】十塊換十顆，重疊的方式一模一樣。
 * 三顆散開的小煙互相交錯才是「一團」而不是「一顆」。
 */
export const EMBER_PER_CHUNK = 3
/** 三顆散開多遠，佔火球直徑的比例 */
export const EMBER_SPREAD = 0.32
/** 每一顆的尺寸，佔火球直徑的比例。三顆加起來才蓋得住那一塊火球 */
export const EMBER_SIZE = 0.72
/** 垂直方向的散開壓扁多少。爆炸的煙團是扁的，不是球 */
export const EMBER_FLATTEN = 0.6

/** 水霧往外攤開的速度，m/s。與下沉合起來就是錐狀 */
export const MIST_SPREAD_SPEED = 9.5
/**
 * 柱頂那一團的向下初速，m/s，往柱腳線性收到 0。
 *
 * 【為什麼需要它】霧自己的下沉終端只有 2.2 m/s，而柱子塌得快得多 —— 生在
 * 34 m 高的那幾團會被留在半空，讀起來是一縷飄著的煙而不是塌下來的水。
 */
export const MIST_FALL_SPEED = 8

/**
 * 一塊火球淡出時的交棒 —— 在原地放 `EMBER_PER_CHUNK` 顆散開的煙。
 *
 * 【方向由 slot 決定】與整個專案其他所有隨機同一條紀律：純函數、重播可
 * 重現（`coneDirection` 依索引取方向）。
 *
 * @param slot 火球那一格的索引，由 `ChunkConfig.onFade` 給
 * @param d    那一塊當下的直徑，m
 */
export function emitEmber(
  pool: ParticleEmitter, slot: number,
  x: number, y: number, z: number,
  vx: number, vy: number, vz: number, d: number,
): void {
  const r = EMBER_SPREAD * d
  for (let k = 0; k < EMBER_PER_CHUNK; k++) {
    // 半角 π = 整個球面
    coneDirection(0, 1, 0, Math.PI, slot * 31 + k, DIR)
    pool.emit(
      x + DIR.x * r, y + DIR.y * r * EMBER_FLATTEN, z + DIR.z * r,
      vx, vy, vz, d * EMBER_SIZE,
    )
  }
}

/**
 * 一根水柱的交棒 —— **照柱子當下的形狀**沿整根柱身留下 `count` 團水霧。
 *
 * ```
 *   位置   柱腳到頂點等距取樣
 *   半徑   `jetProfileRadius(up)` —— 底粗頂細，與柱身同一條輪廓
 *   往外   越高拋得越開
 *   往下   越高掉得越快（`MIST_FALL_SPEED`），頂端那幾團才不會留在半空
 * ```
 *
 * @param height 這一刻的柱高，m
 * @param radius 柱子的底部半徑，m
 */
export function emitMist(
  pool: ParticleEmitter, slot: number, count: number, sizeScale: number,
  x: number, y: number, z: number, height: number, radius: number,
): void {
  for (let k = 0; k < count; k++) {
    const up = count <= 1 ? 0.5 : k / (count - 1)
    // 【頂點取 0.94 不取 1】輪廓在 1.0 處收到半徑 0，那一團會是一個點
    const pr = jetProfileRadius(up * 0.94)
    coneDirection(0, 1, 0, Math.PI, slot * 53 + k, DIR)
    const outX = DIR.x
    const outZ = DIR.z
    const len = Math.hypot(outX, outZ) || 1
    const spread = MIST_SPREAD_SPEED * (0.35 + up)
    pool.emit(
      x + (outX / len) * radius * pr * 0.8,
      y + height * up,
      z + (outZ / len) * radius * pr * 0.8,
      (outX / len) * spread, -MIST_FALL_SPEED * up, (outZ / len) * spread,
      radius * pr * sizeScale,
    )
  }
}

export interface BlastPools {
  fireball: ParticleEmitter
  smoke: ParticleEmitter
  dust: ParticleEmitter
  spray: ParticleEmitter
  /** 水柱的事件通道。呼叫端每幀餵給 `Splashes.emit` —— 與 `World` 同一條路 */
  splashEvents: ImpactEvents
  /** 火球的光暈。省略 = 不畫 */
  glow?: ParticleEmitter | undefined
  /**
   * 爆炸的水冠。**省略時水柱退回 `splashEvents`**（子彈入水那一套細柱）。
   */
  jets?: Pick<WaterJets, 'emit'> | undefined
}

/** 模組私有的暫存。熱路徑：不配置 */
const DIR = new Vector3()

/**
 * 噴一次。
 *
 * @param seed  方向的序號起點。**同一個 seed 逐位元噴出同一組方向** ——
 *              `coneDirection` 由索引決定方向，與專案其他隨機同一條紀律。
 * @param ivx,ivy,ivz 要繼承的速度，m/s。**空中擊墜必須給** —— 一架
 *              150 m/s 的飛機在火球的半秒裡會飛出 75 m，不繼承的話爆炸
 *              留在原地而殘骸飛走了。落地的爆炸給 0。
 */
export function emitBlast(
  pools: BlastPools, p: BlastParams,
  x: number, y: number, z: number, seed: number,
  ivx = 0, ivy = 0, ivz = 0, anchor = -1,
): void {
  // 【四種粒子各自從 seed 的不同段取索引】共用同一段的話，火球第 3 顆與
  // 塵土第 3 顆會朝完全相同的方向，畫面上是一條並排的雙軌
  emitCone(pools.fireball, p.fireCount, p.fireSpeed, p.fireCone, p.fireSize,
    x, y, z, seed, ivx, ivy, ivz, anchor)
  // 【光暈與火球同一段 seed】方向必須逐顆對齊，光暈才貼在球塊上而不是
  // 散在它旁邊
  // 【錨點也要一起給】光暈沒吸附的話，火球跟著物件走而光暈留在原地
  if (pools.glow !== undefined && p.glowSize > 0) {
    emitCone(pools.glow, p.fireCount, p.fireSpeed, p.fireCone,
      p.fireSize * p.glowSize, x, y, z, seed, ivx, ivy, ivz, anchor)
  }
  emitCone(pools.smoke, p.smokeCount, p.smokeSpeed, p.smokeCone, p.smokeSize,
    x, y, z, seed + 1013, ivx, ivy, ivz, anchor)
  emitCone(pools.dust, p.dustCount, p.dustSpeed, p.dustCone, p.dustSize,
    x, y, z, seed + 2027)
  // 【水花跟著水柱走，不是撒在爆心】見 `emitCrown`

  emitCrown(pools, p, x, y, z, seed)
}

/**
 * 水冠 —— 一叢粗水柱，**中央最高、往外遞減**。
 *
 * 【柱子要重疊】中央那幾根的直徑（`jetRadius` × 2 = 6.4 m）大過相鄰兩根的
 * 間距（半徑 6.5 m 內撒 13 根，相鄰約 1.8 m），所以柱身互相穿插 —— 讀起來
 * 是一叢水而不是幾根分開的柱子。
 *
 * 【第一根在正中心】那是最高的一根。其餘的照 `√(k / count)` 取半徑，讓柱子
 * 在圓面上分佈均勻而不是擠在外圈（等距取半徑會讓外圈稀、內圈密）。
 *
 * 【方位角用黃金角】相鄰的兩根不會排成一條直線，也不會在小數量時剛好對稱。
 *
 * 【沒有 `jets` 池時退回 `splashEvents`】遊戲目前接的是後者。
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

function emitCrown(
  pools: BlastPools, p: BlastParams,
  x: number, y: number, z: number, seed: number,
): void {
  if (p.jetCount <= 0) return
  for (let n = 0; n < p.jetCount; n++) {
    const u = p.jetCount <= 1 ? 0 : Math.sqrt(n / (p.jetCount - 1))
    const r = u * p.jetSpread
    const a = seed * 0.37 + n * GOLDEN_ANGLE
    const jx = x + Math.cos(a) * r
    const jz = z + Math.sin(a) * r
    if (pools.jets !== undefined && p.jetHeight > 0) {
      const f = jetFalloff(u)
      pools.jets.emit(jx, y, jz, p.jetHeight * f, p.jetRadius * (0.45 + 0.55 * f))
    } else {
      pushImpact(pools.splashEvents, jx, y, jz, 0, 1, 0)
    }
    // 【每一根柱腳都炸出一圈水花】柱子出水那一下把表面的水掀開。跟著柱子的
    // 位置走，所以柱子排得密，水花也密
    emitCone(pools.spray, p.sprayCount, p.spraySpeed, p.sprayCone, 1,
      jx, y, jz, seed + 3041 + n * 97)
  }
}

function emitCone(
  pool: ParticleEmitter, count: number, speed: number, cone: number, size: number,
  x: number, y: number, z: number, seed: number,
  ivx = 0, ivy = 0, ivz = 0, anchor = -1,
): void {
  for (let k = 0; k < count; k++) {
    coneDirection(0, 1, 0, cone, seed + k, DIR)
    pool.emit(
      x, y, z,
      ivx + DIR.x * speed, ivy + DIR.y * speed, ivz + DIR.z * speed,
      size, anchor,
    )
  }
}
