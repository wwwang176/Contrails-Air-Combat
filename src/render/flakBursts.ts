import { Color, NormalBlending, Vector3 } from 'three'
import { createParticles, type Particles } from './particles'
import { coneDirection } from './scatter'
import { FLAK_RADIUS, type BurstEvents } from '../world/flak'

/**
 * # 高砲的黑雲
 *
 * **與殘骸的煙是同一套粒子系統的另一份實例，不是新的系統。**
 *
 * 【為什麼不能共用煙霧池】壽命、上升、起訖尺寸是**整池共用的建立期設定**
 * （`render/smoke.ts`），而 `Particles.emit` 只覆寫得了位置、速度與整體
 * 尺寸倍率。殘骸的煙是 2.5 秒、以 3 m/s 上升、2→9 m；高砲雲要的是四秒、
 * 幾乎不上升、6→14 m 慢慢膨脹。同一份設定生不出兩種。
 *
 * `createParticles` 本來就吃設定物件，所以代價只是一個新的字面值。
 */

/** 一朵雲幾顆。**起始值。** */
export const FLAK_PUFFS = 9

/** 一朵雲的粒子散得多開，m。約殺傷半徑的三分之一 —— 雲比殺傷範圍小。 */
export const FLAK_SPREAD = FLAK_RADIUS / 3

/**
 * 粒子的初速，m/s。
 *
 * 【為什麼要有初速而不是直接撒開】瞬間就到定位的話那朵雲是「出現」的；
 * 有初速再被阻尼拉住，看起來才是「炸開」的。
 */
export const FLAK_PUFF_SPEED = 14

/** 池的容量。同時最多約 20 朵在天上 × 9 顆，取兩倍餘裕。 */
export const FLAK_BURST_CAPACITY = 384

/**
 * 黑雲的顏色。比殘骸的煙（`0x1a1a1a`）再深一點 —— 高砲雲在照片裡幾乎是
 * 純黑的剪影。
 */
export const FLAK_COLOR = 0x121212

export function createFlakBursts(capacity: number = FLAK_BURST_CAPACITY): Particles {
  return createParticles({
    capacity,
    blending: NormalBlending,
    life: 4,
    // 【壽命要抖】同一朵的九顆若同時消失，那朵雲會被切齊地「關掉」而不是散開
    lifeJitter: 0.3,
    // 【×1.5，負責人試飛裁定】原本 6 → 14。
    sizeFrom: 9,
    sizeTo: 21,
    // 【幾乎不上升】終端速度 = gravity / drag = 0.1 m/s。高砲雲會掛在原地
    // 好幾秒，那正是它在照片裡的樣子。
    gravity: 0.2,
    drag: 2,
    alphaFrom: 0.8,
    color: (_t: number, out: Color) => { out.setHex(FLAK_COLOR) },
  })
}

/**
 * 這一場已經開過幾朵雲。**種子用它，不用事件在這一幀的序號。**
 *
 * 【為什麼不能用序號】`emitFireball` 是那樣寫的（`e * COUNT + k`），但擊墜
 * 很少見、火球又只活半秒，重複看不出來。高砲雲不一樣：每秒約四朵、每朵活
 * 四秒，而**大部分幀只有一次引爆，序號恆為 0** —— 於是每一朵孤立的雲都用
 * 同一組九個方向，長得一模一樣。
 *
 * 【為什麼不是亂數】與這個專案其他所有隨機一樣：確定性才測得起來、重播才
 * 可重現。一個單調遞增的計數器就夠了。
 */
let burstSeed = 0

/** 換一場時歸零 —— 不歸零不會壞，但同一場從同一朵開始比較好比對。 */
export function resetFlakBurstSeed(): void {
  burstSeed = 0
}

/**
 * 把這一幀的引爆事件變成雲。**呼叫端負責排空 `events`。**
 *
 * 【方向用確定性的低差異序列，不用亂數】與 `emitFireball` 同一條紀律：
 * 純函數才測得起來，重播也才可重現。
 */
export function emitFlakBursts(pool: Particles, events: BurstEvents): void {
  for (let e = 0; e < events.count; e++) {
    const x = events.x[e]!
    const y = events.y[e]!
    const z = events.z[e]!
    const seed = burstSeed++ * FLAK_PUFFS
    for (let k = 0; k < FLAK_PUFFS; k++) {
      // 半角 π = 等向。軸取 +Y 只是給錐一個參考，等向下不影響結果
      coneDirection(0, 1, 0, Math.PI, seed + k, DIR)
      pool.emit(
        x + DIR.x * FLAK_SPREAD,
        y + DIR.y * FLAK_SPREAD,
        z + DIR.z * FLAK_SPREAD,
        DIR.x * FLAK_PUFF_SPEED,
        DIR.y * FLAK_PUFF_SPEED,
        DIR.z * FLAK_PUFF_SPEED,
      )
    }
  }
}

/** 模組私有暫存。熱路徑之外，但仍不配置。 */
const DIR = /* @__PURE__ */ new Vector3()
