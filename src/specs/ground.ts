import { Vector3 } from 'three'
import type { Box } from '../world/hit'
import { DEG } from '../core/math'

/** 停放尾輪機的機尾下沉角；命中盒姿態與模型烘焙共用。 */
export const PARKED_TAIL_DOWN = 10 * DEG

/** 油廠構件的腳印與高度，m；命中盒與程序化幾何共用。 */
export const PLANT_SIZE = {
  hydroTower: { x: 8, y: 40, z: 8 },
  chimney: { x: 8, y: 100, z: 8 },
  boilerHouse: { x: 60, y: 18, z: 30 },
  oilTank: { x: 25, y: 12, z: 25 },
  gasHolder: { x: 40, y: 35, z: 40 },
  coolingTower: { x: 30, y: 40, z: 30 },
} as const

export type PlantKind = keyof typeof PLANT_SIZE

export type GroundUnitId =
  | 'tank' | 'tankDug' | 'truck' | 'atGun'
  | 'panzer4' | 'tiger' | 'infantry' | 'mortar'
  | 'flakHeavy' | 'flakLight'
  | 'usTank' | 'usTruck' | 'usFlakTrack'
  | 'locomotive' | 'tender' | 'boxcar' | 'flatcar'
  | PlantKind
  | 'parkedB17' | 'fuelDump' | 'bombDump' | 'searchlight'
  | 'parkedP51'

/** 地面單位的共用規格；模型來源與建構函式由渲染層登記。 */
export interface GroundUnit {
  id: GroundUnitId
  /** 開發工具展示的用途說明。 */
  note: string
  /** 全長（含砲管）、全寬與全高，m；供模型尺寸驗證。 */
  realLength: number
  realWidth: number
  realHeight: number
  /** 人員死亡只退場，不爆炸或起火。 */
  personnel?: true
  /** X 橫向、Y 上、−Z 車頭；不含可旋轉的砲管。 */
  hull: readonly Box[]
}

function groundBox(min: readonly [number, number, number], max: readonly [number, number, number]): Box {
  return {
    center: new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2),
    half: new Vector3((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2),
  }
}

/**
 * 程序化模型的實測命中盒，保留 Float32 頂點量出的完整精度。
 * 模擬不需建立幾何；ground-units.test.ts 驗證它與出貨模型的邊界一致。
 */
function measuredBox(center: readonly [number, number, number], half: readonly [number, number, number]): Box {
  return { center: new Vector3(...center), half: new Vector3(...half) }
}

