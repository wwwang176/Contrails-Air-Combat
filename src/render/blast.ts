import { Color, NormalBlending, SRGBColorSpace, Vector3 } from 'three'
import { createParticles, type Particles } from './particles'
import { coneDirection } from './scatter'
import { pushImpact, type ImpactEvents } from '../world/events'

/**
 * 炸彈落地的爆炸 —— **組成規則**，不是粒子系統本身。
 *
 * 【它為什麼獨立於 `World`】一次爆炸是五種既有粒子的一組配方，而配方是設計
 * 值：顆數、初速、噴出的錐角、尺寸倍率。把它寫成參數表，`blast.html` 那個
 * 展示區才調得動，而遊戲接上去時走的是同一支 `emitBlast`。
 *
 * 【目前沒有任何遊戲程式呼叫它】接進 `World.onBombImpact` 是另一件事 ——
 * 那要先決定傷害，見 `docs`。
 */

/**
 * 一種爆炸的配方。
 *
 * 【為什麼每一種粒子都有自己的錐角】火球是往上竄的一團、塵土是往外掀的一圈
 * ——同一個角度做不出兩者的差別。
 */
export interface BlastParams {
  /** 火球顆數 */
  fireCount: number
  /** 火球初速，m/s */
  fireSpeed: number
  /** 火球尺寸倍率。1 = `FIREBALL_SIZE_FROM`／`TO` 那一組（一架飛機的擊墜） */
  fireSize: number
  /** 火球噴出的錐半角，rad。軸恆是世界上方 */
  fireCone: number
  smokeCount: number
  smokeSpeed: number
  smokeSize: number
  smokeCone: number
  /** 揚塵。落水恆為 0 */
  dustCount: number
  dustSpeed: number
  dustSize: number
  dustCone: number
  /** 水霧。墜地恆為 0 */
  sprayCount: number
  spraySpeed: number
  sprayCone: number
  /** 水柱根數。墜地恆為 0 */
  jetCount: number
  /** 水柱離爆點多遠，m。一根柱子太細，用一圈換規模 */
  jetSpread: number
}

/**
 * 墜地。**起始值，由試飛裁定。**
 *
 * 【塵比火多】500 lb 落在土地上，看得最久的是那一團土 —— 火球 0.5 s 就沒了。
 */
export const LAND_BLAST: BlastParams = {
  fireCount: 18,
  fireSpeed: 26,
  fireSize: 2.2,
  fireCone: (55 * Math.PI) / 180,
  smokeCount: 14,
  smokeSpeed: 9,
  smokeSize: 3,
  smokeCone: (45 * Math.PI) / 180,
  dustCount: 24,
  dustSpeed: 17,
  dustSize: 2.4,
  dustCone: (72 * Math.PI) / 180,
  sprayCount: 0,
  spraySpeed: 0,
  sprayCone: 0,
  jetCount: 0,
  jetSpread: 0,
}

/**
 * 落水。**起始值，由試飛裁定。**
 *
 * 【火球留一點點】水面爆炸的火在一瞬間就被壓熄，但那一下黃光是「這是爆炸不是
 * 掉東西」的唯一線索 —— 全關掉的話與濺水長得一樣。
 */
export const WATER_BLAST: BlastParams = {
  fireCount: 5,
  fireSpeed: 15,
  fireSize: 1.2,
  fireCone: (35 * Math.PI) / 180,
  smokeCount: 6,
  smokeSpeed: 7,
  smokeSize: 1.6,
  smokeCone: (30 * Math.PI) / 180,
  dustCount: 0,
  dustSpeed: 0,
  dustSize: 0,
  dustCone: 0,
  sprayCount: 44,
  spraySpeed: 24,
  sprayCone: (52 * Math.PI) / 180,
  jetCount: 5,
  jetSpread: 3.5,
}

/** 揚塵的壽命，s。比黑煙短 —— 土會落下 */
export const DUST_LIFE = 2.2
export const DUST_LIFE_JITTER = 0.3
export const DUST_SIZE_FROM = 4
export const DUST_SIZE_TO = 17
/** 微微下沉。土不是熱的，不會像煙一樣往上飄 */
export const DUST_GRAVITY = -2
export const DUST_DRAG = 1.7
export const DUST_ALPHA = 0.72
/** 一次墜地 24 顆，池子夠十幾次同時活著 */
export const DUST_CAPACITY = 512

