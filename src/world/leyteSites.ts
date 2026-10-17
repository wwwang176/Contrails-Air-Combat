/**
 * 高度場在 (0, EVACUATE_Z) 周圍留一塊不長山的平地（`world/leyte.ts` 的
 * `EVAC_CLEAR`）。離前線約兩公里、離灘頭約七公里。
 * **改它會改到整片山脈的擺位。**
 */
export const EVACUATE_Z = 2500

/**
 * 灘頭與前線的固定防空砲位，世界座標。**不動、會開火**，照陸上砲位的規格
 * （`world/shipGuns.ts`）。全部在平地上、離公路中線至少 40 m（`leyte.test.ts`）。
 *
 * 【灘頭重、前線輕】灘頭是卸貨點，六座重高砲（美軍的 90 mm，雷達射控）加四輛
 * 停著的 M16 防空半履帶車；前線兩輛 M16。重高砲的射控在任務卡上複寫
 * （`MissionBattle.flakSpec`）。**座數與位置是起始值，由試飛裁定。**
 *
 * 【加砲位會不會改到地形與佈景】山脈離公路至少 400 m（`world/leyte.ts` 的
 * `ROAD_CLEAR`），砲位讓山 200 m（`FLAK_CLEAR`）：新砲位離公路中線 200 m 內就不會
 * 讓任何一座山讓位，更遠的可能會。灘頭的砲位也要離已經擺好的佈景（木箱堆、停著
 * 的車）夠遠，否則佈景會重新擺過（`leyteBeach.ts` 的 `beachClear`）。
 */
export const LEYTE_FLAK_SITES: readonly {
  readonly unit: 'usFlakTrack' | 'usFlakHeavy'; readonly x: number; readonly z: number
}[] = [
  { unit: 'usFlakTrack', x: 2753, z: -3031 },
  { unit: 'usFlakTrack', x: 2500, z: -3250 },
  { unit: 'usFlakTrack', x: 3100, z: -3440 },
  { unit: 'usFlakTrack', x: 2400, z: -3190 },
  { unit: 'usFlakHeavy', x: 2519, z: -2706 },
  { unit: 'usFlakHeavy', x: 2900, z: -2900 },
  { unit: 'usFlakHeavy', x: 2300, z: -2900 },
  { unit: 'usFlakHeavy', x: 2340, z: -3090 },
  { unit: 'usFlakHeavy', x: 3080, z: -3280 },
  { unit: 'usFlakHeavy', x: 2530, z: -2540 },
  { unit: 'usFlakTrack', x: -1228, z: 1169 },
  { unit: 'usFlakTrack', x: -1346, z: 1033 },
]