export const GROUND_UNITS: readonly GroundUnit[] = [
  {
    id: 'tank', note: '蘇軍戰車 — 德 M4 勒熱夫突擊的縱隊',
    realLength: 6.68, realWidth: 3.00, realHeight: 2.60,
    hull: [groundBox([-1.50, 0.00, -2.61], [1.50, 2.63, 3.54])],
  },
  {
    // 劇本殘骸與突擊縱隊分開計數，也有不同的 AI 目標價值。
    id: 'tankDug', note: '蘇軍戰車（殘骸與劇本打掉的）— 德 M4 勒熱夫',
    realLength: 6.68, realWidth: 3.00, realHeight: 2.60,
    hull: [groundBox([-1.50, 0.00, -2.61], [1.50, 2.63, 3.54])],
  },
  {
    id: 'atGun', note: '反坦克砲 — 德 M4 勒熱夫：蘇軍支援砲（第一段的目標）與德軍的反坦克砲共用（暫代：Flak 38）',
    realLength: 2.41, realWidth: 1.91, realHeight: 1.92,
    hull: [groundBox([-0.95, 0.00, -0.76], [0.95, 1.59, 1.06])],
  },
  {
    id: 'panzer4', note: '德軍 IV 號戰車 — 德 M4 勒熱夫（暫代：M4A3）',
    realLength: 5.84, realWidth: 2.62, realHeight: 2.58,
    hull: [groundBox([-1.30, 0.00, -2.92], [1.30, 2.58, 2.88])],
  },
  {
    id: 'tiger', note: '德軍虎式戰車 — 目前沒有任務使用（暫代：M4A3）',
    realLength: 5.84, realWidth: 2.62, realHeight: 2.58,
    hull: [groundBox([-1.30, 0.00, -2.92], [1.30, 2.58, 2.88])],
  },
  {
    id: 'infantry', note: '步兵一個班（五根圓柱）— 德 M4 勒熱夫，兩邊都有',
    realLength: 2.4, realWidth: 6.4, realHeight: 1.4, personnel: true,
    hull: [measuredBox([0, 0.6999999940395356, -0.19999998807907104], [3.1732051372528076, 0.6999999821186065, 1.199999988079071])],
  },
  {
    id: 'mortar', note: '迫擊砲（暫代：立方體）— 德 M4 勒熱夫，兩邊都有',
    realLength: 1.4, realWidth: 1.4, realHeight: 1.2, personnel: true,
    hull: [measuredBox([0, 0.6000000119209288, 0], [0.699999988079071, 0.600000035762787, 0.699999988079071])],
  },
  {
    id: 'truck', note: '蘇軍 4 噸卡車 — 德 M4 勒熱夫的德軍後勤也借用它（暫代）',
    realLength: 6.72, realWidth: 2.385, realHeight: 2.70,
    hull: [groundBox([-1.21, 0.00, -3.40], [1.21, 2.70, 3.32])],
  },
  {
    id: 'flakHeavy', note: '重型防空砲 — 盟 M2、德 M2、日 M3',
    realLength: 6.48, realWidth: 5.26, realHeight: 2.50,
    hull: [groundBox([-2.63, 0.00, -2.63], [2.63, 2.50, 2.63])],
  },
  {
    id: 'flakLight', note: '輕型四聯防空砲 — 德 M2',
    realLength: 2.41, realWidth: 1.91, realHeight: 1.92,
    hull: [groundBox([-0.95, 0.00, -0.76], [0.95, 1.59, 1.06])],
  },
  {
    id: 'usTank', note: '美軍戰車 — 日 M2 雷伊泰車隊',
    realLength: 5.84, realWidth: 2.62, realHeight: 2.58,
    hull: [groundBox([-1.30, 0.00, -2.92], [1.30, 2.58, 2.88])],
  },
  {
    id: 'usTruck', note: '美軍兩噸半卡車 — 日 M2 雷伊泰車隊',
    realLength: 6.93, realWidth: 2.24, realHeight: 2.79,
    hull: [groundBox([-1.10, 0.00, -3.52], [1.10, 2.86, 3.29])],
  },
  {
    id: 'usFlakTrack', note: '美軍四聯 .50 防空半履帶車 — 日 M2 雷伊泰車隊與灘頭',
    realLength: 6.51, realWidth: 2.16, realHeight: 2.95,
    hull: [groundBox([-1.05, 0.00, -3.43], [1.05, 2.61, 2.90])],
  },
  {
    id: 'locomotive', note: '蒸汽機車 — 盟 M3 諾曼第斷軌',
    realLength: 13.00, realWidth: 3.10, realHeight: 4.45,
    hull: [measuredBox([0, 2.2310123052448034, 0], [1.5700000524520874, 2.2089877519756556, 6.5])],
  },
  {
    id: 'tender', note: '接在機車後面 — 盟 M3',
    realLength: 8.60, realWidth: 2.92, realHeight: 3.35,
    hull: [measuredBox([0, 1.683190569281578, 0], [1.4299999475479126, 1.6587188392877579, 4.300000190734863])],
  },
  {
    id: 'boxcar', note: '有蓋貨車 — 盟 M3',
    realLength: 9.10, realWidth: 2.92, realHeight: 3.70,
    hull: [measuredBox([0, 1.8617464657872915, 0], [1.4600000381469727, 1.8382535818964243, 4.550000190734863])],
  },
  {
    id: 'flatcar', note: '載台，可放防空砲 — 盟 M3',
    realLength: 10.30, realWidth: 2.92, realHeight: 1.72,
    hull: [measuredBox([0, 0.8717464562505484, 0], [1.4600000381469727, 0.8482535723596811, 5.150000095367432])],
  },
  plant('hydroTower', { note: '高壓氫化反應塔，成排 — 盟 M2 梅澤堡的油廠' }),
  plant('chimney', { note: '鍋爐房的煙囪，廠區最高 — 盟 M2' }),
  plant('boilerHouse', { note: '大方盒、人字頂 — 盟 M2' }),
  plant('oilTank', { note: '成品油槽，成群 — 盟 M2' }),
  plant('gasHolder', { note: '煤氣櫃，大圓桶 — 盟 M2' }),
  plant('coolingTower', { note: '截錐 — 盟 M2' }),
  {
    // 停放高度不含起落架，命中盒各邊對烘好的模型保留不到 5 cm。
    id: 'parkedB17', note: '停在停機坪上的轟炸機 — 德 M2',
    realLength: 22.44, realWidth: 31.62, realHeight: 5.41,
    hull: [groundBox([-15.85, 0.00, -11.25], [15.85, 5.45, 11.25])],
  },
  {
    id: 'fuelDump', note: '露天堆放的航空汽油桶 — 德 M2',
    realLength: 18.1, realWidth: 28.1, realHeight: 1.8,
    hull: [measuredBox([0, 0.8999999821186067, 0], [14.050000190734863, 0.8999999701976775, 9.050000190734863])],
  },
  {
    id: 'bombDump', note: '露天堆放的炸彈 — 德 M2',
    realLength: 9.6, realWidth: 20.400000000000002, realHeight: 0.8,
    hull: [measuredBox([0, 0.4000000052154064, 0], [10.199999809265137, 0.40000000670552255, 4.800000190734863])],
  },
  {
    id: 'searchlight', note: '防空探照燈 — 德 M2。光束由渲染層畫',
    realLength: 3, realWidth: 3, realHeight: 2,
    hull: [measuredBox([0, 1, 0], [1.5, 1, 1.5])],
  },
  {
    id: 'parkedP51', note: '停在停機墊上的戰鬥機 — 德 M3 Y-29',
    realLength: 9.79, realWidth: 11.28, realHeight: 3.50,
    hull: [groundBox([-5.66, 0.00, -4.92], [5.66, 3.52, 4.92])],
  },
]

function plant(id: PlantKind, info: { readonly note: string }): GroundUnit {
  const { x, y, z } = PLANT_SIZE[id]
  return {
    id, note: info.note, realLength: z, realWidth: x, realHeight: y,
    hull: [groundBox([-x / 2, 0, -z / 2], [x / 2, y, z / 2])],
  }
}

/** 展示列車的車序。 */
export const TRAIN_CONSIST: readonly GroundUnitId[] = [
  'locomotive', 'tender', 'boxcar', 'boxcar', 'flatcar',
]
