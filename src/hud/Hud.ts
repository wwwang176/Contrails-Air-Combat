import { drawArena } from './widgets/arena'
import { drawBattleReport } from './widgets/battleReport'
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
import { drawTorpedoLine } from './widgets/torpedoLine'
import type { HudFrame, HudLayout } from './types'

export type HudWidget =
  | 'gEffect' | 'damageEdge' | 'markers' | 'contacts' | 'reticle' | 'tape'
  | 'dials' | 'minimap' | 'health' | 'energy' | 'roster' | 'hints'
  | 'godMarkers' | 'objective' | 'arena' | 'message'
  | 'torpedoLine' | 'bombsight' | 'bombBay' | 'bombVignette' | 'battleReport'

/**
 * 一般飛行的繪製順序。**順序有意義**：
 * 黑視／紅視先畫，其餘 HUD 元件疊在上面維持可讀；標記與目標框貼在世界上，
 * 受擊方向壓在它們上面、儀表與數字之下；準星必須壓在最上層。
 */
export const FULL: readonly HudWidget[] = [
  // 【標記排在目標框之前】同一個位置同時有飛機與剛脫手的炸彈時，壓在上面
  // 的該是飛機
  'gEffect', 'markers', 'contacts', 'damageEdge', 'reticle',
  // 【航跡線排在落點圈之前】圈是線的起點，兩者重疊時壓在上面的該是圈
  'torpedoLine',
  // 【落點圈排在準星之後】兩者重疊時壓在上面的是落點圈
  'bombsight', 'bombBay',
  'tape',
  'dials', 'minimap', 'health', 'energy', 'roster', 'hints',
  // 【在儀表之後、預警之前】它是回饋，蓋得過儀表；但一則「敵方護航機！」
  // 的預警比「剛剛那架算我的」重要，疊到時該讓路的是通報
  'battleReport',
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
// 【`battleReport` 也在這裡】它不是座艙儀表 —— 裡面只有**玩家自己的**戰果，
// 與鏡頭在哪裡無關。而投完魚雷切到上帝視角看它跑正是最常見的用法：不畫的話
// 命中與擊沉都在那三秒裡發生完，切回座艙時已經消失
const GOD: readonly HudWidget[] = [
  // 【排在 `objective` 之前】那一個壓最上層，兩種視角都是
  'markers', 'godMarkers', 'minimap', 'roster', 'hints', 'arena', 'message',
  'battleReport', 'objective',
]

/**
 * 投彈模式畫的那一套：**拿掉準星、加一層暗角，其餘照舊。**
 *
 * 【為什麼一定要拿掉 `reticle`】投彈模式下左鍵是投彈、不開槍，而瞄準點
 * 指的是航向（滑鼠只能微調，見 `BOMB_AIM_SCALE`），不在朝下看的畫面裡。
 * 理由與上面 `GOD` 那一段相同：「準星更是直接誤導 —— 它會讓人以為那個方向
 * 會有子彈出去」。
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
  torpedoLine: (ctx, L, f) => drawTorpedoLine(ctx, L, f),
  bombsight: (ctx, L, f) => drawBombsight(ctx, L, f),
  bombBay: (ctx, L, f) => drawBombBay(ctx, L, f),
  bombVignette: (ctx, L, f) => drawBombVignette(ctx, L, f),
  message: (ctx, L, f) => drawMessage(ctx, L, f),
  battleReport: (ctx, L, f) => drawBattleReport(ctx, L, f),
}

/**
 * 寫進 `style.transform` 之前先量化：角度到 0.01°、位移到萬分之一個畫面。
 *
 * 【為什麼要量化】每幀寫一個新字串會觸發一次樣式重算與合成層更新；量化之後
 * 靜止時寫的是同一個值，就跳過了。兩個步進都遠在看得出來的門檻以下。
 */
const SHAKE_STEP = 0.01 * Math.PI / 180
const SHIFT_STEP = 1e-4

/**
 * 畫在**不跟著震動**的那一張畫布上的 widget。
 *
 * 【滿版遮罩】暗角與黑視壓在世界上。整張 HUD 會跟著鏡頭震動平移旋轉，而畫布
 * 只有自己那一塊點陣 —— 往外多填是填不進去的（超出點陣就被裁掉），所以畫布
 * 一移開，邊上就沒有像素可以蓋，露出一道沒壓暗的世界。
 *
 * 【敵我標示與目標框】它們是用**已經套上震動**的相機投影出來的，本來就貼著
 * 飛機跟著畫面晃。再吃一次 `#hud` 的變換就震了兩次，框與飛機脫開。
 *
 * 【順序仍然成立】這張畫布疊在 `#hud` 底下，所以這些在每一份清單裡都排在
 * 會震的前面 —— 兩件事合起來層次與清單一致。`hudWidgets` 的護欄釘住這一條。
 */
const UNSHAKEN: readonly HudWidget[] = [
  'gEffect', 'bombVignette', 'markers', 'contacts', 'godMarkers',
]

export class Hud {
  private readonly ctx: CanvasRenderingContext2D
  private readonly maskCtx: CanvasRenderingContext2D
  private readonly layout: HudLayout = { width: 0, height: 0, cx: 0, cy: 0, unit: 0, scale: 1 }
  /** 上一次寫進 style 的搖晃，已量化 */
  private shakeWritten = ''

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly maskCanvas: HTMLCanvasElement,
  ) {
    const c = canvas.getContext('2d')
    const m = maskCanvas.getContext('2d')
    if (!c || !m) throw new Error('無法取得 HUD 的 2D context')
    this.ctx = c
    this.maskCtx = m
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio, 2)
    const w = window.innerWidth
    const h = window.innerHeight
    for (const [canvas, ctx] of [
      [this.canvas, this.ctx], [this.maskCanvas, this.maskCtx],
    ] as const) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const L = this.layout
    L.width = w
    L.height = h
    L.cx = w / 2
    L.cy = h / 2
    L.unit = h / 2
    L.scale = Math.max(0.75, Math.min(1.4, h / 900))
  }

  render(f: HudFrame, dt: number): void {
    const { ctx, maskCtx, layout: L } = this
    ctx.clearRect(0, 0, L.width, L.height)
    maskCtx.clearRect(0, 0, L.width, L.height)
    for (const w of hudWidgets(f.godView, f.bombing)) {
      WIDGET_DRAW[w](UNSHAKEN.includes(w) ? maskCtx : ctx, L, f, dt)
    }
    this.applyShake(f.shakeAngle, f.shakeX, f.shakeY)
  }

  /**
   * 整張 HUD 平移一點、再繞畫面中央轉一點。**用 CSS 而不是 canvas 的變換**
   * —— 儀表與盤面走離屏快取，貼回來時 `setTransform` 成 identity，疊在
   * context 上的變換它們吃不到（見 `widgets/layerCache.ts`）。
   *
   * 轉軸是元素的中心，也就是畫面中央 —— `#hud` 是 `position: fixed; inset: 0`，
   * 而 `transform-origin` 的預設就是中心。位移的百分比也是對元素自己的
   * 寬高，所以左右吃畫面寬、上下吃畫面高。
   *
   * 【只動 `#hud`】遮罩與標記在另一張畫布上，那一張不能動，見 `UNSHAKEN`。
   */
  private applyShake(angle: number, shiftX: number, shiftY: number): void {
    const a = Math.round(angle / SHAKE_STEP) * SHAKE_STEP
    const x = Math.round(shiftX / SHIFT_STEP) * SHIFT_STEP
    const y = Math.round(shiftY / SHIFT_STEP) * SHIFT_STEP
    const css = a === 0 && x === 0 && y === 0
      ? ''
      : `translate(${(x * 100).toFixed(2)}%, ${(y * 100).toFixed(2)}%) rotate(${a}rad)`
    if (css === this.shakeWritten) return
    this.shakeWritten = css
    this.canvas.style.transform = css
  }
}
