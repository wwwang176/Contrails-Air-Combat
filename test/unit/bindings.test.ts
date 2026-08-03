import { describe, it, expect, afterEach } from 'vitest'
import { attachInput } from '../../src/input/bindings'
import { createInputState } from '../../src/input/InputState'

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

  it('R 設定 resetRequested、C 設定 swapSpecRequested', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    expect(state.resetRequested).toBe(false)
    dom.win.fire('keydown', key('KeyR'))
    expect(state.resetRequested).toBe(true)

    expect(state.swapSpecRequested).toBe(false)
    dom.win.fire('keydown', key('KeyC'))
    expect(state.swapSpecRequested).toBe(true)
  })

  it('detach 之後事件不再有任何作用', () => {
    const dom = setupDom()
    const state = createInputState()
    const b = attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    b.detach()
    expect(dom.win.count('mousemove')).toBe(0)

    dom.win.fire('mousemove', move(0.5, 0))
    dom.win.fire('keydown', key('KeyR'))
    expect(state.aimDeltaX).toBe(0)
    expect(state.resetRequested).toBe(false)
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

describe('靶機機動切換鍵', () => {
  const key = (code: string) => ({ code, preventDefault: () => {} })

  it('1 2 3 4 依序選到四種機動', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    expect(state.droneManoeuvre).toBe(0)
    for (const [code, index] of
      [['Digit2', 1], ['Digit3', 2], ['Digit4', 3], ['Digit1', 0]] as const) {
      dom.win.fire('keydown', key(code))
      expect(state.droneManoeuvre).toBe(index)
    }
  })
})

describe('靶機 AI 切換鍵', () => {
  const key = (code: string) => ({ code, preventDefault: () => {} })

  it('預設不是 AI；按 5 切成 AI', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    expect(state.droneAi).toBe(false)
    dom.win.fire('keydown', key('Digit5'))
    expect(state.droneAi).toBe(true)
  })

  it('按 1–4 回到預錄機動', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)

    dom.win.fire('keydown', key('Digit5'))
    expect(state.droneAi).toBe(true)
    dom.win.fire('keydown', key('Digit2'))
    expect(state.droneAi).toBe(false)
    expect(state.droneManoeuvre).toBe(1)
  })
})
