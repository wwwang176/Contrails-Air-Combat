import { Vector3 } from 'three'
import { createScene } from '../render/scene'
import { createTerrain, type Terrain } from '../render/terrain'
import { applyTimeOfDay } from '../render/timeOfDay'
import { preloadPlantScenery } from '../render/geometry/ground/plantScenery'
import {
  createGodCameraState, godCameraTarget, stepGodCamera, DEFAULT_GOD_CAMERA,
  type GodCameraInput, type GodCameraOptions,
} from '../camera/godCamera'
import { DEG } from '../core/math'
import Stats from 'three/addons/libs/stats.module.js'

/**
 * 田色 clipmap 展示區 —— 純檢視用的開發工具，不屬於遊戲。
 *
 * 【它走的是遊戲的那條路徑】`createScene` ＋ `createTerrain('leuna', gfx)` ＋
 * `applyTimeOfDay`，與 `main.ts` 相同 —— 地形自己建 clipmap、自己換材質，
 * 這裡只拿 `terrain.fieldClip` 來切模式與讀統計。
 *
 * 【三個模式是同一個 program】算式／純貼圖／內圈算式＋貼圖差的只有兩個
 * uniform，切換不重編譯、不換材質，A/B 看到的差就是那兩個 uniform 的差。
 *
 * 進入方式：`npm run dev` 之後開 /tools/clipmap.html。
 */

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)

// 【廠區的佈景是 GLB】`createTerrain` 是同步的，要先載完
await preloadPlantScenery()

const terrain: Terrain = createTerrain('leuna', { renderer: ctx.renderer, fieldInner: 500 })
ctx.scene.add(terrain.object)
applyTimeOfDay(ctx, terrain, 'novemberNoon')
if (terrain.fieldClip === null) throw new Error('洛伊納給了 renderer 卻沒有田色 clipmap')
const clipmap = terrain.fieldClip

// ── 鏡頭 ──
const CAM: GodCameraOptions = {
  ...DEFAULT_GOD_CAMERA,
  moveSpeed: 150,
  boostFactor: 6,
  minAltitude: 5,
  // 拖曳一個螢幕半高轉 90°
  lookSensitivity: 90 * DEG,
}
const cam = createGodCameraState()
cam.position.set(0, 250, -3500)
cam.pitch = -8 * DEG
const input: GodCameraInput = {
  forward: false, back: false, left: false, right: false, up: false, down: false, boost: false,
  lookX: 0, lookY: 0,
}
const KEYS: Record<string, keyof GodCameraInput> = {
  KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', KeyE: 'up', KeyQ: 'down',
  ShiftLeft: 'boost', ShiftRight: 'boost',
}
window.addEventListener('keydown', (e) => {
  const k = KEYS[e.code]
  if (k !== undefined) { (input[k] as boolean) = true; e.preventDefault() }
})
window.addEventListener('keyup', (e) => {
  const k = KEYS[e.code]
  if (k !== undefined) (input[k] as boolean) = false
})
let dragging = false
canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) { dragging = true; canvas.setPointerCapture(e.pointerId) } })
canvas.addEventListener('pointerup', () => { dragging = false })
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return
  const half = canvas.clientHeight / 2
  input.lookX += e.movementX / half
  input.lookY -= e.movementY / half
})
const TARGET = new Vector3()

// ── 面板 ──
type Mode = 'proc' | 'clip' | 'hybrid'
const MODES: readonly { id: Mode; name: string }[] = [
  { id: 'proc', name: '算式' },
  { id: 'clip', name: '純貼圖' },
  { id: 'hybrid', name: '內圈算式＋貼圖' },
]
let mode: Mode = 'hybrid'
let inner = 500

const modes = document.getElementById('modes') as HTMLElement
function selectMode(m: Mode): void {
  mode = m
  clipmap.setBypass(m === 'proc')
  clipmap.setInnerRadius(m === 'hybrid' ? inner : 0)
  for (const b of Array.from(modes.children)) b.classList.toggle('on', b.id === 'm-' + m)
}
for (const m of MODES) {
  const b = document.createElement('button')
  b.id = 'm-' + m.id
  b.textContent = m.name
  b.addEventListener('click', () => selectMode(m.id))
  modes.appendChild(b)
}

