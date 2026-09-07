import type { HeightFieldData } from '../../src/world/heightfield'
import type { IslandDesc } from '../../src/world/archipelago'

/**
 * 遮蔽測試的考題：兩架同高，連線從山頂之下穿過。
 *
 * 【為什麼是搜出來的，不是抄一組座標】島的高度與坡度是設計值，會改；
 * 寫死的座標在山變矮之後會靜靜地變成一個不再遮蔽的場景。這裡在真的高度場
 * 上找一條穿過島心的弦：兩端離地恰好是安全層的 clearance、兩架在射程之
 * 內，取**山頂高出連線最多**的那一組 —— 高出越多，兩架互相接近時遮蔽
 * 維持得越久，AI 那幾條「遮蔽期間不開火、不防禦」才量得到東西。找不到就
 * 丟例外，那代表這張圖上已經沒有山擋得住視線，測試的前提不成立，該有人
 * 知道。
 */
export interface OcclusionCase {
  /** 那座島的島心（主瓣的峰） */
  cx: number
  cz: number
  ax: number
  az: number
  bx: number
  bz: number
  /** 兩架的高度 */
  y: number
  /** 弦的一半 */
  d: number
  /** 連線上最高的地形 */
  ridge: number
  /** 山頂高出連線幾公尺（`ridge − y`） */
  drop: number
}

export interface OcclusionSearch {
  /** 兩架相距的上限，m */
  maxChord: number
  /** 山頂至少要高出連線幾公尺 */
  minDrop: number
  /** 兩端離地的高度 */
  clearance: number
}

export const DEFAULT_OCCLUSION_SEARCH: OcclusionSearch = {
  maxChord: 1000, minDrop: 40, clearance: 120,
}

export function findOcclusionCase(
  field: HeightFieldData, islands: readonly IslandDesc[],
  opt: OcclusionSearch = DEFAULT_OCCLUSION_SEARCH,
): OcclusionCase {
  let best: OcclusionCase | null = null
  for (const isl of islands) {
    // 矮島擋不住 clearance + minDrop 那麼高的落差，不必搜
    if (isl.peak < opt.clearance + opt.minDrop) continue
    for (let d = 200; d <= opt.maxChord / 2; d += 25) {
      for (let k = 0; k < 36; k++) {
        const th = (k / 36) * Math.PI
        const ax = isl.cx + Math.cos(th) * d
        const az = isl.cz + Math.sin(th) * d
        const bx = isl.cx - Math.cos(th) * d
        const bz = isl.cz - Math.sin(th) * d
        let ridge = -Infinity
        const n = Math.ceil((2 * d) / 10)
        for (let i = 0; i <= n; i++) {
          const t = i / n
          const h = field.sample(ax + (bx - ax) * t, az + (bz - az) * t)
          if (h > ridge) ridge = h
        }
        // 兩端離地恰好 clearance：越低，山頂高出連線越多
        const y = Math.max(field.sample(ax, az), field.sample(bx, bz)) + opt.clearance
        const drop = ridge - y
        if (drop < opt.minDrop) continue
        // 高出最多的那一組；同樣高出取弦短的，離射程上限遠一點
        if (best === null || drop > best.drop + 1e-9
          || (Math.abs(drop - best.drop) <= 1e-9 && d < best.d)) {
          best = { cx: isl.cx, cz: isl.cz, ax, az, bx, bz, y, d, ridge, drop }
        }
      }
    }
  }
  if (best === null) {
    throw new Error(
      `這張圖上找不到「兩架離地 ${opt.clearance} m、相距 ≤ ${opt.maxChord} m、`
      + `山頂高出連線 ≥ ${opt.minDrop} m」的位置 —— 遮蔽測試的前提不成立`)
  }
  return best
}
