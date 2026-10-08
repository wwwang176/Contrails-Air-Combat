import type { BufferGeometry } from 'three'
import { GROUND_UNITS, type GroundUnit, type GroundUnitId } from '../../../specs/ground'
import { groundGlb, preloadGroundGlbs, type GroundGlbSource } from './glb'
import type { GroundTurretNodes } from './turret'
import { buildBoxcar, buildFlatcar, buildLocomotive, buildTender } from './train'
import { PLANT_BUILDERS } from './plant'
import { buildBombDump, buildFuelDump, buildSearchlight } from './dump'
import { bakeParkedAircraft } from './parked'
import { buildInfantrySquad } from './infantry'
import { buildMortar } from './mortar'

/**
 * 地面單位的幾何來源：GLB 的路徑，或程式化的建構函數。兩條路的產物相同（一顆
 * 不共用頂點、帶頂點色的幾何），呼叫端用 `groundGeometry` 拿，不必分辨。
 *
 * GLB 共用快取幾何；程序化模型每次建構回傳可獨立釋放的幾何。
 */
export type GroundModel =
  | {
    readonly glb: string
    /** 可轉動的砲管節點不納入命中盒，名稱須與 GLB 的節點名一致。 */
    readonly barrelNodes: readonly string[]
    /**
     * 會轉的砲塔：兩個轉軸節點的名字。有登記的，載入時拆成固定／水平轉／上下抬三塊
     * （`GUN_TURRET_KEY`），畫面照瞄準方向轉。**同一支 GLB 的每一筆登記要相同**
     */
    readonly turret?: GroundTurretNodes
  }
  | { readonly build: () => BufferGeometry }

export interface GroundModelSet {
  readonly model: GroundModel
  /**
   * 遠處用的低模。**省略即這一種沒有 LOD**，一律走 `model`。
   *
   * 【`real*` 與 `hull` 一律對著 `model` 量】低模只在遠處出現，而那兩項是
   * 尺寸與命中判定 —— 拿低模去對就會隨著低模的精簡程度漂。
   */
  readonly lodModel?: GroundModel
}

/** 共用同一支 GLB 的單位用同一份節點名 —— 預載時會檢查一致 */
const T34_TURRET: GroundTurretNodes = { traverse: 'T34_Traverse', elevate: 'T34_Elevate' }
const F38_TURRET: GroundTurretNodes = { traverse: 'F38_Traverse', elevate: 'F38_Elevate' }

/** 新增單位時，型別檢查要求同時提供模型；物理規格不依賴此表。 */
export const GROUND_MODELS: Readonly<Record<GroundUnitId, GroundModelSet>> = {
  tank: { model: { glb: '/models/t34.glb', barrelNodes: ['T34_Gun'], turret: T34_TURRET } },
  tankDug: { model: { glb: '/models/t34.glb', barrelNodes: ['T34_Gun'], turret: T34_TURRET } },
  atGun: { model: { glb: '/models/flak38.glb', barrelNodes: ['F38_Barrel_'], turret: F38_TURRET } },
  panzer4: { model: { glb: '/models/m4a3.glb', barrelNodes: ['M4_Gun'] } },
  tiger: { model: { glb: '/models/m4a3.glb', barrelNodes: ['M4_Gun'] } },
  infantry: { model: { build: buildInfantrySquad } },
  mortar: { model: { build: buildMortar } },
  truck: { model: { glb: '/models/zis150.glb', barrelNodes: [] } },
  flakHeavy: {
    model: { glb: '/models/flak18.glb', barrelNodes: ['F18_Barrel'], turret: { traverse: 'F18_Traverse', elevate: 'F18_Elevate' } },
  },
  flakLight: { model: { glb: '/models/flak38.glb', barrelNodes: ['F38_Barrel_'], turret: F38_TURRET } },
  usTank: { model: { glb: '/models/m4a3.glb', barrelNodes: ['M4_Gun'] } },
  usTruck: { model: { glb: '/models/cckw.glb', barrelNodes: [] } },
  usFlakTrack: {
    model: { glb: '/models/m16.glb', barrelNodes: ['M16_Barrel_'], turret: { traverse: 'M16_Traverse', elevate: 'M16_Elevate' } },
  },
  usFlakHeavy: {
    model: { glb: '/models/m1_90mm.glb', barrelNodes: ['M1_Barrel_'], turret: { traverse: 'M1_Traverse', elevate: 'M1_Elevate' } },
  },
  locomotive: { model: { build: buildLocomotive } },
  tender: { model: { build: buildTender } },
  boxcar: { model: { build: buildBoxcar } },
  flatcar: { model: { build: buildFlatcar } },
  hydroTower: { model: { build: PLANT_BUILDERS.hydroTower } },
  chimney: { model: { build: PLANT_BUILDERS.chimney } },
  boilerHouse: { model: { build: PLANT_BUILDERS.boilerHouse } },
  oilTank: { model: { build: PLANT_BUILDERS.oilTank } },
  gasHolder: { model: { build: PLANT_BUILDERS.gasHolder } },
  coolingTower: { model: { build: PLANT_BUILDERS.coolingTower } },
  // 遠處減少停機坪的三角形數，近處仍用正式模型；距離門檻與飛行模型共用。
  parkedB17: {
    model: { build: () => bakeParkedAircraft('b17g') },
    lodModel: { build: () => bakeParkedAircraft('b17g_lod2') },
  },
  fuelDump: { model: { build: buildFuelDump } },
  bombDump: { model: { build: buildBombDump } },
  searchlight: { model: { build: buildSearchlight } },
  // 槳葉獨立，停機線暖機時可慢轉。
  parkedP51: { model: { build: () => bakeParkedAircraft('p51d', true) } },
}

/** 預載 GLB 依單位登記順序去重，保持載入順序與進度回報。 */
export function groundModelUrls(): string[] {
  const urls = new Set<string>()
  for (const u of GROUND_UNITS) {
    const { model } = GROUND_MODELS[u.id]
    if ('glb' in model) urls.add(model.glb)
  }
  return [...urls]
}

/** 開場 await 一次；每載好一支 GLB 回報一次，之後同步取用幾何。 */
export async function preloadGroundModels(
  fetcher?: (url: string) => Promise<ArrayBuffer>,
  onLoaded?: () => void,
): Promise<void> {
  const sources: GroundGlbSource[] = []
  for (const u of GROUND_UNITS) {
    const { model } = GROUND_MODELS[u.id]
    if ('glb' in model) sources.push(model.turret === undefined ? { url: model.glb } : { url: model.glb, turret: model.turret })
  }
  await preloadGroundGlbs(sources, fetcher, onLoaded)
}

/** GLB 回共用幾何，程序化模型回新幾何；呼叫端不可改動共用幾何。 */
export function groundGeometry(unit: GroundUnit): BufferGeometry {
  const { model } = GROUND_MODELS[unit.id]
  return 'glb' in model ? groundGlb(model.glb) : model.build()
}

/** 無低模或全域停放 LOD 開關關閉時回 null。 */
export function groundLodGeometry(unit: GroundUnit): BufferGeometry | null {
  const m = GROUND_MODELS[unit.id].lodModel
  if (m === undefined) return null
  if ((globalThis as Record<string, unknown>)['__PARKED_LOD'] === false) return null
  return 'glb' in m ? groundGlb(m.glb) : m.build()
}
