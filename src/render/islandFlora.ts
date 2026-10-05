/** 候選植株位置只由全域索引決定；tile 邊界只負責過濾，分割區域不改變結果。 */
import { isGrass } from './island'
import { BUSH_R, CONE_CROWN_R } from '../specs/flora'
import type { HeightFieldData } from '../world/heightfield'
import type { IslandDesc } from '../world/archipelago'
import { valueNoise } from './fields'
import { FloraKind, pushFlora, type FloraSource } from '../core/floraBuffer'
import { TREE_SCALE, BUSH_SCALE } from '../specs/flora'
import { hash2, hash1 } from '../core/hash'

/**
 * 島上的網格間距，m。**一格最多一棵樹加一叢灌木。**
 *
 * 【這是叢內的密度】`1e6 / grid²` 是上限，13 m 是 5,917 株/km²；叢外由
 * `islandClump` 壓到 5%，所以整座島的總數比均勻鋪法少，叢內卻更密。
 * 要通過高度帶（`isGrass`）、坡度、高度、叢四關才長得出來。
 *
 * 【面積密度是它的平方反比】改它就要回頭看 `ISLAND_MAX_PER_TILE`：一格
 * 250 m 的 tile 放得下幾個網格由它決定。掃描表在
 * `test/tools/island-density.probe.ts`。
 */
export const ISLAND_GRID = 13.0

/** tile 中心離島多遠就整格跳過，m */
const ISLAND_MARGIN = 200

/**
 * 海邊的植被密度相對山頂。山頂是 1.0，密度沿高度線性插到這個值。
 *
 * 【為什麼要有落差】整座島同一個密度看起來像一塊綠地毯。山頂密、山腳疏，
 * 高度差才讀得出來。**山頂是滿密度** —— 這一條只往下壓。
 */
export const ISLAND_SHORE_DENSITY = 0.15

/**
 * 樹叢的尺度，m：值雜訊的格距。叢的直徑大約是它的一到兩倍。
 *
 * 【為什麼要成叢】逐格獨立抽樣鋪出來的是均勻的一層絨毛，整個山頭都是樹；
 * 真的山是一撮一撮的林子夾著空地。叢是一張與 tile 無關的低頻遮罩乘在
 * 接受率上，所以島上「哪裡有林子」是全域決定的，tile 的切法改不了它。
 */
export const ISLAND_CLUMP_CELL = 110

/**
 * 叢的門檻：值雜訊低於下界是空地、高於上界是叢內，中間平滑過渡。
 *
 * 兩個尺度的值雜訊相加後平均 0.5、標準差約 0.2，這一組讓四成上下的地
 * 落在叢內、兩成在邊緣。
 */
const ISLAND_CLUMP_GATE = [0.42, 0.58] as const

/**
 * 叢外殘留的密度。不是 0 —— 空地上零星幾棵樹才像林緣，全空是草皮。
 */
export const ISLAND_CLUMP_FLOOR = 0.05

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * 這一點在不在樹叢裡，`ISLAND_CLUMP_FLOOR`～1。
 *
 * 兩個尺度：大的定叢的位置，小的把邊緣弄毛 —— 單一尺度的叢是一顆顆圓斑。
 */
export function islandClump(x: number, z: number): number {
  const n = 0.65 * valueNoise(x, z, ISLAND_CLUMP_CELL, 0x6f3a)
    + 0.35 * valueNoise(x, z, ISLAND_CLUMP_CELL * 0.45, 0x1b9c)
  return ISLAND_CLUMP_FLOOR
    + (1 - ISLAND_CLUMP_FLOOR) * smoothstep(ISLAND_CLUMP_GATE[0], ISLAND_CLUMP_GATE[1], n)
}

/**
 * 灌木相對樹的接受機率。
 *
 * 【為什麼要有灌木】樹之間的地是空的，低空掠過時看得到一格一格的間隙。
 * 灌木補在同一格的另一個抽樣點上，吃同一條高度與坡度的門檻。
 */
export const ISLAND_BUSH_RATIO = 0.7

