import { Group, type Mesh, type MeshStandardMaterial } from 'three'
import { assetUrl } from '../core/asset'
import type { FloraSource } from './flora'
import { createFloodplain } from './floodplain'
import { terrainGrid } from './groundDecal'
import { excludingWhere, type BoxTest } from './floraExclude'
import type { PoolName } from './vegetation'
import type { RiverSet } from './river'
import {
  buildGreens, buildSettlementGround, buildStreets, settlementLayout, settlementNear, settlementTest,
} from './settlements'
import { buildMines, mineNear, mineTest } from './mines'
import { buildMotorway, motorwayProfiles } from './motorway'
import { FLAK_SITES } from '../world/leuna'
import { CHANNEL_HALF, RiverIndex, type HeightSampler } from '../world/river'
import type { FeatureFile } from '../world/landFeatures'

/**
 * # 洛伊納一帶的真實地物：村鎮、A9、蓋澤爾谷的露天礦
 *
 * 資料：© OpenStreetMap contributors，ODbL，由 `tools/dem/fetch-leuna-features.mjs`
 * 抓成 `public/data/leuna-features.json`。
 *
 * 【進場前預載】與河道、廠區的 GLB 同一個理由：`createTerrain` 是同步的。
 */
export const LEUNA_FEATURES_URL = '/data/leuna-features.json'

let cache: FeatureFile | null = null

export async function preloadLeunaFeatures(
  fetcher: (url: string) => Promise<FeatureFile> =
  async (u) => (await fetch(assetUrl(u))).json() as Promise<FeatureFile>,
): Promise<void> {
  if (cache !== null) return
  cache = await fetcher(LEUNA_FEATURES_URL)
}

/** 地形上的一層真實地物。`terrain.ts` 的 `createInlandTerrain` 吃這一份 */
export interface LandDressing {
  /** 鋪在地表上的網格：村鎮的地面、礦坑、高速公路。掛在陸地底下 */
  readonly object: Group
  /** 樹籬與樹林不長在這些地方：村鎮裡、礦坑裡、高速公路上 */
  readonly keepOut: (x: number, z: number) => boolean
  /** `keepOut` 的整格版（`excludingWhere` 的 `near`）：回 false 的格一定沒有要擋的 */
  readonly keepOutNear: BoxTest
  /** 田的樹籬與田裡的林地另外不長在這裡：河漫灘（河岸林照長） */
  readonly fieldsOut: (x: number, z: number) => boolean
  /** `fieldsOut` 的整格版 */
  readonly fieldsOutNear: BoxTest
  /** 另外的散佈器：河漫灘的河岸林（已經擋了 `keepOut`） */
  readonly flora: readonly FloraSource[]
  /** 村鎮的建築。已經避開河道、高速公路、礦坑與砲位 */
  readonly buildings: FloraSource
  /** 植被池的容量覆寫 —— 真實的鎮一個就上千棟房子 */
  readonly capacity: Partial<Record<PoolName, number>>
  /**
   * 平貼在地上的網格：鎮的地面、草地、礦坑、街（`object` 裡），依烘圖的先後。有田色
   * clipmap 時整顆烘進兩張貼圖、網格不畫（`terrain.ts`）—— 二十幾萬個三角形每幀
   * 都要送一次
   */
  readonly baked: readonly Mesh[]
  /**
   * 河漫灘、鎮的地面與礦坑的粗網格（一格一個地形格，`terrainGrid`），只畫在
   * 遠圖外面：遠圖只蓋鏡頭周圍 30 km，外面沒有它們的話，礦坑與河谷在十幾公里外
   * 一下子不見
   */
  readonly beyond: readonly Mesh[]
  dispose(): void
}

/** 河漫灘的地面鋪到多遠（見方的半邊），m。與建築查詢的範圍相同 */
const FLOODPLAIN_EXTENT = 22000
/**
 * 河漫灘地面的格子。森林團塊最小的尺度是 260 m，40 m 一格就畫得出來；20 m 的話
 * 建地形多花兩秒多（每個頂點都要算覆蓋率）。40 是 40 的因數，兩種奇偶都對得齊
 */
const FLOODPLAIN_GRID = { size: 40, origin: 0 }

/** 房子離河的中心線至少多遠，m。水面半寬加一點岸 */
const HOUSE_RIVER = CHANNEL_HALF + 15
/** 房子與樹籬離高速公路的中心線至少多遠，m。車道半寬加路堤 */
const ROAD_KEEP_OUT = 25
/** 房子離砲位至少多遠，m */
const HOUSE_FLAK = 70
/** 房子離坑緣至少多遠，m */
const HOUSE_MINE = 30

/**
 * 【容量怎麼來】
 * - 建築：鏡頭每隔 1 km 掃過整張圖，植被圈內（6 km）最多是新瓦 2,815、石板瓦
 *   783、老瓦 1,267、油毛氈 676（小菜園的棚子多半是它）、教堂 35
 *   （`leuna-features.test.ts` 守著），各留五成以上的餘裕。
 * - 近級的樹：村鎮的果樹、教堂墓園的樹、河漫灘的河岸林加上樹籬與樹林。逐 tile
 *   數過整張圖，鏡頭每 250 m 滑一次、近級半徑多算半個 tile 的對角線（偏高的
 *   估計）：闊葉 4,138（Luppe 的河岸林上空）、針葉 2,012；植被引擎在最密處實跑
 *   的針葉是 1,637。預設的 3,500、1,500 會溢位，這裡照偏高的估計再留兩成多。
 *   其餘各級的預設都還有 1.35 倍以上。
 *
 * 溢位時丟掉並記一次告警，症狀是半個鎮沒有房子、近處的樹整片消失。
 *
 * 【單格的上限不必動】建築、果樹加上格子裡剩下的樹籬與樹林，整張圖最密的一格
 * 是 353 株，在 `MAX_PER_TILE`（384）以內。
 */
