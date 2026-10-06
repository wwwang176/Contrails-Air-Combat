import { FIRE_CHUNK_DRAG, FIRE_CHUNK_LIFE, FIRE_CHUNK_SIZE } from './chunks'
import type { BlastParams } from './blastRecipes'

/**
 * 整個爆炸的快慢 —— **壽命倍率**，火球、塵、煙三個池一起吃。
 *
 * 【為什麼不在 `BlastParams` 裡】它不是發射時的參數，是**建池**時的：粒子
 * 池的壽命在 `createParticles` 就固定了。改它要重建池，所以它是
 * `createFireChunks`／`createDust`／`createBlastSmoke` 的引數。
 *
 * 【0.6 是什麼】火球 0.85 s、塵 3.2 s、煙 2.5 s 各乘 0.6 —— 0.51 / 1.92 /
 * 1.5 s。**在展示區用眼睛調的。**
 */
export const BLAST_PACE = 0.6

/**
 * 當量 → **線性尺度倍率**。`LAND_BLAST`／`WATER_BLAST` 的基準是 1
 * （AN-M64，500 lb）。
 *
 * 【立方根律】爆炸相似律（Hopkinson–Cranz）：火球半徑與持續時間都正比於
 * 當量的立方根。八倍的裝藥只有兩倍大 —— 這不是美術上的取捨，是真的。
 *
 * ```
 *   250 lb    0.5×    尺度 0.79
 *   500 lb    1.0×    尺度 1.00     ← 基準
 *  1000 lb    2.0×    尺度 1.26
 *  2000 lb    4.0×    尺度 1.59
 * ```
 */
export function blastScale(yieldRatio: number): number {
  return Math.cbrt(Math.max(0, yieldRatio))
}

/**
 * 火球外緣的半徑，m：火塊衝出去的距離加上一塊的半徑。拿已經縮放過的配方算。
 *
 * 火塊壽命是建池時的 `FIRE_CHUNK_LIFE × BLAST_PACE`，不隨當量變；衝出去的
 * 距離是阻力下的 初速 ÷ 阻力 ×（1 − e^{−阻力·壽命}）。
 */
export function blastFireRadius(p: BlastParams): number {
  const travel = (p.fireSpeed / FIRE_CHUNK_DRAG)
    * (1 - Math.exp(-FIRE_CHUNK_DRAG * FIRE_CHUNK_LIFE * BLAST_PACE))
  return travel + (FIRE_CHUNK_SIZE * p.fireSize) / 2
}

/**
 * 投下的炸彈另外乘在**表現尺度**上的倍率。1 = 照當量算出來的大小。
 *
 * 【乘火球、煙、塵】動態光源的亮度與衰減、鏡頭震動照原尺度 —— 一起乘的話
 * 遠處的一顆炸彈會把整片天照亮，而那不是「爆炸大一點」。碎片與火星噴多遠
 * 跟著火球半徑（`blastFireRadius`），所以間接吃到這個倍率。
 *
 * 【為什麼不是改 `LAND_BLAST` 的尺寸】那一份同時是撞地的飛機與燒起來的
 * 地面目標用的；在那裡放大，墜機的火球會跟著變成炸彈那麼大。
 */
export const BOMB_BLAST_SIZE = 2

/**
 * 把配方縮放到某個當量，就地寫進 `out`。**放大公式的全部規則在這裡。**
 *
 * ```
 *   尺寸   × s      單顆粒子的直徑、水柱的散佈半徑
 *   顆數   × s      維持覆蓋率：整團的投影面積 ∝ s²，而每顆也大了 s
 *   初速   不變     相似律下質點速度與當量無關；擴散距離 = 速度 × 時間，
 *                   而時間也 ∝ s，所以團徑自己就 ∝ s
 *   錐角   不變     形狀不隨大小改變
 * ```
 *
 * 【顆數為 0 的保持 0】墜地沒有水霧、落水沒有揚塵 —— 那是種類的差別，
 * 不該被當量放大成 1 顆。
 */
export function scaleBlast(
  src: BlastParams, yieldRatio: number, out: { -readonly [K in keyof BlastParams]: number },
): void {
  const s = blastScale(yieldRatio)
  const n = (v: number): number => (v === 0 ? 0 : Math.max(1, Math.round(v * s)))
  out.fireCount = n(src.fireCount)
  out.fireSpeed = src.fireSpeed
  out.fireSize = src.fireSize * s
  out.fireCone = src.fireCone
  out.smokeCount = n(src.smokeCount)
  out.smokeSpeed = src.smokeSpeed
  out.smokeSize = src.smokeSize * s
  out.smokeCone = src.smokeCone
  out.dustCount = n(src.dustCount)
  out.dustSpeed = src.dustSpeed
  out.dustSize = src.dustSize * s
  out.dustCone = src.dustCone
  out.sprayCount = n(src.sprayCount)
  out.spraySpeed = src.spraySpeed
  out.sprayCone = src.sprayCone
  out.jetCount = n(src.jetCount)
  out.jetSpread = src.jetSpread * s
  out.jetHeight = src.jetHeight * s
  out.jetRadius = src.jetRadius * s
  out.mistPerJet = src.mistPerJet
  out.mistSize = src.mistSize
  // 【光暈是比例，不吃當量】它跟著火球的直徑走，而那已經乘過 s 了
  out.glowSize = src.glowSize
  out.glowAlpha = src.glowAlpha
}
