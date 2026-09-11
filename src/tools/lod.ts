import {
  Box3, Color, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { DEG } from '../core/math'
import { preloadAircraftModels } from '../render/geometry/buildAircraft'
import { bakeParkedAircraft } from '../render/geometry/ground/parked'
import { createLights } from '../render/lighting'
import { DAY_PALETTES, type TimeOfDay } from '../render/timeOfDay'

/**
 * 低模驗收 —— 純檢視用的開發工具，不屬於遊戲。
 *
 * 進入方式：`npm run dev` 之後開 /tools/lod.html。**不在 `vite.config.ts` 的建置
 * 清單裡**，所以它不會進正式版。
 *
 * 【為什麼要有這一頁】剪影比對（`tools/blender/check_lod_silhouette.py`）拍的是
 * Blender 的離線算圖 —— 全白物件、平光、沒有材質。它證得了「輪廓沒變」，
 * 證不了「看起來一樣」：頂點色、平面著色的稜線、夜間的三盞燈都不在那條路徑上。
 * 這一頁用**遊戲真正在用的那份幾何與材質**並排給人看。
 *
 * 【為什麼走 `bakeParkedAircraft` 而不是 `buildFromTemplate`】停放的飛機在遊戲
 * 裡是烘成一顆、材質色塗進頂點色的（見 `geometry/ground/parked.ts`）。這裡若
 * 另外走一條，看到的就不是畫面上那個東西，這個工具反而會製造錯誤的信心。
 *
 * 【距離滑桿換算的是什麼】把相機退到「這架飛機在 720p、FOV 65° 之下佔幾個
 * 像素」與該距離相同的位置。滑桿停在 200 m（`AIRCRAFT_LOD_DIST`）看到的，
 * 就是切換那一刻玩家看到的大小。
 *
 * 【時段要能切】剪影在亮底與暗底上讀起來完全不同：暗機身在亮天空下看得到每
 * 一道折面，在夜空下只剩一個輪廓。四個時段的光與背景都照 `timeOfDay.ts` 那
 * 一份走。
 */

const FOV = 65
const canvas = document.getElementById('scene') as HTMLCanvasElement
const renderer = new WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
const scene = new Scene()
const camera = new PerspectiveCamera(FOV, 1, 0.1, 20000)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true

const lights = createLights(DAY_PALETTES.noon)
for (const l of lights.all) scene.add(l)

/** 與 `render/groundTargets.ts` 的 `live` 逐項相同 —— 看到的要是遊戲那一份 */
const material = new MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.06,
})
const wireMaterial = new MeshStandardMaterial({
  vertexColors: true, flatShading: true, wireframe: true,
})

interface Side {
  readonly id: string
  readonly mesh: Mesh
  readonly tris: number
}

/**
 * 有低模的機種。**與 `buildAircraft.ts` 的 `AIRCRAFT_LOD` 是同一份名單**，
 * 那邊多一台這邊就要多一台，否則新做的低模沒有地方可以看。
 *
 * `count` 是這一台同時出現的架數，拿來把面數換算成一場的總量：B-17 是波爾塔瓦
 * 停機坪上的 24 架，He 111 是德 M2 的編隊。
 */
interface Plane {
  readonly label: string
  readonly id: string
  readonly lod: string
  readonly count: number
}

const PLANES: readonly Plane[] = [
  { label: 'B-17G', id: 'b17g', lod: 'b17g_lod2', count: 24 },
  { label: 'He 111', id: 'he111', lod: 'he111_lod2', count: 8 },
]

const group = new Group()
scene.add(group)

/** 目前畫的是實體還是線框。**換機種時要沿用**，不然線框會被切回實體 */
let shown: MeshStandardMaterial = material

/**
 * 可選的時段。**背景要跟著換** —— 剪影在亮底與暗底上讀起來完全不同：暗機身
 * 在亮天空下看得到每一道折面，在夜空下只剩一個輪廓。兩邊都要看得到。
 */
const SKIES: readonly TimeOfDay[] = ['dawn', 'noon', 'dusk', 'night']
let sky: TimeOfDay = 'noon'

function setSky(t: TimeOfDay): void {
  sky = t
  const p = DAY_PALETTES[t]
  lights.sun.color.setHex(p.sunColor)
  lights.sun.intensity = p.sunIntensity
  lights.sun.position.set(p.sunDir[0], p.sunDir[1], p.sunDir[2]).normalize()
  lights.hemi.color.setHex(p.hemiSky)
  lights.hemi.groundColor.setHex(p.hemiGround)
  lights.hemi.intensity = p.hemiIntensity
  lights.ambient.color.setHex(p.ambientColor)
  lights.ambient.intensity = p.ambientIntensity
  scene.background = new Color(p.skyHorizon)
  syncButtons()
}

function make(id: string): Side {
  const geo = bakeParkedAircraft(id)
  const mesh = new Mesh(geo, shown)
  group.add(mesh)
  const idx = geo.getIndex()
  const pos = geo.getAttribute('position')
  return { id, mesh, tris: (idx === null ? pos.count : idx.count) / 3 }
}

let plane: Plane = PLANES[0]!
let full: Side
let lod: Side
let span = 31.6

type Mode = 'side' | 'over' | 'flip'
let mode: Mode = 'side'
let spinning = true
let flipShowsLod = false
let lastFlip = 0

function layout(): void {
  // 【並排時左右各退半個翼展加一點縫】疊合與交替都放在原點，才比得出差異
  const gap = mode === 'side' ? span * 0.62 : 0
  full.mesh.position.set(-gap, 0, 0)
  lod.mesh.position.set(gap, 0, 0)
  if (mode === 'flip') {
    full.mesh.visible = !flipShowsLod
    lod.mesh.visible = flipShowsLod
  } else {
    full.mesh.visible = true
    lod.mesh.visible = true
  }
}

