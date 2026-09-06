import {
  contactBoxRadius, contactColor, hudFont,
  type HudContact, type HudFrame, type HudLayout,
} from '../types'

/**
 * 這個接觸點要不要畫分隊標示。
 *
 * 【為什麼抽成純函數】canvas 在 node 環境驗不到，而「只畫長機」正是這一份
 * 的核心要求 —— 它壞掉的話畫面上會多出十幾個框，而沒有任何自動化的東西
 * 會發現。與 `hudWidgets`、`edgeIndicatorPosition` 是同一個做法。
 *
 * 【畫面外不畫】上帝視角有小地圖畫全場，邊緣再排十個箭頭只是雜訊。所以
 * 這裡沒有 `edgeIndicatorPosition` 的對應物。
 */
export function godMarkerVisible(c: HudContact, aspect: number): boolean {
  return c.active && c.flightLeader && !c.behind
    && Math.abs(c.x) <= aspect && Math.abs(c.y) <= 1
}

/**
 * 分隊存活／編制的字串，形如 `(2/4)`。
 *
 * 【名字不叫 `flightLabel`】`roster.ts` 已經有一個同名函數，語意不同：
 * 它回傳 `隊 2/4`，而且剩一架時回傳 `null`（「那時候沒有『隊』這回事」）。
 * 上帝視角相反 —— `(1/4)` 是「那一隊快被打光了」，正是最值得看的資訊。
 */
export function flightStrengthLabel(alive: number, size: number): string {
  return `(${alive}/${size})`
}

/**
 * 分隊標示的顏色。**兩色**：敵紅、我方藍。
 *
 * 【為什麼借用 `contactColor` 而不自己寫一行三元式】那會是第三份同義的顏色
 * 邏輯，遲早與另外兩份漂開 —— `contactColor` 的註解記的就是這件事。
 *
 * 【`flightMate = false` 是刻意的，不是忘了填】座艙的第三個顏色（警示黃）
 * 標的是玩家自己的 Schwarm，意思是「誰會在你被咬時回頭掩護你」。上帝視角是
 * 旁觀全場，那個區別沒有意義。
 */
export function godMarkerColor(hostile: boolean): string {
  return contactColor(hostile, false)
}

/**
 * 上帝視角的分隊標示：長機外面一個方框，框下是 `(存活/編制)`。
 *
 * 框的線寬、字級、間距全部沿用座艙目標框（`contacts.ts`），因為兩者是同一套
 * 視覺語言 —— 只是框底下那個讀數的意思由「距離」換成「這一隊還剩幾架」。
 *
 * 【配置：每個標示一個字串，每幀】`flightStrengthLabel` 與 `hudFont` 都回傳
 * 新字串。**這不是零配置**，但與 `drawContacts` 的距離讀數是同一個取捨，而且
 * 量級更小（最多十個分隊 vs 最多四十架）。`hudFont` 已經提到迴圈外，一幀一次。
 */
export function drawGodMarkers(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame,
): void {
  const aspect = L.width / L.height
  ctx.font = hudFont(10 * L.scale)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  for (let i = 0; i < f.contactCount; i++) {
    const c = f.contacts[i]!
    if (!godMarkerVisible(c, aspect)) continue

    const x = L.cx + c.x * L.unit
    const y = L.cy - c.y * L.unit
    const r = contactBoxRadius(c.radius, L.unit, L.scale)
    const color = godMarkerColor(c.hostile)

    ctx.strokeStyle = color
    ctx.lineWidth = 1.5 * L.scale
    ctx.strokeRect(x - r, y - r, r * 2, r * 2)

    // 【間距也要乘 scale】不乘的話高 DPI 下字會貼到框上
    ctx.fillStyle = color
    ctx.fillText(flightStrengthLabel(c.flightAlive, c.flightSize), x, y + r + 3 * L.scale)
  }
}
