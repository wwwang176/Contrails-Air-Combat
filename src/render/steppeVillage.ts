import { BufferAttribute, BufferGeometry, Color } from 'three'
import { FloraKind, pushFlora, type FloraSource } from './flora'
import { regionAt, trackGap, trackWidthAt, type RegionSample } from './fields'
import { TILE_SIZE } from './vegetation'
import { DECAL_LIFT } from './groundDecal'
import { Occupancy, placeChurch, type Placement } from './settlements'
import { nameHash, type Place } from '../world/landFeatures'
import type { HeightSampler } from '../world/river'

/**
 * # 草原街村：1943 年俄國南部的村
 *
 * 庫斯克一帶的村是**沿著一條路（或溪谷、沖溝）排成兩列的街村**：長長的一條，大一點
 * 的有一兩公里。每戶一棟小的白牆草頂房子（khata），屋脊順著街；房子後面是院子與
 * 幾棵果樹（別爾哥羅德以果園出名），再後面是**一條垂直於街、往外伸的長條菜園**
 * （自留地），兩側連起來像梳子的齒。附屬的棚子與主屋分開，不連成德國那種三合院。
 * 大村另有集體農場的場部：幾棟長條的牲口棚與一棟鐵皮頂的辦公房。
 *
 * 【街就是凹路】程序農地的凹路是兩顆區塊種子的中垂線（`fields.ts` 的 `trackGap`），
 * 村站址在它上面（`flora.ts` 的 `villageSite`）。房子沿凹路兩側排，離路心的距離
 * 用 `trackGap` 量 —— 與地上畫的路、植被避開的路是同一把尺。凹路在站址以外的地方會
 * 轉彎或被第三顆種子截斷，過了那一點 `trackGap` 超出帶寬，房子就自然停了。
 *
 * 【位置只由聚落決定】每個聚落一支固定種子的亂數、固定的生成次序，與現在畫到哪一格
 * 無關。**房子、果樹與菜園出自同一次放置**，菜園才對得上房子。
 */

/** 一個村：聚落、站址（凹路上）、凹路的走向（弧度，`atan2(tz, tx)`） */
export interface LaneVillage {
  readonly place: Place
  readonly siteX: number
  readonly siteZ: number
  readonly lane: number
}

/** 屋後的一條菜園：中心、四個角（繞行）、顏色 */
export interface GardenStrip {
  readonly x: number
  readonly z: number
  readonly ring: readonly (readonly [number, number])[]
  readonly color: number
}

/** 菜園的色：馬鈴薯與蔬菜的深綠、向日葵的黃綠、剛翻過的裸土 */
const GARDEN_COLORS = [0x657240, 0x6d7847, 0x7a8350, 0x84764f] as const

/** 街的總長，m：`BASE + pop × PER_POP`，人口沒給時取中間 */
const STREET_LENGTH = { base: 420, perPop: 1.0 } as const
/** 一戶沿街的寬，m */
const LOT = [19, 29] as const
/**
 * 房子的中心離路心多遠，m。凹路半寬約 10 m（`TRACK_WIDTH` 20），房子前緣再留幾公尺
 */
const HOUSE_OFFSET = [16, 20] as const
/** 凹路的帶寬：`trackGap` 是離路心的兩倍。小於下限在路上、大於上限路已經轉走了 */
const GAP_NEAR = 8
const GAP_FAR = 80
/** 菜園：離路心多遠起算、長度、寬佔一戶的比例 */
const GARDEN = { from: 40, length: [55, 110], share: 0.86 } as const

const REG: RegionSample = { r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0 }

/** 種子進、序列出。**不得 `Math.random`** */
function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const span = (r: () => number, v: readonly [number, number]): number => v[0] + r() * (v[1] - v[0])

/** 不在凹路上，也離路邊留了一段 */
function offTrack(x: number, z: number): boolean {
  regionAt(x, z, REG)
  return trackGap(x, z, REG) >= trackWidthAt(x, z) + GAP_NEAR
}

/** 這一點離凹路的距離合不合房子的位置：不在路上、也不在路已經轉走的地方 */
function besideStreet(x: number, z: number): boolean {
  regionAt(x, z, REG)
  const g = trackGap(x, z, REG)
  return g >= trackWidthAt(x, z) + GAP_NEAR && g <= GAP_FAR
}

/** 屋脊順著街的旋轉（模型的屋脊在 z 軸，`flora.ts` 的 `farmVillageFlora` 同一個算法） */
function ridgeAlong(tx: number, tz: number): number {
  return Math.atan2(tx, tz)
}

interface Out {
  readonly placements: Placement[]
  readonly gardens: GardenStrip[]
}

const place = (
  o: Out, occ: Occupancy, x: number, z: number, room: number, rot: number, scale: number, tint: number,
  kind: FloraKind, wide = 1, tall = 1,
): boolean => {
  if (!occ.free(x, z, room)) return false
  occ.add(x, z, room)
  o.placements.push({ x, z, rot, scale, tint, kind, wide, tall })
  return true
}

