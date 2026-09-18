import { aglOk, pitchOk, rollOk, type ReleaseEnvelope } from '../../weapons/releaseEnvelope'
import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

const RAD = 180 / Math.PI

/**
 * 整排格子的頂邊離畫面下緣多遠，px（未乘 `L.scale`）。
 *
 * `energy` 的 `THR … kW … 機名` 那一行 baseline 在 26，字級 13（字頂 32.5）——
 * 這一排的底邊落在 `BOTTOM − PIP_H` = 53，中間留 20 px，貼太近會讀成同一行。
 * 格子改大小時 `BOTTOM` 跟著加，底邊不動。
 */
const BOTTOM = 77
/** 每一格彈的寬與高，px（未乘 `L.scale`）。1 : 4 接近炸彈的長徑比 4.4 */
const PIP_W = 6
const PIP_H = 24
const PIP_GAP = 6
/**
 * 魚雷那一格的寬高，px。
 *
 * 【為什麼與炸彈不同】炸彈是一排立著的小格子；魚雷只有一枚，同樣畫成一個
 * 立著的剪影時讀起來像「彈艙裡只剩一顆炸彈」。躺著的長條才讀得出是別
 * 一種東西 —— 而長徑比本來就是它與炸彈最明顯的差別（11.7 對 4.4）。
 * 80 × 7 接近那個比例。
 */
const TORPEDO_W = 80
const TORPEDO_H = 7
/**
 * 「裝填中」的**字底**離格子頂邊多遠，px。
 *
 * 【在格子上方】下方是 `energy` 的 `THR … kW … 機名`，格子與它之間沒有
 * 放一行字的空間（見 `BOTTOM`）。
 */
const LABEL_RISE = 8
/** 「裝填中」與閘門三格的字級，px（未乘 `L.scale`） */
const LABEL_FONT = 13.5

/** 閘門三格的水平間距，px（未乘 `L.scale`）。**起始值，由試飛裁定。** */
const GATE_GAP = 111

/**
 * 這一幀畫不畫投放閘門。**與「裝填中」二擇一。**
 *
 * 【為什麼只有魚雷】`BOMB_ENVELOPE` 只擋退化狀態（倒飛、60 m），常態恆綠
 * —— 畫出來是純噪音。`TORPEDO_ENVELOPE` 三個軸都會在進場時真的擋人，而
 * 「哪一根桿子拉錯」正是玩家需要的那句話。
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
 * 出界時往哪邊修：在界內回空字串，出界回一個箭頭。**紅的那一格才有箭頭。**
 *
 * 【過不過只問逐軸述詞】方向只在已經判定出界之後才看，而且看的是區間的
 * 中點在哪一側 —— 不在這裡重抄一份門檻的比較（理由見下面 `cell` 的說明）。
 * 沒有上界（`Infinity`）時中點也是 `Infinity`，出界就只可能是太低，照樣對。
 *
 * ```
 *   高度   太高 ▼（飛低）  太低 ▲（飛高）
 *   俯仰   機頭太高 ▼      機頭太低 ▲
 *   坡度   右滾過頭 ◀      左滾過頭 ▶     —— 往水平壓回去的方向
 * ```
 */
export function aglHint(env: ReleaseEnvelope, agl: number): string {
  if (aglOk(env, agl)) return ''
  return agl > (env.minAgl + env.maxAgl) / 2 ? ' ▼' : ' ▲'
}

export function pitchHint(env: ReleaseEnvelope, pitch: number): string {
  if (pitchOk(env, pitch)) return ''
  return pitch > (env.minPitch + env.maxPitch) / 2 ? ' ▼' : ' ▲'
}

/** 【右滾為正】見 `hud/attitude-math.ts` */
export function rollHint(env: ReleaseEnvelope, roll: number): string {
  if (rollOk(env, roll)) return ''
  return roll > 0 ? ' ◀' : ' ▶'
}

/**
 * 投放閘門：**坡度／俯仰／高度各一格，顯示值不是燈號。** 出界的那一格
 * 後面加一個箭頭，指往哪邊修（`aglHint` 那三支）。
 *
 * 【為什麼顯示值】這個包絡緊。「高度 240 m」告訴你要下降多少、往哪個方向
 * 收斂；一個紅點只告訴你不行。值本身就是操作指令。
 *
 * 【門檻與高度都只有一份】三格直接呼叫 `weapons/releaseEnvelope.ts` 的逐軸
 * 述詞，吃的是 `f.releaseEnv` 與 `f.releaseAgl` —— 也就是 `main.ts` 餵給
 * `canRelease` 的那一組。自己在這裡抄一份門檻的比較，或改讀
 * `f.altitude`（那是海拔不是離地），症狀都是**三格全綠而扳機沒有反應**：
 * 不拋例外、沒有訊息。
 */
function cell(
  ctx: CanvasRenderingContext2D, text: string, ok: boolean, x: number, y: number,
): void {
  ctx.fillStyle = releaseGateColor(ok)
  ctx.fillText(text, x, y)
}

function drawReleaseGate(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
  baseline: number,
): void {
  const env = f.releaseEnv
  if (env === null) return
  ctx.font = hudFont(Math.round(LABEL_FONT * L.scale))
  ctx.textAlign = 'center'
  // 【一定要自己設 textBaseline】整個 HUD 共用一個 ctx，而這個屬性是黏著的
  ctx.textBaseline = 'bottom'
  const gap = GATE_GAP * L.scale
  const x0 = L.cx - gap
  // 【三格逐一畫，不先組一個陣列】組陣列會每幀配置一個外層加三個 tuple
  cell(ctx, `坡度 ${Math.round(Math.abs(f.roll) * RAD)}°${rollHint(env, f.roll)}`,
    rollOk(env, f.roll), x0, baseline)
  cell(ctx, `俯仰 ${Math.round(f.pitch * RAD)}°${pitchHint(env, f.pitch)}`,
    pitchOk(env, f.pitch), x0 + gap, baseline)
  cell(ctx, `高度 ${Math.round(f.releaseAgl)} m${aglHint(env, f.releaseAgl)}`,
    aglOk(env, f.releaseAgl), x0 + 2 * gap, baseline)
  ctx.textAlign = 'left'
}

