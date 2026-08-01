import {
  AmbientLight, AxesHelper, Box3, Color, DirectionalLight, GridHelper, HemisphereLight,
  Mesh, MeshStandardMaterial, PerspectiveCamera, PMREMGenerator, Scene, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildAircraft, type AircraftModel } from '../render/geometry/buildAircraft'
import { SILHOUETTES } from '../render/geometry/silhouettes'
import { P51D } from '../specs/p51d'
import { BF109G6 } from '../specs/bf109g6'
import type { AircraftSpec } from '../specs/types'

/**
 * 機庫 —— 純檢視用的開發工具，不屬於遊戲。
 *
 * 【為什麼直接 import buildAircraft】機庫的唯一價值是「讓人用眼睛驗收
 * 實際會飛的那架飛機」。若在這裡另外複製一份幾何，看到的就不是遊戲裡的
 * 東西，這個工具反而會製造錯誤的信心。任何幾何調整都應該改
 * `src/render/geometry/`，機庫自動跟著變。
 *
 * 進入方式：`npm run dev` 之後開 /hangar.html。
 */

const SPECS: AircraftSpec[] = [P51D, BF109G6]

const canvas = document.getElementById('scene') as HTMLCanvasElement
const renderer = new WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

const scene = new Scene()
scene.background = new Color(0x0d1620)

const camera = new PerspectiveCamera(42, 1, 0.1, 500)
camera.position.set(11, 5, 13)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08

// 燈光刻意與遊戲場景（src/render/scene.ts）一致，這樣機庫看到的明暗
// 就是遊戲裡的明暗，而不是一個打光更討喜的攝影棚。
const sun = new DirectionalLight(0xfff2e0, 2.2)
sun.position.set(14, 18, 10)
scene.add(sun)
scene.add(new HemisphereLight(0xbfd8ee, 0x2a3a48, 0.9))
scene.add(new AmbientLight(0xffffff, 0.15))

// 環境反射預設關閉：遊戲場景目前沒有它，開著會讓機庫比遊戲好看。
// 按鈕可切換，用來評估「要不要把它加進遊戲」。
const pmrem = new PMREMGenerator(renderer)
const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.05).texture

const grid = new GridHelper(40, 40, 0x4f7ea8, 0x2b3f52)
grid.position.y = -3
grid.material.transparent = true
grid.material.opacity = 0.35
scene.add(grid)

// 機體座標軸：X 紅（右翼）、Y 綠（座艙上方）、Z 藍（機尾，機首為 −Z）
const axes = new AxesHelper(4)
axes.visible = false
scene.add(axes)

let specIndex = 0
let model: AircraftModel | null = null
let propRotation = 0
let autoRotate = true
let wireframe = false

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const stats = $<HTMLDivElement>('stats')

/** 真實三角形數：有索引的幾何要看 index，position.count/3 算的是頂點數。 */
function countTriangles(m: AircraftModel): { tris: number; meshes: number } {
  let tris = 0
  let meshes = 0
  m.group.traverse((o) => {
    const g = (o as Mesh).geometry
    if (!g?.getAttribute) return
    const p = g.getAttribute('position')
    if (!p) return
    meshes++
    tris += g.index ? g.index.count / 3 : p.count / 3
  })
  return { tris, meshes }
}

function applyWireframe(m: AircraftModel, on: boolean): void {
  m.group.traverse((o) => {
    const mat = (o as Mesh).material as MeshStandardMaterial | undefined
    if (mat && 'wireframe' in mat) mat.wireframe = on
  })
}

function rebuild(): void {
  if (model) {
    scene.remove(model.group)
    model.dispose()
  }
  const spec = SPECS[specIndex]!
  model = buildAircraft(spec)
  scene.add(model.group)
  applyWireframe(model, wireframe)

  const box = new Box3().setFromObject(model.group)
  const size = new Vector3()
  const center = new Vector3()
  box.getSize(size)
  box.getCenter(center)
  controls.target.copy(center)

  // 翼展與全長同時列出「模型量到的」與「真機的」，這樣調造型時偏離史實
  // 會立刻看得出來，不用等測試跑。
  const sil2 = SILHOUETTES[spec.id]!
  const { tris, meshes } = countTriangles(model)
  stats.textContent =
    `${spec.name}\n` +
    `三角形  ${tris}\n` +
    `mesh    ${meshes}\n` +
    `翼展    ${size.x.toFixed(2)} / 真機 ${spec.wing.span.toFixed(2)} m\n` +
    `全長    ${size.z.toFixed(2)} / 真機 ${sil2.realLength.toFixed(2)} m\n` +
    `高      ${size.y.toFixed(2)} m`

  for (const b of specButtons) b.classList.toggle('on', SPECS[specIndex]!.id === b.dataset['id'])
  syncProp()
}

// 機種切換按鈕
const specRow = $<HTMLDivElement>('specRow')
const specButtons = SPECS.map((s, i) => {
  const b = document.createElement('button')
  b.textContent = s.id === 'p51d' ? 'P-51D' : 'Bf 109'
  b.dataset['id'] = s.id
  b.onclick = () => { specIndex = i; rebuild() }
  specRow.appendChild(b)
  return b
})

const rpm = $<HTMLInputElement>('rpm')

function syncProp(): void {
  const p = Number(rpm.value)
  $<HTMLSpanElement>('rpmV').textContent = p === 0 ? '停' : p < 0.5 ? '慢轉' : '模糊'
}
rpm.addEventListener('input', syncProp)

$<HTMLButtonElement>('wire').onclick = (ev) => {
  wireframe = !wireframe
  if (model) applyWireframe(model, wireframe)
  ;(ev.currentTarget as HTMLElement).classList.toggle('on', wireframe)
}
$<HTMLButtonElement>('env').onclick = (ev) => {
  const on = scene.environment === null
  scene.environment = on ? envTexture : null
  ;(ev.currentTarget as HTMLElement).classList.toggle('on', on)
}
$<HTMLButtonElement>('axes').onclick = (ev) => {
  axes.visible = !axes.visible
  ;(ev.currentTarget as HTMLElement).classList.toggle('on', axes.visible)
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { autoRotate = !autoRotate; e.preventDefault() }
})

function resize(): void {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()
rebuild()

// 開發用：讓 Playwright 之類的外部工具設定正交視角截圖。
// （不用 import.meta.env.DEV 判斷——專案沒有 vite/client 型別，
// tsc --noEmit 會報 ImportMeta.env 不存在。機庫本身就是開發工具。）
;(window as unknown as Record<string, unknown>)['__hangarCam'] =
    (x: number, y: number, z: number) => {
      autoRotate = false
      if (model) model.group.rotation.y = 0
      camera.position.set(x, y, z)
      // 只有正上方俯視需要換 up（否則 lookAt 退化）；其餘一律 +Y 朝上，
      // 不然斜視角會被轉得歪七扭八。
      const overhead = x === 0 && z === 0
      camera.up.set(0, overhead ? 0 : 1, overhead ? -1 : 0)
      controls.update()
    }

let last = performance.now()
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now

  if (model) {
    const p = Number(rpm.value)
    propRotation += p * 30 * dt
    model.setPropSpin(propRotation, p >= 0.5)
    if (autoRotate) model.group.rotation.y += dt * 0.35
  }
  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
