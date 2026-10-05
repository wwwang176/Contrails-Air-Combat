import { Color, TextureLoader, Vector3 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import Stats from 'three/addons/libs/stats.module.js'
import { createScene } from '../render/scene'
import { createTerrain } from '../render/terrain'
import { preloadPlantScenery } from '../render/geometry/ground/plantScenery'
import { applyTimeOfDay, DAY_PALETTES, type TimeOfDay } from '../render/timeOfDay'
import { buildAircraft, preloadAircraftModels } from '../render/geometry/buildAircraft'
import { CLOUD_ATLAS_URL, cloudColorOf, cloudPuffCount, createClouds, type CloudSpec } from '../render/clouds'
import { hash01 } from '../render/scatter'
import { createShipFireSmoke, SHIP_FIRE_PLUME_SPEED } from '../render/smoke'
import { JU87 } from '../specs/ju87'
import { assetUrl } from '../core/asset'

/**
 * 雲朵展示區：一片靜止的雲層（`render/clouds.ts`）與一架穿雲的斯圖卡，幾種鏡頭輪著看 ——
 * 雲塊廣告板在環繞、穿過、正上下看、鏡頭滾轉時會不會穿幫，都在這裡驗。
 */

type CameraMode = 'orbit' | 'fly' | 'dive' | 'ground' | 'roll' | 'chase'

/** 雲層高度（雲底），m；斯圖卡飛在雲頂附近 */
const LAYER = 1500
const STUKA_Y = LAYER + 25
const STUKA_SPEED = 85
/** 斯圖卡往返的範圍：z 從 +RUN 飛到 −RUN 再接回來 */
const RUN = 1600

const DESCRIPTIONS: Record<CameraMode, string> = {
  orbit: '環繞整片雲層。拖曳旋轉、滾輪縮放。',
  fly: '以 100 m/s 平飛穿過雲層，擦過與穿過雲朵。',
  dive: '從雲層上方往下俯衝，正上方往下看穿過雲層。',
  ground: '站在地面往上看雲層，鏡頭慢慢搖。',
  roll: '平飛穿雲，鏡頭每秒滾 60°：雲塊要保持正立、不跟著轉。',
  chase: '跟在斯圖卡後上方，看雲當參照物。',
}

/** 面板上符合 `selector` 的按鈕 */
const buttons = (selector: string): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(selector))

const canvas = document.getElementById('scene') as HTMLCanvasElement
const statsRoot = document.getElementById('stats') as HTMLElement
const description = document.getElementById('description') as HTMLParagraphElement
const statsInfo = document.createElement('div')
statsRoot.appendChild(statsInfo)
const performanceStats = new Stats()
performanceStats.dom.style.cssText = 'position:static;display:block;margin:8px 0 0 auto'
statsRoot.appendChild(performanceStats.dom)

const ctx = createScene(canvas, 'noon')
ctx.camera.far = 30000
ctx.camera.updateProjectionMatrix()
await preloadPlantScenery()
const terrain = createTerrain('farmland')
ctx.scene.add(terrain.object)

await preloadAircraftModels()
const stuka = buildAircraft(JU87)
ctx.scene.add(stuka.group)

const atlas = await new TextureLoader().loadAsync(assetUrl(CLOUD_ATLAS_URL))
const clouds = createClouds(atlas)
ctx.scene.add(clouds.object)

/**
 * 遮擋測試：最大那朵雲附近同一高度兩柱煙（遊戲的船火煙池），一柱在雲後面、一柱在雲與鏡頭之間。
 * 雲的深度那一遍開著時，雲核心後面的煙要被擋住、前面的煙要疊在雲上
 */
const smokeTexture = await new TextureLoader().loadAsync(assetUrl('/textures/smoke.png'))
const smoke = createShipFireSmoke(4096, smokeTexture)
smoke.object.visible = false
ctx.scene.add(smoke.object)
const SMOKE_INTERVAL = 0.3
const SMOKE_PUFFS = 14
let smokeClock = 0
let smokeSeed = 0

/** 兩柱煙的位置與遮擋測試鏡頭，都以最大那朵雲為準 */
function occlusionLayout(): { back: Vector3, front: Vector3, cam: Vector3, look: Vector3 } {
  const c = field.reduce((a, b) => (b.radius > a.radius ? b : a))
  const r = c.radius
  return {
    back: new Vector3(c.x - 0.35 * r, c.y - 30, c.z - 2.2 * r),
    front: new Vector3(c.x + 0.6 * r, c.y - 30, c.z + 1.5 * r),
    cam: new Vector3(c.x, c.y + 0.35 * r, c.z + 3.2 * r),
    look: new Vector3(c.x, c.y + 0.3 * r, c.z),
  }
}