/**
 * 炸彈側影的半邊輪廓，`[軸向, 半寬]`：軸向 0 是彈頭、1 是尾端，半寬以彈體
 * 最大半徑為 1。
 *
 * 【照遊戲裡那一枚的輪廓】`render/bombs.ts` 的 `PROFILE`（`BOMB_SHAPE` 倍率
 * 是 1）：鈍頭、彈體、收尾錐、尾管。尾翼跨度約等於彈體直徑，裝在尾管上，
 * 側影上是收尾錐後面那一段撐回彈體寬。
 */
const BOMB_OUTLINE: readonly (readonly [number, number])[] = [
  [0, 0.17], [0.05, 0.64], [0.19, 1], [0.675, 1], [0.76, 0.8],
  [0.76, 1], [0.99, 1], [0.99, 0.64], [1, 0.64],
]

/**
 * 沿一條輪廓建出對稱的剪影路徑。上半（或左半）照 `outline` 從彈頭走到尾端，
 * 另一半鏡射走回來。只建路徑，填滿或描邊由呼叫端決定。
 *
 * @param noseDown true = 直立、彈頭朝下（炸彈）；false = 橫躺、彈頭朝右（魚雷）
 */
function ordnancePath(
  ctx: CanvasRenderingContext2D, outline: readonly (readonly [number, number])[],
  x: number, y: number, w: number, h: number, noseDown: boolean,
): void {
  const n = outline.length
  // 軸向與徑向在這一格裡各佔哪一邊
  const len = noseDown ? h : w
  const half = (noseDown ? w : h) / 2
  const mid = noseDown ? x + half : y + half
  ctx.beginPath()
  for (let k = 0; k < 2 * n; k++) {
    // 前半走一側、後半倒著走另一側
    const i = k < n ? k : 2 * n - 1 - k
    const side = k < n ? -1 : 1
    const [t, r] = outline[i]!
    const a = noseDown ? y + len * (1 - t) : x + len * (1 - t)
    const b = mid + side * r * half
    const px = noseDown ? b : a
    const py = noseDown ? a : b
    if (k === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

/**
 * 魚雷側影的上半輪廓，`[軸向, 半高]`：軸向 0 是彈頭、1 是尾端，半高以彈體
 * 最大半徑為 1。
 *
 * 【照遊戲裡那一支的輪廓】`render/bombs.ts` 的 `PROFILE` 乘上 `TORPEDO_SHAPE`
 * 的倍率：鈍頭漸收約 1 m、彈體、收尾錐、比彈體細的尾管。尾翼跨度等於彈體
 * 直徑，所以側影上它**不高過彈體**，只在尾管那一段凸出來。
 */
const TORPEDO_OUTLINE: readonly (readonly [number, number])[] = [
  [0, 0.17], [0.05, 0.64], [0.19, 1], [0.675, 1], [0.85, 0.64],
  // 尾翼：弦長約全長的一成，裝在尾管末段
  [0.884, 0.64], [0.884, 1], [0.989, 1], [0.989, 0.64], [1, 0.64],
]


/**
 * 彈艙讀數：**恆是這一台的滿艙格數**，有彈的實心剪影、投掉的空心剪影。
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
  // 【內縮半個線寬】canvas 的描邊跨在路徑上，不縮的話空心的會比實心的大一圈
  const inset = 0.5 * L.scale
  for (let i = 0; i < slots; i++) {
    const x = x0 + i * (w + gap)
    const loaded = i < f.bombLoad
    const k = loaded ? 0 : inset
    ordnancePath(ctx, torpedo ? TORPEDO_OUTLINE : BOMB_OUTLINE,
      x + k, y + k, w - 2 * k, h - 2 * k, !torpedo)
    if (loaded) {
      ctx.fillStyle = HUD_COLORS.primary
      ctx.fill()
    } else {
      ctx.strokeStyle = HUD_COLORS.dim
      ctx.stroke()
    }
  }

  // 【裝填中與閘門二擇一】兩個都畫的話會在同一個 baseline 上疊字。裝填中
  // 優先 —— 那時候投不出去的理由是「艙是空的」，姿態對不對無關緊要
  const baseline = y - LABEL_RISE * L.scale
  if (!f.bombReloading) {
    if (releaseGateVisible(f)) drawReleaseGate(ctx, L, f, baseline)
    return
  }
  ctx.font = hudFont(Math.round(LABEL_FONT * L.scale))
  ctx.fillStyle = HUD_COLORS.warn
  ctx.textAlign = 'center'
  // 【一定要自己設 textBaseline】整個 HUD 共用一個 ctx，而這個屬性是黏著的
  // ——不設就吃到上一個畫字的 widget 留下的值，字會隨別的儀表出沒而跳動。
  // `bottom` 讓字底就是 y − LABEL_RISE，與格子的距離才算得準
  ctx.textBaseline = 'bottom'
  ctx.fillText(`裝填中 ${f.bombReloadLeft.toFixed(0)}s`, L.cx, baseline)
  ctx.textAlign = 'left'
}
