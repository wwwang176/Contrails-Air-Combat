/**
 * 改出試驗場：同一個初始姿態下，比較「現行撞地接管」與「60 Hz 物理預演」
 * 什麼時候觸發、最低掉到哪裡。開發工具，不屬於遊戲。
 *
 * 模型與閉迴路試飛在 `recoveryModel.ts`，量測探針用的是同一份。
 *
 * 【先算完整條軌跡再播放】兩架各跑一次 25 秒的物理，存成逐格姿態，
 * 播放只是插值 —— 拖滑桿時立刻看得到整條結果，重播也不會跑出不同的東西。
 *
 * 進入方式：`npm run dev` 之後開 /tools/recovery.html。
 */
import {
  BufferAttribute, BufferGeometry, CircleGeometry, Color, DoubleSide, GridHelper, Line,
  LineBasicMaterial, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, Quaternion,
  SphereGeometry, TorusGeometry, Vector3,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createScene } from '../render/scene'
import { buildAircraft, preloadAircraftModels, type AircraftModel } from '../render/geometry/buildAircraft'
import {
  DT, RECOVERY_V2_COEFFS, bankFromUpright, fixedMargin, simulateTrial,
  type Intent, type ModelParams, type SafetyModel, type Scenario,
} from './recoveryModel'
import { P51D } from '../specs/p51d'
import { BF109K4 } from '../specs/bf109k4'
import { A6M5 } from '../specs/a6m5'
import { F4F4 } from '../specs/f4f4'
import { F6F5 } from '../specs/f6f5'
import { KI84 } from '../specs/ki84'
import { B17G } from '../specs/b17g'
import { HE111 } from '../specs/he111'
import { G4M } from '../specs/g4m'
import type { AircraftSpec } from '../specs/types'

const DEG = Math.PI / 180
/** 模擬長度，s */
const SIM_SECONDS = 25
/** 每幾個物理步存一格 */
const STRIDE = 2
const FRAME_DT = DT * STRIDE
/** 兩架並排的橫向間距，m。只影響畫面，物理各跑各的 */
const LANE = 40

const SPECS: readonly AircraftSpec[] = [P51D, BF109K4, A6M5, F4F4, F6F5, KI84, B17G, HE111, G4M]

/** 每格欄位 */
const F = { x: 0, y: 1, z: 2, qx: 3, qy: 4, qz: 5, qw: 6, needed: 7, takeover: 8, bank: 9, gamma: 10, n: 11, tas: 12 } as const
const FIELDS = 13

interface Run {
  frames: Float32Array
  count: number
  /** 第一次接管的格；−1 = 沒有 */
  trigger: number
  minIndex: number
  crashed: boolean
}

function record(s: Scenario, model: SafetyModel, p: ModelParams): Run {
  const maxFrames = Math.ceil(SIM_SECONDS / FRAME_DT) + 2
  const frames = new Float32Array(maxFrames * FIELDS)
  let count = 0
  let trigger = -1
  let minIndex = 0
  let minY = Infinity
  let crashedAt = -1
  const res = simulateTrial(s, model, p, SIM_SECONDS, true, (st) => {
    const i = Math.round(st.t / DT)
    const hit = st.agl <= 0
    const first = st.takeover && trigger < 0
    if (i % STRIDE !== 0 && !hit && !first) return
    if (count >= maxFrames) return
    const a = st.aircraft
    const o = count * FIELDS
    const pos = a.state.position
    const q = a.state.orientation
    const vel = a.state.velocity
    const tas = vel.length()
    frames[o + F.x] = pos.x
    frames[o + F.y] = Math.max(st.agl, 0)
    frames[o + F.z] = pos.z
    frames[o + F.qx] = q.x
    frames[o + F.qy] = q.y
    frames[o + F.qz] = q.z
    frames[o + F.qw] = q.w
    frames[o + F.needed] = st.needed
    frames[o + F.takeover] = st.takeover ? 1 : 0
    frames[o + F.bank] = bankFromUpright(a) / DEG
    frames[o + F.gamma] = Math.asin(Math.max(-1, Math.min(1, vel.y / Math.max(tas, 1e-3)))) / DEG
    frames[o + F.n] = a.diag.loadFactor
    frames[o + F.tas] = tas
    if (first) trigger = count
    if (st.agl < minY) {
      minY = st.agl
      minIndex = count
    }
    if (hit) crashedAt = count
    count++
  })
  return { frames, count, trigger, minIndex: res.crashed && crashedAt >= 0 ? crashedAt : minIndex, crashed: res.crashed }
}

