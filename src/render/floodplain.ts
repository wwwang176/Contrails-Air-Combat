import type { Mesh } from 'three'
import { FloraKind, hash2, pushFlora, valueNoise, type FloraSource } from './flora'
import { buildDecals, DECAL_GRID, type DecalGrid, type DecalRegion } from './groundDecal'
import { MEADOW, MEADOW_HALF } from './river'
import { canopyColor, FLORA_COLORS } from './season'
import { CHANNEL_HALF, RiverIndex, type HeightSampler, type WaterLine } from '../world/river'

/**
 * # 河漫灘：草地與成團的河岸森林（Auwald）
 *
 * 梅澤堡到萊比錫之間的 Elster–Luppe 河谷、薩勒河的河谷是河漫灘：年年淹水，不犁
 * 田，是放牧的草地與一大片一大片的河岸林（橡樹、白蠟、榆樹）。田與樹籬到河谷邊
 * 就停了。
 *
 * - 範圍：離河的中心線 `WIDTH` 以內，寬度沿河用低頻雜訊起伏
 * - 森林：兩個尺度的值雜訊決定團塊（大的定位置、小的把邊弄毛），往河谷邊緣淡掉
 * - 地面：草甸色只鋪靠河的 `GROUND_SHARE`、往外淡回田色；森林底下的林地深色鋪滿
 *   整個河漫灘（`buildGround`，烘進田色貼圖）。沒有河漫灘的河也在這裡鋪草甸：
 *   `MEADOW_HALF` 的同一個比例
 * - 樹：20 m 一格一個候選點，照森林的覆蓋率接受；草地上零星幾棵
 *
 * 【位置只由全域座標決定】與植被的其他散佈器同一條鐵律。
 */

/** 河漫灘的半寬（離中心線），m。不在表上的河沒有河漫灘 */
const WIDTH: Readonly<Record<string, number>> = { Luppe: 900, Saale: 450 }
/** 寬度沿河起伏的雜訊格寬，m；寬度在基準的 0.55～1.15 倍之間 */
const WIDTH_NOISE = 1800
/** 森林團塊的兩個尺度，m */
const CLUMP_CELL = [700, 260] as const
/** 雜訊值落在這一段裡由草地漸變到森林 */
const CLUMP_GATE = [0.44, 0.58] as const
/** 草地上零星的樹：每一格的接受機率 */
const MEADOW_TREES = 0.015
/** 候選點的格距，m。河岸林的樹大，稀一點也蓋得滿 */
const GRID = 20
/**
 * 森林烘進地面的顏色：從空中看的林子（`season.ts` 的 `canopyColor`）。植被圈
 * 外樹不畫，地上留的是這個顏色，要與有樹時看起來一樣。河漫灘只有洛伊納有，
 * 洛伊納是晚秋
 */
export const FOREST_GROUND = canopyColor(FLORA_COLORS.lateAutumn.broadLeaf).getHex()
/**
 * 地面的草甸色只鋪河漫灘（與小河的草甸）寬度靠河的這個比例；外面除了林地是
 * 田色。鋪滿的話從空中看是一條很寬的色帶
 */
const GROUND_SHARE = 0.25
/**
 * 地面往外緣淡出的那一段，佔鋪的寬度的比例。外緣是格子的鋸齒，淡到 0 才看不見；
 * 淡出帶太窄的話看起來仍是一條硬邊的色帶
 */
const EDGE_FADE = 0.45

/** 離中心線佔寬度的比例 → 地面的不透明度：`1 − EDGE_FADE` 以內是 1、外緣是 0 */
function edgeFade(rel: number): number {
  const t = Math.min(1, Math.max(0, (1 - rel) / EDGE_FADE))
  return t * t * (3 - 2 * t)
}
/** 河道兩側不長樹，m（水面半寬再加一點岸） */
const CHANNEL_CLEAR = CHANNEL_HALF + 8
/** 地面網格切段的長度，m：每一段一個外接盒 */
const CHUNK = 2000
/**
 * 整格判斷能處理的最大半對角線，m（植被一格 250 m 的半對角線是 177）。更大的框
 * 退回索引格的判斷（`mayReach`），仍然保守
 */