/**
 * 一個候選點的接受機率。**放置與地色共用這一支** —— 見
 * `islandCanopyCover`。
 *
 * 【坡度只壓密度】陡的地方稀疏，但不是砍光 —— 乘 `cos(slope)`。實測群島的
 * 島很陡：草帶 16.24 km² 裡坡度 20° 以內只有 3.7%，用坡度當門檻會砍掉
 * 95% 的地。
 *
 * 【高度只壓密度】山頂 1.0，海邊 `ISLAND_SHORE_DENSITY`，尺是 `h / peak`。
 *
 * 【叢是乘上去的】高度與坡度決定「這一帶能多密」，叢決定「這一點在不在
 * 林子裡」。乘法讓山頂的叢比山腳的叢密，而叢外到處一樣疏。
 *
 * 【坡度要在植株自己的位置上取】格中心離它最遠 7 m，那個距離足以把坡度與
 * 密度的相關性抹平。
 */
export function islandAccept(
  field: HeightFieldData, peak: number, x: number, z: number, h: number,
): number {
  const cell = field.cell
  const dx = (field.sample(x + cell, z) - field.sample(x - cell, z)) / (2 * cell)
  const dz = (field.sample(x, z + cell) - field.sample(x, z - cell)) / (2 * cell)
  return (ISLAND_SHORE_DENSITY + (1 - ISLAND_SHORE_DENSITY)
    * Math.min(1, Math.max(0, h / peak))) * islandClump(x, z)
    / Math.hypot(1, Math.hypot(dx, dz))
}

/**
 * 逐株縮放均勻分佈於 `[0.5, 1]`，所以 `E[s²] = 2∫s²ds = 7/12`。
 * 面積吃的是半徑的平方，所以要的是這個而不是 `E[s]²`。
 */
export const E_SCALE2 = 7 / 12

/** 一格裡一株樹的期望樹冠面積，m² */
const CONE_AREA = Math.PI * CONE_CROWN_R * CONE_CROWN_R * E_SCALE2

/** 一格裡一叢灌木的期望樹冠面積，m²。乘上它自己的接受比 */
export const BUSH_AREA = Math.PI * BUSH_R * BUSH_R * E_SCALE2 * ISLAND_BUSH_RATIO

/**
 * 這一點的地被樹冠遮住多少，0～1。**島的地色按它上色。**
 *
 * 【為什麼地要先帶上林相】`FLORA_RADIUS` 外一棵都不畫，而地色比樹冠亮很多
 * —— 飛進圈的瞬間整座島同時變暗變花。地先按實際被遮住的面積比調暗，樹進圈
 * 就只是加上質感。
 *
 * 【與放置同源】機率讀的是 `islandAccept`，不是另外湊一條。兩份會漂，而症狀
 * 是「地的顏色說有森林，實際卻是光禿的」。
 *
 * 【要的是聯集，不是面積和】樹冠會互相重疊。名目強度 λ 的實際遮蔽是
 * `1 − e^(−λ)` —— λ = 0.35 時是 0.295，差五個半百分點。直接相加會讓遠處的
 * 地色比實際的林相暗。
 */
export function islandCanopyCover(
  field: HeightFieldData, islands: readonly IslandDesc[],
): (x: number, z: number) => number {
  return (x, z) => {
    const h = field.sample(x, z)
    if (!isGrass(h)) return 0
    let peak = islands[0]!.peak
    let bd = Infinity
    for (const o of islands) {
      const d = Math.hypot(o.cx - x, o.cz - z)
      if (d < bd) { bd = d; peak = o.peak }
    }
    const lambda = (islandAccept(field, peak, x, z, h) * (CONE_AREA + BUSH_AREA))
      / (ISLAND_GRID * ISLAND_GRID)
    return 1 - Math.exp(-lambda)
  }
}

/**
 * 群島的樹與灌木。
 *
 * 【接受機率在 `islandAccept`】坡度與高度都只壓密度，不當門檻。地色那一側
 * 也讀同一支 —— 兩份會漂，而症狀是「地的顏色說有森林，實際卻是光禿的」。
 *
 * 【樹與灌木共用一格】兩者在同一格裡各自抽一個位置、各自抽一次接受 ——
 * 所以灌木不是「沒長樹的地方」，兩者會混在一起。共用高度與坡度的那一趟
 * 取樣是為了成本：一格因此只多兩次 `field.sample`。
 *
 * 【只 import `isGrass`，不 import 任何高度常數】`world/archipelago.ts` 也有
 * 一個 `SHORE_BAND`，值是 200（烘岸距離），而顏色分帶那個是 12。看不到常數
 * 就沒有拿錯的機會 —— 見 `render/island.ts` 的 `GRASS_MIN_HEIGHT`。
 */
