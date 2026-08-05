import type { AircraftSpec } from './types'

/**
 * 手感係數：把「史實的飛機」與「玩起來的飛機」分成兩層。
 *
 * 【為什麼需要這一層】`src/specs/*.ts` 的每一個數字都對應真飛機，而
 * `test/performance/historical.test.ts` 的整層 L2 斷言（極速／失速／升限
 * ±5%、海平面爬升率 [−15%, −12%]）就是靠這個前提才有意義。直接去改 spec
 * 換手感，等於讓那層測試從此變成「符合我們亂調的數字」——它會照樣是綠的，
 * 卻不再守著任何東西。
 *
 * 所以手感調整走這裡：**史實值原封不動，遊戲執行時套一層倍率。**
 * `HISTORICAL`（全部 1.0）是那層測試永遠使用的輪廓。
 *
 * 【只放真的會動的旋鈕】不預先開一堆倍率欄位。目前只有滾轉一項，因為
 * 那是唯一經過評估、確認代價可接受的（見下方 `roll`）。
 */
export interface FeelProfile {
  /**
   * 滾轉權限倍率。1 = 史實。
   *
   * 實作方式是縮放 `moments.clDa`（副翼滾轉力矩導數）。滿舵穩態滾轉率
   * `p = (clDa / −clP)·(2V/b)` 對 `clDa` 是線性的，所以倍率就是滾轉率倍率；
   * `FlightDirector.steadyRollRate` 讀的是同一個導數，指揮儀的內部估計會
   * 自動跟上，不會出現「飛機滾得比指揮儀以為的快」的錯配。
   *
   * 【為什麼滾轉可以動而推力不行】滾轉率不進任何史實斷言的判準
   * （`relative.test.ts` 量的是**兩機的比值**，一起縮放不變），而且滾轉與
   * 能量無關 —— 副翼不吃升力配平。推力則會同時推動極速、爬升率、升限與
   * 極速峰值高度四項，實測 +20% 會讓 P-51 的臨界高度極速由 +3.83% 變成
   * 約 +10%、海平面爬升率由 −14.45% 變成約 0%，四項全部出界。
   */
  roll: number
}

/** 史實輪廓。L2 史實測試恆用這一組 —— 它必須是無操作。 */
export const HISTORICAL: FeelProfile = { roll: 1 }

/**
 * 遊戲實際使用的輪廓。
 *
 * 【`roll: 1.2` 的由來】人工驗收的手感決定，不是實測回填的數字。二戰活塞
 * 戰機的滾轉率本來就不快（P-51D 約 100°/s @480 km/h），在滑鼠／鍵盤上
 * 操作時反應偏鈍。1.2 讓它到約 120°/s —— 仍在同世代機種的實際區間內
 * （FW-190 約 160°/s），不會變成噴射機。
 */
export const GAME_FEEL: FeelProfile = { roll: 1.2 }

/**
 * 把手感輪廓套在一份 spec 上，回傳新的 spec。**不修改傳入的物件。**
 *
 * 倍率為 1 時原封不動回傳**同一個物件** —— 這讓「史實測試跑在未經包裝的
 * spec 上」可以用同一性斷言守住，而不是靠讀者自律。
 */
export function applyFeel(spec: AircraftSpec, feel: FeelProfile): AircraftSpec {
  if (feel.roll === 1) return spec
  return {
    ...spec,
    moments: { ...spec.moments, clDa: spec.moments.clDa * feel.roll },
  }
}
