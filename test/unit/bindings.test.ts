import { describe, it, expect, afterEach } from 'vitest'
import { attachInput } from '../../src/input/bindings'
import { createInputState, CRUISE_THROTTLE } from '../../src/input/InputState'

/**
 * bindings.ts 是純 DOM 外殼，但「右鍵自由視角絕不移動瞄準點」這條性質
 * 只有在這一層才驗得到——它取決於事件處理器的分流，不是任何純函式的性質。
 * 因此這裡用最小的 DOM 替身（不是 jsdom）把處理器抓出來直接呼叫，
 * 測試仍然在 node 環境、不啟動任何渲染。
 */
type Handler = (e: unknown) => void

class FakeTarget {
  readonly handlers = new Map<string, Handler[]>()
  addEventListener(type: string, h: Handler) {
    const list = this.handlers.get(type) ?? []
    list.push(h)
    this.handlers.set(type, list)
  }
  removeEventListener(type: string, h: Handler) {
    const list = this.handlers.get(type)
    if (list) this.handlers.set(type, list.filter((x) => x !== h))
  }
  fire(type: string, event: unknown) {
    for (const h of this.handlers.get(type) ?? []) h(event)
  }
  count(type: string) {
    return (this.handlers.get(type) ?? []).length
  }
}

interface Dom {
  canvas: FakeTarget
  win: FakeTarget
  doc: { pointerLockElement: unknown }
}

const HALF_HEIGHT = 500 // window.innerHeight = 1000

function setupDom(locked = true): Dom {
  const canvas = new FakeTarget()
  const doc = { pointerLockElement: locked ? (canvas as unknown) : null }
  const win = new FakeTarget()
  Object.assign(canvas, { requestPointerLock: () => { doc.pointerLockElement = canvas } })
  Object.assign(win, { innerHeight: HALF_HEIGHT * 2 })
  const g = globalThis as unknown as Record<string, unknown>
  g['window'] = win
  g['document'] = doc
  return { canvas, win, doc }
}

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>
  delete g['window']
  delete g['document']
})

/** movementX/Y 以「畫面半高」為單位方便換算：1.0 = 半個畫面高。 */
const move = (dxHalf: number, dyHalf: number) => ({
  movementX: dxHalf * HALF_HEIGHT,
  movementY: dyHalf * HALF_HEIGHT,
})

describe('attachInput：瞄準點位移的累積', () => {
  it('取得 pointer lock 後，滑鼠右移累積 +aimDeltaX、上移累積 +aimDeltaY', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    dom.win.fire('mousemove', move(0.1, 0)) // 往右
    expect(state.aimDeltaX).toBeGreaterThan(0)
    expect(state.aimDeltaY).toBe(0)

    state.aimDeltaX = 0
    dom.win.fire('mousemove', move(0, -0.1)) // DOM 的 movementY 為負 = 往上
    expect(state.aimDeltaY).toBeGreaterThan(0)
    expect(state.aimDeltaX).toBe(0)
  })

  it('位移是累加的，讓一幀內的多個事件合成一次 slew', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    dom.win.fire('mousemove', move(0.05, 0))
    const first = state.aimDeltaX
    dom.win.fire('mousemove', move(0.05, 0))
    expect(state.aimDeltaX).toBeCloseTo(first * 2, 12)
  })

  it('沒有 pointer lock 時完全不理會滑鼠', () => {
    const dom = setupDom(false)
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    dom.win.fire('mousemove', move(0.5, 0.5))
    expect(state.aimDeltaX).toBe(0)
    expect(state.aimDeltaY).toBe(0)
  })

  it('瞄準點本身不被 bindings 觸碰——旋轉與夾制是飛行迴圈的事', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    dom.win.fire('mousemove', move(0.3, 0.2))
    expect(state.aimWorld.x).toBe(0)
    expect(state.aimWorld.y).toBe(0)
    expect(state.aimWorld.z).toBe(-1)
  })
})