/** 一個街村 */
function street(
  v: LaneVillage, avoid: (x: number, z: number) => boolean, occ: Occupancy, out: Out,
): void {
  const p = v.place
  const rand = makeRand(nameHash(p.name))
  const church = placeChurch(p, avoid, occ)
  if (church !== null) out.placements.push(church)
  const tx = Math.cos(v.lane)
  const tz = Math.sin(v.lane)
  // 往左的單位法線
  const nx = -tz
  const nz = tx
  const length = STREET_LENGTH.base + (p.pop ?? 400) * STREET_LENGTH.perPop
  const rot = ridgeAlong(tx, tz)
  for (const side of [1, -1]) {
    let s = -length / 2 + rand() * 10
    while (s < length / 2) {
      const lot = span(rand, LOT)
      const mid = s + lot / 2
      s += lot
      const off = span(rand, HOUSE_OFFSET) * side
      const hx = v.siteX + tx * mid + nx * off
      const hz = v.siteZ + tz * mid + nz * off
      // 【空一戶的機率】街不是排得滿滿的 —— 燒掉的、搬走的、留作空地的
      if (rand() < 0.1) continue
      if (!besideStreet(hx, hz)) continue
      // 屋脊長 9～11 m、牆寬 5.5～7 m、牆高約 3 m：模型 z 軸是進深（`BUILDING_DEPTH` 8）、
      // x 軸是面寬（11），所以 `scale` 定長、`wide` 壓成窄的
      const scale = 1.1 + rand() * 0.25
      if (!place(out, occ, hx, hz, 6, rot + (rand() - 0.5) * 0.12, scale, rand(), FloraKind.House, 0.55, 0.55)) {
        continue
      }
      // 院子：屋後的棚子（與主屋分開），0～2 棟
      const sheds = rand() < 0.55 ? (rand() < 0.3 ? 2 : 1) : 0
      for (let k = 0; k < sheds; k++) {
        const back = 14 + rand() * 8
        const along = (rand() - 0.5) * lot * 0.6
        const sx = hx + nx * side * back + tx * along
        const sz = hz + nz * side * back + tz * along
        if (offTrack(sx, sz)) place(out, occ, sx, sz, 3.5, rot + (rand() - 0.5) * 0.3, 0.7 + rand() * 0.2, rand(), FloraKind.Barn, 0.7, 0.6)
      }
      // 果樹：屋兩側與屋後各幾棵
      const trees = 2 + Math.floor(rand() * 3)
      for (let k = 0; k < trees; k++) {
        const back = 6 + rand() * 24
        const along = (rand() - 0.5) * lot * 0.9
        place(out, occ, hx + nx * side * back + tx * along, hz + nz * side * back + tz * along, 3,
          rand() * 6.3, 0.3 + rand() * 0.12, rand(), FloraKind.BroadTree)
      }
      // 菜園：從屋後 `GARDEN.from` 起一條垂直於街的長條，寬佔這一戶的八成多
      let gl = span(rand, GARDEN.length)
      const hw = lot * GARDEN.share / 2
      const x0 = v.siteX + tx * mid + nx * (GARDEN.from * side)
      const z0 = v.siteZ + tz * mid + nz * (GARDEN.from * side)
      // 【菜園是烘進地面的貼片，蓋在道路之上】遇到凹路就在那裡截斷（兩側邊與中線都量），
      // 不然路面被一塊綠色蓋掉
      for (let d = 0; d <= gl; d += 6) {
        const cx = x0 + nx * side * d
        const cz = z0 + nz * side * d
        if (!offTrack(cx, cz) || !offTrack(cx + tx * hw, cz + tz * hw) || !offTrack(cx - tx * hw, cz - tz * hw)) {
          gl = d - 6
          break
        }
      }
      if (gl < 20) continue
      const x1 = x0 + nx * side * gl
      const z1 = z0 + nz * side * gl
      const corner = (cx: number, cz: number, a: number): readonly [number, number] => [cx + tx * a, cz + tz * a]
      out.gardens.push({
        x: (x0 + x1) / 2, z: (z0 + z1) / 2,
        ring: [corner(x0, z0, -hw), corner(x0, z0, hw), corner(x1, z1, hw), corner(x1, z1, -hw)],
        color: GARDEN_COLORS[Math.floor(rand() * GARDEN_COLORS.length)]!,
      })
    }
  }
  // 集體農場的場部：大村才有。街的一端外面，兩三棟長條牲口棚加一棟鐵皮頂的辦公房
  if ((p.pop ?? 0) >= 350 && rand() < 0.7) {
    const end = rand() < 0.5 ? 1 : -1
    const s0 = end * (length / 2 + 40)
    const side = rand() < 0.5 ? 1 : -1
    const base = 34
    const cx = v.siteX + tx * s0 + nx * side * base
    const cz = v.siteZ + tz * s0 + nz * side * base
    const sheds = 2 + Math.floor(rand() * 2)
    for (let k = 0; k < sheds; k++) {
      const ax = cx + nx * side * (k * 24 - 12)
      const az = cz + nz * side * (k * 24 - 12)
      if (offTrack(ax, az)) place(out, occ, ax, az, 12, rot, 1.0, rand(), FloraKind.TarBarn, 0.45, 0.7)
    }
    const ox = cx - tx * 40
    const oz = cz - tz * 40
    if (offTrack(ox, oz)) place(out, occ, ox, oz, 7, rot, 1.1, rand(), FloraKind.SlateHouse, 0.6, 0.75)
  }
}

