import { Vector3 } from 'three'
import { createHeightField, type HeightFieldData } from './heightfield'
import { bakeRelief, makeLobes, WOBBLE_MAX, type IslandDesc } from './archipelago'
import { FARM_CELL, FARM_SIZE, HILL_PEAK_MAX } from './farmland'
import { drawHillLobes } from './leuna'
import { TAKEOFF_ROLL_GAP, TAXI_SPEED, type TakeoffLine, type TaxiPoint } from '../control/takeoffRoll'
import type { CrateField, ParkedVehicle } from './depot'
import { BROAD_CROWN_R, BUSH_R, CONE_CROWN_R } from '../render/floraShapes'

/**
 * # Y-29（比利時 Asch）：德 M3 專用的地形
 *
 * Kempen 高原的荒地：平、遠處幾顆極緩的丘。Y-29 是前進降落場（ALG），不是
 * 水泥機場 —— 一條鋼板網（PSP）跑道鋪在草地上，跑道一側一圈環狀滑行帶，
 * 滑行帶外側是一架一格的分散停機墊，每一格旁邊是整備區（補給堆、卡車）。跑道
 * 東側是作業區、南端是營區，營房旁邊隨意停著卡車。**整張圖的佈局都在這個檔案**，
 * 卡片與佈景引用這裡的常數。
 *
 * 【跑道南北向、不轉】藍隊從東邊朝西進場（`battle/entry.ts` 的 `ASCH_EAST`），
 * 橫切跑道與停機線：一趟只掃得到一兩架，要轉回來再打。機場局部座標是世界
 * 座標減去 `FIELD_CENTER`，沒有旋轉。
 */

/**
 * 機場中心。`ASCH_EAST` 把藍隊放在它正東 7.5 km、同一個 z；7.5 km 的進場在
 * 200 m/s 下約 37 秒。**搬動它要一起改 `ASCH_EAST`**，否則玩家會從機場旁邊飛過
 */
export const FIELD_CENTER = /* @__PURE__ */ new Vector3(-750, 0, -2500)

/** 機場局部 → 世界 */
function at(dx: number, dz: number): { x: number; z: number } {
  return { x: FIELD_CENTER.x + dx, z: FIELD_CENTER.z + dz }
}

/** 世界 → 機場局部。護欄與佈景讀它 */
export function worldToField(x: number, z: number, out: { x: number; z: number }): void {
  out.x = x - FIELD_CENTER.x
  out.z = z - FIELD_CENTER.z
}

/** 軸對齊的矩形，機場局部座標 */
export interface FieldRect { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }

/** 墊面：草地，內部高度保證 0。一塊就包得住跑道、滑行帶與停機墊 */
export const FIELD_PAD: FieldRect = { x0: -340, z0: -760, x1: 70, z1: 760 }
/**
 * 附加的墊面：跑道東側的作業區、南端的營區。**都與主墊面相接**。營房、箱子與
 * 車要落在墊面裡 —— 墊面外底下是田，而且會長樹
 */
export const FIELD_LOBES: readonly FieldRect[] = [
  { x0: 70, z0: -760, x1: 400, z1: 760 },
  { x0: -340, z0: 760, x1: 70, z1: 1020 },
]
/** 主墊面與附加墊面的外接矩形。護欄、佈景用 */
export const FIELD_BOUNDS: FieldRect = /* @__PURE__ */ [FIELD_PAD, ...FIELD_LOBES].reduce((b, r) => ({
  x0: Math.min(b.x0, r.x0), z0: Math.min(b.z0, r.z0), x1: Math.max(b.x1, r.x1), z1: Math.max(b.z1, r.z1),
}))

/** 這一點在墊面（主體或任何一塊附加）的矩形裡；不含裙邊 */
export function inField(dx: number, dz: number): boolean {
  for (const r of [FIELD_PAD, ...FIELD_LOBES]) {
    if (dx >= r.x0 && dx <= r.x1 && dz >= r.z0 && dz <= r.z1) return true
  }
  return false
}
/**
 * 墊面外一圈不長樹，m。Kempen 高原的松林貼著機場長；防空砲位要落在這一圈裡，
 * 不然會站在林子中間
 */
