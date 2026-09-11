import type { BufferGeometry } from 'three'
import { Vector3 } from 'three'
import type { Box } from '../../../world/hit'
import { groundGlb, preloadGroundGlbs } from './glb'
import { buildBoxcar, buildFlatcar, buildLocomotive, buildTender } from './train'
import { PLANT_BUILDERS, PLANT_SIZE, type PlantKind } from './plant'
import { buildBombDump, buildFuelDump, buildSearchlight, DUMP_SIZE } from './dump'
import { bakeParkedAircraft } from './parked'

/**
 * 地面單位的登記表。
 *
 * 兩種來源：**車輛與防空砲**由 `tools/blender/build_ground.py` 對著參考模型
 * 建、匯成 `public/models/*.glb`；**火車**還沒有參考模型，仍是 `train.ts` 的
 * 盒子與圓柱。兩條路的產物相同（一顆不共用頂點、帶頂點色的幾何），呼叫端
 * 用 `groundGeometry` 拿，不必分辨。
 *
 * 【`real*` 是驗收用的】展示區與護欄測試拿它跟包圍盒對照。差超過幾個百分點
 * 就表示某個零件的座標寫錯了 —— 那種錯不會報錯，只會讓單位在地圖上靜靜地比
 * 它該有的尺寸小一截。
 *
 * 【`hull` 是一台一個大盒】遊戲座標（X 橫向、Y 上、−Z 車頭）的 AABB，就是
 * **砲管以外**整台的包圍盒 —— 砲管會轉，盒子不能跟著它。地面目標不需要逐部位
 * 傷害，一個盒就夠。GLB 那四台的數字由 `build_ground.py` 的 `LOG[…]['hitbox']`
 * 吐出，火車從自己的幾何量。`ground-units.test.ts` 守著它們沒有浮空、
 * 蓋住砲管以外的全部頂點。
 */

export type GroundUnitId =
  | 'tank' | 'truck'
  | 'flakHeavy' | 'flakLight'
  | 'locomotive' | 'tender' | 'boxcar' | 'flatcar'
  | PlantKind
  | 'parkedB17' | 'fuelDump' | 'bombDump' | 'searchlight'

/** 幾何的來源：GLB 的路徑，或程式化的建構函數。 */
export type GroundModel =
  | {
    readonly glb: string
    /**
     * 砲管節點的名字前綴。**砲管會轉，所以不在命中盒裡**；之後接旋轉動畫也
     * 靠它認節點。與 `build_ground.py` 的 `BARREL_NODES` 是同一份合約。
     */
    readonly barrelNodes: readonly string[]
  }
  | {
    readonly build: () => BufferGeometry
  }

export interface GroundUnit {
  id: GroundUnitId
  /** 顯示名稱。 */
  name: string
  /** 這個單位在哪一關用得到，以及它是誰的。 */
  note: string
  /** 真車全長，m（含砲管）。展示區拿它跟包圍盒的 Z 幅度對照。 */
  realLength: number
  /** 真車全寬，m。 */
  realWidth: number
  /** 真車全高，m。 */
  realHeight: number
  model: GroundModel
  /**
   * 遠處用的低模。**省略即這一種沒有 LOD**，一律走 `model`。
   *
   * 【`real*` 與 `hull` 一律對著 `model` 量】低模只在遠處出現，而那兩項是
   * 尺寸與命中判定 —— 拿低模去對就會隨著低模的精簡程度漂。
   */
  lodModel?: GroundModel
  /** 命中盒，遊戲座標。 */
  hull: readonly Box[]
}

/** 以兩個角點建盒。與 `world/ships.ts` 的 `box` 同一個形式。 */
export function groundBox(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): Box {
  return {
    center: new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2),
    half: new Vector3((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2),
  }
}

/**
 * 程序化那幾節的盒子直接從自己的幾何量：建一次、取包圍盒、丟掉。
 *
 * 【為什麼不照史實尺寸寫死】機車建出來寬 3.14，史實 3.10 —— 差 4 cm 就有
 * 頂點在盒外。盒子跟幾何是同一個來源才不會這樣漂掉，GLB 那四台的數字也是
 * 從 Blender 量的。載入期跑一次，不在熱路徑上。
 */
function boxOf(build: () => BufferGeometry): Box {
  const g = build()
  const pos = g.getAttribute('position')
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.count; i++) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)]
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[k]!)
      hi[k] = Math.max(hi[k]!, p[k]!)
    }
  }
  g.dispose()
  return groundBox([lo[0]!, lo[1]!, lo[2]!], [hi[0]!, hi[1]!, hi[2]!])
}

