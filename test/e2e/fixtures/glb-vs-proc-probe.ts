import { Color, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { createLights } from '../../../src/render/lighting'
import { buildAircraft, preloadAircraftModels, type AircraftModel } from '../../../src/render/geometry/buildAircraft'
import { buildHe111 } from '../../../src/render/geometry/he111'
import { buildB17G } from '../../../src/render/geometry/b17g'
import type { AircraftSpec } from '../../../src/specs/types'

/**
 * **程式版 vs GLB 的逐 byte 比對台**。與 `plane-probe.ts` 同一組畫布、燈光、
 * 相機，差別是同一個姿態畫兩次：一次用程式版 builder、一次用 `buildAircraft`
 * （走 GLB 路），回報兩張 `readPixels` 緩衝差了幾個像素、最大差幾階。
 *
 * 【為什麼不用 before／after 兩次執行】那樣只答得出「一樣還是不一樣」；
 * 烘變換的 float32 尾數本來就會讓雜湊變，真正要知道的是差多少。
 */
const SIZE = 512
const BG = 0x0000ff
const CANVAS_ID = 'plane-probe'

const PROC: Record<string, () => AircraftModel> = { he111: buildHe111, b17g: buildB17G }

export interface PlaneDiff {
  /** 非背景像素（程式版那張） */
  pixels: number
  /** 任一通道不同的像素數 */
  differing: number
  /** 最大的單通道差（0–255） */
  maxDelta: number
}

function render(model: AircraftModel, azimuthDeg: number, pitchDeg: number, blurred: boolean): Uint8Array {
  document.getElementById(CANVAS_ID)?.remove()
  const canvas = document.createElement('canvas')
  canvas.id = CANVAS_ID
  canvas.width = SIZE
  canvas.height = SIZE
  canvas.style.position = 'fixed'
  canvas.style.left = '0'
  canvas.style.top = '0'
  document.body.appendChild(canvas)
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(SIZE, SIZE, false)

  const scene = new Scene()
  scene.background = new Color(BG)
  for (const l of createLights().all) scene.add(l)

  model.setPropSpin(0.7, blurred)
  scene.add(model.group)

  const dist = model.metrics.realLength * 2.2
  const a = (azimuthDeg * Math.PI) / 180
  const p = (pitchDeg * Math.PI) / 180
  const eye = new Vector3(
    Math.sin(a) * Math.cos(p) * dist,
    Math.sin(-p) * dist,
    Math.cos(a) * Math.cos(p) * dist,
  )
  const camera = new PerspectiveCamera(35, 1, 0.1, dist * 4)
  camera.position.copy(eye)
  camera.lookAt(new Vector3(0, 0, 0))
  camera.updateMatrixWorld(true)

  renderer.render(scene, camera)
  const gl = renderer.getContext()
  const buf = new Uint8Array(SIZE * SIZE * 4)
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, buf)
  scene.remove(model.group)
  model.dispose()
  renderer.dispose()
  return buf
}

export function planeDiff(
  id: string, azimuthDeg: number, pitchDeg: number, blurred: boolean,
): PlaneDiff {
  const build = PROC[id]
  if (!build) throw new Error(`沒有程式版：${id}`)
  const a = render(build(), azimuthDeg, pitchDeg, blurred)
  const b = render(buildAircraft({ id } as unknown as AircraftSpec), azimuthDeg, pitchDeg, blurred)
  let pixels = 0, differing = 0, maxDelta = 0
  for (let o = 0; o < a.length; o += 4) {
    if (!(a[o + 2]! > 200 && a[o + 1]! < 60 && a[o]! < 60)) pixels++
    let d = 0
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(a[o + k]! - b[o + k]!))
    if (d > 0) { differing++; maxDelta = Math.max(maxDelta, d) }
  }
  return { pixels, differing, maxDelta }
}

await preloadAircraftModels()
;(window as unknown as Record<string, unknown>)['__planeDiff'] = planeDiff
