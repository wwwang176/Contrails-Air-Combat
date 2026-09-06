import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/**
 * 整排格子的頂邊離畫面下緣多遠，px（未乘 `L.scale`）。
 *
 * `energy` 的 `THR … kW … 機名` 那一行 baseline 在 26，字級 13 —— 這一排的
 * 底邊落在 41，兩者不重疊。
 */
const BOTTOM = 52
/** 每一格彈的寬與高，px（未乘 `L.scale`） */
const PIP_W = 5
const PIP_H = 11
const PIP_GAP = 3
/**
 * 魚雷那一格的寬高，px。
 *
 * 【為什麼與炸彈不同】炸彈是一排立著的小格子；魚雷只有一枚，同樣畫成一個
 * 5 × 11 的方塊時讀起來像「彈艙裡只剩一顆炸彈」。躺著的長條才讀得出是別
 * 一種東西 —— 而長徑比本來就是它與炸彈最明顯的差別（11.7 對 4.4）。
 */
const TORPEDO_W = 26
const TORPEDO_H = 6
/**
 * 「裝填中」的**字底**離格子頂邊多遠，px。
 *
 * 【在格子上方】下方是 `energy` 的 `THR … kW … 機名`（middle 基線在 26、
 * 字級 13，字頂落在 32.5）—— 格子底邊在 41，中間只剩 8.5 px。
 */
const LABEL_RISE = 4

/**
 * 彈艙讀數：**恆是這一台的滿艙格數**，有彈的實心、投掉的空心。
 *
 * 【格數固定，位置才固定】依**剩餘**彈數畫格子的話，整排的寬度會隨著投彈
 * 縮短，上面那一行字跟著跳。跟著機種變則沒有這個問題 —— 一場之內不換機。
 *
 * 【釘在畫面下方而不是跟著準星走】它是儀表，與鏡頭在哪裡無關 —— 一般飛行
 * 時本來就沒有準星可以跟。
 */
export function drawBombBay(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
): void {
  if (!f.bombCapable || f.bombBayCapacity <= 0) return

  const torpedo = f.ordnance === 'torpedo'
  const w = (torpedo ? TORPEDO_W : PIP_W) * L.scale
  const h = (torpedo ? TORPEDO_H : PIP_H) * L.scale
  const gap = PIP_GAP * L.scale
  // 【底邊對齊，不是頂邊】魚雷那一格比較矮，照頂邊對齊的話「裝填中」那一行
  // 會離格子更遠，看起來像浮著
  const y = L.height - BOTTOM * L.scale + (PIP_H * L.scale - h)
  // 【格數是這一台的滿艙，不是全域常數】B-17G 十枚、He 111 八枚、G4M 兩枚
  const slots = f.bombBayCapacity
  const full = slots * w + (slots - 1) * gap
  const x0 = L.cx - full / 2

  ctx.lineWidth = 1 * L.scale
  for (let i = 0; i < slots; i++) {
    const x = x0 + i * (w + gap)
    if (i < f.bombLoad) {
      ctx.fillStyle = HUD_COLORS.primary
      ctx.fillRect(x, y, w, h)
    } else {
      ctx.strokeStyle = HUD_COLORS.dim
      // 【內縮半個線寬】canvas 的描邊跨在路徑上，不縮的話空心格會比實心格寬
      ctx.strokeRect(x + 0.5 * L.scale, y + 0.5 * L.scale, w - L.scale, h - L.scale)
    }
  }

  if (!f.bombReloading) return
  ctx.font = hudFont(Math.round(9 * L.scale))
  ctx.fillStyle = HUD_COLORS.warn
  ctx.textAlign = 'center'
  // 【一定要自己設 textBaseline】整個 HUD 共用一個 ctx，而這個屬性是黏著的
  // ——不設就吃到上一個畫字的 widget 留下的值，字會隨別的儀表出沒而跳動。
  // `bottom` 讓字底就是 y − LABEL_RISE，與格子的距離才算得準
  ctx.textBaseline = 'bottom'
  ctx.fillText(`裝填中 ${f.bombReloadLeft.toFixed(0)}s`, L.cx, y - LABEL_RISE * L.scale)
  ctx.textAlign = 'left'
}
