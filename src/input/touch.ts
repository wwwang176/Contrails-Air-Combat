import type { InputState } from './InputState'
import { endLook, pressBomb, pressView, slewLook, type TouchHold } from './bindings'

/**
 * 觸控拖曳瞄準的靈敏度：每拖「一個螢幕半高」瞄準點轉多少弧度。
 * 與滑鼠同一個單位，所以與螢幕大小無關。
 */
const TOUCH_AIM_SENSITIVITY = 1.6

/** 一根手指按下時抓到的東西。整段拖曳都算它，拖出範圍也不換 */
type GripKind = 'aim' | 'look' | 'fire' | 'up' | 'down' | 'score' | 'bomb' | 'view' | 'pause'

interface Grip {
  kind: GripKind
  x: number
  y: number
  /** 按鈕本身；拖曳區是 null */
  el: HTMLElement | null
}

export interface TouchControls {
  /** 交給 `bindings.tick` 的按住狀態 */
  readonly hold: TouchHold
  /** 觸控層現在顯示著 */
  readonly visible: boolean
  /** 最近一次輸入來自觸控。為真時出擊不要求指標鎖 */
  readonly active: boolean
  /** 每幀呼叫：`show` 是這一幀能不能操作（戰鬥中、沒暫停、還沒分出勝負） */
  sync(show: boolean): void
}

/**
 * 觸控操作層：**左半邊拖曳 = 瞄準**、**右半邊拖曳 = 自由視角**，按鈕都在右邊。
 *
 * 寫的是與鍵鼠同一份 `InputState`：瞄準累加到 `aimDeltaX/Y`（與滑鼠同一個
 * 單位），自由視角走 `slewLook`，投彈與視角鈕走 `pressBomb`／`pressView`。
 * 飛行控制完全不知道輸入來自哪裡。
 *
 * 【按下的那一刻決定歸屬】手指落在按鈕上，整段都算按鈕；落在空白處，依左右
 * 半邊算瞄準或視角。右拇指從視角區滑過開火鈕不會誤觸，反過來也一樣。
 *
 * 【pointerdown 一律 preventDefault】否則瀏覽器會補送相容的 mouse 事件，
 * `bindings` 的 window mouseup 會把扳機清掉。
 */
export function attachTouch(root: HTMLElement, state: InputState): TouchControls {
  const hold: TouchHold = { up: false, down: false, fire: false }
  const grips = new Map<number, Grip>()
  let active = window.matchMedia('(pointer: coarse)').matches
  let visible = false

  const fireBtn = root.querySelector('[data-t="fire"]') as HTMLElement
  const bombBtn = root.querySelector('[data-t="bomb"]') as HTMLElement
  const aimRing = root.querySelector('.t-ring.aim') as HTMLElement
  const lookRing = root.querySelector('.t-ring.look') as HTMLElement
  // 【初值要與 index.html 一致】投彈鈕在 HTML 裡是 hidden；這裡寫 true 的話
  // 轟炸機第一幀比對「沒變」，按鈕就永遠不出來
  let fireLabel = ''
  let bombLabel = ''
  let bombShown = false

  const ringAt = (ring: HTMLElement, x: number, y: number): void => {
    ring.style.transform = `translate(${x}px, ${y}px)`
  }

  const release = (id: number): void => {
    const g = grips.get(id)
    if (g === undefined) return
    grips.delete(id)
    g.el?.classList.remove('down')
    switch (g.kind) {
      case 'aim': aimRing.hidden = true; break
      case 'look': lookRing.hidden = true; endLook(state); break
      case 'fire': hold.fire = false; state.firing = false; break
      case 'up': hold.up = false; break
      case 'down': hold.down = false; state.braking = false; break
      case 'score': state.scoreboardHeld = false; break
      default: break
    }
  }

  const releaseAll = (): void => {
    for (const id of [...grips.keys()]) release(id)
  }

  // 【任何一下按壓都判一次來源】筆電的觸控螢幕與滑鼠可以交替用
  window.addEventListener('pointerdown', (e) => { active = e.pointerType === 'touch' }, true)

  root.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-t]')
    const kind: GripKind = el !== null
      ? el.dataset['t'] as GripKind
      : e.clientX < window.innerWidth / 2 ? 'aim' : 'look'
    root.setPointerCapture(e.pointerId)
    grips.set(e.pointerId, { kind, x: e.clientX, y: e.clientY, el })
    el?.classList.add('down')
    switch (kind) {
      case 'aim': aimRing.hidden = false; ringAt(aimRing, e.clientX, e.clientY); break
      case 'look': lookRing.hidden = false; ringAt(lookRing, e.clientX, e.clientY); state.lookActive = true; break
      case 'fire': hold.fire = true; state.firing = true; break
      case 'up': hold.up = true; break
      case 'down': hold.down = true; state.braking = true; break
      case 'score': state.scoreboardHeld = true; break
      case 'bomb': pressBomb(state); break
      case 'view': pressView(state); break
      case 'pause': state.pauseRequested = true; break
    }
  })

  root.addEventListener('pointermove', (e) => {
    const g = grips.get(e.pointerId)
    if (g === undefined) return
    const half = window.innerHeight / 2
    const dx = (e.clientX - g.x) / half
    const dy = (e.clientY - g.y) / half
    g.x = e.clientX
    g.y = e.clientY
    if (g.kind === 'aim') {
      state.aimDeltaX += dx * TOUCH_AIM_SENSITIVITY
      state.aimDeltaY -= dy * TOUCH_AIM_SENSITIVITY
    } else if (g.kind === 'look') {
      slewLook(state, dx, dy)
    }
  })

  root.addEventListener('pointerup', (e) => release(e.pointerId))
  root.addEventListener('pointercancel', (e) => release(e.pointerId))
  root.addEventListener('contextmenu', (e) => e.preventDefault())

  // 【切到背景就暫停】手機上最常見的「離開」是回主畫面或來電，沒有 Esc 可按
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !visible) return
    releaseAll()
    state.pauseRequested = true
  })

  return {
    hold,
    get visible() { return visible },
    get active() { return active },
    sync(show) {
      const next = show && active
      if (next !== visible) {
        visible = next
        root.hidden = !next
        // 【齒輪在觸控飛行中藏起來】暫停鈕取代它；飛行中打開設定不會暫停
        document.body.classList.toggle('touch-play', next)
        if (!next) releaseAll()
      }
      if (!next) return
      // 【只在字變了才寫 DOM】這支每幀跑
      const fire = state.viewMode === 'bomb' ? '投彈' : '開火'
      if (fire !== fireLabel) { fireLabel = fire; fireBtn.textContent = fire }
      const shown = state.bombCapable || state.bombRelease
      if (shown !== bombShown) { bombShown = shown; bombBtn.hidden = !shown }
      const bomb = state.bombRelease ? '投彈' : state.viewMode === 'bomb' ? '返回' : '瞄準鏡'
      if (bomb !== bombLabel) { bombLabel = bomb; bombBtn.textContent = bomb }
    },
  }
}
