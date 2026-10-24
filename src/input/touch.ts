import type { InputState } from './InputState'
import { pressBomb, slewLook } from './actions'
import type { TouchHold } from './holdState'
import { onLangChange, t, type MessageKey } from '../i18n'
import { releaseTouchGrip, type Grip, type GripKind, type TouchRings } from './touchGrip'
import { TOUCH_STICK_RADIUS, touchStickPosition, type TouchStick } from './touchStick'

/**
 * 觸控拖曳瞄準的靈敏度：每拖「一個螢幕半高」瞄準點轉多少弧度。
 * 與滑鼠同一個單位，所以與螢幕大小無關。
 */
const TOUCH_AIM_SENSITIVITY = 1.6

/**
 * 手機直放。成立時 `index.html` 的 `#rotate` 蓋住整個畫面。
 *
 * 【與 index.html 的 media query 一字不差】這一份負責戰鬥中轉直時暫停
 */
const PHONE_PORTRAIT = '(pointer: coarse) and (orientation: portrait) and (max-width: 600px)'

export interface TouchControls {
  /** 交給 `bindings.tick` 的按住狀態 */
  readonly hold: TouchHold
  /** 觸控層現在顯示著 */
  readonly visible: boolean
  /** 最近一次輸入來自觸控。為真時出擊不要求指標鎖 */
  readonly active: boolean
  /** 觸控搖桿的位置（`touchStickPosition`）；沒有手指在推時是 0 */
  readonly stick: Readonly<TouchStick>
  /**
   * 搖桿歸零：還按著的那根手指，它現在的位置變成新的中心。`playerControl` 歸零搖桿時一起呼叫 ——
   * 只清 `InputState` 的話，下一幀照抄觸控又把手指的位移灌回來
   */
  recentre(): void
  /** 每幀呼叫：`show` 是這一幀能不能操作（戰鬥中、沒暫停、還沒分出勝負） */
  sync(show: boolean): void
}

