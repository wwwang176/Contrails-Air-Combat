import { HUD_MAX_MARKERS, type HudFrame } from './types'
import { teamSlot } from '../world/World'
import type { Ship } from '../world/ships'

/**
 * 一個可以長出標記的池：炸彈或魚雷。
 *
 * 【為什麼是一個介面而不是收 `Bombs | Torpedoes`】兩個類別的欄位在這裡用到
 * 的部分完全相同，而測試要餵得進一個假的池 —— 收具體類別的話就得在測試裡
 * 造一整顆 `Bombs`，而那把「標記有沒有長出來」與「炸彈積分對不對」綁在一起。
 */
export interface MarkerPool {
  readonly capacity: number
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
  readonly team: Int8Array
  readonly active: Uint8Array
}

/**
 * 把一個世界座標投影到螢幕。**單位是螢幕半高**（與 `HudContact` 同一套）。
 *
 * @returns 在相機背後回 `true` —— 那一格不畫
 */
export type MarkerProject = (
  x: number, y: number, z: number, out: { x: number; y: number },
) => boolean

/**
 * 這一艘船的標記該畫在多高，m（水線為 0）。
 *
 * 【為什麼是回呼】答案只有**模型**知道 —— 桅杆與測距儀不在任何碰撞盒裡，
 * 碰撞盒推出來的高度只有模型的三分之一到一半。而模型住在算繪層，
 * `hud/` 不能往那個方向依賴。
 */
export type ShipMarkerTop = (ship: Ship) => number

/** 投影結果的暫存。熱路徑不配置 */
const OUT = { x: 0, y: 0 }

/**
 * 填滿標記池：**還浮著的船、空中的炸彈、空中與水中的魚雷。**
 *
 * 【為什麼抽出 `main.ts`】那個檔案沒有任何測試（見 `test/e2e/` 幾支的檔頭），
 * 而這裡有兩條會靜靜壞掉的性質：漏掉某一種物體（症狀只是「炸彈沒有標記」），
 * 與敵我判反（症狀只是「顏色不對」）。兩者都不會有任何錯誤訊息。
 *
 * 【為什麼收一個投影回呼而不是相機】`three` 的 `Camera` 進不了這一層的
 * 單元測試，而投影本身不是這支函數的內容 —— 它要負責的是「哪些東西進池、
 * 敵我怎麼判、滿了怎麼辦」。
 *
 * @param own 玩家的隊別（`teamSlot`）。與物體的隊別相等 = 友方（藍）
 */
export function fillMarkers(
  f: HudFrame,
  ships: readonly Ship[],
  pools: readonly MarkerPool[],
  own: number,
  project: MarkerProject,
  shipTop: ShipMarkerTop,
): void {
  let n = 0
  for (const s of ships) {
    // 【沉了就跳過這一艘，不是收工】`break` 的話艦隊裡第一艘沉沒之後，
    // 排在它後面的每一艘都會一起消失
    if (!s.alive) continue
    if (n >= HUD_MAX_MARKERS) break
    // 【抬到整艘船的最高點】`Ship.position.y` 恆為 0（水線），而甲板高與
    // 砲位盒的頂都不夠 —— 桅杆比它們高兩三倍
    n = put(f, n, s.position.x, shipTop(s), s.position.z,
      teamSlot(s.team), own, project)
  }
  for (const p of pools) {
    for (let i = 0; i < p.capacity; i++) {
      if (p.active[i] === 0) continue
      if (n >= HUD_MAX_MARKERS) break
      n = put(f, n, p.x[i]!, p.y[i]!, p.z[i]!, p.team[i]!, own, project)
    }
  }
  // 【收尾要把用過的格子關掉】`markerCount` 縮小時，上一幀留在後面那幾格的
  // `active` 還是 true。widget 只讀前 `markerCount` 格，但留著一批「還活著」
  // 的死資料是下一個讀它的人的陷阱
  for (let i = n; i < f.markerCount; i++) f.markers[i]!.active = false
  f.markerCount = n
}

function put(
  f: HudFrame, i: number,
  x: number, y: number, z: number, team: number, own: number,
  project: MarkerProject,
): number {
  const m = f.markers[i]!
  m.behind = project(x, y, z, OUT)
  m.x = OUT.x
  m.y = OUT.y
  m.hostile = team !== own
  m.active = true
  return i + 1
}