const NEAR_MARGIN = 200
/**
 * 距離場的格點間距，m。與河漫灘地面網格的頂點是同一組（`leunaFeatures.ts` 的
 * `FLOODPLAIN_GRID`），地色與樹落在同一組數字上
 */
const LATTICE = 40
/** 格點快取的槽數。一格 250 m 用 49 個格點，植被圈一次補十幾格 */
const LAT_SLOTS = 1 << 15
/** 觸及範圍外的值：內插時要是有限的數，不然一個角是 Infinity 整格都是 */
const FAR_REL = 10
const FAR_D = 1e6

export interface Floodplain {
  /** 在河漫灘裡嗎。樹籬與田裡的林地擋在外面 */
  readonly inside: (x: number, z: number) => boolean
  /** 這個方框**可能**碰到河漫灘嗎（保守：回 false 時一定沒有） */
  readonly near: (x0: number, z0: number, x1: number, z1: number) => boolean
  /** 森林的覆蓋率，0～1。河漫灘外是 0 */
  readonly cover: (x: number, z: number) => number
  /** 河岸林的樹（還沒擋村鎮、礦坑、高速公路，由呼叫端包） */
  readonly flora: FloraSource
  /** 河漫灘的地面網格。`grid` 見 `buildDecals`；只鋪 `extent` 見方以內 */
  buildGround(sample: HeightSampler, extent: number, grid?: DecalGrid, name?: string): Mesh
}

