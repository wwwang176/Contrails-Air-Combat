import type { WebGLRenderer } from 'three'
import Stats from 'three/addons/libs/stats.module.js'

export interface PerfOverlay {
  begin(): void
  beginPhysics(): void
  endPhysics(): void
  endFrame(substeps: number): void
  /** 開發資訊的開關。曲線那一排不受影響 —— 它一直都在 */
  toggle(): void
  readonly visible: boolean
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
 * 左上角的效能面板。
 *
 * 【為什麼平均值不夠，要有曲線】原本整塊面板都是 60 幀平均，而平均會把
 * 頓挫整個藏起來 —— 一幀 40 ms 的卡頓攤到 60 幀只讓平均動 0.6 ms。會咬人
 * 的正是那種瞬間尖峰。
 *
 * 【為什麼只借 `Stats.Panel` 而不用 `Stats` 那個容器】容器會在自己身上掛
 * click 去輪流切換面板，一次只顯示一格。這個遊戲的滑鼠是瞄準器 —— 面板
 * 因此整塊 `pointer-events:none`，而三條曲線要並排一起看。
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
  const framePanel = new Stats.Panel('MS', '#ffcc44', '#1a1400')
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
  const frameTimes: number[] = []
  const physicsTimes: number[] = []
  let frameStart = 0
  let physicsStart = 0
  let physicsAccum = 0

  const push = (arr: number[], v: number) => {
    arr.push(v)
    if (arr.length > SAMPLE_WINDOW) arr.shift()
  }
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)

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
    toggle: () => setVisible(!visible),
    begin() {
      frameStart = performance.now()
      physicsAccum = 0
    },
    beginPhysics() {
      physicsStart = performance.now()
    },
    endPhysics() {
      physicsAccum += performance.now() - physicsStart
    },
    endFrame(substeps: number) {
      const frameMs = performance.now() - frameStart
      push(frameTimes, frameMs)
      push(physicsTimes, physicsAccum)

      // 【曲線吃這一幀的值，不是平均】它存在的理由就是讓尖峰看得見
      fpsPanel.update(1000 / Math.max(frameMs, 0.001), FPS_CEILING)
      if (!visible) return
      framePanel.update(frameMs, FRAME_CEILING)
      physicsPanel.update(physicsAccum, PHYSICS_CEILING)

      // 【數字吃平均】絕對值要的是穩定讀數，逐幀跳動的數字讀不出來
      const f = avg(frameTimes)
      const p = avg(physicsTimes)
      const perStepUs = substeps > 0 ? (p / substeps) * 1000 : 0
      const info = renderer.info
      text.textContent =
        `frame     ${f.toFixed(2)} ms\n` +
        `physics   ${p.toFixed(3)} ms  (${substeps} 子步)\n` +
        `per step  ${perStepUs.toFixed(1)} us\n` +
        `draw call ${info.render.calls}\n` +
        `triangles ${info.render.triangles}`
    },
  }
}
