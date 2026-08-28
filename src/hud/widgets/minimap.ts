import { contactColor, HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'
import { ARENA_RADIUS } from '../../world/arena'

/** 地圖半徑，公尺。 */
const RANGE = 4000
/** 網格間距，公尺。 */
const CELL = 2000
/**
 * 貼邊符號離方框的內縮量，px（未乘 L.scale）。
 *
 * 符號半徑是 4 px，取 7 讓整個符號留在框內 —— 貼齊到剛好碰到邊的話，
 * 一半的符號會被 clip 切掉，而被切一半的三角形與倒三角形讀起來一樣。
 */
const SYMBOL_MARGIN = 7

/**
 * 沿 (x, y) 推到**剛好碰到**邊長 2 × `edge` 的正方形，回傳應乘的縮放係數。
 *
 * 原點回傳 0 —— 沒有方位可言。
 *
 * 【為什麼抽成純函數】小地圖有兩個東西要貼框（超界的接觸點、N 標記），
 * 而繪製函數進不了單元測試。與 `contacts.ts` 的 `edgeIndicatorPosition`
 * 是同一招。
 */
export function edgeReach(x: number, y: number, edge: number): number {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  // 除以 0 會得到 Infinity，min 自然挑另一軸
  const s = Math.min(edge / ax, edge / ay)
  return Number.isFinite(s) ? s : 0
}

/**
 * 同 `edgeReach`，但**已經在框內的不動**。超界的接觸點用這一個。
 *
 * 【與 N 標記的差別】N 是一律推到邊（它是方位指示，距離沒有意義）；
 * 接觸點是「在圖上就照實畫，超出去才貼邊」。兩者共用同一個幾何原語，
 * 但語意不同 —— 寫成兩個名字才不會有人拿錯。
 */
export function edgeClamp(x: number, y: number, edge: number): number {
  return Math.min(1, edgeReach(x, y, edge))
}

/**
 * 小地圖。自機恆在中心且恆朝上，他機依高度差以三角／方／倒三角區分敵我
 * 與相對高度（M2 spec §8）。
 *
 * 【機首朝上】自機符號固定指向畫面上方，轉的是地圖。空戰時腦子裡的方位
 * 是相對自己的（「他在我兩點鐘」），北方朝上的地圖每次都要先在心裡轉一次。
 * 代價是失去絕對方位，所以補一個會繞著轉的 N 標記，並讓網格跟著世界座標
 * 捲動——網格因此不只是裝飾，它就是地面。
 */
export function drawMinimap(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const size = Math.min(L.width, L.height) * 0.19
  const x = 30 * L.scale
  const y = L.height - size - 42 * L.scale
  const cx = x + size / 2
  const cy = y + size / 2
  /** 每公尺的像素數 */
  const px = size / (2 * RANGE)

  ctx.fillStyle = HUD_COLORS.panel
  ctx.fillRect(x, y, size, size)

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, size, size)
  ctx.clip()
  ctx.translate(cx, cy)
  ctx.rotate(-f.heading)

  // 網格。地圖旋轉後方框的四個角最遠是半對角線，線要畫得比方框寬才蓋得滿。
  const cellPx = CELL * px
  const reach = size * 0.71 + cellPx
  const n = Math.ceil(reach / cellPx)
  const ox = -(((f.worldX % CELL) + CELL) % CELL) * px
  const oz = -(((f.worldZ % CELL) + CELL) % CELL) * px
  ctx.strokeStyle = HUD_COLORS.dim
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = -n; i <= n; i++) {
    const gx = ox + i * cellPx
    const gz = oz + i * cellPx
    ctx.moveTo(gx, -reach); ctx.lineTo(gx, reach)
    ctx.moveTo(-reach, gz); ctx.lineTo(reach, gz)
  }
  ctx.stroke()

  // 【戰場邊界】小地圖半徑 4 km、界 12 km，所以只有靠近時才進得了畫面 ——
  // 那正是它該出現的時機。
  //
  // 【圓心是世界原點相對於玩家】這一段仍在 translate 到玩家、rotate 了
  // −heading 的座標系裡，所以原點落在 (−worldX·px, −worldZ·px)。
  // 畫在 `ctx.restore()` 之後的話這個算式就不成立了
  if (f.arenaShow) {
    ctx.strokeStyle = HUD_COLORS.warn
    ctx.lineWidth = 1.5 * L.scale
    ctx.beginPath()
    ctx.arc(-f.worldX * px, -f.worldZ * px, ARENA_RADIUS * px, 0, Math.PI * 2)
    ctx.stroke()
  }

  // 敵我符號：高於我 = 三角、同層 = 方、低於我 = 倒三角（spec §8）。
  // 【畫在旋轉座標系裡但符號本身不轉】位置要跟著地圖轉（機首朝上），
  // 形狀不能轉——倒三角轉了就讀不出「他在我下面」。
  const cosH = Math.cos(f.heading)
  const sinH = Math.sin(f.heading)
  const edge = size / 2 - SYMBOL_MARGIN * L.scale
  for (let i = 0; i < f.contactCount; i++) {
    const c = f.contacts[i]!
    if (!c.active) continue
    let rx = (c.worldX - f.worldX) * px
    let rz = (c.worldZ - f.worldZ) * px

    // 【超出範圍的不剔除，改成貼在**方框邊上**並轉半透明】剔除掉的話
    // 「他不在圖上」與「他不存在」在畫面上長得一模一樣——而空戰裡最想知道的
    // 往往就是那個剛脫離的傢伙往哪走了。半透明表示「方位對、距離不對」。
    //
    // 【為什麼是方框而不是內接圓】N 標記貼的就是方框（見下方），兩套夾制
    // 規則會讓同一個方位的兩個標記落在不同半徑上。而且圓形夾制浪費四個角：
    // 45° 方位的目標會被拉到比 0° 方位的目標更靠近中心，讀起來像是比較近。
    //
    // 【夾制要在螢幕座標算】ctx 已經旋轉 −heading，方框是**螢幕**上的方框。
    // 旋轉是等距的，所以在螢幕座標算出來的縮放係數可以直接套回地圖座標。
    const sx = rx * cosH + rz * sinH
    const sy = -rx * sinH + rz * cosH
    const k = edgeClamp(sx, sy, edge)
    const beyond = k < 1
    if (beyond) {
      rx *= k
      rz *= k
    }

    ctx.save()
    ctx.globalAlpha = beyond ? 0.35 : 1
    ctx.translate(rx, rz)
    ctx.rotate(f.heading)
    ctx.fillStyle = contactColor(c.hostile, c.flightMate)
    const s = 4 * L.scale
    ctx.beginPath()
    switch (minimapSymbol(c.deltaY)) {
      case 'above':
        ctx.moveTo(0, -s); ctx.lineTo(s, s); ctx.lineTo(-s, s)
        break
      case 'below':
        ctx.moveTo(0, s); ctx.lineTo(s, -s); ctx.lineTo(-s, -s)
        break
      case 'level':
        ctx.rect(-s * 0.8, -s * 0.8, s * 1.6, s * 1.6)
        break
    }
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // 撤離點。**與接觸點共用 `edgeClamp`** —— 不新增幾何原語。
  //
  // 【為什麼畫成圓圈而不是第四種三角形】三角／方／倒三角在這張圖上的語意是
  // 「相對高度」，而撤離點沒有那個語意。借用會讓玩家讀出一個不存在的意思。
  //
  // 【為什麼一定要貼邊】撤離點在 20 km 外，而這張圖的半徑只有 4 km ——
  // 不貼邊的話它從開局到最後一刻都不在圖上，等於沒有這個功能。
  if (f.objectiveHasTarget) {
    let rx = (f.objectiveWorldX - f.worldX) * px
    let rz = (f.objectiveWorldZ - f.worldZ) * px
    const sx = rx * cosH + rz * sinH
    const sy = -rx * sinH + rz * cosH
    const k = edgeClamp(sx, sy, edge)
    const beyond = k < 1
    if (beyond) {
      rx *= k
      rz *= k
    }
    ctx.save()
    ctx.globalAlpha = beyond ? 0.5 : 1
    ctx.strokeStyle = HUD_COLORS.primary
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(rx, rz, 5 * L.scale, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  ctx.restore()

  ctx.strokeStyle = HUD_COLORS.dim
  ctx.lineWidth = 1
  ctx.strokeRect(x, y, size, size)

  // 北方標記：世界 −Z。地圖轉了 −heading，所以它落在這個方向上，字本身不轉。
  // 沿方向推到**剛好碰到方框**——貼著邊比浮在圓周上好讀，而且方框本身就是
  // 現成的刻度盤。除以 0 會得到 Infinity，min 自然會挑另一軸。
  const dx = -Math.sin(f.heading)
  const dy = -Math.cos(f.heading)
  const reachEdge = edgeReach(dx, dy, edge)
  ctx.fillStyle = HUD_COLORS.warn
  ctx.font = hudFont(10 * L.scale)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('N', cx + dx * reachEdge, cy + dy * reachEdge)

  // 中心的標記。座艙裡它是自機（恆位於中心且恆朝上）。
  //
  // 【上帝視角下它不是一架飛機】那時候 `worldX`/`worldZ`/`heading` 填的是
  // **鏡頭**的，中心代表鏡頭在哪。照畫友機三角形的話它就是在騙人 —— 那個
  // 位置沒有飛機，而自機是以一般接觸點的身分畫在別的地方（`main.ts` 在
  // 上帝視角下把自己也放進接觸點）。改畫一個空心方框，讀起來是「視野中心」
  // 而不是「一架友機」。
  if (f.godView) {
    ctx.strokeStyle = HUD_COLORS.dim
    ctx.lineWidth = 1 * L.scale
    const h = 5 * L.scale
    ctx.strokeRect(cx - h, cy - h, h * 2, h * 2)
  } else {
    ctx.fillStyle = HUD_COLORS.friendly
    ctx.beginPath()
    ctx.moveTo(cx, cy - 7 * L.scale)
    ctx.lineTo(cx + 5 * L.scale, cy + 6 * L.scale)
    ctx.lineTo(cx - 5 * L.scale, cy + 6 * L.scale)
    ctx.closePath()
    ctx.fill()
  }

  // 比例尺與座標放在框**外**：N 標記貼著框邊跑，某些航向會正好落在角落上
  ctx.fillStyle = HUD_COLORS.dim
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`${(RANGE / 1000).toFixed(0)} km`, x, y - 4 * L.scale)
  ctx.textBaseline = 'top'
  ctx.fillText(
    `X ${(f.worldX / 1000).toFixed(1)}  Z ${(f.worldZ / 1000).toFixed(1)}`,
    x, y + size + 5 * L.scale,
  )
}

/**
 * 同層的高度帶，m。帶內畫方形，帶外畫三角／倒三角。
 *
 * 【為什麼是 200 m】空戰的高度優勢在 200 m 以內基本上不構成優勢——那是
 * 一次拉升就補得回來的量。門檻太小的話符號會在平飛時抖動。
 */
export const MINIMAP_LEVEL_BAND = 200

export function minimapSymbol(deltaY: number): 'above' | 'level' | 'below' {
  if (deltaY > MINIMAP_LEVEL_BAND) return 'above'
  if (deltaY < -MINIMAP_LEVEL_BAND) return 'below'
  return 'level'
}