const DUST_YOUNG = { r: 0.62, g: 0.52, b: 0.38 }
const DUST_OLD = { r: 0.34, g: 0.29, b: 0.24 }

/**
 * 年齡比例 → 塵土的顏色。
 *
 * 【為什麼不沿用黑煙】土是暖色的，而黑煙整條曲線都是中性灰 —— 兩者疊在
 * 同一次爆炸上時，差別正是「地面被掀起來」與「東西在燒」。
 *
 * 【色標是 sRGB，所以要指定色彩空間】`setRGB` 預設寫的是線性值，火球與黑煙
 * 都為此踩過同一個坑。
 */
export function dustColor(t: number, out: Color): void {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  out.setRGB(
    DUST_YOUNG.r + (DUST_OLD.r - DUST_YOUNG.r) * k,
    DUST_YOUNG.g + (DUST_OLD.g - DUST_YOUNG.g) * k,
    DUST_YOUNG.b + (DUST_OLD.b - DUST_YOUNG.b) * k,
    SRGBColorSpace,
  )
}

export function createDust(capacity: number = DUST_CAPACITY): Particles {
  return createParticles({
    capacity,
    blending: NormalBlending,
    life: DUST_LIFE,
    lifeJitter: DUST_LIFE_JITTER,
    sizeFrom: DUST_SIZE_FROM,
    sizeTo: DUST_SIZE_TO,
    gravity: DUST_GRAVITY,
    drag: DUST_DRAG,
    alphaFrom: DUST_ALPHA,
    color: dustColor,
  })
}

export interface BlastPools {
  fireball: Particles
  smoke: Particles
  dust: Particles
  spray: Particles
  /** 水柱的事件通道。呼叫端每幀餵給 `Splashes.emit` —— 與 `World` 同一條路 */
  splashEvents: ImpactEvents
}

/** 模組私有的暫存。熱路徑：不配置 */
const DIR = new Vector3()

/**
 * 噴一次。
 *
 * @param seed 方向的序號起點。**同一個 seed 逐位元噴出同一組方向** ——
 *             `coneDirection` 由索引決定方向，與專案其他隨機同一條紀律。
 */
export function emitBlast(
  pools: BlastPools, p: BlastParams,
  x: number, y: number, z: number, seed: number,
): void {
  // 【四種粒子各自從 seed 的不同段取索引】共用同一段的話，火球第 3 顆與
  // 塵土第 3 顆會朝完全相同的方向，畫面上是一條並排的雙軌
  emitCone(pools.fireball, p.fireCount, p.fireSpeed, p.fireCone, p.fireSize, x, y, z, seed)
  emitCone(pools.smoke, p.smokeCount, p.smokeSpeed, p.smokeCone, p.smokeSize,
    x, y, z, seed + 1013)
  emitCone(pools.dust, p.dustCount, p.dustSpeed, p.dustCone, p.dustSize,
    x, y, z, seed + 2027)
  emitCone(pools.spray, p.sprayCount, p.spraySpeed, p.sprayCone, 1,
    x, y, z, seed + 3041)

  // 【水柱排成一圈而不是疊在一點】`splashSize` 依池格給高低粗細，五根散開
  // 讀起來是一圈掀起來的水；疊在同一點只是一根比較亮的柱子
  for (let n = 0; n < p.jetCount; n++) {
    const a = (n / p.jetCount) * Math.PI * 2
    pushImpact(
      pools.splashEvents,
      x + Math.cos(a) * p.jetSpread, y, z + Math.sin(a) * p.jetSpread,
      0, 1, 0,
    )
  }
}

function emitCone(
  pool: Particles, count: number, speed: number, cone: number, size: number,
  x: number, y: number, z: number, seed: number,
): void {
  for (let k = 0; k < count; k++) {
    coneDirection(0, 1, 0, cone, seed + k, DIR)
    pool.emit(x, y, z, DIR.x * speed, DIR.y * speed, DIR.z * speed, size)
  }
}