// ── 場景 ─────────────────────────────────────────────────────────

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)
await preloadAircraftModels()

const ground = new Mesh(
  new PlaneGeometry(60000, 60000),
  new MeshLambertMaterial({ color: 0x5d6b47 }),
)
ground.rotation.x = -Math.PI / 2
ctx.scene.add(ground)
const grid = new GridHelper(20000, 200, 0x3c4a2e, 0x4a5a38)
grid.position.y = 0.3
ctx.scene.add(grid)

const controls = new OrbitControls(ctx.camera, ctx.renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08

interface Lane {
  key: SafetyModel
  name: string
  color: Color
  offset: Vector3
  model: AircraftModel | null
  trail: Line
  disc: Mesh
  drop: Line
  triggerMark: Mesh
  minMark: Mesh
  crashMark: Mesh
  run: Run | null
}

function makeLane(key: SafetyModel, name: string, hex: number, side: number): Lane {
  const color = new Color(hex)
  const trail = new Line(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true }))
  trail.frustumCulled = false
  ctx.scene.add(trail)
  const disc = new Mesh(
    new CircleGeometry(18, 40),
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: DoubleSide, depthWrite: false }),
  )
  disc.rotation.x = -Math.PI / 2
  ctx.scene.add(disc)
  const dropGeo = new BufferGeometry()
  dropGeo.setAttribute('position', new BufferAttribute(new Float32Array(6), 3))
  const drop = new Line(dropGeo, new LineBasicMaterial({ color, transparent: true, opacity: 0.5 }))
  drop.frustumCulled = false
  ctx.scene.add(drop)
  const triggerMark = new Mesh(new SphereGeometry(4, 16, 12), new MeshBasicMaterial({ color }))
  ctx.scene.add(triggerMark)
  const minMark = new Mesh(new TorusGeometry(9, 1.2, 8, 32), new MeshBasicMaterial({ color }))
  minMark.rotation.x = -Math.PI / 2
  ctx.scene.add(minMark)
  const crashMark = new Mesh(new SphereGeometry(14, 20, 14), new MeshBasicMaterial({ color: 0xff3030 }))
  ctx.scene.add(crashMark)
  return {
    key, name, color, offset: new Vector3(side * LANE, 0, 0), model: null, trail,
    disc, drop, triggerMark, minMark, crashMark, run: null,
  }
}

const lanes: Lane[] = [
  makeLane('current', '現行', 0xe8913a, -1),
  makeLane('rollout', '物理預演', 0x4fd1e0, 1),
]

// ── UI ─────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const specSel = $<HTMLSelectElement>('spec')
for (let i = 0; i < SPECS.length; i++) {
  const o = document.createElement('option')
  o.value = String(i)
  o.textContent = `${SPECS[i]!.name}（${SPECS[i]!.role === 'fighter' ? '戰鬥機' : '轟炸機'}）`
  specSel.appendChild(o)
}
const intentSel = $<HTMLSelectElement>('intent')
const latchBox = $<HTMLInputElement>('latch')
const readout = $('readout')
const followBtn = $<HTMLButtonElement>('follow')
const pauseBtn = $<HTMLButtonElement>('pause')

const sliders = {
  alt: (v: number) => `${v} m`,
  tas: (v: number) => `${v} m/s`,
  gamma: (v: number) => `${v}°`,
  bank: (v: number) => `${v}°`,
  rollRate: (v: number) => `${v}°/s`,
  load: (v: number) => `${v.toFixed(1)} G`,
  margin: (v: number) => `${v} m`,
  rate: (v: number) => `${v.toFixed(1)}×`,
}
type SliderKey = keyof typeof sliders
const val = (k: SliderKey): number => Number($<HTMLInputElement>(k).value)

let playT = 0
let paused = false
let follow = true
let builtSpec: AircraftSpec | null = null

function rebuildModels(spec: AircraftSpec): void {
  for (const lane of lanes) {
    if (lane.model !== null) {
      ctx.scene.remove(lane.model.group)
      lane.model.dispose()
    }
    lane.model = buildAircraft(spec)
    ctx.scene.add(lane.model.group)
  }
  builtSpec = spec
}