/**
 * 觸控操作層：**左半邊拖曳 = 瞄準**（設定是滑鼠搖桿時是**推搖桿**）、**右半邊拖曳 = 自由視角**，
 * 按鈕都在右邊。
 *
 * 寫的是與鍵鼠同一份 `InputState`：瞄準累加到 `aimDeltaX/Y`（與滑鼠同一個
 * 單位），自由視角走 `slewLook`，投彈鈕走 `pressBomb`，望遠鈕按住時 `zoom`。
 * 搖桿位置寫進 `stick`，由 `playerControl` 照抄進 `InputState.stickX/Y`。
 *
 * 【按下的那一刻決定歸屬】手指落在按鈕上，整段都算按鈕；落在空白處，依左右
 * 半邊算瞄準或視角。右拇指從視角區滑過開火鈕不會誤觸，反過來也一樣。
 * 上帝視角下左半邊一律是瞄準：上帝鏡頭吃的是 `aimDeltaX/Y`。
 *
 * 【搖桿只認一根手指】已經有手指在推時，左半邊再按下去的手指整段不算數 —— 兩根一起寫同一份
 * 位置的話，放開任一根都會把另一根的桿量清掉。
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
  const rings: TouchRings = {
    aim: root.querySelector('.t-ring.aim') as HTMLElement,
    look: root.querySelector('.t-ring.look') as HTMLElement,
    stick: root.querySelector('.t-ring.stick') as HTMLElement,
  }
  const stick: TouchStick = { x: 0, y: 0 }
  // 正在推搖桿的那根手指；它的 `x/y` 是搖桿中心
  let stickGrip: Grip | null = null
  // 那根手指現在的位置，`recentre` 拿它當新的中心
  let fingerX = 0
  let fingerY = 0
  // 這一段搖桿拖曳的滿桿位移，px。按下時依視窗高度定，拖曳中轉向也不換
  let stickRadius = 1
  // 【初值要與 index.html 一致】投彈鈕在 HTML 裡是 hidden；這裡寫 true 的話
  // 轟炸機第一幀比對「沒變」，按鈕就永遠不出來
  let fireLabel: MessageKey | null = null
  let bombLabel: MessageKey | null = null
  let bombShown = false
  // 換語言時清掉，下一幀照新的語言重寫
  onLangChange(() => { fireLabel = null; bombLabel = null })

  const ringAt = (ring: HTMLElement, x: number, y: number): void => {
    ring.style.transform = `translate(${x}px, ${y}px)`
  }

  const release = (id: number): void => {
    const g = grips.get(id)
    if (g === undefined) return
    grips.delete(id)
    if (g === stickGrip) stickGrip = null
    releaseTouchGrip(g, state, hold, rings, stick)
  }

  const releaseAll = (): void => {
    for (const id of [...grips.keys()]) release(id)
  }

  function recentre(): void {
    stick.x = 0
    stick.y = 0
    // 【中心沒變就不寫】死亡鏡頭期間每幀都歸零，手指不動時不重組字串、不寫 DOM
    if (stickGrip === null || (stickGrip.x === fingerX && stickGrip.y === fingerY)) return
    stickGrip.x = fingerX
    stickGrip.y = fingerY
    ringAt(rings.stick, fingerX - stickRadius, fingerY - stickRadius)
  }

  // 【任何一下按壓都判一次來源】筆電的觸控螢幕與滑鼠可以交替用
  window.addEventListener('pointerdown', (e) => { active = e.pointerType === 'touch' }, true)

  root.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-t]')
    const kind: GripKind = el !== null
      ? el.dataset['t'] as GripKind
      : e.clientX >= window.innerWidth / 2 ? 'look'
        : state.controlMode === 'stick' && !state.godView ? 'stick' : 'aim'
    if (kind === 'stick' && stickGrip !== null) return
    root.setPointerCapture(e.pointerId)
    const grip: Grip = { kind, x: e.clientX, y: e.clientY, el }
    grips.set(e.pointerId, grip)
    el?.classList.add('down')
    switch (kind) {
      case 'aim': rings.aim.hidden = false; ringAt(rings.aim, e.clientX, e.clientY); break
      case 'stick': {
        // 方框邊長 2R：框邊就是滿桿
        stickRadius = TOUCH_STICK_RADIUS * window.innerHeight
        rings.stick.style.width = rings.stick.style.height = `${2 * stickRadius}px`
        rings.stick.hidden = false
        ringAt(rings.stick, e.clientX - stickRadius, e.clientY - stickRadius)
        stickGrip = grip
        fingerX = e.clientX
        fingerY = e.clientY
        stick.x = 0
        stick.y = 0
        break
      }
      case 'look': rings.look.hidden = false; ringAt(rings.look, e.clientX, e.clientY); state.lookActive = true; break
      case 'fire': hold.fire = true; state.firing = true; break
      case 'up': hold.up = true; break
      case 'down': hold.down = true; state.braking = true; break
      case 'score': state.scoreboardHeld = true; break
      case 'bomb': pressBomb(state); break
      case 'view': if (!state.dead) state.zoom = true; break
      case 'pause': state.pauseRequested = true; break
    }
  })

  root.addEventListener('pointermove', (e) => {
    const g = grips.get(e.pointerId)
    if (g === undefined) return
    if (g.kind === 'stick') {
      // 相對搖桿中心，所以 `g.x/y` 不更新
      fingerX = e.clientX
      fingerY = e.clientY
      touchStickPosition(fingerX - g.x, fingerY - g.y, stickRadius, stick)
      return
    }
    const half = window.innerHeight / 2
    const dx = ((e.clientX - g.x) / half) * state.mouseSensitivity
    const dy = ((e.clientY - g.y) / half) * state.mouseSensitivity
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

  // 【切到背景、轉成直放都暫停】手機上最常見的「離開」是回主畫面或來電，
  // 沒有 Esc 可按；直放時提示蓋住整個畫面，戰鬥不能在底下繼續打
  const leave = (): void => {
    if (!visible) return
    releaseAll()
    state.pauseRequested = true
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) leave() })
  const portrait = window.matchMedia(PHONE_PORTRAIT)
  portrait.addEventListener('change', () => { if (portrait.matches) leave() })

  return {
    hold,
    get visible() { return visible },
    get active() { return active },
    stick,
    recentre,
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
      const fire: MessageKey = state.viewMode === 'bomb' ? 'touch.drop' : 'touch.fire'
      if (fire !== fireLabel) { fireLabel = fire; fireBtn.textContent = t(fire) }
      const shown = state.bombCapable || state.bombRelease
      if (shown !== bombShown) { bombShown = shown; bombBtn.hidden = !shown }
      const bomb: MessageKey = state.bombRelease ? 'touch.drop' : state.viewMode === 'bomb' ? 'touch.back' : 'touch.sight'
      if (bomb !== bombLabel) { bombLabel = bomb; bombBtn.textContent = t(bomb) }
    },
  }
}
