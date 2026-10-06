/** 候選植株位置只由全域索引決定；tile 邊界只負責過濾，分割區域不改變結果。 */
import { isLeyteGrass, type CanopyMap } from './leyteGround'
import { BROAD_CROWN_R, BUSH_R } from '../specs/flora'
import type { HeightFieldData } from '../world/heightfield'
import { baseHeight, farUpland, isInBeachClearing, isInRoadClearing } from '../world/leyte'
import {
  FLORA_STRIDE, FloraKind, createFloraBuffer, pushFlora, type FloraSource,
} from '../core/floraBuffer'
import { TREE_SCALE, BUSH_SCALE } from '../specs/flora'
import { hash2, hash1 } from '../core/hash'
import { ISLAND_GRID, islandClump, ISLAND_BUSH_RATIO, E_SCALE2, BUSH_AREA } from './islandFlora'

/**
 * 雷伊泰平地上的密度相對丘陵頂。**平地的樹少** —— 平地取代了水田，看起來
 * 該是開闊地夾著零星的林子。**起始值，由試飛裁定。**
 */
export const LEYTE_PLAIN_DENSITY = 0.08

/**
 * 丘陵上的密度上限。**不是 1**：丘陵又大又多，滿密度的話植被池要配到六十萬個
 * 實例（約 90 MB）。六成之下山坡仍然是林子 —— 地色讀同一個接受率，遠看一樣暗。
 */
export const LEYTE_HILL_DENSITY = 0.6

/** 高出基準面這麼多就到丘陵的密度，m。丘陵的山腰往上是林子 */
const LEYTE_HILL_FULL = 40

/**
 * 雷伊泰一個候選點的接受機率。**不超過 `LEYTE_HILL_DENSITY`** —— 叢遮罩 ≤ 1、
 * 坡度只除不乘；`createLeyteFlora` 靠這個上限先擋掉大部分候選，改式子時要守住。
 *
 * 沙灘與公路清空帶是 0；平地是 `LEYTE_PLAIN_DENSITY`；高出基準面
 * `LEYTE_HILL_FULL` 就是 `LEYTE_HILL_DENSITY`。再乘上成叢遮罩、除以坡度（同群島）。
 *
 * 【清空帶讀 `isInRoadClearing`】路的座標只有 `LEYTE_ROADS` 一份 —— 路面
 * 與這裡讀的是同一組折線，車隊走的是其中第 0 條。
 */
export function leyteAccept(field: HeightFieldData, x: number, z: number, h: number): number {
  if (!isLeyteGrass(h)) return 0
  if (isInRoadClearing(x, z) || isInBeachClearing(x, z)) return 0
  const cell = field.cell
  const dx = (field.sample(x + cell, z) - field.sample(x - cell, z)) / (2 * cell)
  const dz = (field.sample(x, z + cell) - field.sample(x, z - cell)) / (2 * cell)
  // 【高出的是丘陵，不是平地的緩坡】量的是比這一點的基準面高多少
  const up = Math.min(1, Math.max(0, (h - baseHeight(x, z)) / LEYTE_HILL_FULL))
  return (LEYTE_PLAIN_DENSITY + (LEYTE_HILL_DENSITY - LEYTE_PLAIN_DENSITY) * up) * islandClump(x, z)
    / Math.hypot(1, Math.hypot(dx, dz))
}

/** 一格裡一株闊葉樹的期望樹冠面積，m² */
const BROAD_AREA = Math.PI * BROAD_CROWN_R * BROAD_CROWN_R * E_SCALE2

/**
 * 粗的樹冠圖：一格一個高度場格子，值是那裡的**期望**覆蓋率（與
 * `islandCanopyCover` 同一個算法）。開場先用它，`bakeLeyteCanopy` 在背景烘好
 * 之後換掉 —— 換之前林子是一片平均的暗綠，換之後是一株一株的。
 */
export function leyteCanopyCoarse(field: HeightFieldData): CanopyMap {
  const size = field.size - 1
  const half = (size * field.cell) / 2
  const data = new Uint8Array(size * size)
  for (let row = 0; row < size; row++) {
    const z = -half + (row + 0.5) * field.cell
    for (let col = 0; col < size; col++) {
      const x = -half + (col + 0.5) * field.cell
      const lambda = (leyteAccept(field, x, z, field.sample(x, z)) * (BROAD_AREA + BUSH_AREA))
        / (ISLAND_GRID * ISLAND_GRID)
      data[row * size + col] = Math.round((1 - Math.exp(-lambda)) * 255)
    }
  }
  return { data, size, half, texel: field.cell }
}