function recompute(resetCamera: boolean): void {
  const spec = SPECS[Number(specSel.value)]!
  if (builtSpec !== spec) rebuildModels(spec)
  const scenario: Scenario = {
    spec, ground: 0, agl: val('alt'), tas: val('tas'), gammaDeg: val('gamma'), bankDeg: val('bank'),
    rollRateDeg: val('rollRate'), load: val('load'), intent: intentSel.value as Intent,
  }
  const p: ModelParams = {
    latch: latchBox.checked, margin: val('margin'), ...RECOVERY_V2_COEFFS,
  }
  for (const lane of lanes) {
    const run = record(scenario, lane.key, p)
    lane.run = run
    const pos = new Float32Array(run.count * 3)
    const col = new Float32Array(run.count * 3)
    for (let k = 0; k < run.count; k++) {
      const o = k * FIELDS
      pos[k * 3] = run.frames[o + F.x]! + lane.offset.x
      pos[k * 3 + 1] = run.frames[o + F.y]!
      pos[k * 3 + 2] = run.frames[o + F.z]!
      const bright = run.frames[o + F.takeover]! > 0.5 ? 1 : 0.4
      col[k * 3] = lane.color.r * bright
      col[k * 3 + 1] = lane.color.g * bright
      col[k * 3 + 2] = lane.color.b * bright
    }
    const geo = lane.trail.geometry
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    geo.setAttribute('color', new BufferAttribute(col, 3))
    geo.setDrawRange(0, 0)
    placeMark(lane.triggerMark, lane, run.trigger)
    placeMark(lane.minMark, lane, run.crashed ? -1 : run.minIndex)
    placeMark(lane.crashMark, lane, run.crashed ? run.count - 1 : -1)
  }
  playT = 0
  if (resetCamera) {
    controls.target.set(0, val('alt'), 0)
    ctx.camera.position.set(420, val('alt') + 60, 120)
    controls.update()
  }
}

function placeMark(mark: Mesh, lane: Lane, index: number): void {
  const run = lane.run
  mark.visible = false
  if (run === null || index < 0) {
    mark.userData.t = undefined
    return
  }
  const o = index * FIELDS
  mark.position.set(run.frames[o + F.x]! + lane.offset.x, run.frames[o + F.y]!, run.frames[o + F.z]!)
  mark.userData.t = index * FRAME_DT
}

let recomputeTimer = 0
let resetCameraPending = false
function scheduleRecompute(resetCamera: boolean): void {
  resetCameraPending ||= resetCamera
  window.clearTimeout(recomputeTimer)
  recomputeTimer = window.setTimeout(() => {
    recompute(resetCameraPending)
    resetCameraPending = false
  }, 80)
}

for (const k of Object.keys(sliders) as SliderKey[]) {
  const el = $<HTMLInputElement>(k)
  const label = $(`${k}V`)
  const show = (): void => { label.textContent = sliders[k](Number(el.value)) }
  show()
  el.addEventListener('input', () => {
    show()
    if (k !== 'rate') scheduleRecompute(k === 'alt')
  })
}
specSel.addEventListener('change', () => {
  const spec = SPECS[Number(specSel.value)]!
  $<HTMLInputElement>('margin').value = String(fixedMargin(spec))
  $('marginV').textContent = sliders.margin(val('margin'))
  recompute(false)
})
intentSel.addEventListener('change', () => recompute(false))
latchBox.addEventListener('change', () => recompute(false))
const replay = (): void => { playT = 0 }
const togglePause = (): void => {
  paused = !paused
  pauseBtn.classList.toggle('on', paused)
}
$('replay').addEventListener('click', replay)
pauseBtn.addEventListener('click', togglePause)
followBtn.addEventListener('click', () => {
  follow = !follow
  followBtn.classList.toggle('on', follow)
})
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
  if (e.code === 'Space') { e.preventDefault(); togglePause() }
  if (e.code === 'KeyR') replay()
})

// ── 播放 ─────────────────────────────────────────────────────────

const qa = new Quaternion()
const qb = new Quaternion()
const mid = new Vector3()
const prevMid = new Vector3()
let havePrevMid = false
let last = performance.now()

