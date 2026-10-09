import { CircleGeometry, Mesh, type Material, type Object3D } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createScene } from '../render/scene'
import { createTerrain } from '../render/terrain'
import { buildAircraft, preloadAircraftModels } from '../render/geometry/buildAircraft'
import type { AircraftModel } from '../render/geometry/assembly'
import { PROP_BLUR, countBlades, createPropBlurMaterial, syncPropBlur } from '../render/propBlur'
import type { AircraftSpec } from '../specs/types'
import { A6M5 } from '../specs/a6m5'
import { B17G } from '../specs/b17g'
import { BF109K4 } from '../specs/bf109k4'
import { F4F4 } from '../specs/f4f4'
import { F6F5 } from '../specs/f6f5'
import { G4M } from '../specs/g4m'
import { HE111 } from '../specs/he111'
import { JU87 } from '../specs/ju87'
import { KI84 } from '../specs/ki84'
import { P51D } from '../specs/p51d'
import { YAK1B } from '../specs/yak1b'

/**
 * 螺旋槳殘影的調整頁 —— 開發工具，**不屬於遊戲**。
 *
 * 用遊戲真正的機體模型（`buildAircraft`），把槳盤的材質換成 `render/propBlur.ts` 的殘影材質，
 * 與舊的灰圓盤、實際槳葉切換比較。滑桿改的是 `PROP_BLUR` 那一份，接進遊戲時用同一份。
 *
 * 進入方式：`npm run dev` 之後開 /tools/propblur.html。
 */

const SPECS: readonly AircraftSpec[] = [P51D, BF109K4, A6M5, KI84, F4F4, F6F5, YAK1B, JU87, B17G, HE111, G4M]

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)
const terrain = createTerrain('sea')
terrain.object.position.y = -400
ctx.scene.add(terrain.object)
await preloadAircraftModels()

const controls = new OrbitControls(ctx.camera, ctx.renderer.domElement)

interface PropParts {
  hub: Object3D
  disc: Mesh
  blades: Mesh[]
  oldMaterial: Material | Material[]
  newMaterial: Material
  count: number
}

let model: AircraftModel | null = null
let props: PropParts[] = []
type Mode = 'new' | 'old' | 'blades'
let mode: Mode = 'new'

/** 換機種：建模型、找出每一具槳的圓盤與槳葉，數槳葉、建殘影材質 */
function load(spec: AircraftSpec): void {
  if (model !== null) ctx.scene.remove(model.group)
  for (const p of props) (p.newMaterial as Material).dispose()
  model = buildAircraft(spec)
  ctx.scene.add(model.group)
  props = []
  model.group.traverse((o) => {
    if (!o.userData['propHub']) return
    let disc: Mesh | null = null
    const blades: Mesh[] = []
    for (const c of o.children) {
      const m = c as Mesh
      if (!m.isMesh) continue
      if (m.geometry.type === 'CircleGeometry') disc = m
      else blades.push(m)
    }
    if (disc === null) return
    const d = disc as Mesh
    d.geometry.computeBoundingSphere()
    const radius = d.geometry.boundingSphere?.radius ?? 1.7
    const positions: number[] = []
    for (const b of blades) {
      const a = b.geometry.getAttribute('position')
      for (let i = 0; i < a.count; i++) positions.push(a.getX(i), a.getY(i), a.getZ(i))
    }
    const count = countBlades(positions, radius)
    // 圓盤邊數拉高：舊的 16 邊在殘影的柔邊上看得出稜角
    d.geometry = new CircleGeometry(radius, 64)
    props.push({ hub: o, disc: d, blades, oldMaterial: d.material, newMaterial: createPropBlurMaterial(count, radius), count })
  })
  applyMode()
  setCamera('quarter')
  document.getElementById('info')!.textContent =
    `${spec.id}：${props.length} 具槳，槳葉 ${props.map((p) => p.count).join('／')} 片`
}