/** 成叢遮罩的平均值。第一次用到才量：64 × 64 點、37 m 一格，蓋二十幾個叢 */
let clumpMean = -1

function meanClump(): number {
  if (clumpMean >= 0) return clumpMean
  let s = 0
  for (let i = 0; i < 64; i++) for (let j = 0; j < 64; j++) s += islandClump(i * 37 + 5, j * 37 + 11)
  clumpMean = s / 4096
  return clumpMean
}

/**
 * 場外遠景陸地的期望樹冠覆蓋率，0～1。與場內同一套密度（平地疏、山上是山林
 * 的密度）與同一個樹冠面積，所以兩邊平均起來一樣暗。「在不在山上」讀
 * `farUpland`。
 *
 * 【叢取平均值】遠景的頂點 500 m 一個，叢才 110 m —— 逐點取的話只是雜訊。
 * 一株一株的質感由地面的 shader 補（`render/leyteGround.ts`）。
 *
 * @param h 這一點的遠景高度（`farHeight`）
 */
export function leyteFarCover(x: number, z: number, h: number): number {
  if (!isLeyteGrass(h)) return 0
  const up = farUpland(x, z)
  const accept = (LEYTE_PLAIN_DENSITY + (LEYTE_HILL_DENSITY - LEYTE_PLAIN_DENSITY) * up) * meanClump()
  return 1 - Math.exp(-(accept * (BROAD_AREA + BUSH_AREA)) / (ISLAND_GRID * ISLAND_GRID))
}

/** 樹冠圖一格幾公尺。樹冠半徑 5～10 m，一株落在一到幾格 */
const CANOPY_TEXEL = 8

/** 烘焙時一次跑多大一塊，m。只影響暫存緩衝的大小 */
const CANOPY_CHUNK = 400

/**
 * 把場地裡**每一株**闊葉樹與灌木的樹冠印成一張俯視圖，給地面的 shader 畫
 * （`render/leyteGround.ts`）。**載入期跑一次。**
 *
 * 【為什麼】立體的樹只生成到 `FLORA_RADIUS`，更遠的林子原本只有頂點色的
 * 平均暗綠（80 m 一格），樹跑進範圍時是憑空冒出來的。這張圖的每一個暗點
 * 就是那一株真的樹：**走的是同一支 `createLeyteFlora`**，位置、接受率、
 * 大小完全相同 —— 樹進入範圍時是長在自己的暗點上。
 *
 * 【一株的份量守恆】樹冠面積照「離圓心多近」分給周圍幾格，再縮放到總和
 * 等於樹冠面積 —— 比一格還小的灌木也只加它自己那麼多，不會整格塗滿。
 * 同一格疊到滿就停在 255。
 *
 * 【整張場地要跑兩秒多】**在背景執行緒跑**（`render/canopyBake.ts`），主執行緒
 * 不得直接呼叫 —— 會卡住畫面。
 */
export function bakeLeyteCanopy(field: HeightFieldData): CanopyMap {
  const half = ((field.size - 1) * field.cell) / 2
  const size = Math.round((2 * half) / CANOPY_TEXEL)
  const texel = (2 * half) / size
  const data = new Uint8Array(size * size)
  const source = createLeyteFlora(field)
  const buf = createFloraBuffer(8192)
  const heightAt = (): number => 0
  const w = new Float32Array(64)
  for (let z0 = -half; z0 < half; z0 += CANOPY_CHUNK) {
    for (let x0 = -half; x0 < half; x0 += CANOPY_CHUNK) {
      buf.count = 0
      buf.dropped = 0
      source(x0, z0, Math.min(half, x0 + CANOPY_CHUNK), Math.min(half, z0 + CANOPY_CHUNK), heightAt, buf)
      for (let k = 0; k < buf.count; k++) {
        const o = k * FLORA_STRIDE
        const x = buf.data[o]!
        const z = buf.data[o + 2]!
        const r = (buf.kind[k] === FloraKind.Bush ? BUSH_R : BROAD_CROWN_R) * buf.data[o + 4]!
        // 樹冠圓涵蓋的格子，每格依「格心離圓心多近」給一個權重
        const u = (x + half) / texel - 0.5
        const v = (z + half) / texel - 0.5
        const rt = r / texel
        const c0 = Math.max(0, Math.floor(u - rt))
        const c1 = Math.min(size - 1, Math.ceil(u + rt))
        const r0 = Math.max(0, Math.floor(v - rt))
        const r1 = Math.min(size - 1, Math.ceil(v + rt))
        let sum = 0
        let n = 0
        for (let row = r0; row <= r1; row++) {
          for (let col = c0; col <= c1; col++) {
            const wt = Math.min(1, Math.max(0, rt + 0.5 - Math.hypot(col - u, row - v)))
            if (n < w.length) w[n] = wt
            sum += wt
            n++
          }
        }
        if (sum <= 0 || n > w.length) continue
        const scale = (Math.PI * rt * rt) / sum
        n = 0
        for (let row = r0; row <= r1; row++) {
          for (let col = c0; col <= c1; col++) {
            const add = Math.round(w[n++]! * scale * 255)
            const i = row * size + col
            data[i] = Math.min(255, data[i]! + add)
          }
        }
      }
    }
  }
  return { data, size, half, texel }
}