/**
 * 把相機退到「這架飛機看起來和 `metres` 公尺外一樣大」的位置。
 *
 * 【為什麼不是直接把相機放到那個距離】那樣物件會小到看不見。這裡反過來：
 * 算出它在 720p 下該佔幾個像素，再把相機退到在**目前視窗高度**下佔同樣
 * 比例的位置 —— 於是畫面上的相對大小與遊戲裡一致，而視窗多大都成立。
 */
function pixelsAt(metres: number): number {
  return span * (720 / 2) / (metres * Math.tan((FOV / 2) * DEG))
}

function frame(metres: number): void {
  const px = pixelsAt(metres)
  const share = px / 720
  const dist = span / (2 * share * Math.tan((FOV / 2) * DEG))
  const dir = camera.position.clone().sub(controls.target)
  if (dir.lengthSq() < 1e-6) dir.set(0, 0.35, 1)
  dir.normalize().multiplyScalar(dist)
  camera.position.copy(controls.target).add(dir)
}

function view(dir: Vector3): void {
  const d = camera.position.distanceTo(controls.target)
  camera.position.copy(controls.target).add(dir.clone().normalize().multiplyScalar(d))
  spinning = false
  syncButtons()
}

const el = (id: string) => document.getElementById(id)!
function syncButtons(): void {
  for (const [id, on] of [
    ['mSide', mode === 'side'], ['mOver', mode === 'over'], ['mFlip', mode === 'flip'],
    ['spin', spinning], ['wire', shown === wireMaterial],
  ] as const) {
    el(id).classList.toggle('on', Boolean(on))
  }
  for (const b of Array.from(el('planes').children)) {
    b.classList.toggle('on', (b as HTMLElement).dataset['plane'] === plane.id)
  }
  for (const b of Array.from(el('sky').children)) {
    b.classList.toggle('on', (b as HTMLElement).dataset['sky'] === sky)
  }
}

/**
 * 換一台。舊的兩顆幾何在這裡放掉 —— `bakeParkedAircraft` 每次回的是快取那一份
 * 的 `clone()`，不放的話每切一次就多留兩份在 GPU 上。
 */
function loadPlane(p: Plane, apply: () => void): void {
  for (const s of [full, lod]) {
    if (s === undefined) continue
    group.remove(s.mesh)
    s.mesh.geometry.dispose()
  }
  plane = p
  full = make(p.id)
  lod = make(p.lod)
  const size = new Vector3()
  new Box3().setFromObject(full.mesh).getSize(size)
  span = Math.max(size.x, size.z)
  controls.target.set(0, size.y * 0.5, 0)
  layout()
  apply()
  syncButtons()
}

async function main(): Promise<void> {
  await preloadAircraftModels()

  const distEl = el('dist') as HTMLInputElement
  const apply = (): void => {
    const m = Number(distEl.value)
    el('distV').textContent = `${m} m`
    frame(m)
    el('stats').textContent =
      `正式  ${full.tris.toLocaleString().padStart(7)} 個三角形\n`
      + `低模  ${lod.tris.toLocaleString().padStart(7)} 個三角形`
      + `（${((lod.tris / full.tris) * 100).toFixed(0)}%）\n`
      + `${String(plane.count).padStart(2)} 架 `
      + `${(full.tris * plane.count).toLocaleString()}`
      + ` → ${(lod.tris * plane.count).toLocaleString()}\n`
      + `${m} m 外一架寬 ${pixelsAt(m).toFixed(1)} px`
  }

  const planesEl = el('planes')
  for (const p of PLANES) {
    const b = document.createElement('button')
    b.textContent = p.label
    b.dataset['plane'] = p.id
    b.addEventListener('click', () => { loadPlane(p, apply) })
    planesEl.appendChild(b)
  }

  loadPlane(PLANES[0]!, apply)
  camera.position.set(0, span * 0.2, span * 1.6)
  apply()
  distEl.addEventListener('input', apply)

  for (const [id, m] of [['mSide', 'side'], ['mOver', 'over'], ['mFlip', 'flip']] as const) {
    el(id).addEventListener('click', () => { mode = m; layout(); syncButtons() })
  }
  el('vSide').addEventListener('click', () => view(new Vector3(1, 0, 0)))
  el('vTop').addEventListener('click', () => view(new Vector3(0, 1, 0.001)))
  el('vFront').addEventListener('click', () => view(new Vector3(0, 0, 1)))
  el('vQtr').addEventListener('click', () => view(new Vector3(0.7, 0.5, 0.5)))
  el('spin').addEventListener('click', () => { spinning = !spinning; syncButtons() })
  el('wire').addEventListener('click', () => {
    shown = shown === wireMaterial ? material : wireMaterial
    full.mesh.material = shown
    lod.mesh.material = shown
    syncButtons()
  })
  const skyEl = el('sky')
  for (const t of SKIES) {
    const b = document.createElement('button')
    b.textContent = DAY_PALETTES[t].name
    b.dataset['sky'] = t
    b.addEventListener('click', () => { setSky(t) })
    skyEl.appendChild(b)
  }
  setSky(sky)

  const tick = (t: number): void => {
    if (spinning) group.rotation.y = t * 0.00025
    // 【交替每 0.7 秒換一次】人眼對「同一個位置的閃動」比對並排敏感得多，
    // 差異若存在，交替時會像抖了一下
    if (mode === 'flip' && t - lastFlip > 700) {
      lastFlip = t
      flipShowsLod = !flipShowsLod
      layout()
    }
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    controls.update()
    renderer.render(scene, camera)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

void main()