function applyMode(): void {
  for (const p of props) p.disc.material = mode === 'old' ? p.oldMaterial : p.newMaterial
  document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => {
    b.classList.toggle('on', b.dataset['mode'] === mode)
  })
}

function setCamera(which: string): void {
  if (model === null) return
  const hub = props[0]?.hub.position
  const hy = hub?.y ?? 0, hz = hub?.z ?? -2.5
  const cams: Record<string, [number, number, number, number, number, number]> = {
    front: [0, hy, hz - 9, 0, hy, hz],
    quarter: [5.5, hy + 1.6, hz - 7, 0, hy, hz + 1],
    side: [9, hy + 0.4, hz + 0.5, 0, hy, hz + 0.5],
    cockpit: [model.eyePoint.x, model.eyePoint.y, model.eyePoint.z, model.eyePoint.x, model.eyePoint.y, model.eyePoint.z - 20],
  }
  const c = cams[which]!
  ctx.camera.position.set(c[0], c[1], c[2])
  controls.target.set(c[3], c[4], c[5])
  controls.update()
}

const select = document.getElementById('spec') as HTMLSelectElement
for (const s of SPECS) select.add(new Option(s.id, s.id))
select.addEventListener('change', () => load(SPECS.find((s) => s.id === select.value)!))
document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => {
  b.addEventListener('click', () => { mode = b.dataset['mode'] as Mode; applyMode() })
})
document.querySelectorAll<HTMLButtonElement>('#cams button').forEach((b) => {
  b.addEventListener('click', () => setCamera(b.dataset['cam']!))
})

const SLIDERS: [keyof typeof PROP_BLUR, string, number, number, number][] = [
  ['opacity', '整體濃度', 0, 1, 0.01],
  ['rootAlpha', '槳根濃度', 0, 1, 0.01],
  ['tipAlpha', '槳尖濃度', 0, 1, 0.01],
  ['fadeCurve', '漸變曲線', 0.2, 6, 0.1],
  ['rootSmear', '槳根殘影長', 0, 0.5, 0.005],
  ['tipSmear', '槳尖殘影長', 0, 0.5, 0.005],
  ['smearCurve', '殘影漸增曲線', 0.2, 6, 0.1],
  ['bladeWidth', '槳葉寬', 0, 0.3, 0.005],
  ['base', '底盤濃度', 0, 0.3, 0.005],
  ['baseCurve', '底盤漸變曲線', 0, 6, 0.1],
  ['spin', '殘影轉速', 0, 30, 0.5],
  ['shade', '顏色亮度', 0, 1, 0.01],
]
const dump = document.getElementById('dump') as HTMLTextAreaElement
const sliders = document.getElementById('sliders')!
const writeDump = (): void => { dump.value = JSON.stringify(PROP_BLUR, null, 1) }
for (const [key, label, min, max, step] of SLIDERS) {
  const row = document.createElement('div')
  row.className = 'row'
  row.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${PROP_BLUR[key]}"><span class="val"></span>`
  const input = row.querySelector('input')!
  const val = row.querySelector('.val')!
  const sync = (): void => {
    PROP_BLUR[key] = Number(input.value)
    val.textContent = String(PROP_BLUR[key])
    syncPropBlur()
    writeDump()
  }
  input.addEventListener('input', sync)
  sync()
  sliders.appendChild(row)
}

load(P51D)

let last = performance.now()
/** 槳轂照真實轉速轉；殘影圓盤另外照 `PROP_BLUR.spin` 轉 */
let hubAngle = 0
let blurAngle = 0
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  hubAngle += dt * (mode === 'blades' ? 1 : 60)
  blurAngle += dt * PROP_BLUR.spin
  if (model !== null) {
    model.setPropSpin(hubAngle, mode !== 'blades')
    for (const p of props) p.disc.rotation.z = mode === 'new' ? blurAngle - hubAngle : 0
  }
  controls.update()
  terrain.update(now / 1000, ctx.camera.position.x, ctx.camera.position.z)
  ctx.renderer.render(ctx.scene, ctx.camera)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