const POSES: readonly { name: string; x: number; y: number; z: number; pitch: number }[] = [
  { name: '貼地 250 m', x: 0, y: 250, z: -3500, pitch: -8 },
  { name: '1 km', x: 0, y: 1000, z: -3000, pitch: -22 },
  { name: '投彈 4 km', x: 0, y: 4000, z: -2000, pitch: -45 },
]
const poses = document.getElementById('poses') as HTMLElement
function placeCamera(x: number, y: number, z: number, yawDeg: number, pitchDeg: number): void {
  cam.position.set(x, y, z)
  cam.yaw = yawDeg * DEG
  cam.pitch = pitchDeg * DEG
}
for (const p of POSES) {
  const b = document.createElement('button')
  b.textContent = p.name
  b.addEventListener('click', () => placeCamera(p.x, p.y, p.z, 0, p.pitch))
  poses.appendChild(b)
}

const rows = document.getElementById('rows') as HTMLElement
{
  const d = document.createElement('div')
  d.className = 'row'
  const l = document.createElement('label')
  l.textContent = '內圈半徑'
  const r = document.createElement('input')
  r.type = 'range'; r.min = '0'; r.max = '2000'; r.step = '50'; r.value = String(inner)
  const v = document.createElement('span')
  v.className = 'val'
  v.textContent = `${inner} m`
  r.addEventListener('input', () => {
    inner = Number(r.value)
    v.textContent = `${inner} m`
    if (mode === 'hybrid') clipmap.setInnerRadius(inner)
  })
  d.append(l, r, v)
  rows.appendChild(d)
}

const statsEl = document.getElementById('stats') as HTMLElement
// 【右上角的 stats.js】每幀更新，點一下切 FPS／MS。左上角面板那一行是一秒平均，
// 兩者看的是不同的東西：這個看瞬間的抖動，那個看平均
const stats = new Stats()
stats.dom.style.left = 'auto'
stats.dom.style.right = '12px'
stats.dom.style.top = '12px'
document.body.appendChild(stats.dom)
/** 一秒平均的幀率；秒內幀數 ÷ 秒長 */
let fps = 0
let frameMs = 0
let secFrames = 0
let secStart = performance.now()

// ── 量測出口 ──
;(window as unknown as Record<string, unknown>)['__cam'] = placeCamera
;(window as unknown as Record<string, unknown>)['__mode'] = (m: Mode): void => selectMode(m)
;(window as unknown as Record<string, unknown>)['__stats'] = () => ({
  mode, inner, fps, frameMs, ...clipmap.stats,
  cam: [cam.position.x, cam.position.y, cam.position.z],
  lost: ctx.renderer.getContext().isContextLost(),
})

selectMode('hybrid')

let last = performance.now()
let elapsed = 0
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25)
  last = now
  elapsed += dt
  stepGodCamera(cam, input, dt, CAM)
  input.lookX = 0
  input.lookY = 0
  ctx.camera.position.copy(cam.position)
  ctx.camera.lookAt(godCameraTarget(cam, TARGET))
  // 【挪窗在 terrain.update 裡】與遊戲同一條路徑
  terrain.update(elapsed, cam.position.x, cam.position.z)
  ctx.renderer.render(ctx.scene, ctx.camera)
  stats.update()

  secFrames++
  if (now - secStart >= 1000) {
    fps = (secFrames * 1000) / (now - secStart)
    frameMs = (now - secStart) / secFrames
    secFrames = 0
    secStart = now
    const s = clipmap.stats
    statsEl.textContent = [
      `${fps.toFixed(1)} FPS　${frameMs.toFixed(2)} ms/幀`,
      `挪窗 ${s.recentres} 次　烘 ${s.pieces} 片　${(s.texels / 1e6).toFixed(1)} M 格`,
      `鏡頭 x ${cam.position.x.toFixed(0)}　z ${cam.position.z.toFixed(0)}　高 ${cam.position.y.toFixed(0)} m`,
    ].join('\n')
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