function frameIndex(run: Run, t: number): { i: number; f: number } {
  const x = t / FRAME_DT
  const i = Math.min(Math.floor(x), run.count - 1)
  const f = i >= run.count - 1 ? 0 : x - i
  return { i: Math.max(i, 0), f }
}

function lerpField(run: Run, i: number, f: number, field: number): number {
  const a = run.frames[i * FIELDS + field]!
  if (f === 0) return a
  const b = run.frames[(i + 1) * FIELDS + field]!
  return a + (b - a) * f
}

function frame(now: number): void {
  const wall = Math.min((now - last) / 1000, 0.1)
  last = now
  if (!paused) playT = Math.min(playT + wall * val('rate'), SIM_SECONDS)

  mid.set(0, 0, 0)
  const lines: string[] = []
  for (const lane of lanes) {
    const run = lane.run
    if (run === null || lane.model === null) continue
    const { i, f } = frameIndex(run, playT)
    const x = lerpField(run, i, f, F.x) + lane.offset.x
    const y = lerpField(run, i, f, F.y)
    const z = lerpField(run, i, f, F.z)
    const o = i * FIELDS
    qa.set(run.frames[o + F.qx]!, run.frames[o + F.qy]!, run.frames[o + F.qz]!, run.frames[o + F.qw]!)
    if (f > 0) {
      const p = (i + 1) * FIELDS
      qb.set(run.frames[p + F.qx]!, run.frames[p + F.qy]!, run.frames[p + F.qz]!, run.frames[p + F.qw]!)
      qa.slerp(qb, f)
    }
    lane.model.group.position.set(x, y, z)
    lane.model.group.quaternion.copy(qa)
    lane.model.setPropSpin(now * 0.04, true)
    mid.x += x / lanes.length
    mid.y += y / lanes.length
    mid.z += z / lanes.length

    lane.trail.geometry.setDrawRange(0, i + 1)
    const needed = Math.max(lerpField(run, i, f, F.needed), 0)
    lane.disc.position.set(x, Math.min(needed, y), z)
    const dp = lane.drop.geometry.getAttribute('position') as BufferAttribute
    dp.setXYZ(0, x, y, z)
    dp.setXYZ(1, x, 0, z)
    dp.needsUpdate = true
    for (const mark of [lane.triggerMark, lane.minMark, lane.crashMark]) {
      const t = mark.userData.t as number | undefined
      mark.visible = t !== undefined && t <= playT
    }

    const trig = run.trigger >= 0 ? run.frames[run.trigger * FIELDS + F.y]! : NaN
    const minY = run.crashed ? 0 : run.frames[run.minIndex * FIELDS + F.y]!
    const takeover = run.frames[o + F.takeover]! > 0.5
    lines.push(
      `${lane.name}${takeover ? '　◆ 接管中' : ''}`,
      `  高度 ${y.toFixed(0).padStart(5)} m   需要 ${needed.toFixed(0).padStart(4)} m`,
      `  γ ${lerpField(run, i, f, F.gamma).toFixed(0).padStart(4)}°  坡度 ${lerpField(run, i, f, F.bank).toFixed(0).padStart(4)}°`,
      `  過載 ${lerpField(run, i, f, F.n).toFixed(1).padStart(4)} G  速度 ${lerpField(run, i, f, F.tas).toFixed(0).padStart(4)} m/s`,
      `  觸發 ${Number.isNaN(trig) ? '  —' : `${trig.toFixed(0).padStart(4)} m`}   最低 ${run.crashed ? '撞地' : `${minY.toFixed(0)} m`}`,
      '',
    )
  }
  lines.push(`t = ${playT.toFixed(1)} s${paused ? '（暫停）' : ''}`)
  readout.textContent = lines.join('\n')

  if (follow) {
    if (havePrevMid) {
      const dx = mid.x - prevMid.x
      const dy = mid.y - prevMid.y
      const dz = mid.z - prevMid.z
      controls.target.x += dx; controls.target.y += dy; controls.target.z += dz
      ctx.camera.position.x += dx; ctx.camera.position.y += dy; ctx.camera.position.z += dz
    } else {
      controls.target.copy(mid)
    }
  }
  prevMid.copy(mid)
  havePrevMid = true
  controls.update()
  ctx.renderer.render(ctx.scene, ctx.camera)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', ctx.resize)
ctx.resize()
recompute(true)
requestAnimationFrame(frame)
