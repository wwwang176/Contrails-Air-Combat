import type { WebGLRenderer } from 'three'
import Stats from 'three/addons/libs/stats.module.js'

export interface PerfOverlay {
  /** `now` 是 `requestAnimationFrame` 給的時間戳 —— FPS 由相鄰兩次的差算 */
  begin(now: number): void
  beginPhysics(): void
  endPhysics(): void
  endFrame(substeps: number): void
  /** 開發資訊的開關。曲線那一排不受影響 —— 它一直都在 */
  toggle(): void
  readonly visible: boolean
  /** 最近 `SAMPLE_WINDOW` 幀的真實幀率（幀間隔平均的倒數） */
  readonly fps: number
}

const SAMPLE_WINDOW = 60

/**
 * 三條曲線各自的縱軸上限。
 *
 * 【為什麼要固定而不是跟著最大值長】`Stats.Panel` 畫的是一整排歷史像素，
 * 縱軸一變，畫面上舊的那幾十格就是用另一個比例畫的 —— 曲線於是在說謊，
 * 而且看不出來。
 *
 * 【三個值怎麼取的】都讓「及格線」落在半高，一眼就讀得出有沒有掉出去：
 * 60 FPS 對 120、16.7 ms 對 33 ms，物理則是一幀 60 FPS 預算的四分之一。
 */
const FPS_CEILING = 120
const FRAME_CEILING = 33
const PHYSICS_CEILING = 8

/**
 * 兩次 rAF 相隔超過這麼久就不算一幀，ms。
 *
 * 分頁切到背景時 rAF 會停；回來的第一幀間隔是好幾秒，算進平均的話 FPS
 * 會在接下來一秒內掉到個位數，看起來像當掉。
 */
const MAX_INTERVAL_MS = 1000

/**
 * 左上角的效能面板。
 *
 * 【FPS 量的是幀間隔，不是 `frame()` 花了多久】相鄰兩次 rAF 時間戳的差
 * 才包含 GPU、vsync、合成與 GC；`1000 / CPU 時間` 在 GPU 吃緊時會顯示
 * 100–200，而畫面實際只有 30。CPU 時間另外畫在 MS 那一格。
 *
 * 【為什麼平均值不夠，要有曲線】平均會把頓挫整個藏起來 —— 一幀 40 ms 的
 * 卡頓攤到 60 幀只讓平均動 0.6 ms。會咬人的正是那種瞬間尖峰。
 *
 * 【為什麼只借 `Stats.Panel` 而不用 `Stats` 那個容器】容器會在自己身上掛
 * click 去輪流切換面板，一次只顯示一格。這個遊戲的滑鼠是瞄準器 —— 面板
 * 因此整塊 `pointer-events:none`，而三條曲線要並排一起看。
 *
 * 【統計用環形緩衝】每幀都會走到，不配置記憶體。
 */
export function createPerfOverlay(renderer: WebGLRenderer): PerfOverlay {
  const root = document.createElement('div')
  root.style.cssText = [
    'position:fixed', 'top:8px', 'left:8px', 'z-index:100', 'pointer-events:none',
  ].join(';')

  const graphs = document.createElement('div')
  graphs.style.cssText = 'display:flex;gap:2px'
  root.appendChild(graphs)

  // 【FPS 恆亮】玩家要的只有這一格
  const fpsPanel = new Stats.Panel('FPS', '#9fe8b0', '#001a08')
  const framePanel = new Stats.Panel('CPU', '#ffcc44', '#1a1400')
  const physicsPanel = new Stats.Panel('PHY', '#5aa9ff', '#001020')
  graphs.appendChild(fpsPanel.dom)
  graphs.appendChild(framePanel.dom)
  graphs.appendChild(physicsPanel.dom)

  const text = document.createElement('div')
  text.style.cssText = [
    'font:11px/1.45 ui-monospace,Consolas,monospace',
    'color:#9fe8b0', 'background:rgba(0,0,0,.55)',
    'padding:6px 9px', 'border-radius:4px',
    'white-space:pre', 'margin-top:2px',
  ].join(';')
  root.appendChild(text)
  document.body.appendChild(root)

  // 【開發資訊預設關著】draw call 與子步數對玩家沒有意義，而這塊面板在
  // 成品裡也會在
  let visible = false
  const intervals = new Float64Array(SAMPLE_WINDOW)
  const frameTimes = new Float64Array(SAMPLE_WINDOW)
  const physicsTimes = new Float64Array(SAMPLE_WINDOW)
  let intervalCount = 0
  let intervalAt = 0
  let sampleCount = 0
  let sampleAt = 0
  let lastNow = -1
  let frameStart = 0
  let physicsStart = 0
  let physicsAccum = 0

  const avg = (arr: Float64Array, n: number): number => {
    if (n === 0) return 0
    let sum = 0
    for (let i = 0; i < n; i++) sum += arr[i]!
    return sum / n
  }
  const fps = (): number => {
    const ms = avg(intervals, intervalCount)
    return ms > 0 ? 1000 / ms : 0
  }

  const setVisible = (v: boolean) => {
    visible = v
    const d = v ? 'block' : 'none'
    framePanel.dom.style.display = d
    physicsPanel.dom.style.display = d
    text.style.display = d
  }
  setVisible(false)

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault()
      setVisible(!visible)
    }
  })

  return {
    get visible() {
      return visible
    },
    get fps() {
      return fps()
    },
    toggle: () => setVisible(!visible),
    begin(now) {
      frameStart = performance.now()
      physicsAccum = 0
      const interval = lastNow < 0 ? 0 : now - lastNow
      lastNow = now
      if (interval <= 0 || interval > MAX_INTERVAL_MS) return
      intervals[intervalAt] = interval
      intervalAt = (intervalAt + 1) % SAMPLE_WINDOW
      if (intervalCount < SAMPLE_WINDOW) intervalCount++
      // 【曲線吃這一幀的值，不是平均】它存在的理由就是讓尖峰看得見
      fpsPanel.update(1000 / interval, FPS_CEILING)
    },
    beginPhysics() {
      physicsStart = performance.now()
    },
    endPhysics() {
      physicsAccum += performance.now() - physicsStart
    },
    endFrame(substeps: number) {
      const frameMs = performance.now() - frameStart
      frameTimes[sampleAt] = frameMs
      physicsTimes[sampleAt] = physicsAccum
      sampleAt = (sampleAt + 1) % SAMPLE_WINDOW
      if (sampleCount < SAMPLE_WINDOW) sampleCount++

      if (!visible) return
      framePanel.update(frameMs, FRAME_CEILING)
      physicsPanel.update(physicsAccum, PHYSICS_CEILING)

      // 【數字吃平均】絕對值要的是穩定讀數，逐幀跳動的數字讀不出來
      const f = avg(frameTimes, sampleCount)
      const p = avg(physicsTimes, sampleCount)
      const perStepUs = substeps > 0 ? (p / substeps) * 1000 : 0
      const info = renderer.info
      text.textContent =
        `fps       ${fps().toFixed(1)}  (幀間隔 ${avg(intervals, intervalCount).toFixed(2)} ms)\n` +
        `cpu       ${f.toFixed(2)} ms\n` +
        `physics   ${p.toFixed(3)} ms  (${substeps} 子步)\n` +
        `per step  ${perStepUs.toFixed(1)} us\n` +
        `draw call ${info.render.calls}\n` +
        `triangles ${info.render.triangles}`
    },
  }
}