export const GROUND_UNITS: readonly GroundUnit[] = [
  {
    id: 'tank',
    name: 'T-34-76',
    note: '蘇軍戰車 — 德 M3 奧博揚公路',
    realLength: 6.68, realWidth: 3.00, realHeight: 2.60,
    model: { glb: '/models/t34.glb', barrelNodes: ['T34_Gun'] },
    hull: [groundBox([-1.50, 0.00, -2.61], [1.50, 2.63, 3.54])],
  },
  {
    id: 'truck',
    name: 'ZIS-150 卡車',
    note: '蘇軍 4 噸卡車 — 德 M3 奧博揚公路',
    realLength: 6.72, realWidth: 2.385, realHeight: 2.70,
    model: { glb: '/models/zis150.glb', barrelNodes: [] },
    hull: [groundBox([-1.21, 0.00, -3.40], [1.21, 2.70, 3.32])],
  },
  {
    id: 'flakHeavy',
    name: '8.8 cm Flak 18',
    note: '重型防空砲 — 盟 M2、德 M2、日 M4',
    // 長 Z 是十字砲座後臂（2.63）加水平砲管到砲口（3.85）
    realLength: 6.48, realWidth: 5.26, realHeight: 2.50,
    model: { glb: '/models/flak18.glb', barrelNodes: ['F18_Barrel'] },
    hull: [groundBox([-2.63, 0.00, -2.63], [2.63, 2.50, 2.63])],
  },
  {
    id: 'flakLight',
    name: '2 cm Flakvierling 38',
    note: '輕型四聯防空砲 — 德 M2',
    realLength: 2.41, realWidth: 1.91, realHeight: 1.92,
    model: { glb: '/models/flak38.glb', barrelNodes: ['F38_Barrel_'] },
    hull: [groundBox([-0.95, 0.00, -0.76], [0.95, 1.59, 1.06])],
  },
  {
    id: 'locomotive',
    name: 'BR 52 機車',
    note: '蒸汽機車 — 盟 M3 諾曼第斷軌',
    realLength: 13.00, realWidth: 3.10, realHeight: 4.45,
    model: { build: buildLocomotive },
    hull: [boxOf(buildLocomotive)],
  },
  {
    id: 'tender',
    name: '煤水車',
    note: '接在機車後面 — 盟 M3',
    realLength: 8.60, realWidth: 2.92, realHeight: 3.35,
    model: { build: buildTender },
    hull: [boxOf(buildTender)],
  },
  {
    id: 'boxcar',
    name: '棚車',
    note: '有蓋貨車 — 盟 M3',
    realLength: 9.10, realWidth: 2.92, realHeight: 3.70,
    model: { build: buildBoxcar },
    hull: [boxOf(buildBoxcar)],
  },
  {
    id: 'flatcar',
    name: '平板車',
    note: '載台，可放防空砲 — 盟 M3',
    realLength: 10.30, realWidth: 2.92, realHeight: 1.72,
    model: { build: buildFlatcar },
    hull: [boxOf(buildFlatcar)],
  },
  // 油廠的六種構件。**命中盒由 `PLANT_SIZE` 撐起來，不從幾何量** —— 幾何
  // 與盒子對著同一份數字，護欄兩邊比；從幾何量的話「幾何在盒內」恆真
  plant('hydroTower', '氫化塔', '高壓氫化反應塔，成排 — 盟 M2 梅澤堡的油廠'),
  plant('chimney', '煙囪', '鍋爐房的煙囪，廠區最高 — 盟 M2'),
  plant('boilerHouse', '鍋爐房', '大方盒、人字頂 — 盟 M2'),
  plant('oilTank', '儲油槽', '成品油槽，成群 — 盟 M2'),
  plant('gasHolder', '氣櫃', '煤氣櫃，大圓桶 — 盟 M2'),
  plant('coolingTower', '冷卻塔', '截錐 — 盟 M2'),
  // 波爾塔瓦機場的四種
  {
    id: 'parkedB17',
    name: '停放的 B-17G',
    note: '停在停機坪上的轟炸機 — 德 M2',
    // 【高是停放的高，不是史實的 5.82】GLB 沒有起落架，機尾下沉 10° 之後
    // 量出來是 5.41；`ground-units.test.ts` 對 `real*` 的容差是 5%
    realLength: 22.44, realWidth: 31.62, realHeight: 5.41,
    // 【命中盒是手寫的】`boxOf` 在模組載入時就要幾何，而樣板那時還沒載。
    // 數字是烘好的幾何量的（x ±15.81、y 0…5.41、z ±11.22），各留不到 5 cm ——
    // `ground-units.test.ts` 兩邊都守：蓋住全部頂點、又不伸出包圍盒 5 cm
    /**
     * **遠處用低模。** 機場上停 24 架，正式模型一架 13,251 個三角形 —— 實測
     * 那一批在投彈高度值 1.90 ms（一幀 16 ms 的 12%）、佔全場三角形的 61%，
     * 而一架在畫面上只有 25 x 15 px（每個像素 35 個三角形）。低模一架 2,200
     * 個三角形，24 架由 318,024 降到 52,800。
     *
     * 【畫面沒有變】`check_lod_silhouette.py` 在 25 px（就是投彈高度上的實際
     * 大小）拍六個方位逐像素比對，428 個覆蓋像素裡**差 4 個**；放大到 256 px
     * 才出現 1.56%。低模由 `tools/blender/build_b17g_lod.py` 從出貨的 GLB
     * **逐件**重建 —— 趴在機身上的（機背甲板、三座砲塔、觀測罩、尾艙罩）各自
     * 一件，15 片平面窗原封不動搬過來。
     *
     * 【剩下的成本不是幾何】換上低模之後這 24 架**仍然值 1 ms 以上**（幾輪
     * 落在 1.2…1.8 ms，而基準自己就漂 4…6%，別把那個區間當成一個數字），
     * 而它們只剩全場 8% 的三角形。那是 24 個 draw call 與填充率 —— 再減面
     * 拿不到東西，下一步是把 24 架併成一批。
     *
     * 【近了就換回正式模型】上帝視角飛得到停機坪旁邊，門檻與飛行中那批
     * 共用（`buildAircraft.ts` 的 `AIRCRAFT_LOD_DIST`）。
     *
     * 【`__PARKED_LOD = false` 整場一律正式模型】進場前在主控台設，拿來做
     * A/B。飛行中那批的對應開關是 `__FLYING_LOD`，切到哪裡看 `__lod()`。
     */
    model: { build: () => bakeParkedAircraft('b17g') },
    lodModel: { build: () => bakeParkedAircraft('b17g_lod2') },
    hull: [groundBox([-15.85, 0.00, -11.25], [15.85, 5.45, 11.25])],
  },
  {
    id: 'fuelDump',
    name: '油桶堆',
    note: '露天堆放的航空汽油桶 — 德 M2',
    realLength: DUMP_SIZE.fuelDump.z, realWidth: DUMP_SIZE.fuelDump.x, realHeight: DUMP_SIZE.fuelDump.y,
    model: { build: buildFuelDump },
    hull: [boxOf(buildFuelDump)],
  },
  {
    id: 'bombDump',
    name: '彈藥堆',
    note: '露天堆放的炸彈 — 德 M2',
    realLength: DUMP_SIZE.bombDump.z, realWidth: DUMP_SIZE.bombDump.x, realHeight: DUMP_SIZE.bombDump.y,
    model: { build: buildBombDump },
    hull: [boxOf(buildBombDump)],
  },
  {
    id: 'searchlight',
    name: '探照燈',
    note: '防空探照燈 — 德 M2。光束由渲染層畫',
    realLength: DUMP_SIZE.searchlight.z, realWidth: DUMP_SIZE.searchlight.x, realHeight: DUMP_SIZE.searchlight.y,
    model: { build: buildSearchlight },
    hull: [boxOf(buildSearchlight)],
  },
]

