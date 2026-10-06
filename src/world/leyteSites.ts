/**
 * 撤離點的世界 z（x = 0）。Ki-84 從這一側進場，也從這一側撤離。
 * 離車隊區約九到十公里。**起始值，由試飛裁定。**
 */
export const EVACUATE_Z = 9000

/**
 * 灘頭與前線的固定防空砲位，世界座標。**不動、會開火**，照陸上砲位的規格
 * （`world/shipGuns.ts`）。全部在平地上、離公路中線至少 40 m（`leyte.test.ts`）。
 *
 * 【灘頭重、前線輕】灘頭是卸貨點，三座重高砲（美軍的 90 mm，雷達射控）加兩輛
 * 停著的 M16 防空半履帶車；前線兩輛 M16。重高砲的射控在任務卡上複寫
 * （`MissionBattle.flakSpec`）。**座數與位置是起始值，由試飛裁定。**
 *
 * 【重高砲仍是 Flak 18 的模型】美軍 90 mm 還沒有模型；打起來照任務卡的規格。
 */
export const LEYTE_FLAK_SITES: readonly {
  readonly unit: 'usFlakTrack' | 'flakHeavy'; readonly x: number; readonly z: number
}[] = [
  { unit: 'usFlakTrack', x: 2753, z: -3031 },
  { unit: 'usFlakTrack', x: 2500, z: -3250 },
  { unit: 'flakHeavy', x: 2519, z: -2706 },
  { unit: 'flakHeavy', x: 2900, z: -2900 },
  { unit: 'flakHeavy', x: 2300, z: -2900 },
  { unit: 'usFlakTrack', x: -1228, z: 1169 },
  { unit: 'usFlakTrack', x: -1346, z: 1033 },
]
