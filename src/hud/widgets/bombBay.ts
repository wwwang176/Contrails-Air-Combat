import { aglOk, pitchOk, rollOk } from '../../weapons/releaseEnvelope'
import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

const RAD = 180 / Math.PI

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

/** 閘門三格的水平間距，px（未乘 `L.scale`）。**起始值，由試飛裁定。** */
const GATE_GAP = 74

/**
 * 這一幀畫不畫投放閘門。**與「裝填中」二擇一。**
 *
 * 【為什麼只有魚雷】`BOMB_ENVELOPE` 只擋退化狀態（倒飛、60 m），常態恆綠
 * —— 畫出來是純噪音。魚雷的是 12°／±6°／20…200 m，紅是常態，而「哪一根
 * 桿子拉錯」正是玩家需要的那句話。
 *
 * 【為什麼不限投彈模式】它是儀表，不是瞄具。進場的姿態要在切投彈模式
 * **之前**就擺好 —— 理由與彈艙格子「釘在畫面下方而不是跟著準星走」相同。
 */
export function releaseGateVisible(f: HudFrame): boolean {
  return f.bombCapable
    && f.bombBayCapacity > 0
    && f.ordnance === 'torpedo'
    && f.releaseEnv !== null
    && !f.bombReloading
}

/** 一格過不過的顏色。**綠 = 這一軸在包絡內。** */
export function releaseGateColor(ok: boolean): string {
  return ok ? HUD_COLORS.primary : HUD_COLORS.danger
}

/**
 * 投放閘門：**坡度／俯仰／高度各一格，顯示值不是燈號。**
 *
 * 【為什麼顯示值】這個包絡緊。「高度 240 m」告訴你要下降多少、往哪個方向
 * 收斂；一個紅點只告訴你不行。值本身就是操作指令。
 *
 * 【門檻與高度都只有一份】三格直接呼叫 `weapons/releaseEnvelope.ts` 的逐軸
 * 述詞，吃的是 `f.releaseEnv` 與 `f.releaseAgl` —— 也就是 `main.ts` 餵給
 * `canRelease` 的那一組。自己在這裡寫一份 `Math.abs(roll) <= 12°`，或改讀
 * `f.altitude`（那是海拔不是離地），症狀都是**三格全綠而扳機沒有反應**：
 * 不拋例外、沒有訊息。
 */
function drawReleaseGate(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
  baseline: number,
): void {
  const env = f.releaseEnv
  if (env === null) return
  const cells: readonly [string, boolean][] = [
    [`坡度 ${Math.round(Math.abs(f.roll) * RAD)}°`, rollOk(env, f.roll)],
    [`俯仰 ${Math.round(f.pitch * RAD)}°`, pitchOk(env, f.pitch)],
    [`高度 ${Math.round(f.releaseAgl)} m`, aglOk(env, f.releaseAgl)],
  ]
  ctx.font = hudFont(Math.round(9 * L.scale))
  ctx.textAlign = 'center'
  // 【一定要自己設 textBaseline】整個 HUD 共用一個 ctx，而這個屬性是黏著的
  ctx.textBaseline = 'bottom'
  const gap = GATE_GAP * L.scale
  const x0 = L.cx - gap
  for (let i = 0; i < cells.length; i++) {
    const [text, ok] = cells[i]!
    ctx.fillStyle = releaseGateColor(ok)
    ctx.fillText(text, x0 + i * gap, baseline)
  }
  ctx.textAlign = 'left'
}

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
  // 【格數是這一台的滿艙，不是全域常數】B-17G 十枚、He 111 八枚、G4M 魚雷一枚
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

  // 【裝填中與閘門二擇一】兩個都畫的話會在同一個 baseline 上疊字。裝填中
  // 優先 —— 那時候投不出去的理由是「艙是空的」，姿態對不對無關緊要
  const baseline = y - LABEL_RISE * L.scale
  if (!f.bombReloading) {
    if (releaseGateVisible(f)) drawReleaseGate(ctx, L, f, baseline)
    return
  }
  ctx.font = hudFont(Math.round(9 * L.scale))
  ctx.fillStyle = HUD_COLORS.warn
  ctx.textAlign = 'center'
  // 【一定要自己設 textBaseline】整個 HUD 共用一個 ctx，而這個屬性是黏著的
  // ——不設就吃到上一個畫字的 widget 留下的值，字會隨別的儀表出沒而跳動。
  // `bottom` 讓字底就是 y − LABEL_RISE，與格子的距離才算得準
  ctx.textBaseline = 'bottom'
  ctx.fillText(`裝填中 ${f.bombReloadLeft.toFixed(0)}s`, L.cx, baseline)
  ctx.textAlign = 'left'
}