function plant(id: PlantKind, name: string, note: string): GroundUnit {
  const { x, y, z } = PLANT_SIZE[id]
  return {
    id, name, note,
    realLength: z, realWidth: x, realHeight: y,
    model: { build: PLANT_BUILDERS[id] },
    hull: [groundBox([-x / 2, 0, -z / 2], [x / 2, y, z / 2])],
  }
}

/** 接成一列時的車序。展示區照它把火車串起來。 */
export const TRAIN_CONSIST: readonly GroundUnitId[] = [
  'locomotive', 'tender', 'boxcar', 'boxcar', 'flatcar',
]

/** 開場 await 一次，之後 `groundGeometry` 是同步的。node 測試傳自己的 fetcher。 */
export async function preloadGroundModels(
  fetcher?: (url: string) => Promise<ArrayBuffer>,
): Promise<void> {
  const urls: string[] = []
  for (const u of GROUND_UNITS) {
    if ('glb' in u.model) urls.push(u.model.glb)
  }
  await preloadGroundGlbs(urls, fetcher)
}

/**
 * 這台的幾何。GLB 那幾台回快取裡**共用的那一份**（沒預載會丟）；程序化的
 * 每次呼叫建一份新的。兩種都不要拿去改。
 */
export function groundGeometry(unit: GroundUnit): BufferGeometry {
  return 'glb' in unit.model ? groundGlb(unit.model.glb) : unit.model.build()
}

/**
 * 這台遠處用的幾何。沒有低模就回 `null`。
 *
 * 【`__PARKED_LOD = false` 一律回 null】那一場就完全不會有低模，A/B 才乾淨。
 */
export function groundLodGeometry(unit: GroundUnit): BufferGeometry | null {
  const m = unit.lodModel
  if (m === undefined) return null
  if ((globalThis as Record<string, unknown>)['__PARKED_LOD'] === false) return null
  return 'glb' in m ? groundGlb(m.glb) : m.build()
}
