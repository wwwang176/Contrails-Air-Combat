/**
 * 載入畫面：開場預載模型、進關卡建場景時蓋住整個畫面，一條進度條加上目前這一步。
 *
 * 【為什麼 HTML 裡一開始就蓋著】模型還在預載時選單就點得到，那時按出擊會在
 * 找不到模型樣板的地方丟例外。蓋著的東西不需要 JS 就在，預載完才收。
 *
 * 【為什麼每一步都要等一次繪製】建一場戰鬥是同步的一大段。不先讓瀏覽器把這一步
 * 的文字與進度畫出去，畫面會停在上一個狀態直到整段跑完 —— 進度條一格都看不到。
 */

/** 進度（0…1）→ 百分比字樣。夾在 0–100，壞掉的輸入回 0% */
export function loadingPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '0%'
  const f = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction
  return `${Math.round(f * 100)}%`
}

/**
 * 已載完的檔數 → 進度（0…1）。總數 0 算已完成 —— 沒東西要載就是載完了，
 * 不是 NaN。
 */
export function fileFraction(done: number, total: number): number {
  if (!(total > 0)) return 1
  return done <= 0 ? 0 : done >= total ? 1 : done / total
}

/**
 * 開頭在 0%、結尾在 100% 各停多久，秒。
 *
 * 【為什麼要停】模型有快取或場景很小時，整段載入不到一幀 —— 畫面一閃而過，
 * 看不出是載入，像是跳了一下。頭尾各停一下，進度條才讀得出來。
 */
export const LOADING_HOLD_SECONDS = 0.1

export interface LoadingScreen {
  /** 蓋上畫面，進度歸零 */
  show(): void
  /** 畫出目前的狀態，再停 `LOADING_HOLD_SECONDS` */
  hold(): Promise<void>
  /** 換成這一步並推進度，**等瀏覽器畫出去才回來** */
  step(label: string, fraction: number): Promise<void>
  /**
   * 只改字與進度，不等繪製。給下載中的回呼用：檔案一支支到，瀏覽器本來就
   * 在畫，下一幀自然會帶出去
   */
  set(label: string, fraction: number): void
  /** 推到 100%、停 `LOADING_HOLD_SECONDS`，再收起 */
  finish(label: string): Promise<void>
  hide(): void
}

/**
 * 等瀏覽器真的畫過一次。**兩個 rAF**：第一個回呼在這一幀繪製之前執行，第二個
 * 才保證剛改的 DOM 已經畫出去。
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function wait(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

/** 接上 `index.html` 裡的 `#loading`。元素找不到就丟 —— 那是 HTML 與這裡對不上 */
export function createLoadingScreen(doc: Document = document): LoadingScreen {
  const pick = (id: string): HTMLElement => {
    const el = doc.getElementById(id)
    if (el === null) throw new Error(`載入畫面少了 #${id}`)
    return el
  }
  const root = pick('loading')
  const stepEl = pick('loading-step')
  const fill = pick('loading-fill')
  const pct = pick('loading-pct')

  const set = (label: string, fraction: number): void => {
    stepEl.textContent = label
    const p = loadingPercent(fraction)
    fill.style.width = p
    pct.textContent = p
  }

  return {
    show() {
      // 【0% 停著的那 0.1 秒也要有字】狀態列空著的話看起來像還沒畫好
      set('準備中', 0)
      root.hidden = false
    },
    async hold() {
      await nextPaint()
      await wait(LOADING_HOLD_SECONDS)
    },
    async step(label, fraction) {
      set(label, fraction)
      await nextPaint()
    },
    set,
    async finish(label) {
      set(label, 1)
      await nextPaint()
      await wait(LOADING_HOLD_SECONDS)
      root.hidden = true
    },
    hide() {
      root.hidden = true
    },
  }
}
