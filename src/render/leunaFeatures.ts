import { Group, type Mesh, type MeshStandardMaterial } from 'three'
import { assetUrl } from '../core/asset'
import type { FloraSource } from './flora'
import type { PoolName } from './vegetation'
import type { RiverSet } from './river'
import { buildSettlementGround, settlementFlora, settlementTest } from './settlements'
import { buildMines, mineTest } from './mines'
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
  /** 村鎮的建築。已經避開河道、高速公路、礦坑與砲位 */
  readonly buildings: FloraSource
  /** 植被池的容量覆寫 —— 真實的鎮一個就上千棟房子 */
  readonly capacity: Partial<Record<PoolName, number>>
  dispose(): void
}

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
 * - 建築：鏡頭每隔 1 km 掃過整張圖，植被圈內（6 km）最多是房 5,518、石板瓦房
 *   1,573、穀倉 1,357、油毛氈穀倉 338、教堂 33（`leuna-features.test.ts` 守著），
 *   各留約七八成的餘裕。
 * - 近級的樹：村鎮的果樹、教堂墓園的樹加上樹籬與樹林，植被引擎實跑的峰值是
 *   闊葉近級 2,389、針葉近級 1,164 —— 預設的 2,800、1,300 不到 1.35 倍（別張圖的
 *   門檻），這裡加大。其餘各級的預設都還有 1.35 倍以上。
 *
 * 溢位時丟掉並記一次告警，症狀是半個鎮沒有房子、近處的樹整片消失。
 *
 * 【單格的上限不必動】建築、果樹加上格子裡剩下的樹籬與樹林，整張圖最密的一格
 * 是 353 株，在 `MAX_PER_TILE`（384）以內。
 */
const CAPACITY: Partial<Record<PoolName, number>> = {
  house: 9500, houseSlate: 2800, barn: 2400, barnTar: 600, church: 60,
  broadNear: 3300, coneNear: 1600,
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

export function buildLeunaDressing(sample: HeightSampler, rivers: RiverSet): LandDressing {
  if (cache === null) throw new Error('洛伊納的地物還沒載入 —— 少了 preloadLeunaFeatures()')
  const f = cache
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
  const buildings = settlementFlora(
    f.places,
    (x, z) => rivers.index.distance(x, z) < HOUSE_RIVER || onRoad(x, z) || nearMine(x, z) || nearFlak(x, z),
    rightOfSaale(rivers),
  )

  const object = new Group()
  object.name = 'landFeatures'
  const meshes: Mesh[] = [
    buildSettlementGround(sample, f.places),
    buildMines(sample, f.mines),
  ]
  for (const m of meshes) object.add(m)
  const motorway = buildMotorway(sample, profiles)
  object.add(motorway)

  return {
    object,
    keepOut: (x, z) => inTown(x, z) || inMine(x, z) || onRoad(x, z),
    buildings,
    capacity: CAPACITY,
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