const CAPACITY: Partial<Record<PoolName, number>> = {
  house: 5000, houseSlate: 1400, barn: 2100, barnTar: 1200, church: 60,
  broadNear: 5200, coneNear: 2600,
}

/**
 * 這一點在薩勒河的右岸（順著水流的右手邊）嗎。北流的那一段右岸就是東岸 ——
 * 中世紀東向殖民的地區，村形與西岸不同（`settlements.ts`）。
 *
 * 【點的次序就是水流方向】OSM 抓下來的 Saale 三段都是由上游往下游（南 → 北、
 * 西南 → 東北）。只看地圖內那三段，延伸段是編的、有一端是倒著走的。
 */
export function rightOfSaale(rivers: RiverSet): (x: number, z: number) => boolean {
  const saale = rivers.lines.filter((l) => l.name === 'Saale')
  return (x, z) => {
    let best = Infinity
    let side = 0
    for (const l of saale) {
      for (let i = 0; i + 1 < l.points.length; i++) {
        const a = l.points[i]!
        const b = l.points[i + 1]!
        const vx = b[0] - a[0]
        const vz = b[1] - a[1]
        const l2 = vx * vx + vz * vz
        const t = l2 <= 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / l2))
        const d = Math.hypot(x - (a[0] + vx * t), z - (a[1] + vz * t))
        if (d < best) {
          best = d
          // 北是 −z：往北流 (0, −1) 時東邊 (+x) 的叉積是正的
          side = vx * (z - a[1]) - vz * (x - a[0])
        }
      }
    }
    return side > 0
  }
}

/**
 * `field` 是這張地形的格網（格數、格距）：遠圖外的粗網格要對齊它的格點
 * （`terrainGrid`）
 */
export function buildLeunaDressing(
  sample: HeightSampler, rivers: RiverSet, field: { readonly size: number; readonly cell: number },
): LandDressing {
  if (cache === null) throw new Error('洛伊納的地物還沒載入 —— 少了 preloadLeunaFeatures()')
  const f = cache
  const coarse = terrainGrid(field)
  const profiles = motorwayProfiles(f.a9, sample, rivers.index)
  const road = new RiverIndex(
    profiles.map((p) => ({ name: 'A9', points: p.points, level: p.points.map(() => 0), coarse: true })),
    ROAD_KEEP_OUT,
  )
  const inMine = mineTest(f.mines, 0)
  const nearMine = mineTest(f.mines, HOUSE_MINE)
  const inTown = settlementTest(f.places)
  const nearFlak = (x: number, z: number): boolean =>
    FLAK_SITES.some((s) => Math.hypot(s.x - x, s.z - z) < HOUSE_FLAK)
  const onRoad = (x: number, z: number): boolean => road.distance(x, z) < ROAD_KEEP_OUT
  const layout = settlementLayout(
    f.places,
    (x, z) => rivers.index.distance(x, z) < HOUSE_RIVER || onRoad(x, z) || nearMine(x, z) || nearFlak(x, z),
    rightOfSaale(rivers),
  )
  const buildings = layout.flora

  const keepOut = (x: number, z: number): boolean => inTown(x, z) || inMine(x, z) || onRoad(x, z)
  const townNear = settlementNear(f.places)
  const mineNearBox = mineNear(f.mines, 0)
  const keepOutNear: BoxTest = (x0, z0, x1, z1) =>
    townNear(x0, z0, x1, z1) || mineNearBox(x0, z0, x1, z1) || road.mayReach(x0, z0, x1, z1)
  const object = new Group()
  object.name = 'landFeatures'
  const floodplain = createFloodplain(rivers.lines)
  // 【河漫灘最先烘】沿河的鎮、礦坑蓋在它上面
  const baked = [
    floodplain.buildGround(sample, FLOODPLAIN_EXTENT, FLOODPLAIN_GRID),
    buildSettlementGround(sample, f.places),
    buildGreens(sample, layout.greens),
    buildMines(sample, f.mines),
    buildStreets(sample, layout.streets),
  ]
  const beyond = [
    floodplain.buildGround(sample, FLOODPLAIN_EXTENT, coarse, 'floodplainFar'),
    buildSettlementGround(sample, f.places, coarse, 'settlementGroundFar'),
    buildMines(sample, f.mines, coarse, 'minesFar'),
  ]
  for (const m of beyond) m.visible = false
  const meshes: Mesh[] = [...baked, ...beyond]
  for (const m of meshes) object.add(m)
  const motorway = buildMotorway(sample, profiles)
  object.add(motorway)

  return {
    object,
    keepOut,
    keepOutNear,
    fieldsOut: floodplain.inside,
    fieldsOutNear: floodplain.near,
    flora: [excludingWhere(floodplain.flora, keepOut, keepOutNear)],
    buildings,
    capacity: CAPACITY,
    baked,
    beyond,
    dispose() {
      object.traverse((o) => {
        const m = o as Mesh
        if (m.geometry === undefined) return
        m.geometry.dispose()
        ;(m.material as MeshStandardMaterial).dispose()
      })
    },
  }
}
