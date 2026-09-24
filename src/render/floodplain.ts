import type { Mesh } from 'three'
import { FloraKind, hash2, pushFlora, valueNoise, type FloraSource } from './flora'
import { buildDecals, DECAL_GRID, type DecalGrid, type DecalRegion } from './groundDecal'
import { MEADOW } from './river'
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
 * - 地面：草甸色，森林底下往林地的深色混（`buildGround`，烘進田色貼圖）
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
/** 森林的地面：落葉與林下的深色 */
const FOREST_GROUND = 0x3e3d2f
/** 河道兩側不長樹，m（水面半寬再加一點岸） */
const CHANNEL_CLEAR = CHANNEL_HALF + 8
/** 地面網格切段的長度，m：每一段一個外接盒 */
const CHUNK = 2000

export interface Floodplain {
  /** 在河漫灘裡嗎。樹籬與田裡的林地擋在外面 */
  readonly inside: (x: number, z: number) => boolean
  /** 森林的覆蓋率，0～1。河漫灘外是 0 */
  readonly cover: (x: number, z: number) => number
  /** 河岸林的樹（還沒擋村鎮、礦坑、高速公路，由呼叫端包） */
  readonly flora: FloraSource
  /** 河漫灘的地面網格。`grid` 見 `buildDecals`；只鋪 `extent` 見方以內 */
  buildGround(sample: HeightSampler, extent: number, grid?: DecalGrid, name?: string): Mesh
}

export function createFloodplain(lines: readonly WaterLine[]): Floodplain {
  const groups = Object.entries(WIDTH).map(([name, base]) => {
    const own = lines.filter((l) => l.name === name)
    return { name, base, own, index: new RiverIndex(own, base * 1.2) }
  }).filter((g) => g.own.length > 0)
  const width = (x: number, z: number, base: number): number =>
    base * (0.55 + 0.6 * valueNoise(x, z, WIDTH_NOISE, 0x5a17))

  /** 離最近那條河的中心線佔河漫灘寬度的比例（0 = 河心、1 = 河谷邊），與那個距離 */
  const where = (x: number, z: number): { rel: number; d: number } => {
    let rel = Infinity
    let d = Infinity
    for (const g of groups) {
      const dd = g.index.distance(x, z)
      if (!Number.isFinite(dd)) continue
      const rr = dd / width(x, z, g.base)
      if (rr < rel) {
        rel = rr
        d = dd
      }
    }
    return { rel, d }
  }
  const inside = (x: number, z: number): boolean => where(x, z).rel < 1
  const cover = (x: number, z: number): number => {
    const { rel, d } = where(x, z)
    if (rel >= 1 || d < CHANNEL_CLEAR) return 0
    const n = 0.65 * valueNoise(x, z, CLUMP_CELL[0], 0x2e41) + 0.35 * valueNoise(x, z, CLUMP_CELL[1], 0x7c03)
    const t = Math.min(1, Math.max(0, (n - CLUMP_GATE[0]) / (CLUMP_GATE[1] - CLUMP_GATE[0])))
    // 往河谷邊緣淡掉：最外面那兩成是草地與田的交界
    const edge = Math.min(1, Math.max(0, (1 - rel) / 0.2))
    return t * t * (3 - 2 * t) * edge
  }

  const flora: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
    for (let j = Math.floor(z0 / GRID); j * GRID < z1; j++) {
      for (let i = Math.floor(x0 / GRID); i * GRID < x1; i++) {
        const h = hash2(i ^ 0x3c6e, j)
        const x = (i + (h & 0xff) / 256) * GRID
        const z = (j + ((h >>> 8) & 0xff) / 256) * GRID
        if (x < x0 || x >= x1 || z < z0 || z >= z1) continue
        const { rel, d } = where(x, z)
        if (rel >= 1 || d < CHANNEL_CLEAR) continue
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
    cover,
    flora,
    buildGround(sample, extent, g = { size: DECAL_GRID, origin: 0 }, name = 'floodplain') {
      const grid = g.size
      // 【一格只鋪一次】河沿著好幾段外接盒走，相鄰兩段的盒子重疊；重疊處的細格
      // 鋪兩次的話是兩片共面的三角形。第一個認領的那一段鋪
      const claimed = new Set<number>()
      const regions: DecalRegion[] = []
      const meadow = MEADOW
      for (const g of groups) {
        const reach = g.base * 1.15
        for (const l of g.own) {
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
                if (!inside(x, z)) return false
                const key = Math.floor(x / grid) * 1_000_003 + Math.floor(z / grid)
                if (claimed.has(key)) return false
                claimed.add(key)
                return true
              },
              colorAt: (x, z) => mixHex(meadow, FOREST_GROUND, cover(x, z)),
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