describe('attachInput：自由視角（右鍵）不得移動瞄準點', () => {
  it('按住右鍵時滑鼠位移只改變 lookYaw/lookPitch，一點也不進 aimDelta', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    dom.win.fire('mousemove', move(0.2, 0)) // 先正常移動一次
    const aimBefore = { x: state.aimDeltaX, y: state.aimDeltaY }
    expect(aimBefore.x).toBeGreaterThan(0)

    dom.canvas.fire('mousedown', { button: 2 }) // 按住右鍵
    expect(state.lookActive).toBe(true)

    dom.win.fire('mousemove', move(0.4, -0.3))
    dom.win.fire('mousemove', move(-0.2, 0.5))

    // 瞄準位移一動也沒動
    expect(state.aimDeltaX).toBe(aimBefore.x)
    expect(state.aimDeltaY).toBe(aimBefore.y)
    // 視角確實動了
    expect(state.lookYaw).not.toBe(0)
    expect(state.lookPitch).not.toBe(0)
  })

  it('放開右鍵後視角歸零，瞄準位移恢復累積', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    dom.canvas.fire('mousedown', { button: 2 })
    dom.win.fire('mousemove', move(0.4, 0))
    dom.win.fire('mouseup', { button: 2 })

    expect(state.lookActive).toBe(false)
    expect(state.lookYaw).toBe(0)
    expect(state.lookPitch).toBe(0)

    dom.win.fire('mousemove', move(0.1, 0))
    expect(state.aimDeltaX).toBeGreaterThan(0)
  })
})

describe('attachInput：鍵盤旗標與解除綁定', () => {
  const key = (code: string) => ({ code, preventDefault: () => {} })

  it('C 與 R 都不再有任何作用 —— 換機種與重開都由選單擁有', () => {
    // 【為什麼要留一條測試守兩個「不做事」的鍵】它們曾經有行為，而且是
    // M2 時代那種「一個鍵一個功能」的臨時鷹架：
    //
    // - `C` 寫死成「P-51 ⇄ Bf 109」二選一、與陣營無關 —— 選了軸心國之後
    //   按下去，玩家會在藍隊裡開著一台跟敵人一模一樣的 P-51。M10 起機種
    //   由遭遇戰設定頁決定（`battle/skirmish.ts`）。
    // - `R` 的行為本身沒壞，但它只出現在 HUD 提示那一行 —— 一個能用卻沒
    //   寫在任何地方的鍵。M10 起「重新開始」長在暫停選單上。
    //
    // 沒有這一條，哪天有人把 `KeyC`／`KeyR` 接到別的功能上，不會有任何
    // 東西提醒他這兩個鍵有過歷史。
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    const before = JSON.stringify(state)
    for (const code of ['KeyC', 'KeyR']) {
      dom.win.fire('keydown', key(code))
      dom.win.fire('keyup', key(code))
    }
    expect(JSON.stringify(state)).toBe(before)
  })

  it('detach 之後事件不再有任何作用', () => {
    const dom = setupDom()
    const state = createInputState()
    const b = attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    b.detach()
    expect(dom.win.count('mousemove')).toBe(0)

    dom.win.fire('mousemove', move(0.5, 0))
    dom.win.fire('keydown', key('KeyI'))
    expect(state.aimDeltaX).toBe(0)
    expect(state.playerAi).toBe(false)
  })
})

describe('開火鍵（滑鼠左鍵）', () => {
  it('未鎖定指標時，左鍵只請求鎖定、不開火', () => {
    const dom = setupDom(false)
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    dom.canvas.fire('mousedown', { button: 0 })
    expect(state.firing).toBe(false)
    // 第一次點擊的用途是進入遊戲——指標鎖確實被請求了
    expect(dom.doc.pointerLockElement).toBe(dom.canvas)
  })

  it('已鎖定指標時，左鍵按下即開火、放開即停火', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    dom.canvas.fire('mousedown', { button: 0 })
    expect(state.firing).toBe(true)
    dom.win.fire('mouseup', { button: 0 })
    expect(state.firing).toBe(false)
  })

  it('右鍵自由視角不會誤觸開火', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    dom.canvas.fire('mousedown', { button: 2 })
    expect(state.firing).toBe(false)
    expect(state.lookActive).toBe(true)
  })

  it('失去指標鎖時停火 —— 否則切出視窗會卡住扳機', () => {
    // 【為什麼由 tick 檢查而不是監聽 pointerlockchange】既有測試的 doc
    // 替身只有 pointerLockElement 一個欄位，沒有 addEventListener；加監聽器
    // 會讓 M1 那一整檔的測試在 attachInput 就拋錯。tick 每幀本來就會呼叫，
    // 拿它順手檢查一次是零成本的做法。
    const dom = setupDom()
    const state = createInputState()
    const b = attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    dom.canvas.fire('mousedown', { button: 0 })
    expect(state.firing).toBe(true)

    dom.doc.pointerLockElement = null
    b.tick(1 / 60)
    expect(state.firing).toBe(false)
  })

  it('detach 之後左鍵不再開火', () => {
    const dom = setupDom()
    const state = createInputState()
    const b = attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    b.detach()
    dom.canvas.fire('mousedown', { button: 0 })
    expect(state.firing).toBe(false)
  })
})