export const FIELD_TREE_CLEAR = 100
/** 墊面外一圈不蓋村莊，m */
export const FIELD_BUILDING_CLEAR = 300

/** 冬天的荒地草色 */
export const PAD_GRASS = 0x5a5c42
/** 鋼板網：生鏽的灰褐色，與波爾塔瓦的水泥（`RUNWAY_CONCRETE`）分得開 */
export const PSP_STEEL = 0x6b6556

/** 跑道：南北向 1,400 × 36 m */
export const RUNWAY: FieldRect = { x0: -18, z0: -700, x1: 18, z1: 700 }

/**
 * 環狀滑行帶，只在跑道西側：北、南兩段橫向接上跑道兩端，西段把兩頭接起來。
 * 寬 15 m。**三段的次序是北、西、南**。
 */
export const TAXI_LOOP: readonly FieldRect[] = [
  { x0: -215, z0: -655, x1: -18, z1: -640 },
  { x0: -215, z0: -640, x1: -200, z1: 640 },
  { x0: -215, z0: 640, x1: -18, z1: 655 },
]

/** 停機墊的半邊，m：30 m 見方，翼展 11.3 m 的 P-51 停得下 */
const PAD_HALF = 15
/** 窄巷的半寬，m */
const LANE_HALF = 5
/** 停機墊中心的 x：滑行帶西段外側 55 m */
const STAND_X = -270
/** 12 格，南北間距 90 m */
const STAND_ZS: readonly number[] = /* @__PURE__ */ Array.from({ length: 12 }, (_, i) => -495 + 90 * i)

/** 停機墊：飛機腳下那一塊 */
export const STAND_PADS: readonly FieldRect[] = /* @__PURE__ */ STAND_ZS.map((dz) => ({
  x0: STAND_X - PAD_HALF, x1: STAND_X + PAD_HALF, z0: dz - PAD_HALF, z1: dz + PAD_HALF,
}))

/** 窄巷：從停機墊中心接到滑行帶西段的外緣 */
export const STAND_LANES: readonly FieldRect[] = /* @__PURE__ */ STAND_ZS.map((dz) => ({
  x0: STAND_X, x1: TAXI_LOOP[1]!.x0, z0: dz - LANE_HALF, z1: dz + LANE_HALF,
}))

/** 全部的鋪面。著色器鋪鋼板色、佈景與砲位避開它們 */
export const PAVED: readonly FieldRect[] = /* @__PURE__ */ [RUNWAY, ...TAXI_LOOP, ...STAND_LANES, ...STAND_PADS]

/** 停放的 P-51：12 架，機首朝滑行帶（+X，`heading` −π/2） */
export const PARKED_ROWS: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ STAND_ZS.map((dz) => ({ ...at(STAND_X, dz), heading: -Math.PI / 2 }))

/**
 * 前後兩架的間隔，m：滑一個間隔的時間要比滾行間隔長。短了的話後一架滑到起飛點時
 * 前一架還沒滾行出去，兩架停在同一點
 */
const HOLD_GAP = TAKEOFF_ROLL_GAP * TAXI_SPEED + 2

/**
 * 已經滑到跑道頭的一個小隊：4 架排在南段滑行帶的中線上，機首朝跑道（+X），
 * 最前面那架離跑道中線 30 m、前後間隔 `HOLD_GAP`。開場第一批就是它們，滑一兩百
 * 公尺上跑道就滾行 —— 玩家約 37 秒到場時已經升空。
 */
export const HOLD_ROWS: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ [0, 1, 2, 3].map((i) => ({
    ...at(-30 - HOLD_GAP * i, (TAXI_LOOP[2]!.z0 + TAXI_LOOP[2]!.z1) / 2), heading: -Math.PI / 2,
  }))

