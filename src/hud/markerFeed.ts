import { HUD_MAX_MARKERS, type HudFrame } from './types'
import { teamSlot } from '../world/team'
import type { Ship } from '../world/ships'
import type { GroundTarget } from '../world/groundTargets'
import type { DisplayPositionPool } from '../core/displayPositionPool'

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

/**
 * 哪些船、地面目標是任務的主要目標（標記上標距離），與量距離的基準點。
 * 判定依當下的規則（`battle/objectiveQueries.ts` 的 `isObjectiveShip`／`isObjectiveGround`）；
 * 基準點與接觸點的距離讀數同一個 —— 自機，上帝視角是鏡頭。
 */
export interface MarkerObjectives {
  ship(s: Ship): boolean
  ground(t: GroundTarget): boolean
  readonly ref: { readonly x: number; readonly y: number; readonly z: number }
  /** 鏡頭垂直半視角的正切。包圍球半徑換成螢幕大小用（望遠時跟著變） */
  readonly tanHalfFov: number
}

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
  groundTargets: readonly GroundTarget[],
  pools: readonly DisplayPositionPool[],
  own: number,
  project: MarkerProject,
  shipTop: ShipMarkerTop,
  objectives: MarkerObjectives,
): void {
  let n = 0
  for (const s of ships) {
    // 【沉了就跳過這一艘，不是收工】`break` 的話艦隊裡第一艘沉沒之後，
    // 排在它後面的每一艘都會一起消失
    if (!s.alive) continue
    if (n >= HUD_MAX_MARKERS) break
    // 【抬到整艘船的最高點】`Ship.position.y` 恆為 0（水線），而甲板高與
    // 砲位盒的頂都不夠 —— 桅杆比它們高兩三倍
    const top = shipTop(s)
    n = put(f, n, s.position.x, top, s.position.z,
      teamSlot(s.team), own, project, objectives.ship(s), objectives, s.cls.radius, top / 2)
  }
  for (const t of groundTargets) {
    // 【炸毀的不畫】與沉船同一個理由；殘骸只是佈景
    if (!t.alive) continue
    if (n >= HUD_MAX_MARKERS) break
    // 【高度用盒頂】建築沒有桅杆，命中盒的頂就是模型的頂 —— 不像船要
    // 問模型。`impactY` 已經是地面高度加盒頂
    n = put(f, n, t.position.x, t.impactY, t.position.z, teamSlot(t.team), own, project,
      objectives.ground(t), objectives, t.radius, (t.position.y + t.impactY) / 2)
  }
  for (const p of pools) {
    for (let i = 0; i < p.capacity; i++) {
      if (p.active[i] === 0) continue
      if (n >= HUD_MAX_MARKERS) break
      n = put(f, n, p.x[i]!, p.y[i]!, p.z[i]!, p.team[i]!, own, project, false, objectives, 0, p.y[i]!)
    }
  }
  // 【收尾要把用過的格子關掉】`markerCount` 縮小時，上一幀留在後面那幾格的
  // `active` 還是 true。widget 只讀前 `markerCount` 格，但留著一批「還活著」
  // 的死資料是下一個讀它的人的陷阱
  for (let i = n; i < f.markerCount; i++) f.markers[i]!.active = false
  f.markerCount = n
}

/**
 * @param y 標記的高度（物體頂上）
 * @param worldRadius 包圍球半徑，m。主要目標的括號大小
 * @param centerY 物體中心的高度，m。主要目標的括號框在這裡，不是框在頂上的標記點
 */
function put(
  f: HudFrame, i: number,
  x: number, y: number, z: number, team: number, own: number,
  project: MarkerProject, objective: boolean, objectives: MarkerObjectives,
  worldRadius: number, centerY: number,
): number {
  const m = f.markers[i]!
  m.behind = project(x, y, z, OUT)
  m.x = OUT.x
  m.y = OUT.y
  m.hostile = team !== own
  m.objective = objective
  const ref = objectives.ref
  m.range = objective ? Math.hypot(x - ref.x, y - ref.y, z - ref.z) : 0
  // 【與目標框同一條式子】`HudContact.radius` 也是半徑 ÷ 距離 ÷ tan(半視角)
  m.radius = objective ? worldRadius / Math.max(m.range, 1) / objectives.tanHalfFov : 0
  m.centerX = m.x
  m.centerY = m.y
  if (objective) {
    project(x, centerY, z, OUT)
    m.centerX = OUT.x
    m.centerY = OUT.y
  }
  m.worldX = x
  m.worldZ = z
  m.active = true
  return i + 1
}