describe('自機 AI 接管鍵', () => {
  const key = (code: string) => ({ code, preventDefault: () => {} })

  it('預設由玩家駕駛；按 I 交給 AI，再按一次收回', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    expect(state.playerAi).toBe(false)
    dom.win.fire('keydown', key('KeyI'))
    expect(state.playerAi).toBe(true)
    dom.win.fire('keydown', key('KeyI'))
    expect(state.playerAi).toBe(false)
  })

})

describe('TAB 記分板（M9 spec §9.4）', () => {
  it('按住為真、放開為假', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    expect(state.scoreboardHeld).toBe(false)
    dom.win.fire('keydown', { code: 'Tab', preventDefault() {} })
    expect(state.scoreboardHeld).toBe(true)
    dom.win.fire('keyup', { code: 'Tab' })
    expect(state.scoreboardHeld).toBe(false)
  })

  it('按住時要擋掉預設行為', () => {
    // 【為什麼】Tab 的預設行為是移動焦點 —— 不擋的話按一次就把焦點移出
    // canvas，之後所有鍵盤輸入都收不到。
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    let prevented = 0
    dom.win.fire('keydown', { code: 'Tab', preventDefault() { prevented++ } })
    expect(prevented).toBe(1)
  })
})

describe('指標鎖定掉了（M10 spec §8.2）', () => {
  it('鎖定期間為假，鎖定消失的那一次 tick 為真', () => {
    // 【為什麼不是綁 Escape 的 keydown】指標鎖定期間按 ESC，瀏覽器會解除
    // 鎖定並**吃掉那個鍵盤事件**。暫停必須由「鎖定沒了」觸發。
    const dom = setupDom()
    const state = createInputState()
    const b = attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    b.tick(1 / 60)
    expect(state.pointerLockLost).toBe(false)

    dom.doc.pointerLockElement = null
    b.tick(1 / 60)
    expect(state.pointerLockLost).toBe(true)
  })

  it('是單幀旗標 —— 呼叫端清掉之後不會自己又變真', () => {
    // 【為什麼要守】沒有邊緣偵測的話，指標鎖定沒回來的每一幀都會再送一次
    // 「暫停」，而玩家按了「繼續」也會立刻被彈回暫停選單。
    const dom = setupDom()
    const state = createInputState()
    const b = attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    dom.doc.pointerLockElement = null
    b.tick(1 / 60)
    expect(state.pointerLockLost).toBe(true)
    state.pointerLockLost = false
    b.tick(1 / 60)
    expect(state.pointerLockLost).toBe(false)
  })

  it('鎖定回來之後再掉一次會再送一次', () => {
    const dom = setupDom()
    const state = createInputState()
    const b = attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    dom.doc.pointerLockElement = null
    b.tick(1 / 60)
    state.pointerLockLost = false
    dom.doc.pointerLockElement = dom.canvas
    b.tick(1 / 60)
    expect(state.pointerLockLost).toBe(false)
    dom.doc.pointerLockElement = null
    b.tick(1 / 60)
    expect(state.pointerLockLost).toBe(true)
  })
})

