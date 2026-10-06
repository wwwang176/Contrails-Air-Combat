import {
  regionAt, regionSeed, trackGap, trackWidthAt, REGION_SPACING, TRACK_WIDTH,
  VILLAGE_CHANCE, VILLAGE_NEIGHBOUR, type RegionSample, type Vec2,
} from './fields'
import { FloraKind, pushFlora, type FloraSource } from '../core/floraBuffer'
import { hash1, hash2 } from '../core/hash'

const AT: RegionSample = {
  r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
}

/**
 * 村落的建築離站址最遠多少，m。
 *
 * 【不要放大】140 m 會讓十來棟房子沿路拉開近三百公尺，從空中看是散落的
 * 點而不是一個聚落。
 */
export const VILLAGE_REACH = 95

/** 建築沿路排開的最近距離，m */
const VILLAGE_INNER = 14

/** 建築離路心的垂距，m */
const LANE_OFFSET = [11, 34] as const

/**
 * 一棟建築離站址最遠可能多遠，m。沿路 `VILLAGE_REACH`、垂向 `LANE_OFFSET[1]`。
 * **由那兩個推導，不寫死** —— 兩者改了這個要跟著改，而漏掉的症狀是村的
 * 邊緣幾棟房子在切窗時忽有忽無。
 */
export const VILLAGE_SPAN = Math.hypot(VILLAGE_REACH, LANE_OFFSET[1])

/**
 * 建築容許的「離凹路多遠」，用 `trackGap` 表示。
 *
 * 【為什麼是 trackGap 而不是公尺】它是兩顆種子距離差，凹路中心線上是 0，
 * 離開 t 公尺時約 2t。用它就不必自己算點到凹路的距離，而且與
 * `fieldSurfaceColor` 判斷凹路用的是同一個量。
 *
 * 下界是 `trackWidthAt`（房子不蓋在路面上），上界 90 ≈ 離路心 45 m。
 */
export const LANE_BAND = 90

/** 一個村有教堂的機率 */
const CHURCH_CHANCE = 0.45

/** 有多少比例的建築是穀倉 */
const BARN_CHANCE = 0.33

/** 穀倉的面寬與樓高倍率（建築只有一種形狀，見 `floraShapes.ts`） */
const BARN_WIDE = 1.6

const BARN_TALL = 1.3

const SEED_A: Vec2 = { x: 0, z: 0 }

const SEED_B: Vec2 = { x: 0, z: 0 }

/**
 * 配對的鄰格（`VILLAGE_NEIGHBOUR`，與田色共用）。**只往 +x 與 +z，不往回**。
 *
 * 【為什麼不能四個方向都來】(i, j) 選 +x、(i+1, j) 選 −x 的話，兩格算出來
 * 是**同一個中點** —— 同一個村會被生兩次，而且兩份建築完全重疊。只往前配對
 * 之後，一對格子只可能由較小的那一格產生。
 */
const NEIGHBOUR = VILLAGE_NEIGHBOUR

/**
 * 站址那條凹路的走向（單位向量）。**只在 `villageSite` 回 true 之後有效，
 * 而且會被下一次呼叫蓋掉。**
 *
 * 【為什麼要它】房子要沿路排。凹路是兩顆種子的垂直平分線，所以走向就是
 * 「兩顆種子連線」轉九十度。
 */
const LANE_TAN: Vec2 = { x: 1, z: 0 }

/**
 * 第 `(i, j)` 格區塊有沒有村；有的話把站址寫進 `out`。
 *
 * ```
 *   1. 取這一格的種子 A，由它的雜湊挑一個軸向鄰格
 *   2. 取那一格的種子 B
 *   3. 站址 = A 與 B 的中點 —— 到兩顆等距，所以落在它們的邊界上，也就是凹路上
 *   4. 驗證：第三顆種子不得更近（`r2 − r1 < TRACK_WIDTH`）
 * ```
 *
 * 【為什麼站址是「算出來」而不是「擺好再檢查」】村子在路口是 bocage 的常態，
 * 而中點這個構造直接保證它 —— 驗證只用來擋掉第三顆種子更近的情形。
 */
export function villageSite(i: number, j: number, out: Vec2): boolean {
  const h = regionSeed(i, j, SEED_A)
  if (((h >>> 7) & 0xff) / 256 >= VILLAGE_CHANCE) return false
  const d = ((h >>> 5) & 1) * 2
  regionSeed(i + NEIGHBOUR[d]!, j + NEIGHBOUR[d + 1]!, SEED_B)
  const x = (SEED_A.x + SEED_B.x) / 2
  const z = (SEED_A.z + SEED_B.z) / 2
  regionAt(x, z, AT)
  if (AT.r2 - AT.r1 >= TRACK_WIDTH) return false
  // 凹路的走向 = 兩顆種子連線轉九十度
  const dx = SEED_B.x - SEED_A.x
  const dz = SEED_B.z - SEED_A.z
  const len = Math.hypot(dx, dz)
  LANE_TAN.x = -dz / len
  LANE_TAN.z = dx / len
  out.x = x
  out.z = z
  return true
}

