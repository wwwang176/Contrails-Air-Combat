import { drawArena } from './widgets/arena'
import { drawContacts } from './widgets/contacts'
import { drawDamageEdge } from './widgets/damageEdge'
import { drawDials } from './widgets/dials'
import { drawEnergy } from './widgets/energy'
import { drawGEffect } from './widgets/gEffect'
import { drawGodMarkers } from './widgets/godMarkers'
import { drawHealth } from './widgets/health'
import { drawHints } from './widgets/hints'
import { drawMarkers } from './widgets/markers'
import { drawMessage } from './widgets/message'
import { drawMinimap } from './widgets/minimap'
import { drawReticle } from './widgets/reticle'
import { drawRoster } from './widgets/roster'
import { drawObjective } from './widgets/objective'
import { drawHeadingTape } from './widgets/tape'
import { drawBombsight } from './widgets/bombsight'
import { drawBombBay } from './widgets/bombBay'
import { drawBombVignette } from './widgets/bombVignette'
import type { HudFrame, HudLayout } from './types'

export type HudWidget =
  | 'gEffect' | 'damageEdge' | 'markers' | 'contacts' | 'reticle' | 'tape'
  | 'dials' | 'minimap' | 'health' | 'energy' | 'roster' | 'hints'
  | 'godMarkers' | 'objective' | 'arena' | 'message'
  | 'bombsight' | 'bombBay' | 'bombVignette'

/**
 * 一般飛行的繪製順序。**順序有意義**：
 * 黑視／紅視先畫，其餘 HUD 元件疊在上面維持可讀；受擊方向壓在世界上面、
 * 儀表與數字之下；接觸點畫在準星底下 —— 準星必須壓在最上層。
 */
export const FULL: readonly HudWidget[] = [
  // 【標記排在目標框之前】同一個位置同時有飛機與剛脫手的炸彈時，壓在上面
  // 的該是飛機
  'gEffect', 'damageEdge', 'markers', 'contacts', 'reticle',
  // 【落點圈排在準星之後】兩者重疊時壓在上面的是落點圈
  'bombsight', 'bombBay',
  'tape',
  'dials', 'minimap', 'health', 'energy', 'roster', 'hints',
  // 【界的警告排在 objective 之前】兩者都是「這一場的規則」而不是儀表，
  // 但目標壓最上層
  'arena',
  // 【比目標更上層】預警是「接下來三秒要發生的事」，目標是「這一場要做的
  // 事」。兩者的位置不重疊，但真要疊到時該讓路的是後者
  'message',
  // 【排最後】它壓在最上層 —— 這一場的目標不該被任何面板蓋住
  'objective',
]

/**
 * 上帝視角畫這四個。
 *
 * 其餘（姿態儀、速度高度帶、準星、過載黑視、受擊邊框、儀表、血條、能量、
 * 接觸點）全部是**座艙儀表** —— 鏡頭都不在飛機上了，留著只是雜訊，而
 * **準星更是直接誤導**：它會讓人以為那個方向會有子彈出去。
 *
 * 【`markers` 不算在那一批裡】它標的是彈、雷、船的世界位置，與鏡頭在哪裡
 * 無關 —— 與 `godMarkers` 同一個性質，見下面那一段。
 *
 * 【`godMarkers` 不是座艙儀表】它標的是分隊，而分隊只有在看得見全場的時候
 * 才讀得出來。反過來座艙裡也不排它：那裡已經有完整的目標框與預瞄環，再疊
 * 一層分隊框是雜訊。
 *
 * 【排在最前面】世界疊加層在面板底下 —— 與 `FULL` 裡 `contacts` 排在
 * `dials`／`minimap` 之前是同一條理由。
 */
/**
 * 【`objective` 也在這裡】它不是座艙儀表，是**這一場的規則**。上帝視角下
 * 玩家仍然需要知道還剩幾架、倒數剩幾秒 —— 那與鏡頭在哪裡無關。
 */
// 【`arena` 也在這裡】界不看視角 —— `main.ts` 的 crashPolicy 不分座艙與
// 上帝視角。少了它，上帝視角裡飛機會無預警爆炸
// 【`message` 也在這裡】節拍的預警與鏡頭在哪裡無關 —— 上帝視角下看不到
// 「敵方護航機！」的話，那一則預警在兩種視角裡的意義是不一樣的
// 【`markers` 也在這裡】它不是座艙儀表，是**世界疊加層**：彈、雷、船在
// 哪裡與鏡頭在哪裡無關。上帝視角更是最需要它的地方 —— 那裡沒有目標框，
// 整片海上只剩幾個灰色小點
const GOD: readonly HudWidget[] = [
  'markers', 'godMarkers', 'minimap', 'roster', 'hints', 'arena', 'message', 'objective',
]