describe('attachInput：上帝視角', () => {
  const key = (code: string) => ({ code, preventDefault: () => {} })

  it('G 切換 godView', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    expect(state.godView).toBe(false)
    dom.win.fire('keydown', key('KeyG'))
    expect(state.godView).toBe(true)
    dom.win.fire('keydown', key('KeyG'))
    expect(state.godView).toBe(false)
  })

  /**
   * 【油門要先推離巡航才驗得到】`applyThrottleRate` 是**彈簧回中**的
   * （`throttle.ts:53-55`）：起始值就是 `CRUISE_THROTTLE`，放手時它原地
   * 不動，所以在巡航值上斷言「油門沒變」有沒有守衛都會過。
   *
   * 推離巡航之後就分得開了：有 `if (!godView)` 守衛時停在原處，沒有的話
   * 會以 0.6/s 掉回 0.7。
   *
   * 【`tick(0.5)` 而不是 `tick(1)`】1 秒會把油門推到上界 1.1，而 1.1 正是
   * `applyThrottleRate(_, up=true, …)` 的**不動點**（`throttle.ts:47` 的
   * `Math.min`）—— 停在那裡的話，「W 真的被改道了」與「W 還在餵 hold.up」
   * 分不出來。0.5 秒落在 1.0，兩種壞法都測得到。
   */
  it('上帝視角下 W/S 不動油門、不設 braking', () => {
    const dom = setupDom()
    const state = createInputState()
    const b = attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    dom.win.fire('keydown', key('KeyW'))
    b.tick(0.5)
    const raised = state.throttle
    expect(raised).toBeGreaterThan(CRUISE_THROTTLE)

    dom.win.fire('keydown', key('KeyG'))
    dom.win.fire('keydown', key('KeyW'))
    dom.win.fire('keydown', key('KeyS'))
    b.tick(1)
    expect(state.throttle).toBe(raised)
    expect(state.braking).toBe(false)
  })

  /**
   * 【失去指標鎖也要清 hold】與「切出視窗扳機卡住」是同一類 bug，但比它
   * 嚴重：油門有 1.1 的上界，`godMove` 沒有。
   *
   * 失敗情境：上帝視角按著 `W` 時 Alt-Tab —— 瀏覽器不送 `keyup`，
   * `godMove.forward` 留在 true。失去鎖定會讓 `main.ts` 進暫停（所以當下
   * 不會動），玩家按「繼續」之後鏡頭就以 300 m/s（按著 Shift 是 1200）
   * 一路飛走，而且他找不到原因 —— 要再按一次 `W` 並放開才停得下來。
   */
  it('上帝視角下失去指標鎖，卡住的 godMove 要被清掉', () => {
    const dom = setupDom()
    const state = createInputState()
    const b = attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    dom.win.fire('keydown', key('KeyG'))
    dom.win.fire('keydown', key('KeyW'))
    dom.win.fire('keydown', key('ShiftLeft'))
    expect(state.godMove.forward).toBe(true)

    // Alt-Tab：鎖定沒了，而 keyup 永遠不會來
    dom.doc.pointerLockElement = null
    b.tick(1 / 60)
    expect(state.godMove.forward).toBe(false)
    expect(state.godMove.boost).toBe(false)
  })

  /**
   * 【沒有鎖定時不能每幀清】清了的話 `WASD` 在取得指標鎖之前完全不會動 ——
   * 而上帝視角是可以在沒鎖定的情況下用的（全部走鍵盤）。要清的是**邊緣**，
   * 與 `pointerLockLost` 同一個判斷。
   */
  it('一直沒有鎖定時，godMove 照常累積', () => {
    const dom = setupDom(false)
    const state = createInputState()
    const b = attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    dom.win.fire('keydown', key('KeyG'))
    dom.win.fire('keydown', key('KeyW'))
    b.tick(1 / 60)
    b.tick(1 / 60)
    expect(state.godMove.forward).toBe(true)
  })

  /**
   * 【上帝視角下右鍵不能吃掉滑鼠】`onMouseMove` 在 `lookActive` 時提早
   * return，`aimDelta` 因此不再累積 —— 而上帝視角餵給鏡頭的就是那兩個值。
   * 不擋的話按住右鍵等於「鏡頭壞了」，而按鍵提示裡根本沒有右鍵。
   */
  it('上帝視角下按住右鍵，滑鼠照樣轉得動鏡頭', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    dom.win.fire('keydown', key('KeyG'))
    dom.canvas.fire('mousedown', { button: 2 })
    dom.win.fire('mousemove', { movementX: 100, movementY: 0 })
    expect(state.aimDeltaX).not.toBe(0)
    expect(state.lookYaw).toBe(0)
  })

  it('上帝視角下六個方向鍵與 Shift 寫進 godMove', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    dom.win.fire('keydown', key('KeyG'))
    for (const c of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft']) {
      dom.win.fire('keydown', key(c))
    }
    expect(state.godMove).toEqual({
      forward: true, back: true, left: true, right: true,
      up: true, down: true, boost: true,
    })
    for (const c of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft']) {
      dom.win.fire('keyup', key(c))
    }
    expect(state.godMove).toEqual({
      forward: false, back: false, left: false, right: false,
      up: false, down: false, boost: false,
    })
  })

  /**
   * 【離開時要清 godMove】與 `tick()` 裡記載的「切出視窗扳機卡住」同一類
   * bug：按著 W 按 G 離開，`godMove.forward` 會留在 true，下次進上帝視角
   * 第一幀鏡頭就自己往前衝。
   */
  it('離開上帝視角會清掉 godMove', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    dom.win.fire('keydown', key('KeyG'))
    dom.win.fire('keydown', key('KeyW'))
    expect(state.godMove.forward).toBe(true)
    dom.win.fire('keydown', key('KeyG'))
    expect(state.godMove.forward).toBe(false)
  })

  /**
   * 【進入時要清飛行側的 hold】`hold.up` 是 `attachInput` 的區域變數，
   * 外面看不到，所以用「切回來之後油門有沒有繼續漲」來驗：沒清乾淨的話
   * 它會一路衝到 1.1。
   */
  it('進入上帝視角會清掉飛行側的 hold', () => {
    const dom = setupDom()
    const state = createInputState()
    const b = attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    dom.win.fire('keydown', key('KeyW'))
    dom.win.fire('keydown', key('KeyG'))
    dom.win.fire('keydown', key('KeyG'))
    // 回到飛行，而且沒有任何鍵被按著 —— 油門應該回中而不是繼續漲
    b.tick(1)
    expect(state.throttle).toBe(CRUISE_THROTTLE)
  })

  /** 【`clearHolds` 是給 `main.ts` 用的】重開一場時它直接改 `godView` */
  it('clearHolds 清掉上帝側的 hold', () => {
    const dom = setupDom()
    const state = createInputState()
    const b = attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    dom.win.fire('keydown', key('KeyG'))
    dom.win.fire('keydown', key('KeyE'))
    expect(state.godMove.up).toBe(true)
    b.clearHolds()
    expect(state.godMove.up).toBe(false)
  })
})

