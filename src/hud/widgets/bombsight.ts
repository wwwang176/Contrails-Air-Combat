import { HUD_COLORS, type HudFrame, type HudLayout } from '../types'

/**
 * 圓的半徑，px（未乘 `L.scale`）。
 *
 * 滑鼠準星的三倍。那一個圈標的是「你指的方向」，只要標得出一個點；這一個
 * 圈罩的是**落點周圍那一塊地**，要拿去對地面上的東西。
 */
const RADIUS = 33

/** 解不出落點時的中心點半徑，px（未乘 `L.scale`） */
const DEAD_DOT = 1.5

/**
 * 落點圈這一幀怎麼畫。
 *
 * ```
 *   ring     實線圈 —— 投彈模式，圈就是落點
 *   faint    暗色圈 —— 一般飛行，同一個落點，但畫面中央還有機槍準星
 *   dot      中心一個灰點 —— 投彈模式解不出來，或圈滑出畫面
 *   hidden   不畫
 * ```
 *
 * 【一般飛行時圈滑出畫面就不畫】投彈模式留中心點是因為「什麼都不畫」與
 * 「HUD 壞了」長得一樣；一般飛行沒有這個問題 —— 畫面中央本來就有機槍準星，
 * 再疊一個灰點只會被讀成準星的一部分。而且平飛在 2,000 m 以上時落點恆在
 * 畫面下緣之外，那個灰點會一直亮著。
 *
 * 【為什麼抽成純函數】canvas 進不了單元測試，而「哪一種情況畫哪一種」是一條
 * 有實際後果的規則 —— 同 `contactColor`、`minimapSymbol` 的做法。
 */
export type BombsightStyle = 'hidden' | 'ring' | 'faint' | 'dot'

export function bombsightStyle(
  bombing: boolean,
  state: HudFrame['bombState'],
  visible: boolean,
): BombsightStyle {
  if (state === 'off') return 'hidden'
  if (state === 'solved' && visible) return bombing ? 'ring' : 'faint'
  return bombing ? 'dot' : 'hidden'
}

/** 不可投時的暗色圈。與 `HUD_COLORS.dim` 是同一個透明度，只換色相 */
const DIM_BAD = 'rgba(255, 90, 77, 0.45)'

/**
 * 圈用什麼顏色畫。**綠 = 這一幀投得出去，紅 = 投不出去。**
 *
 * 【一般飛行的暗圈也照這條走】那個圈本來就是「現在按 B 投得中」的訊號，
 * 顏色再帶上「而且投得下去」是同一件事的延伸 —— 低空進場時它從畫面下緣
 * 進來、由紅轉綠，那一刻就是可以投的時候。
 *
 * 【為什麼與 `bombsightStyle` 分兩支】樣式回答「畫不畫、畫哪一種」，顏色
 * 回答「投不投得出去」。混成一支的話，加一種顏色就要動樣式的每一條測試。
 */
export function bombsightColor(style: BombsightStyle, releaseOk: boolean): string {
  if (style === 'faint') return releaseOk ? HUD_COLORS.dim : DIM_BAD
  return releaseOk ? HUD_COLORS.primary : HUD_COLORS.danger
}

/**
 * 投彈落點的圓準星。**圓形，不是十字。**
 *
 * 【一般飛行也畫】落點是飛行狀態的函數，與鏡頭無關 —— 算得出來就標得出來。
 * 低空進場時圈會從畫面下緣進來，那就是「現在按 B 投得中」的訊號。高空平飛
 * 時它在畫面外（4,000 m 前拋 2,233 m，離視線太遠），得切投彈模式才看得到。
 *
 * 【不恆在畫面中央，所以要真的投影】投彈模式下相機自動盯落點，解穩定時圈回
 * 到中心；機動、變速、圓錐夾制時視線的 LERP 讓圈漂開，那個分離量就是「投彈
 * 解還沒收斂」。
 *
 * 【不畫離屏箭頭】圈滑出畫面時投彈模式已經退成中央的灰點，那本身就是訊號。
 */
export function drawBombsight(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
): void {
  const style = bombsightStyle(f.bombing, f.bombState, f.bombVisible)
  if (style === 'hidden') return

  if (style === 'dot') {
    ctx.fillStyle = HUD_COLORS.dim
    ctx.beginPath()
    ctx.arc(L.cx, L.cy, DEAD_DOT * L.scale, 0, Math.PI * 2)
    ctx.fill()
    return
  }

  const x = L.cx + (f.bombX * L.width) / 2
  const y = L.cy - (f.bombY * L.height) / 2

  ctx.strokeStyle = bombsightColor(style, f.releaseOk)
  ctx.lineWidth = 1 * L.scale
  ctx.beginPath()
  ctx.arc(x, y, RADIUS * L.scale, 0, Math.PI * 2)
  ctx.stroke()
}