/**
 * 起飛點在跑道中線上的局部 z：滑行帶南段接口（647.5）北邊一點點。
 *
 * 【滑上跑道就起飛】**四架共用這一點**，不各自再往北排隊 —— 排隊要多滑一百
 * 多公尺，畫面上是「滑到前面的停等區才起飛」。前後間隔由抵達時間拉開
 * （`TAKEOFF_ROLL_GAP`）。往北還有 1,347 m，滾行只要約 300 m。
 */
const LINE_Z = 640

/**
 * 起飛線：跑道南段的中線，機首朝北（−Z）。停機墊上的 P-51 沿 `taxiRoute` 滑上
 * 跑道就開始滾行；滾行加上初期爬升約 500 m，交還時還在跑道上空。
 */
export const TAKEOFF_LINE: TakeoffLine = /* @__PURE__ */ { ...at(0, LINE_Z), heading: 0, route: taxiRoute }

/**
 * 從停在 (x, z) 的那一格滑到跑道上的起飛點，世界座標的折線：
 *
 * ```
 *   停機墊中心 → 沿窄巷往東到滑行帶西段中線 → 沿西段往南到南段中線
 *   → 沿南段往東到跑道中線 → 轉北，走到起飛點
 * ```
 *
 * 【`slot` 不影響終點】四架滑到同一個起飛點，先到先滾行。
 *
 * 【停機墊一定在西段外側、窄巷與它同一個 z】`STANDS` 就是這樣排的。每一段都
 * 走在鋪面的中線上，護欄在 `asch.test.ts` 逐公尺檢查。
 *
 * 【已經在南段上的直接往東】跑道頭那一個小隊（`HOLD_ROWS`）停在南段中線上，
 * 只走最後兩段。
 */
export function taxiRoute(x: number, z: number, _slot: number): readonly TaxiPoint[] {
  const lx = x - FIELD_CENTER.x
  const lz = z - FIELD_CENTER.z
  const leg = TAXI_LOOP[1]!
  const south = TAXI_LOOP[2]!
  const legX = (leg.x0 + leg.x1) / 2
  const southZ = (south.z0 + south.z1) / 2
  const runX = (RUNWAY.x0 + RUNWAY.x1) / 2
  if (lx >= south.x0 && lx <= south.x1 && lz >= south.z0 && lz <= south.z1) {
    return [{ x, z }, at(runX, southZ), at(runX, LINE_Z)]
  }
  return [
    { x, z },
    at(legX, lz),
    at(legX, southZ),
    at(runX, southZ),
    at(runX, LINE_Z),
  ]
}

/** 油桶堆兩塊，在滑行帶環內、離跑道與滑行帶各約 90 m */
export const DUMPS: readonly { kind: 'fuelDump'; x: number; z: number; heading: number }[] = [
  { kind: 'fuelDump', ...at(-110, -300), heading: 0 },
  { kind: 'fuelDump', ...at(-110, 300), heading: 0 },
]

/**
 * 防空砲 12 座，美軍的 M16 半履帶車（四聯 .50）：滑行帶環內三座、停機線外側
 * 三座、東側作業區三座、跑道兩端外各一座、營區外一座。都在墊面外不長樹的那一圈
 * （`FIELD_TREE_CLEAR`）之內。**座數由試玩裁定**
 */
export const FLAK_SITES: readonly { x: number; z: number; heading: number }[] =
  /* @__PURE__ */ ([
    { dx: -110, dz: -500 }, { dx: -110, dz: 0 }, { dx: -110, dz: 500 },
    { dx: -400, dz: -600 }, { dx: -400, dz: 60 }, { dx: -400, dz: 600 },
    { dx: 200, dz: 0 }, { dx: 380, dz: -650 }, { dx: 380, dz: 650 },
    { dx: 0, dz: -840 }, { dx: 100, dz: 1080 }, { dx: -400, dz: 900 },
  ] as const).map((s) => ({ ...at(s.dx, s.dz), heading: Math.atan2(s.dx, -s.dz) }))