function emitColumn(at: Vector3): void {
  for (let k = 0; k < SMOKE_PUFFS; k++) {
    const s = smokeSeed++
    const a = hash01(s * 3 + 1) * Math.PI * 2
    const rr = hash01(s * 3 + 2) * 1.6
    smoke.emit(at.x, at.y, at.z, Math.cos(a) * rr, SHIP_FIRE_PLUME_SPEED * (0.75 + 0.5 * hash01(s * 3 + 3)), Math.sin(a) * rr)
  }
}

function stepSmoke(dt: number): void {
  if (!smoke.object.visible) return
  const { back, front } = occlusionLayout()
  smokeClock -= dt
  while (smokeClock <= 0) {
    emitColumn(back)
    emitColumn(front)
    smokeClock += SMOKE_INTERVAL
  }
  smoke.step(dt)
}

const smokeToggle = document.getElementById('smoke-toggle') as HTMLButtonElement
const depthToggle = document.getElementById('depth-toggle') as HTMLButtonElement
const occlusionCam = document.getElementById('occlusion-cam') as HTMLButtonElement
let depthPrepass = true

function setSmoke(on: boolean): void {
  smoke.object.visible = on
  smokeToggle.classList.toggle('on', on)
  smokeToggle.textContent = on ? '煙柱：開' : '煙柱：關'
  if (on) {
    smoke.reset()
    smokeClock = 0
    // 一開就是成熟的煙柱，不必等二十秒
    for (let t = 0; t < 20; t += 0.1) stepSmoke(0.1)
  }
}

function setDepth(on: boolean): void {
  depthPrepass = on
  clouds.setDepthPrepass(on)
  depthToggle.classList.toggle('on', on)
  depthToggle.textContent = on ? '雲的深度：開' : '雲的深度：關'
}

smokeToggle.addEventListener('click', () => setSmoke(!smoke.object.visible))
depthToggle.addEventListener('click', () => setDepth(!depthPrepass))

/** 第 `n` 朵以內的雲：前幾朵擺在斯圖卡的航線兩旁（看得到擦過），其餘撒在周圍 */
function cloudField(n: number): CloudSpec[] {
  const out: CloudSpec[] = []
  for (let k = 0; k < n; k++) {
    const r = 50 + hash01(k * 11 + 1) * 70
    if (k < 4) {
      const side = k % 2 === 0 ? 1 : -1
      out.push({ x: side * (r * 0.4 + 30 * hash01(k * 11 + 2)), y: LAYER - 10 * hash01(k * 11 + 3), z: 900 - k * 550, radius: r })
    } else {
      const a = hash01(k * 11 + 4) * Math.PI * 2
      const d = 400 + hash01(k * 11 + 5) * 1600
      out.push({ x: Math.cos(a) * d, y: LAYER - 40 + 80 * hash01(k * 11 + 6), z: Math.sin(a) * d, radius: r })
    }
  }
  return out
}

let activeTime: TimeOfDay = 'noon'
let amount = 8
let field = cloudField(amount)
const CLOUD_COLOR = new Color()

function rebuildClouds(): void {
  field = cloudField(amount)
  clouds.set(field, cloudColorOf(DAY_PALETTES[activeTime], CLOUD_COLOR))
}

function setTimeOfDay(tod: TimeOfDay): void {
  activeTime = tod
  applyTimeOfDay(ctx, terrain, tod)
  rebuildClouds()
  for (const b of buttons('[data-time]')) b.classList.toggle('on', b.dataset['time'] === tod)
}

const controls = new OrbitControls(ctx.camera, canvas)
controls.target.set(0, LAYER, 0)
ctx.camera.position.set(1100, LAYER + 350, 1300)
controls.update()

let mode: CameraMode = 'orbit'
let modeClock = 0

function setMode(m: CameraMode): void {
  mode = m
  modeClock = 0
  controls.enabled = m === 'orbit'
  ctx.camera.up.set(0, 1, 0)
  if (m === 'orbit') {
    ctx.camera.position.set(1100, LAYER + 350, 1300)
    controls.target.set(0, LAYER, 0)
    controls.update()
  }
  description.textContent = DESCRIPTIONS[m]
  for (const b of buttons('[data-cam]')) b.classList.toggle('on', b.dataset['cam'] === m)
}

/** 遮擋測試鏡頭：從最大那朵雲的正前方看，後面那柱煙在雲後、前面那柱在雲與鏡頭之間 */
function occlusionView(): void {
  setMode('orbit')
  const { cam, look } = occlusionLayout()
  controls.target.copy(look)
  ctx.camera.position.copy(cam)
  controls.update()
}
occlusionCam.addEventListener('click', occlusionView)

