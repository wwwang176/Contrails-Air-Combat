import type { WebGLRenderer } from 'three'

export interface PerfOverlay {
  begin(): void
  beginPhysics(): void
  endPhysics(): void
  endFrame(substeps: number): void
  toggle(): void
  readonly visible: boolean
}

const SAMPLE_WINDOW = 60

export function createPerfOverlay(renderer: WebGLRenderer): PerfOverlay {
  const el = document.createElement('div')
  el.style.cssText = [
    'position:fixed', 'top:8px', 'left:8px', 'z-index:100',
    'font:11px/1.45 ui-monospace,Consolas,monospace',
    'color:#9fe8b0', 'background:rgba(0,0,0,.55)',
    'padding:6px 9px', 'border-radius:4px',
    'white-space:pre', 'pointer-events:none',
  ].join(';')
  document.body.appendChild(el)

  let visible = true
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
    el.style.display = v ? 'block' : 'none'
  }

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
      push(frameTimes, performance.now() - frameStart)
      push(physicsTimes, physicsAccum)
      if (!visible) return
      const f = avg(frameTimes)
      const p = avg(physicsTimes)
      const perStepUs = substeps > 0 ? (p / substeps) * 1000 : 0
      const info = renderer.info
      el.textContent =
        `FPS       ${(1000 / Math.max(f, 0.001)).toFixed(0)}\n` +
        `frame     ${f.toFixed(2)} ms\n` +
        `physics   ${p.toFixed(3)} ms  (${substeps} 子步)\n` +
        `per step  ${perStepUs.toFixed(1)} us\n` +
        `draw call ${info.render.calls}\n` +
        `triangles ${info.render.triangles}`
    },
  }
}