/** 連外道路從主墊面西緣的中線往西出圖 */
export const ROAD_WIDTH = 8
export const ROADS: readonly (readonly { x: number; z: number }[])[] = [
  [at(FIELD_PAD.x0, 0), { x: -14500, z: FIELD_CENTER.z }],
]

// ── 營區、作業區與停機線旁的佈景：營房、補給堆、停著的車 ──────────

/**
 * 一棟木造營房，世界座標。形狀是村裡那一種建築（`render/floraShapes.ts`），
 * `length` 是屋脊方向的長度、`width` 是山牆那一邊，m。`heading` 0 = 屋脊沿 z、
 * π/2 = 屋脊沿 x
 */
export interface Hut {
  readonly x: number; readonly z: number; readonly heading: number
  readonly length: number; readonly width: number
}

/**
 * 營房：南端營區 5 排 × 8 棟，屋脊東西向；跑道東側作業區兩排各 8 棟，屋脊
 * 順著跑道。
 */
export const HUTS: readonly Hut[] = /* @__PURE__ */ (() => {
  const out: Hut[] = []
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i < 8; i++) {
      out.push({ ...at(-300 + 30 * i, 820 + 30 * row), heading: Math.PI / 2, length: 20, width: 7 })
    }
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      out.push({ ...at(140, side * (340 + 40 * i)), heading: 0, length: 24, width: 8 })
    }
  }
  return out
})()

/** 種子進、序列出。**不得 `Math.random`** —— 同一張地圖每次都要長一樣 */
function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 一塊佔掉的地，機場局部座標與外接半徑 */
interface Footprint { readonly x: number; readonly z: number; readonly r: number }

const local = (p: { x: number; z: number }, r: number): Footprint =>
  ({ x: p.x - FIELD_CENTER.x, z: p.z - FIELD_CENTER.z, r })

/** 擺佈景時要避開的地面目標：防空砲、油桶堆、停放的 P-51 */
const SOLID: readonly Footprint[] = /* @__PURE__ */ [
  ...FLAK_SITES.map((s) => local(s, 5 + 5)),
  ...DUMPS.map((d) => local(d, 15 + 5)),
  ...PARKED_ROWS.map((p) => local(p, 8 + 5)),
]

/**
 * 半徑 r 的一塊地（機場局部座標）放得下嗎：整塊在墊面裡、離鋪面 3 m 以上、
 * 不壓連外道路與地面目標，也不壓 `taken` 裡已經擺下的東西。`asch.test.ts` 用
 * 同樣的條件另外驗一次
 */
function fits(x: number, z: number, r: number, taken: readonly Footprint[]): boolean {
  if (!inField(x - r, z) || !inField(x + r, z) || !inField(x, z - r) || !inField(x, z + r)) return false
  const m = r + 3
  for (const p of PAVED) {
    if (x >= p.x0 - m && x <= p.x1 + m && z >= p.z0 - m && z <= p.z1 + m) return false
  }
  if (x - r <= FIELD_PAD.x0 && Math.abs(z) < r + ROAD_WIDTH / 2 + 2) return false
  for (const s of SOLID) if (Math.hypot(x - s.x, z - s.z) < r + s.r) return false
  for (const t of taken) if (Math.hypot(x - t.x, z - t.z) < r + t.r + 2) return false
  return true
}

/** 卡車的外接半徑，m */
const TRUCK_R = 4
/** 整備區離 P-51 多遠，m：停機墊半邊 15 加上縫，到外緣 45 */
const SERVICE_RING = [20, 45] as const

/**
 * 在 (cx, cz) 周圍 `ring` 那一圈裡抽一個放得下半徑 r 的點（機場局部座標），
 * 抽 `tries` 次都放不下就回 null
 */
function around(
  rand: () => number, cx: number, cz: number, ring: readonly [number, number], r: number,
  taken: readonly Footprint[], tries: number,
): { x: number; z: number } | null {
  for (let k = 0; k < tries; k++) {
    const ang = 2 * Math.PI * rand()
    const d = ring[0] + (ring[1] - ring[0]) * rand()
    const x = cx + Math.sin(ang) * d
    const z = cz + Math.cos(ang) * d
    if (fits(x, z, r, taken)) return { x, z }
  }
  return null
}

