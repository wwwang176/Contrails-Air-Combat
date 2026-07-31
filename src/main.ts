import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { FixedStepAccumulator } from './core/loop'
import { createScene } from './render/scene'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)

const placeholder = new Mesh(
  new BoxGeometry(10, 3, 12),
  new MeshStandardMaterial({ color: 0x8fa6b8, flatShading: true }),
)
ctx.scene.add(placeholder)

// 佔位飛行體：等速直線，用於驗證迴圈與渲染插值
const prev = new Vector3(0, 500, 0)
const curr = new Vector3(0, 500, 0)
const velocity = new Vector3(0, 0, -120) // 機首 −Z，120 m/s

const loop = new FixedStepAccumulator({ stepHz: 240, maxSubsteps: 8, maxFrameSeconds: 0.25 })
let lastTime = performance.now()

function frame(now: number) {
  const frameSeconds = (now - lastTime) / 1000
  lastTime = now

  const alpha = loop.advance(frameSeconds, (dt) => {
    prev.copy(curr)
    curr.addScaledVector(velocity, dt)
  })

  placeholder.position.lerpVectors(prev, curr, alpha)
  ctx.camera.position.set(curr.x, curr.y + 12, curr.z + 45)
  ctx.camera.lookAt(curr)

  ctx.renderer.render(ctx.scene, ctx.camera)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