export function createFloodplain(lines: readonly WaterLine[]): Floodplain {
  // 【索引的觸及範圍】河漫灘最寬是基準的 1.15 倍；整格判斷（`near`）用格心的距離，
  // 要再加一個格的半對角線才下得了「一定碰不到」的結論
  const groups = Object.entries(WIDTH).map(([name, base]) => {
    const own = lines.filter((l) => l.name === name)
    return { name, base, own, index: new RiverIndex(own, base * 1.15 + NEAR_MARGIN) }
  }).filter((g) => g.own.length > 0)
  // 沒有河漫灘的河（小河、地圖外的延伸段）：地面只有草甸
  const bankOnly = lines.filter((l) => WIDTH[l.name] === undefined)
  const bankIndex = new RiverIndex(bankOnly, MEADOW_HALF)
  const width = (x: number, z: number, base: number): number =>
    base * (0.55 + 0.6 * valueNoise(x, z, WIDTH_NOISE, 0x5a17))

  /**
   * 離最近那條河的中心線佔河漫灘寬度的比例（0 = 河心、1 = 河谷邊）與那個距離，
   * 寫進 `hitRel`、`hitD`。觸及範圍外是 `FAR_REL`、`FAR_D`
   */
  let hitRel = 0
  let hitD = 0
  const exact = (x: number, z: number): void => {
    hitRel = FAR_REL
    hitD = FAR_D
    for (const g of groups) {
      const dd = g.index.distance(x, z)
      if (!Number.isFinite(dd)) continue
      const rr = dd / width(x, z, g.base)
      if (rr < hitRel) {
        hitRel = rr
        hitD = dd
      }
    }
  }
  // 【格點快取】距離是平滑的場：在 `LATTICE` 一格的全域格點上算一次、記住，其餘的點
  // 雙線性內插。每一點都問索引的話，河漫灘裡一格 250 m 要掃幾千次河道線段。直接
  // 映射，槽位由格點決定、另外存格點比對，撞了就重算
  const latI = new Int32Array(LAT_SLOTS)
  const latJ = new Int32Array(LAT_SLOTS)
  const latOk = new Uint8Array(LAT_SLOTS)
  const latRel = new Float64Array(LAT_SLOTS)
  const latD = new Float64Array(LAT_SLOTS)
  let cRel = 0
  let cD = 0
  const corner = (i: number, j: number): void => {
    const s = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) & (LAT_SLOTS - 1)
    if (latOk[s] === 1 && latI[s] === i && latJ[s] === j) {
      cRel = latRel[s]!
      cD = latD[s]!
      return
    }
    exact(i * LATTICE, j * LATTICE)
    latI[s] = i
    latJ[s] = j
    latOk[s] = 1
    latRel[s] = cRel = hitRel
    latD[s] = cD = hitD
  }
  /** `exact` 的內插版：結果同樣寫進 `hitRel`、`hitD` */
  const where = (x: number, z: number): void => {
    const fx = x / LATTICE
    const fz = z / LATTICE
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    const tx = fx - i
    const tz = fz - j
    corner(i, j)
    let rel = cRel * (1 - tx) * (1 - tz)
    let d = cD * (1 - tx) * (1 - tz)
    corner(i + 1, j)
    rel += cRel * tx * (1 - tz)
    d += cD * tx * (1 - tz)
    corner(i, j + 1)
    rel += cRel * (1 - tx) * tz
    d += cD * (1 - tx) * tz
    corner(i + 1, j + 1)
    rel += cRel * tx * tz
    d += cD * tx * tz
    hitRel = rel
    hitD = d
  }
  const inside = (x: number, z: number): boolean => {
    where(x, z)
    return hitRel < 1
  }
  // 格心離河的距離減掉半對角線，比最寬的河漫灘還遠就一定碰不到
  // （索引在觸及範圍外回 Infinity：範圍是最寬的河漫灘加 `NEAR_MARGIN`，所以
  // Infinity 就表示一定碰不到）
  const near = (x0: number, z0: number, x1: number, z1: number): boolean => {
    const half = Math.hypot(x1 - x0, z1 - z0) / 2
    if (half > NEAR_MARGIN) return groups.some((g) => g.index.mayReach(x0, z0, x1, z1))
    const cx = (x0 + x1) / 2
    const cz = (z0 + z1) / 2
    return groups.some((g) => g.index.distance(cx, cz) - half <= g.base * 1.15)
  }
  const cover = (x: number, z: number): number => {
    where(x, z)
    const rel = hitRel
    if (rel >= 1 || hitD < CHANNEL_CLEAR) return 0
    const n = 0.65 * valueNoise(x, z, CLUMP_CELL[0], 0x2e41) + 0.35 * valueNoise(x, z, CLUMP_CELL[1], 0x7c03)
    const t = Math.min(1, Math.max(0, (n - CLUMP_GATE[0]) / (CLUMP_GATE[1] - CLUMP_GATE[0])))
    // 往河谷邊緣淡掉：最外面那兩成是草地與田的交界
    const edge = Math.min(1, Math.max(0, (1 - rel) / 0.2))
    return t * t * (3 - 2 * t) * edge
  }

  const flora: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
    // 【離河遠的格整格跳過】逐點問離河多遠是這一支的大宗，而絕大多數的格碰不到河漫灘
    if (!near(x0, z0, x1, z1)) return
    for (let j = Math.floor(z0 / GRID); j * GRID < z1; j++) {
      for (let i = Math.floor(x0 / GRID); i * GRID < x1; i++) {
        const h = hash2(i ^ 0x3c6e, j)
        const x = (i + (h & 0xff) / 256) * GRID
        const z = (j + ((h >>> 8) & 0xff) / 256) * GRID
        if (x < x0 || x >= x1 || z < z0 || z >= z1) continue
        where(x, z)
        if (hitRel >= 1 || hitD < CHANNEL_CLEAR) continue
        const accept = Math.max(cover(x, z) * 0.92, MEADOW_TREES)
        const g = hash2(h, j ^ 0x51ed)
        if ((g & 0xffff) / 65536 >= accept) continue
        const bush = (g >>> 28) < 3
        pushFlora(out, x, heightAt(x, z), z, ((g >>> 16) & 0xff) / 255 * Math.PI * 2,
          bush ? 0.5 + ((g >>> 24) & 0xf) / 30 : 1.05 + ((g >>> 24) & 0xf) / 28, ((h >>> 16) & 0xff) / 255,
          bush ? FloraKind.Bush : FloraKind.BroadTree)
      }
    }
  }

  return {
    inside,
    near,
    cover,
    flora,
    buildGround(sample, extent, g = { size: DECAL_GRID, origin: 0 }, name = 'floodplain') {
      const grid = g.size
      // 【一格只鋪一次】河沿著好幾段外接盒走，相鄰兩段的盒子重疊；重疊處的細格
      // 鋪兩次的話是兩片共面的三角形。第一個認領的那一段鋪
      const claimed = new Set<number>()
      const regions: DecalRegion[] = []
      const meadow = MEADOW
      // 河漫灘先鋪、先認領；沒有河漫灘的河只鋪草甸帶
      const bankHalf = MEADOW_HALF * GROUND_SHARE
      const layers = [
        // 【兩層疊成一層】靠河的草甸帶（不透明度 b）上面疊林地（不透明度 = 覆蓋率 f）：
        // 合起來的不透明度 1 − (1 − b)(1 − f)，顏色是兩者照 b(1 − f) 與 f 的比例混。
        // 林地鋪滿整個河漫灘 —— 植被圈外樹不畫，林子要留在地上
        ...groups.map((g) => ({
          own: g.own, reach: g.base * 1.15, inside,
          colorAt: (x: number, z: number) => {
            const f = cover(x, z)
            const a = 1 - (1 - edgeFade(hitRel / GROUND_SHARE)) * (1 - f)
            return mixHex(meadow, FOREST_GROUND, a > 0 ? f / a : 0)
          },
          alphaAt: (x: number, z: number) => {
            const f = cover(x, z)
            return 1 - (1 - edgeFade(hitRel / GROUND_SHARE)) * (1 - f)
          },
        })),
        {
          own: bankOnly, reach: bankHalf, inside: (x: number, z: number) => bankIndex.distance(x, z) < bankHalf,
          colorAt: () => meadow,
          alphaAt: (x: number, z: number) => edgeFade(bankIndex.distance(x, z) / bankHalf),
        },
      ]
      for (const layer of layers) {
        const { reach, inside: within, colorAt, alphaAt } = layer
        for (const l of layer.own) {
          let start = 0
          while (start + 1 < l.points.length) {
            let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
            let len = 0
            let k = start
            for (; k < l.points.length; k++) {
              const [px, pz] = l.points[k]!
              x0 = Math.min(x0, px); x1 = Math.max(x1, px)
              z0 = Math.min(z0, pz); z1 = Math.max(z1, pz)
              if (k > start) len += Math.hypot(px - l.points[k - 1]![0], pz - l.points[k - 1]![1])
              if (len > CHUNK) break
            }
            start = Math.min(k, l.points.length - 1)
            if (x1 < -extent || x0 > extent || z1 < -extent || z0 > extent) continue
            regions.push({
              x0: Math.max(-extent, x0 - reach), z0: Math.max(-extent, z0 - reach),
              x1: Math.min(extent, x1 + reach), z1: Math.min(extent, z1 + reach),
              inside: (x, z) => {
                if (!within(x, z)) return false
                const key = Math.floor(x / grid) * 1_000_003 + Math.floor(z / grid)
                if (claimed.has(key)) return false
                claimed.add(key)
                return true
              },
              colorAt,
              alphaAt,
            })
          }
        }
      }
      return buildDecals(sample, regions, name, g)
    },
  }
}

/** 兩個色碼照 `t` 混，回色碼 */
function mixHex(a: number, b: number, t: number): number {
  const ch = (s: number): number => {
    const ca = (a >> s) & 0xff
    const cb = (b >> s) & 0xff
    return Math.round(ca + (cb - ca) * t) << s
  }
  return ch(16) | ch(8) | ch(0)
}