/**
 * 停機位的整備區：每一架 P-51 旁邊 1～3 堆補給、1～2 台卡車，都在
 * `SERVICE_RING` 那一圈裡的草地上。大小、朝向、位置都由種子抽。
 */
const SERVICE: { readonly crates: readonly CrateField[]; readonly trucks: readonly ParkedVehicle[] } =
  /* @__PURE__ */ (() => {
    const rand = makeRand(1945_01_01)
    const taken: Footprint[] = HUTS.map((h) => local(h, Math.hypot(h.length, h.width) / 2))
    const crates: CrateField[] = []
    const trucks: ParkedVehicle[] = []
    for (const p of PARKED_ROWS) {
      const c = local(p, 0)
      const piles = 1 + Math.floor(3 * rand())
      for (let n = 0; n < piles; n++) {
        const width = 3 + 9 * rand()
        const depth = 3 + 6 * rand()
        const heading = Math.PI * rand()
        const r = Math.hypot(width, depth) / 2
        const at0 = around(rand, c.x, c.z, SERVICE_RING, r, taken, 40)
        if (at0 === null) continue
        taken.push({ ...at0, r })
        crates.push({ ...at(at0.x, at0.z), heading, width, depth, lane: 0, seed: 2901 + crates.length })
      }
      const count = rand() < 0.4 ? 2 : 1
      for (let n = 0; n < count; n++) {
        const at0 = around(rand, c.x, c.z, SERVICE_RING, TRUCK_R, taken, 40)
        if (at0 === null) continue
        taken.push({ ...at0, r: TRUCK_R })
        trucks.push({ unit: 'usTruck', ...at(at0.x, at0.z), heading: 2 * Math.PI * rand() })
      }
    }
    return { crates, trucks }
  })()

/** 補給堆（`world/depot.ts`），全在停機位的整備區。**不是目標**，油桶堆（`DUMPS`）才是 */
export const CRATE_FIELDS: readonly CrateField[] = SERVICE.crates

/**
 * 停著的卡車，**佈景、打不掉**：停機位整備區的那幾台，加上營房旁邊隨意停的，
 * 方向都隨意。佈景裡不放 M16 —— 場上的 M16 都是會開火的那 12 輛
 */
export const VEHICLES: readonly ParkedVehicle[] = /* @__PURE__ */ (() => {
  const rand = makeRand(1945_01_02)
  const huts = HUTS.map((h) => local(h, Math.hypot(h.length, h.width) / 2))
  const taken: Footprint[] = [
    ...huts,
    ...CRATE_FIELDS.map((d) => local(d, Math.hypot(d.width, d.depth) / 2)),
    ...SERVICE.trucks.map((v) => local(v, TRUCK_R)),
  ]
  const out: ParkedVehicle[] = [...SERVICE.trucks]
  for (const h of huts) {
    if (rand() > 0.4) continue
    const at0 = around(rand, h.x, h.z, [h.r + TRUCK_R + 2, h.r + TRUCK_R + 12], TRUCK_R, taken, 12)
    if (at0 === null) continue
    taken.push({ ...at0, r: TRUCK_R })
    out.push({ unit: 'usTruck', ...at(at0.x, at0.z), heading: 2 * Math.PI * rand() })
  }
  return out
})()

/** 樹叢裡的一株，世界座標。`scale`、`rot`、`tint` 照植被的約定（`render/flora.ts`） */
export interface ClumpPlant {
  readonly x: number; readonly z: number
  readonly kind: 'broad' | 'cone' | 'bush'
  readonly scale: number; readonly rot: number; readonly tint: number
}
/** 一叢，(x, z) 是叢心 */
export interface TreeClump { readonly x: number; readonly z: number; readonly plants: readonly ClumpPlant[] }