describe('attachInput：投彈模式', () => {
  /** 【自己帶一份】`key` 在這個檔案裡是每個 describe 各自的區域常數 */
  const key = (code: string): unknown => ({ code, preventDefault: () => {} })

  const arm = (capable: boolean) => {
    const dom = setupDom()
    const state = createInputState()
    state.bombCapable = capable
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    return { dom, state }
  }

  it('B 在帶彈的飛機上切換投彈模式', () => {
    const { dom, state } = arm(true)
    dom.win.fire('keydown', key('KeyB'))
    expect(state.viewMode).toBe('bomb')
    dom.win.fire('keydown', key('KeyB'))
    expect(state.viewMode).toBe('third')
  })

  it('沒有掛彈時 B 沒有作用', () => {
    const { dom, state } = arm(false)
    dom.win.fire('keydown', key('KeyB'))
    expect(state.viewMode).toBe('third')
  })

  it('投彈模式下 V 沒有作用 —— 它的軸是座艙／機外，投彈不在那條軸上', () => {
    const { dom, state } = arm(true)
    dom.win.fire('keydown', key('KeyB'))
    dom.win.fire('keydown', key('KeyV'))
    expect(state.viewMode).toBe('bomb')
  })

  it('機首視角下按 B 也進得去，退出時回機外', () => {
    const { dom, state } = arm(true)
    dom.win.fire('keydown', key('KeyV'))
    expect(state.viewMode).toBe('first')
    dom.win.fire('keydown', key('KeyB'))
    expect(state.viewMode).toBe('bomb')
    dom.win.fire('keydown', key('KeyB'))
    expect(state.viewMode).toBe('third')
  })

  it('上帝視角吃掉 B —— 鏡頭都不在飛機上了', () => {
    const { dom, state } = arm(true)
    dom.win.fire('keydown', key('KeyG'))
    dom.win.fire('keydown', key('KeyB'))
    expect(state.viewMode).toBe('third')
  })

  it('陣亡中 B 沒有作用 —— 死亡鏡頭不給切進瞄具', () => {
    const { dom, state } = arm(true)
    state.dead = true
    dom.win.fire('keydown', key('KeyB'))
    expect(state.viewMode).toBe('third')
  })
})

describe('attachInput：陣亡中的右鍵', () => {
  it('陣亡中按住右鍵，滑鼠既不轉頭也不進 aimDelta', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    state.dead = true
    dom.canvas.fire('mousedown', { button: 2 })
    dom.win.fire('mousemove', move(0.4, -0.3))
    expect(state.lookYaw).toBe(0)
    expect(state.lookPitch).toBe(0)
    expect(state.aimDeltaX).toBe(0)
    expect(state.aimDeltaY).toBe(0)
  })

  it('接手之後（dead 解除）右鍵轉頭恢復', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    state.dead = true
    dom.canvas.fire('mousedown', { button: 2 })
    dom.win.fire('mousemove', move(0.4, 0))
    expect(state.lookYaw).toBe(0)
    state.dead = false
    dom.win.fire('mousemove', move(0.4, 0))
    expect(state.lookYaw).not.toBe(0)
  })
})