/** 小聚落（khutor）：三五戶擠在一起，沒有街 */
function hamlet(v: LaneVillage, occ: Occupancy, out: Out): void {
  const rand = makeRand(nameHash(v.place.name))
  const n = 3 + Math.floor(rand() * 3)
  const heading = rand() * Math.PI * 2
  for (let k = 0; k < n; k++) {
    const a = heading + (rand() - 0.5) * 1.2
    const d = 10 + k * (18 + rand() * 10)
    const hx = v.place.x + Math.cos(a) * d
    const hz = v.place.z + Math.sin(a) * d
    const rot = heading + Math.PI / 2 + (rand() - 0.5) * 0.4
    if (!offTrack(hx, hz)) continue
    if (!place(out, occ, hx, hz, 6, rot, 1.1 + rand() * 0.25, rand(), FloraKind.House, 0.55, 0.55)) continue
    for (let t = 0; t < 2 + Math.floor(rand() * 3); t++) {
      const ta = rand() * Math.PI * 2
      const td = 8 + rand() * 20
      const tx = hx + Math.cos(ta) * td
      const tz = hz + Math.sin(ta) * td
      if (offTrack(tx, tz)) place(out, occ, tx, tz, 3, rand() * 6.3, 0.3 + rand() * 0.12, rand(), FloraKind.BroadTree)
    }
  }
}

/** 依 tile 分桶的鍵（tile 索引夾在 ±4096 內） */
function bucketKey(i: number, j: number): number {
  return (i + 4096) * 8192 + (j + 4096)
}

const NONE: readonly Placement[] = []

/**
 * 全部草原村的建築與樹（`flora`，散佈器）與屋後的菜園（`gardens`）。**建築預先算好、
 * 依 tile 分桶**，與 `settlementLayout` 同一個做法。
 */
export function steppeLayout(
  villages: readonly LaneVillage[], avoid: (x: number, z: number) => boolean,
): { flora: FloraSource; gardens: readonly GardenStrip[] } {
  const out: Out = { placements: [], gardens: [] }
  const occ = new Occupancy()
  for (const v of villages) {
    if (v.place.kind === 'hamlet') hamlet(v, occ, out)
    else street(v, avoid, occ, out)
  }
  const buckets = new Map<number, Placement[]>()
  for (const b of out.placements) {
    const k = bucketKey(Math.floor(b.x / TILE_SIZE), Math.floor(b.z / TILE_SIZE))
    const list = buckets.get(k)
    if (list === undefined) buckets.set(k, [b])
    else list.push(b)
  }
  const flora: FloraSource = (x0, z0, x1, z1, heightAt, o) => {
    const i0 = Math.floor(x0 / TILE_SIZE)
    const i1 = Math.floor((x1 - 1e-6) / TILE_SIZE)
    const j0 = Math.floor(z0 / TILE_SIZE)
    const j1 = Math.floor((z1 - 1e-6) / TILE_SIZE)
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (const b of buckets.get(bucketKey(i, j)) ?? NONE) {
          if (b.x < x0 || b.x >= x1 || b.z < z0 || b.z >= z1) continue
          pushFlora(o, b.x, heightAt(b.x, b.z), b.z, b.rot, b.scale, b.tint, b.kind, b.wide, b.tall)
        }
      }
    }
  }
  return { flora, gardens: out.gardens }
}

/**
 * 菜園的網格：每一條一個四邊形，頂點取地形高度再抬 `DECAL_LIFT`，帶自己的顏色。
 * 平常整顆烘進田色貼圖（`terrain.ts` 的 `addOverlay`）。
 */
export function buildGardens(sample: HeightSampler, gardens: readonly GardenStrip[]): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const c = new Color()
  for (const g of gardens) {
    const base = pos.length / 3
    c.setHex(g.color)
    for (const [x, z] of g.ring) {
      pos.push(x, sample(x, z) + DECAL_LIFT, z)
      col.push(c.r, c.g, c.b)
    }
    // 【捲繞朝上】四個角的繞行方向隨菜園的朝向而定，逐片對
    const a = g.ring[0]!
    const b = g.ring[1]!
    const d = g.ring[2]!
    const cross = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])
    if (cross > 0) idx.push(base, base + 2, base + 1, base, base + 3, base + 2)
    else idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}