const CLUMP_COUNT = 16
/** 叢的半徑，m：樹落在叢心這麼遠之內 */
const CLUMP_R = [18, 45] as const
/** 一棵樹、一叢灌木各佔叢面積多少，m²：株數跟著叢的面積走 */
const CLUMP_AREA_PER_TREE = 150
const CLUMP_AREA_PER_BUSH = 75
/** 灌木散到叢半徑的幾倍，越外面越稀 */
const CLUMP_BUSH_SPREAD = 2.2
/** 一株放不下時重抽幾次，抽不到就不放 */
const CLUMP_PLANT_TRIES = 4
/** 樹的縮放比野地的小一號：15～24 m 的樹、3～6 m 的灌木 */
const CLUMP_TREE_SCALE = [0.5, 0.8] as const
const CLUMP_BUSH_SCALE = [0.5, 1.0] as const
/** 樹冠外緣離跑道，m：起降的航線兩側不長樹；灌木矮，只要不蓋到 */
const RUNWAY_TREE_GAP = 80
const RUNWAY_BUSH_GAP = 15
/** 樹冠外緣離其他鋪面（滑行帶、窄巷、停機墊），m。滑行的翼尖都在鋪面上 */
const PAVING_PLANT_GAP = 3

/** 樹冠不能蓋到的東西，機場局部座標：營房、箱子、車、防空砲、油桶堆、停放的 P-51 */
const PLANT_OBSTACLES: readonly Footprint[] = /* @__PURE__ */ [
  ...HUTS.map((h) => local(h, Math.hypot(h.length, h.width) / 2)),
  ...CRATE_FIELDS.map((d) => local(d, Math.hypot(d.width, d.depth) / 2)),
  ...VEHICLES.map((v) => local(v, TRUCK_R)),
  ...FLAK_SITES.map((s) => local(s, 5)),
  ...DUMPS.map((d) => local(d, 15)),
  ...PARKED_ROWS.map((p) => local(p, 8)),
]

/** 點到矩形的距離，m；在矩形裡是 0 */
function rectGap(x: number, z: number, r: FieldRect): number {
  return Math.hypot(Math.max(0, r.x0 - x, x - r.x1), Math.max(0, r.z0 - z, z - r.z1))
}

/**
 * 樹冠半徑 r 的一株能不能長在 (x, z)（機場局部座標）：根在墊面裡、樹冠外緣離跑道
 * `runwayGap`、離其他鋪面 `PAVING_PLANT_GAP`、不蓋到連外道路與 `PLANT_OBSTACLES`
 */
function plantFits(x: number, z: number, r: number, runwayGap: number): boolean {
  if (!inField(x, z)) return false
  if (rectGap(x, z, RUNWAY) - r < runwayGap) return false
  const m = r + PAVING_PLANT_GAP
  for (const p of PAVED) {
    if (x >= p.x0 - m && x <= p.x1 + m && z >= p.z0 - m && z <= p.z1 + m) return false
  }
  if (x - r <= FIELD_PAD.x0 && Math.abs(z) < r + ROAD_WIDTH / 2 + 2) return false
  for (const o of PLANT_OBSTACLES) if (Math.hypot(x - o.x, z - o.z) < r + o.r + 1) return false
  return true
}

/**
 * 機場裡一片一片的樹叢：樹聚在叢心，灌木往外散開、越外面越稀。**逐株檢查**
 * （`plantFits`）：跑道周圍不長樹，營房、箱子、車與停機位旁邊可以長，只是樹冠不能
 * 蓋到；放不下就重抽，抽不到就不放。叢與叢之間不疊。位置、大小、樹種都由種子抽。
 */
