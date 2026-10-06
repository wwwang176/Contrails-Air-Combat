import { P51D, P51D_HISTORICAL } from './p51d'
import { F6F5, F6F5_HISTORICAL } from './f6f5'
import { F4F4, F4F4_HISTORICAL } from './f4f4'
import { BF109K4, BF109K4_HISTORICAL } from './bf109k4'
import { KI84, KI84_HISTORICAL } from './ki84'
import { A6M5, A6M5_HISTORICAL } from './a6m5'
import { G4M, G4M_HISTORICAL } from './g4m'
import { B17G, B17G_HISTORICAL } from './b17g'
import { HE111, HE111_HISTORICAL } from './he111'
import { JU87, JU87_HISTORICAL } from './ju87'
import type { AircraftSpec, HistoricalReference } from './types'

/**
 * **遭遇戰可以編進名單的全部機種。順序即卡片順序。**
 *
 * 【為什麼不分陣營】混搭上線之後「陣營」不再是一個選擇 —— 兩隊各自的
 * 清單就是全部的設定。任務模式也不分了：**每一張卡直接指名雙方飛什麼**
 * （`missions.ts` 的 `MissionBattle`）。
 *
 * 【順序】戰鬥機在前、轟炸機在後。選單照它畫卡片。
 */
export const ALL_SPECS: readonly AircraftSpec[] = [P51D, BF109K4, F6F5, F4F4, KI84, A6M5, B17G, HE111, JU87, G4M]

/**
 * 機種代號 → 史實參考。編組頁顯示極速用。
 *
 * 【為什麼不從 `AircraftSpec` 讀】極速不在 spec 上 —— 它在各機種檔另外匯出的
 * `HistoricalReference`（spec 是模擬用的係數，極速是量測結果，兩者刻意分開）。
 * 這張表的完整性由測試守：`ALL_SPECS` 每個 id 都要在表上。
 */
export const HISTORICAL: Record<string, HistoricalReference> = {
  p51d: P51D_HISTORICAL, bf109k4: BF109K4_HISTORICAL, f6f5: F6F5_HISTORICAL, f4f4: F4F4_HISTORICAL,
  ki84: KI84_HISTORICAL, a6m5: A6M5_HISTORICAL,
  b17g: B17G_HISTORICAL, he111: HE111_HISTORICAL, ju87: JU87_HISTORICAL, g4m: G4M_HISTORICAL,
}

/** 史實極速，km/h，四捨五入。找不到回 0 —— 顯示層印 0 比印 NaN 好認 */
export function topSpeedKmh(id: string): number {
  const h = HISTORICAL[id]
  return h === undefined ? 0 : Math.round(h.vmaxAtCritical.speed * 3.6)
}

/**
 * 機種代號 → 機種。**找不到落回第一台**（`ALL_SPECS[0]`）。
 *
 * 【為什麼要有落回】名單從 DOM 來，而一個打錯的代號若一路傳到生成迴圈，
 * 症狀是「開始戰鬥之後那一架不見了」而不是任何錯誤。
 */
export function specOf(id: string): AircraftSpec {
  return ALL_SPECS.find((s) => s.id === id) ?? ALL_SPECS[0]!
}