export function createIslandFlora(
  field: HeightFieldData, islands: readonly IslandDesc[],
): FloraSource {
  return (x0, z0, x1, z1, heightAt, out) => {
    // 【先整格早退】離任何一座島都遠的話，下面的網格一格都不必走
    const mx = (x0 + x1) / 2
    const mz = (z0 + z1) / 2
    const reach = Math.hypot(x1 - x0, z1 - z0) / 2 + ISLAND_MARGIN
    let near: IslandDesc | null = null
    let nearD = Infinity
    for (const isl of islands) {
      const d = Math.hypot(isl.cx - mx, isl.cz - mz)
      if (d - isl.outerRadius > reach) continue
      if (d < nearD) { nearD = d; near = isl }
    }
    if (near === null) return

    const g0 = Math.floor(x0 / ISLAND_GRID)
    const g1 = Math.floor(x1 / ISLAND_GRID)
    const h0 = Math.floor(z0 / ISLAND_GRID)
    const h1 = Math.floor(z1 / ISLAND_GRID)
    for (let gz = h0; gz <= h1; gz++) {
      for (let gx = g0; gx <= g1; gx++) {
        // 【最近的島用格中心找】它只提供峰高（密度斜線的尺），而同一格的
        // 兩個候選點最遠只差 7 m —— 找一次，兩者共用
        const cx = (gx + 0.5) * ISLAND_GRID
        const cz = (gz + 0.5) * ISLAND_GRID
        let isl = near
        let bd = Infinity
        for (const o of islands) {
          const d = Math.hypot(o.cx - cx, o.cz - cz)
          if (d < bd) { bd = d; isl = o }
        }

        // ── 樹 ──────────────────────────────────────────
        // 【位置只由全域索引決定】見檔頭的鐵律
        const hh = hash2(gx, gz ^ 0x1d7b)
        const x = (gx + 0.12 + (hh / 4294967296) * 0.76) * ISLAND_GRID
        const g = hash1(hh)
        const z = (gz + 0.12 + (g / 4294967296) * 0.76) * ISLAND_GRID
        const g2 = hash1(g)
        // 【兩個候選各自過邊界】共用一個 `continue` 的話，樹落在格外時會把
        // 灌木一起吃掉 —— 症狀是切法不同結果就不同
        if (x >= x0 && x < x1 && z >= z0 && z < z1) {
          const h = field.sample(x, z)
          if (isGrass(h) && g2 / 4294967296 <= islandAccept(field, isl.peak, x, z, h)) {
            const g3 = hash1(g2)
            pushFlora(
              out, x, heightAt(x, z), z, (g3 / 4294967296) * Math.PI * 2,
              TREE_SCALE[0] + (hash1(g3) / 4294967296) * (TREE_SCALE[1] - TREE_SCALE[0]),
              (hash1(g3 ^ 0x3c1f) & 0xff) / 255, FloraKind.ConeTree,
            )
          }
        }

        // ── 同一格的灌木 ────────────────────────────────
        // 【位置另外抽】與樹同一格但不同點，所以兩者會混在一起
        const bh = hash2(gx ^ 0x5ac3, gz)
        const bx = (gx + 0.12 + (bh / 4294967296) * 0.76) * ISLAND_GRID
        const bg = hash1(bh)
        const bz = (gz + 0.12 + (bg / 4294967296) * 0.76) * ISLAND_GRID
        if (bx < x0 || bx >= x1 || bz < z0 || bz >= z1) continue
        // 【高度要在灌木自己的位置上取】水線是硬分界，借樹的高度會讓灌木
        // 長到沙灘上
        const bhh = field.sample(bx, bz)
        if (!isGrass(bhh)) continue
        const b2 = hash1(bg)
        if (b2 / 4294967296 > islandAccept(field, isl.peak, bx, bz, bhh) * ISLAND_BUSH_RATIO) continue
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
