import type { FloraSource } from './flora'
import { excludingWhere, type BoxTest } from './floraExclude'
import { RiverIndex, type WaterLine } from '../world/river'

/**
 * # 不長樹的範圍：載入時先分好格
 *
 * 河廊、村鎮、礦坑、高速公路、河漫灘……不管是什麼，都是一個 `KeepOutZone`：一支
 * 逐點的判斷、一支整格的判斷、可以的話再一支格的分類。每張地圖把它有的範圍列
 * 出來，`bakeKeepOut` 在載入時合成一張遮罩：地圖切成 `MASK_CELL` 的格，每一格標成
 * 整格在裡面、整格在外面、或跨過邊界；補格時查格子，只有跨邊界的格才逐株算。
 *
 * 【分類必須保守】`CellCover` 回「整格在裡面」時格裡每一點都要在裡面，回「整格在
 * 外面」時每一點都要在外面 —— 錯一格就是那一格整片長錯（鎮上長樹籬、或田裡缺
 * 一塊），不會報錯。每一種範圍各自用距離或輪廓的上下界證明，不取樣。
 */

/** 一種不長樹的範圍 */
export interface KeepOutZone {
  /** 這一點在範圍裡嗎 */
  readonly test: (x: number, z: number) => boolean
  /** 這個方框**可能**碰到範圍嗎（保守：回 false 時一定碰不到） */
  readonly near: BoxTest
  /** 格的分類（保守）。沒有的話由 `near` 推：碰不到是整格在外，其餘逐點算 */
  readonly cover?: CellCover
}

/** 合成好的範圍：`excludingWhere` 的兩支判斷 */
export interface KeepOut {
  readonly test: (x: number, z: number) => boolean
  readonly near: BoxTest
  /** 沒有任何範圍：包了也是原樣 */
  readonly empty: boolean
}

export const COVER_OUT = 0
export const COVER_IN = 1
export const COVER_EDGE = 2

/**
 * 以 (cx, cz) 為中心、半對角線 `hd` 的方格的分類：`COVER_IN`、`COVER_OUT` 或
 * `COVER_EDGE`。格裡每一點離格心不到 `hd`，分類只能用這一點
 */
export type CellCover = (cx: number, cz: number, hd: number) => number

/** 聯集：任一個整格在裡面就是裡面，全部整格在外面才是外面 */
export function unionCover(parts: readonly CellCover[]): CellCover {
  return (cx, cz, hd) => {
    let edge = false
    for (const p of parts) {
      const c = p(cx, cz, hd)
      if (c === COVER_IN) return COVER_IN
      if (c === COVER_EDGE) edge = true
    }
    return edge ? COVER_EDGE : COVER_OUT
  }
}

/**
 * 離折線不到 `halfWidth` 的範圍（`RiverIndex.distance(x, z) < halfWidth`）的分類。
 * 自己建一份查詢半徑夠大的索引：原本那一份在半徑外回 Infinity，分不出「稍微超過」
 * 與「很遠」
 */
export function corridorCover(lines: readonly WaterLine[], halfWidth: number, maxHd: number): CellCover {
  const index = new RiverIndex(lines, halfWidth + maxHd)
  return (cx, cz, hd) => {
    const d = index.distance(cx, cz)
    if (d + hd < halfWidth) return COVER_IN
    if (d - hd >= halfWidth) return COVER_OUT
    return COVER_EDGE
  }
}

/** 遮罩一格的邊長，m */
export const MASK_CELL = 40
/** 先用幾格一組的粗格分：粗格整格在外面（地圖的大半）就不必細分 */
const COARSE = 8

/**
 * 在 `±extent` 的方形裡烘遮罩，回傳與 `exact` 結果相同、但多半不必算的查詢。
 * 範圍外、跨邊界的格照舊呼叫 `exact`。
 *
 * **建地形時跑一次**，會配置。
 */
export function bakeCoverMask(
  cover: CellCover, exact: (x: number, z: number) => boolean, extent: number,
): (x: number, z: number) => boolean {
  const n = Math.ceil((2 * extent) / (MASK_CELL * COARSE)) * COARSE
  const x0 = -extent
  const grid = new Uint8Array(n * n)
  const fineHd = (MASK_CELL * Math.SQRT2) / 2
  const coarseHd = fineHd * COARSE
  for (let bj = 0; bj < n; bj += COARSE) {
    for (let bi = 0; bi < n; bi += COARSE) {
      const c = cover(x0 + (bi + COARSE / 2) * MASK_CELL, x0 + (bj + COARSE / 2) * MASK_CELL, coarseHd)
      for (let j = bj; j < bj + COARSE; j++) {
        for (let i = bi; i < bi + COARSE; i++) {
          grid[j * n + i] = c === COVER_EDGE
            ? cover(x0 + (i + 0.5) * MASK_CELL, x0 + (j + 0.5) * MASK_CELL, fineHd)
            : c
        }
      }
    }
  }
  return (x, z) => {
    const i = Math.floor((x - x0) / MASK_CELL)
    const j = Math.floor((z - x0) / MASK_CELL)
    if (i < 0 || j < 0 || i >= n || j >= n) return exact(x, z)
    const c = grid[j * n + i]!
    if (c === COVER_OUT) return false
    if (c === COVER_IN) return true
    return exact(x, z)
  }
}

/** 遮罩裡粗格的半對角線，m：`corridorZone` 的分類索引要多查這麼遠 */
export const MASK_MAX_HD = (MASK_CELL * COARSE * Math.SQRT2) / 2

/** 由整格判斷推的分類：碰不到是整格在外，其餘都逐點算 */
function coverFromNear(near: BoxTest): CellCover {
  return (cx, cz, hd) => (near(cx - hd, cz - hd, cx + hd, cz + hd) ? COVER_EDGE : COVER_OUT)
}

/**
 * 把一張地圖的範圍合成一個（`±extent` 裡查遮罩，外面逐點算）。
 *
 * **建地形時跑一次**，會配置。
 */
export function bakeKeepOut(zones: readonly KeepOutZone[], extent: number): KeepOut {
  if (zones.length === 0) return { test: () => false, near: () => false, empty: true }
  const exact = (x: number, z: number): boolean => {
    for (let i = 0; i < zones.length; i++) if (zones[i]!.test(x, z)) return true
    return false
  }
  const near: BoxTest = (x0, z0, x1, z1) => {
    for (let i = 0; i < zones.length; i++) if (zones[i]!.near(x0, z0, x1, z1)) return true
    return false
  }
  const cover = unionCover(zones.map((zn) => zn.cover ?? coverFromNear(zn.near)))
  return { test: bakeCoverMask(cover, exact, extent), near, empty: false }
}

/** 把散佈器包成「範圍裡不長」 */
export function excludingZones(source: FloraSource, keepOut: KeepOut): FloraSource {
  return keepOut.empty ? source : excludingWhere(source, keepOut.test, keepOut.near)
}

/**
 * 離折線不到 `halfWidth` 的範圍：河廊、高速公路。逐點與整格用查詢半徑剛好
 * `halfWidth` 的索引；分類另建一份（見 `corridorCover`）
 */
export function corridorZone(lines: readonly WaterLine[], halfWidth: number): KeepOutZone {
  const index = new RiverIndex(lines, halfWidth)
  return {
    test: (x, z) => index.distance(x, z) < halfWidth,
    near: (x0, z0, x1, z1) => index.mayReach(x0, z0, x1, z1),
    cover: corridorCover(lines, halfWidth, MASK_MAX_HD),
  }
}