// 自動鏡頭時一拖曳就交回環繞
canvas.addEventListener('pointerdown', () => {
  if (mode !== 'orbit') {
    setMode('orbit')
  }
})

for (const b of buttons('[data-cam]')) {
  b.addEventListener('click', () => setMode(b.dataset['cam'] as CameraMode))
}
for (const b of buttons('[data-time]')) {
  b.addEventListener('click', () => setTimeOfDay(b.dataset['time'] as TimeOfDay))
}
for (const b of buttons('[data-amount]')) {
  b.addEventListener('click', () => {
    amount = Number(b.dataset['amount'])
    rebuildClouds()
    for (const o of buttons('[data-amount]')) o.classList.toggle('on', o === b)
  })
}

const FORWARD = new Vector3()
const TARGET = new Vector3()

/** 斯圖卡在第 `t` 秒的位置：沿 −Z 往返 */
function stukaAt(t: number, out: Vector3): Vector3 {
  const span = (2 * RUN) / STUKA_SPEED
  const u = (t % span) / span
  return out.set(0, STUKA_Y, RUN - u * 2 * RUN)
}

function placeCamera(dt: number, elapsed: number): void {
  modeClock += dt
  const cam = ctx.camera
  switch (mode) {
    case 'orbit':
      controls.update()
      return
    case 'fly':
    case 'roll': {
      const span = (2 * RUN) / 100
      const u = (modeClock % span) / span
      cam.position.set(40 * Math.sin(u * Math.PI * 6), LAYER + 15 + 20 * Math.sin(u * Math.PI * 4), RUN - u * 2 * RUN)
      TARGET.set(cam.position.x * 0.5, cam.position.y - 25, cam.position.z - 300)
      if (mode === 'roll') {
        const a = modeClock * Math.PI / 3
        FORWARD.subVectors(TARGET, cam.position).normalize()
        cam.up.set(0, 1, 0).applyAxisAngle(FORWARD, a)
      }
      cam.lookAt(TARGET)
      return
    }
    case 'dive': {
      // 從航線上第三朵雲（雲量少時取最後一朵）的正上方往下衝、穿過它
      const c = field[Math.min(2, field.length - 1)]!
      const u = (modeClock % 10) / 10
      cam.position.set(c.x + 20, LAYER + 900 - u * 1400, c.z + 60 - u * 120)
      TARGET.set(c.x + 15, cam.position.y - 400, cam.position.z - 40)
      cam.up.set(0, 0, -1)
      cam.lookAt(TARGET)
      return
    }
    case 'ground': {
      const a = modeClock * 0.05
      cam.position.set(0, 2, 900)
      TARGET.set(Math.sin(a) * 900, LAYER, 900 - Math.cos(a) * 900)
      cam.lookAt(TARGET)
      return
    }
    case 'chase': {
      stukaAt(elapsed, TARGET)
      cam.position.set(TARGET.x + 18, TARGET.y + 8, TARGET.z + 40)
      cam.lookAt(TARGET.x, TARGET.y, TARGET.z - 60)
      return
    }
  }
}

setTimeOfDay('noon')
setMode('orbit')

let last = performance.now()
let elapsed = 0
/** 定格：時間不走（截圖對時用） */
let paused = false

function frame(now: number): void {
  performanceStats.begin()
  const dt = paused ? 0 : Math.min((now - last) / 1000, 0.1)
  last = now
  elapsed += dt
  stukaAt(elapsed, stuka.group.position)
  stuka.group.rotation.set(0, 0, 0)
  placeCamera(dt, elapsed)
  stepSmoke(dt)
  terrain.update(elapsed, ctx.camera.position.x, ctx.camera.position.z)
  ctx.renderer.render(ctx.scene, ctx.camera)
  performanceStats.end()
  let puffs = 0
  for (const c of field) puffs += cloudPuffCount(c.radius)
  statsInfo.textContent = `雲　${field.length} 朵／${puffs} 團\n時段　${activeTime}\n鏡頭　${mode}`
  requestAnimationFrame(frame)
}

;(window as unknown as Record<string, unknown>)['__clouds'] = {
  setMode, setTimeOfDay, setSmoke, setDepth, occlusionView,
  /** 換到 `m` 鏡頭的第 `t` 秒並定格（截圖對時用）；`resume()` 繼續走 */
  freeze(m: CameraMode, t: number) {
    setMode(m)
    modeClock = t
    paused = true
  },
  resume() { paused = false },
  /** 量測用：場景、相機、雲層與這一批雲的位置 */
  get ctx() { return ctx },
  get controls() { return controls },
  get clouds() { return clouds },
  get field() { return field },
}
requestAnimationFrame(frame)