export const TREE_CLUMPS: readonly TreeClump[] = /* @__PURE__ */ (() => {
  const rand = makeRand(1945_01_03)
  const crownOf = { broad: BROAD_CROWN_R, cone: CONE_CROWN_R, bush: BUSH_R } as const
  const b = FIELD_BOUNDS
  const out: TreeClump[] = []
  const clumps: Footprint[] = []
  /** 在叢心 (x, z) 周圍 `reach` 內找一個放得下的位置，種一株 */
  const sow = (
    plants: ClumpPlant[], x: number, z: number, reach: number, kind: ClumpPlant['kind'],
    radial: (u: number) => number,
  ): void => {
    const range = kind === 'bush' ? CLUMP_BUSH_SCALE : CLUMP_TREE_SCALE
    const scale = range[0] + (range[1] - range[0]) * rand()
    const r = crownOf[kind] * scale
    const gap = kind === 'bush' ? RUNWAY_BUSH_GAP : RUNWAY_TREE_GAP
    for (let t = 0; t < CLUMP_PLANT_TRIES; t++) {
      const ang = 2 * Math.PI * rand()
      const d = reach * radial(rand())
      const px = x + Math.sin(ang) * d
      const pz = z + Math.cos(ang) * d
      if (!plantFits(px, pz, r, gap)) continue
      plants.push({ ...at(px, pz), kind, scale, rot: 2 * Math.PI * rand(), tint: rand() })
      return
    }
  }
  for (let tries = 0; tries < 3000 && out.length < CLUMP_COUNT; tries++) {
    const radius = CLUMP_R[0] + (CLUMP_R[1] - CLUMP_R[0]) * rand()
    const x = b.x0 + (b.x1 - b.x0) * rand()
    const z = b.z0 + (b.z1 - b.z0) * rand()
    // 叢心本身要長得出樹；叢與叢不疊
    if (!plantFits(x, z, 0, RUNWAY_TREE_GAP)) continue
    if (clumps.some((c) => Math.hypot(x - c.x, z - c.z) < radius + c.r)) continue
    const area = Math.PI * radius * radius
    const plants: ClumpPlant[] = []
    const trees = Math.round(area / CLUMP_AREA_PER_TREE)
    for (let k = 0; k < trees; k++) sow(plants, x, z, radius, rand() < 0.75 ? 'broad' : 'cone', Math.sqrt)
    // 【灌木徑向均勻取樣】面積密度隨半徑遞減，外圈自然稀疏
    const bushes = Math.round(area / CLUMP_AREA_PER_BUSH)
    for (let k = 0; k < bushes; k++) sow(plants, x, z, radius * CLUMP_BUSH_SPREAD, 'bush', (u) => u)
    if (plants.length === 0) continue
    clumps.push({ x, z, r: radius })
    out.push({ ...at(x, z), plants })
  }
  return out
})()

/**
 * 手擺的丘陵：極緩，全在 4 km 外。`outerRadius` 由生成器算 `radius × WOBBLE_MAX`
 * —— 外緣加上中心距離要在 `HILL_LIMIT`（14,000）內。
 */
export const ASCH_HILLS = [
  { cx: -7000, cz: -7500, radius: 900, peak: 30, pa: 0.9, pb: 3.4, seed: 301 },
  { cx: 6000, cz: -8000, radius: 1000, peak: 35, pa: 2.1, pb: 4.6, seed: 302 },
  { cx: -8000, cz: 3500, radius: 800, peak: 25, pa: 3.0, pb: 1.2, seed: 303 },
  { cx: 6000, cz: 4000, radius: 900, peak: 30, pa: 1.4, pb: 5.3, seed: 304 },
] as const

export function createAsch(): { field: HeightFieldData; hills: IslandDesc[] } {
  const field = createHeightField(FARM_SIZE, FARM_CELL)
  const hills: IslandDesc[] = []
  for (const h of ASCH_HILLS) {
    const outerRadius = h.radius * WOBBLE_MAX
    const peak = Math.min(HILL_PEAK_MAX, h.peak)
    hills.push({
      cx: h.cx, cz: h.cz, radius: h.radius, outerRadius, peak,
      lobes: makeLobes(h.cx, h.cz, h.radius, outerRadius, peak, h.pa, h.pb, drawHillLobes(h.seed)),
    })
  }
  // 基準面是 0：內陸沒有海
  bakeRelief(field, hills, 0)
  return { field, hills }
}