/**
 * 投彈模式畫的那一套：**拿掉準星、加一層暗角，其餘照舊。**
 *
 * 【為什麼一定要拿掉 `reticle`】瞄準點在投彈模式下是**凍結**的（`main.ts`
 * 不再 slew 它），畫出來就是一個指著沒有意義的方向的圓圈。理由與上面 `GOD`
 * 那一段逐字相同：「準星更是直接誤導 —— 它會讓人以為那個方向會有子彈出去」。
 *
 * 【為什麼用 filter 而不是重抄一份清單】抄一份的話，`FULL` 加了新 widget 卻
 * 忘了加到這裡，症狀是「投彈模式下少一個儀表」而不會有任何錯誤。
 */
export const BOMB: readonly HudWidget[] = [
  // 【暗角排最前面】它壓的是**世界**，不是 HUD。排在後面的話儀表、小地圖、
  // 隊列都會被一起壓暗，而那幾個是面板不是視野
  'bombVignette',
  ...FULL.filter((w) => w !== 'reticle'),
]

/**
 * 這一幀要畫哪些 widget，依序。
 *
 * 【為什麼是純函數】canvas 在 node 環境驗不到，而「準星在上帝視角下絕不
 * 出現」是一條真的會壞、壞了又很難察覺的性質。抽出來就驗得到，順帶把
 * 繪製順序也釘進測試裡。
 */
export function hudWidgets(godView: boolean, bombing = false): readonly HudWidget[] {
  if (godView) return GOD
  return bombing ? BOMB : FULL
}

type WidgetDraw = (
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame, dt: number,
) => void

/**
 * widget → 繪製函數。
 *
 * 【為什麼是 `Record` 而不是 switch】少一個分支在 switch 裡是**靜靜地不畫**
 * —— `FULL` 更新了卻漏掉分支的話，`hudWidgets` 的測試仍然全綠而 HUD 完全
 * 不顯示。`Record<HudWidget, …>` 少一格是**編譯錯誤**：`hudWidgets` 的清單
 * 與這張表是同一個聯集的兩個消費者，型別系統因此保證它們對得起來。
 *
 * 【為什麼統一吃 dt】只有 `drawGEffect` 用得到（黑視的淡入淡出）。讓其餘的
 * 忽略它，比開兩張表或在呼叫點分歧簡單。
 */
export const WIDGET_DRAW: Record<HudWidget, WidgetDraw> = {
  gEffect: (ctx, L, f, dt) => drawGEffect(ctx, L, f, dt),
  godMarkers: (ctx, L, f) => drawGodMarkers(ctx, L, f),
  damageEdge: (ctx, L, f) => drawDamageEdge(ctx, L, f),
  markers: (ctx, L, f) => drawMarkers(ctx, L, f),
  contacts: (ctx, L, f) => drawContacts(ctx, L, f),
  reticle: (ctx, L, f) => drawReticle(ctx, L, f),
  tape: (ctx, L, f) => drawHeadingTape(ctx, L, f),
  dials: (ctx, L, f) => drawDials(ctx, L, f),
  minimap: (ctx, L, f) => drawMinimap(ctx, L, f),
  health: (ctx, L, f) => drawHealth(ctx, L, f),
  energy: (ctx, L, f) => drawEnergy(ctx, L, f),
  roster: (ctx, L, f) => drawRoster(ctx, L, f),
  hints: (ctx, L, f) => drawHints(ctx, L, f),
  arena: (ctx, L, f) => drawArena(ctx, L, f),
  objective: (ctx, L, f) => drawObjective(ctx, L, f),
  bombsight: (ctx, L, f) => drawBombsight(ctx, L, f),
  bombBay: (ctx, L, f) => drawBombBay(ctx, L, f),
  bombVignette: (ctx, L, f) => drawBombVignette(ctx, L, f),
  message: (ctx, L, f) => drawMessage(ctx, L, f),
}

export class Hud {
  private readonly ctx: CanvasRenderingContext2D
  private readonly layout: HudLayout = { width: 0, height: 0, cx: 0, cy: 0, unit: 0, scale: 1 }

  constructor(private readonly canvas: HTMLCanvasElement) {
    const c = canvas.getContext('2d')
    if (!c) throw new Error('無法取得 HUD 的 2D context')
    this.ctx = c
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio, 2)
    const w = window.innerWidth
    const h = window.innerHeight
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const L = this.layout
    L.width = w
    L.height = h
    L.cx = w / 2
    L.cy = h / 2
    L.unit = h / 2
    L.scale = Math.max(0.75, Math.min(1.4, h / 900))
  }

  render(f: HudFrame, dt: number): void {
    const { ctx, layout: L } = this
    ctx.clearRect(0, 0, L.width, L.height)
    for (const w of hudWidgets(f.godView, f.bombing)) {
      WIDGET_DRAW[w](ctx, L, f, dt)
    }
  }
}