/**
 * 雷伊泰的闊葉樹與灌木。**網格走法與 `createIslandFlora` 相同**：一格一棵樹
 * 加一叢灌木的候選，座標只由全域索引決定（檔頭的鐵律）。
 *
 * 【整格早退】tile 的四角與中心全部是沙灘或海就跳過。一片陸地伸進 tile 中間
 * 而五個取樣點都落在水裡的情形只丟掉幾棵岸邊的樹。
 */
export function createLeyteFlora(field: HeightFieldData): FloraSource {
  return (x0, z0, x1, z1, heightAt, out) => {
    const mx = (x0 + x1) / 2
    const mz = (z0 + z1) / 2
    if (
      !isLeyteGrass(field.sample(x0, z0)) && !isLeyteGrass(field.sample(x1, z0))
      && !isLeyteGrass(field.sample(x0, z1)) && !isLeyteGrass(field.sample(x1, z1))
      && !isLeyteGrass(field.sample(mx, mz))
    ) return

    const g0 = Math.floor(x0 / ISLAND_GRID)
    const g1 = Math.floor(x1 / ISLAND_GRID)
    const h0 = Math.floor(z0 / ISLAND_GRID)
    const h1 = Math.floor(z1 / ISLAND_GRID)
    for (let gz = h0; gz <= h1; gz++) {
      for (let gx = g0; gx <= g1; gx++) {
        // ── 樹 ──────────────────────────────────────────
        const hh = hash2(gx, gz ^ 0x1d7b)
        const x = (gx + 0.12 + (hh / 4294967296) * 0.76) * ISLAND_GRID
        const g = hash1(hh)
        const z = (gz + 0.12 + (g / 4294967296) * 0.76) * ISLAND_GRID
        const g2 = hash1(g)
        // 【兩個候選各自過邊界】理由同 `createIslandFlora`
        // 【雜湊先比上限】接受率不會超過 `LEYTE_HILL_DENSITY`，雜湊超過它的候選
        // 一定不長 —— 先擋掉就不用算接受率。結果逐位元相同，只是省時間
        if (x >= x0 && x < x1 && z >= z0 && z < z1 && g2 / 4294967296 < LEYTE_HILL_DENSITY) {
          const h = field.sample(x, z)
          // 【嚴格小於】接受率 0（清空帶、沙灘）時雜湊剛好是 0 也不長
          if (g2 / 4294967296 < leyteAccept(field, x, z, h)) {
            const g3 = hash1(g2)
            pushFlora(
              out, x, heightAt(x, z), z, (g3 / 4294967296) * Math.PI * 2,
              TREE_SCALE[0] + (hash1(g3) / 4294967296) * (TREE_SCALE[1] - TREE_SCALE[0]),
              (hash1(g3 ^ 0x3c1f) & 0xff) / 255, FloraKind.BroadTree,
            )
          }
        }

        // ── 同一格的灌木 ────────────────────────────────
        const bh = hash2(gx ^ 0x5ac3, gz)
        const bx = (gx + 0.12 + (bh / 4294967296) * 0.76) * ISLAND_GRID
        const bg = hash1(bh)
        const bz = (gz + 0.12 + (bg / 4294967296) * 0.76) * ISLAND_GRID
        if (bx < x0 || bx >= x1 || bz < z0 || bz >= z1) continue
        const b2 = hash1(bg)
        if (b2 / 4294967296 >= LEYTE_HILL_DENSITY * ISLAND_BUSH_RATIO) continue
        const bhh = field.sample(bx, bz)
        if (b2 / 4294967296 >= leyteAccept(field, bx, bz, bhh) * ISLAND_BUSH_RATIO) continue
        const b3 = hash1(b2)
        pushFlora(
          out, bx, heightAt(bx, bz), bz, (b3 / 4294967296) * Math.PI * 2,
          BUSH_SCALE[0] + (hash1(b3) / 4294967296) * (BUSH_SCALE[1] - BUSH_SCALE[0]),
          (hash1(b3 ^ 0x71a5) & 0xff) / 255, FloraKind.Bush,
        )
      }
    }
  }
}