const SITE: Vec2 = { x: 0, z: 0 }

/** 這個點可以蓋房子嗎 —— 在路邊，但不在路上 */
function besideLane(x: number, z: number): boolean {
  regionAt(x, z, AT)
  const d = trackGap(x, z, AT)
  return d >= trackWidthAt(x, z) && d <= LANE_BAND
}

/**
 * 村落與教堂。
 *
 * 【tile 只負責過濾】站址與每一棟的座標都由區塊格的索引決定，所以一棟房子
 * 由「包含它的那一格」產生，與別格生不生無關。區塊間距 3,200 m 遠大於
 * tile 的 250 m，所以只要檢查涵蓋 `VILLAGE_REACH` 的那幾格。
 */
export const farmVillageFlora: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
  // 【格範圍要多放一格】站址是兩顆種子的**中點**，所以格 (i, j) 生出來的村
  // 可能落在格 (i+1, j) 或 (i, j+1) 裡。只掃站址所在的那一格的話，窄長條的
  // 窗會把整個村漏掉 —— 而全窗看起來完全正常
  const i0 = Math.floor((x0 - VILLAGE_SPAN) / REGION_SPACING) - 1
  const i1 = Math.floor((x1 + VILLAGE_SPAN) / REGION_SPACING) + 1
  const j0 = Math.floor((z0 - VILLAGE_SPAN) / REGION_SPACING) - 1
  const j1 = Math.floor((z1 + VILLAGE_SPAN) / REGION_SPACING) + 1

  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (!villageSite(i, j, SITE)) continue
      const sx = SITE.x
      const sz = SITE.z
      const tx = LANE_TAN.x
      const tz = LANE_TAN.z
      const hs = hash1(hash2(i, j) ^ 0x5eed)
      const count = 6 + (hs % 9)

      for (let k = 0; k < count; k++) {
        const kh = hash2(k, hs)
        const g = hash1(kh)
        // 【沿路排，不是圍著站址一圈】圓上的點絕大多數離路心 60 m 以上，
        // 而房子的容許帶只有 45 m —— 那樣九成的候選會被 besideLane 擋掉
        const along = (VILLAGE_INNER
          + (kh / 4294967296) * (VILLAGE_REACH - VILLAGE_INNER))
          * ((g & 1) === 0 ? 1 : -1)
        const off = (LANE_OFFSET[0]
          + ((g >>> 1) / 2147483648) * (LANE_OFFSET[1] - LANE_OFFSET[0]))
          * ((g & 2) === 0 ? 1 : -1)
        const x = sx + tx * along - tz * off
        const z = sz + tz * along + tx * off
        if (x < x0 || x >= x1 || z < z0 || z >= z1) continue
        if (!besideLane(x, z)) continue
        const g2 = hash1(g)
        const barn = ((g2 >>> 8) & 0xff) / 256 < BARN_CHANCE
        pushFlora(
          out, x, heightAt(x, z), z,
          // 【屋脊順著路】
          Math.atan2(tx, tz), 0.85 + ((g2 & 0xff) / 255) * 0.3,
          (hash1(g2) & 0xff) / 255,
          barn ? FloraKind.Barn : FloraKind.House,
          // 【穀倉是拉寬拉高的同一個形狀】面寬約 1.6 倍、高 1.3 倍
          barn ? BARN_WIDE : 1, barn ? BARN_TALL : 1,
        )
      }

      // ── 教堂 ────────────────────────────────────────
      if ((hs >>> 16) / 65536 >= CHURCH_CHANCE) continue
      for (let k = 0; k < 4; k++) {
        const kh = hash2(k, hs ^ 0xc47c)
        const along = ((kh / 4294967296) - 0.5) * 2 * 24
        const off = (LANE_OFFSET[0] + 6) * (((kh >>> 20) & 1) === 0 ? 1 : -1)
        const x = sx + tx * along - tz * off
        const z = sz + tz * along + tx * off
        if (!besideLane(x, z)) continue
        // 【這裡是 break 不是 continue】教堂就蓋在第一個合格的候選位上。
        // 改成 continue 的話，位置會取決於這一格 tile 切在哪裡
        if (x < x0 || x >= x1 || z < z0 || z >= z1) break
        pushFlora(out, x, heightAt(x, z), z, Math.atan2(tx, tz), 1, 0.5, FloraKind.Church)
        break
      }
    }
  }
}
