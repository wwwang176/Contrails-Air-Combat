import {
  AmbientLight, AxesHelper, Box3, Color, DirectionalLight, GridHelper, HemisphereLight,
  Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, OrthographicCamera,
  PerspectiveCamera,
  PMREMGenerator, Scene, Vector3, WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { DEG } from '../core/math'
import { collectTriangles, extentSlices, radialSlices, type Axis } from './sliceRef'
import { buildAircraft, type AircraftModel } from '../render/geometry/buildAircraft'
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
// preserveDrawingBuffer：外部工具要把畫面複製到 2D canvas 抽輪廓，
// 否則 drawImage 讀到的是已經被清空的緩衝區。開發工具，效能無所謂。
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

const scene = new Scene()
scene.background = new Color(0x0d1620)

const camera = new PerspectiveCamera(42, 1, 0.1, 500)
camera.position.set(11, 5, 13)

/**
 * 正交視圖——比對三視圖線稿專用。
 *
 * 【為什麼一定要正交】透視相機會讓靠近鏡頭的部件變大，機首與機尾的長度
 * 比例在畫面上就不是真的，拿去跟線稿對照只會得到錯的結論。線稿本身是
 * 正交投影，要比就得用同一種投影。
 */
const orthoCam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 500)
let orthoView: 'side' | 'top' | 'front' | null = null

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

/**
 * 參考模型疊圖 —— 載入外部高面數模型，縮放對齊後疊在程序化模型上，用同一顆
 * 正交相機比對外形。
 *
 * 對齊參數寫在這裡而不是網址：三個值都是**量出來的**，不是每次調的旋鈕
 * ——一旦某台的 pitch 定案，下次開機庫沒有理由再打一次，打錯了還很難發現
 * （實測 P-51D 用 −9.5° 時剪影上看起來已經差不多平了，正確值卻是 −14.0°）。
 *
 * 【flip：為什麼不自動判斷】試過用「螺旋槳端的 X 延伸較大」自動判向，但
 * 109 那個模型的機尾也有寬達 ±1.31 的部件，判準直接失效；第一版疊圖整台
 * 頭尾顛倒，還一度被讀成「機身形狀差很多」。
 *
 * 【pitch：參考模型不保證是飛行姿態】P-51D 那個模型是三點著陸姿態、起落架
 * 放下，整台機首朝上 14°。不轉正會被讀成「機身前段太低、後段太高」。求法
 * 見 .claude/skills/aircraft-from-reference（掃描殘餘俯仰角過零）。
 *
 * 【為什麼用疊圖而不是數值切剖面】寫過 GLB 剖面抽取器，解析本身沒問題
 * （三角形數與檔頭一致），但第三方模型有兩百多個節點——蒙皮、內裝、起落架、
 * 螺旋槳混在一起，要靠幾何猜測分類才能取得「機身外形」。分類猜錯，比對就
 * 建立在錯的基準上。疊圖交給眼睛判斷，反而沒有這個失敗模式。
 *
 * 參考模型只當量尺，不進版控（ref/ 已列入 .gitignore），更不會被打包進遊戲。
 *
 * 【宣告必須早於 rebuild() 的呼叫】rebuild → syncRef → 這幾個 const，
 * 放在下面會撞上暫時死區，整支機庫腳本當場掛掉。
 */
interface RefSpec {
  url: string
  /** true = 模型的機首朝 +Z，需要繞 Y 轉 180° */
  flip: boolean
  /** 繞世界 X 軸轉正的角度，度 */
  pitch: number
}
const REFS: Record<string, RefSpec> = {
  p51d: { url: '/ref/p51d.glb', flip: true, pitch: -14.0 },
  bf109g6: { url: '/ref/bf109e4.glb', flip: true, pitch: 0 },
}
const refCache: Record<string, Object3D | null> = {}
let refVisible = false
/**
 * 實體參考：把參考模型改用不透明的一般材質。
 *
 * 【為什麼需要】疊圖用的 30% 平塗橘色只保留輪廓——那正是比對外形時要的，
 * 但也把參考模型自己的面線洗掉了。要判讀「座艙罩的玻璃分界線在哪」這種
 * **輪廓以內**的特徵時，平塗完全看不出來，得先能看見它本來的樣子。
 */
let refSolid = false
let refModel: Object3D | null = null
// 切片用的三角形快取。宣告同樣必須早於 rebuild()——syncRef 會清它。
let refTris: Float32Array | null = null
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
  const { tris, meshes } = countTriangles(model)
  stats.textContent =
    `${spec.name}\n` +
    `三角形  ${tris}\n` +
    `mesh    ${meshes}\n` +
    `翼展    ${size.x.toFixed(2)} / 真機 ${spec.wing.span.toFixed(2)} m\n` +
    `全長    ${size.z.toFixed(2)} / 真機 ${model.metrics.realLength.toFixed(2)} m\n` +
    `高      ${size.y.toFixed(2)} m`

  for (const b of specButtons) b.classList.toggle('on', SPECS[specIndex]!.id === b.dataset['id'])
  syncProp()
  syncRef()
  frameOrtho()
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

/** 把正交相機框到整台飛機（含 8% 邊界），並擺到指定的正視方向。 */
function frameOrtho(): void {
  if (!model || !orthoView) return
  model.group.rotation.y = 0
  model.group.updateMatrixWorld(true)
  const box = new Box3().setFromObject(model.group)
  if (refModel?.visible) box.union(new Box3().setFromObject(refModel))
  const size = box.getSize(new Vector3())
  const c = box.getCenter(new Vector3())

  // 每個視圖的畫面寬高各取自哪兩根機體軸
  const [w, h] = orthoView === 'side' ? [size.z, size.y]
    : orthoView === 'top' ? [size.z, size.x]
      : [size.x, size.y]
  const aspect = window.innerWidth / window.innerHeight
  const half = Math.max(w / aspect, h) * 0.54   // 0.5 + 8% 邊界
  orthoCam.left = -half * aspect
  orthoCam.right = half * aspect
  orthoCam.top = half
  orthoCam.bottom = -half
  orthoCam.near = 0.1
  orthoCam.far = 200
  orthoCam.up.set(0, orthoView === 'top' ? 0 : 1, orthoView === 'top' ? -1 : 0)
  const d = 60
  orthoCam.position.copy(c).add(
    orthoView === 'side' ? new Vector3(d, 0, 0)
      : orthoView === 'top' ? new Vector3(0, d, 0)
        : new Vector3(0, 0, -d),
  )
  orthoCam.lookAt(c)
  orthoCam.updateProjectionMatrix()
}

for (const [id, view] of [['vSide', 'side'], ['vTop', 'top'], ['vFront', 'front']] as const) {
  $<HTMLButtonElement>(id).onclick = () => {
    orthoView = orthoView === view ? null : view
    autoRotate = false
    frameOrtho()
    for (const [bid, v] of [['vSide', 'side'], ['vTop', 'top'], ['vFront', 'front']] as const) {
      $<HTMLButtonElement>(bid).classList.toggle('on', orthoView === v)
    }
  }
}

/**
 * 參考模型的開關。第一次勾選才下載 GLB（兩個檔加起來 50 MB）。
 *
 * 【為什麼是勾選而不是網址參數】對齊用的三個值（路徑、機首朝向、俯仰角）
 * 都是量出來的定值，寫在 REFS 裡；每次開機庫重打一次只會打錯——而且打錯
 * 很難發現，實測 P-51D 用 −9.5° 時剪影上看起來已經差不多平了。
 */
const refCheck = $<HTMLInputElement>('refOn')
refCheck.onchange = () => {
  refVisible = refCheck.checked
  syncRef()
}
$<HTMLButtonElement>('refSolid').onclick = (ev) => {
  refSolid = !refSolid
  for (const obj of Object.values(refCache)) if (obj) applyRefMaterial(obj)
  ;(ev.currentTarget as HTMLElement).classList.toggle('on', refSolid)
}

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
  frameOrtho()
}
window.addEventListener('resize', resize)
resize()
rebuild()

// 開發用：讓 Playwright 之類的外部工具設定正交視角截圖。
// （不用 import.meta.env.DEV 判斷——專案沒有 vite/client 型別，
// tsc --noEmit 會報 ImportMeta.env 不存在。機庫本身就是開發工具。）
;(window as unknown as Record<string, unknown>)['__hangarOrtho'] =
    (view: 'side' | 'top' | 'front' | null, hideGrid = true) => {
      orthoView = view
      autoRotate = false
      grid.visible = !(view && hideGrid)
      frameOrtho()
    }
;(window as unknown as Record<string, unknown>)['__hangarCam'] =
    (x: number, y: number, z: number) => {
      autoRotate = false
      orthoView = null
      if (model) model.group.rotation.y = 0
      camera.position.set(x, y, z)
      // 只有正上方俯視需要換 up（否則 lookAt 退化）；其餘一律 +Y 朝上，
      // 不然斜視角會被轉得歪七扭八。
      const overhead = x === 0 && z === 0
      camera.up.set(0, overhead ? 0 : 1, overhead ? -1 : 0)
      controls.update()
    }

/**
 * 參考模型疊圖 —— 用 `?ref=/ref/xxx.glb` 載入外部高面數模型，縮放對齊後
 * 疊在程序化模型上，用同一顆正交相機比對外形。
 *
 * 【為什麼用疊圖而不是數值切剖面】我先寫過 GLB 剖面抽取器，解析本身沒問題
 * （三角形數與檔頭一致），但第三方模型有兩百多個節點——蒙皮、內裝、起落架、
 * 螺旋槳混在一起，要靠幾何猜測分類才能取得「機身外形」。分類猜錯，比對就
 * 建立在錯的基準上。疊圖交給眼睛判斷，反而沒有這個失敗模式。
 *
 * 參考模型只當量尺，不進版控（ref/ 已列入 .gitignore），更不會被打包進遊戲。
 */

/**
 * 把參考模型依「當前機種的真機全長」等比縮放，並讓機首對齊。
 *
 * 【必須在每次切換機種時重跑】兩架飛機的全長與重心位移都不同。第一版
 * 只在載入完成時對齊一次，而 GLB 有 23 MB、載入比機種切換慢，結果對齊
 * 用的是切換前那架的參數——疊出來整台平移了 1.5 m。
 */
function placeRef(): void {
  if (!refModel || !model) return
  const m = model.metrics
  refModel.scale.setScalar(1)
  refModel.position.set(0, 0, 0)
  refModel.updateMatrixWorld(true)
  const raw = new Box3().setFromObject(refModel)
  // 翻轉在內層（模型自己的軸向），俯仰在外層（世界 X 軸）——兩者若擠在
  // 同一個 Euler 上，180° 的翻轉會把俯仰的正負也一起翻掉。
  const cfg = REFS[SPECS[specIndex]!.id]!
  refModel.children[0]!.rotation.y = cfg.flip ? Math.PI : 0
  refModel.rotation.x = cfg.pitch * DEG
  refModel.updateMatrixWorld(true)
  /**
   * 縮放基準用**翼展**，不是全長。
   *
   * 【為什麼】全長被螺旋槳與姿態污染：實測兩個參考模型依全長縮放後，翼展
   * 都短了——Bf 109 是 9.481 對 9.87（−4.0%）、P-51D 是 11.030 對 11.286
   * （−2.3%）。整台縮小幾個百分點，之後量到的每一個尺寸都跟著錯。
   * 翼尖是乾淨的基準：±X 的極端點必然是翼尖，沒有起落架、螺旋槳、天線。
   */
  refModel.scale.setScalar(SPECS[specIndex]!.wing.span / raw.getSize(new Vector3()).x)
  refModel.updateMatrixWorld(true)
  const scaled = new Box3().setFromObject(refModel)
  refModel.position.z = m.noseZ - scaled.min.z

  // 垂直對齊用**翼尖**：外部模型的 Y 原點是任意的（可能是地面、可能是
  // 推力線）。翼尖是兩邊都乾淨的基準——那裡沒有起落架、內裝、螺旋槳，
  // 而且 ±X 的極端點必然是翼尖，不需要辨識零件。
  refModel.position.y = m.tipY - tipY(refModel, scaled)
}

/** 模型左右翼尖（|x| 落在最外側 8% 內的頂點）的平均 Y。 */
function tipY(obj: Object3D, box: Box3): number {
  const lim = Math.max(box.max.x, -box.min.x) * 0.92
  const v = new Vector3()
  let sum = 0, n = 0
  obj.traverse((o) => {
    const pos = (o as Mesh).geometry?.getAttribute?.('position')
    if (!pos) return
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld)
      if (Math.abs(v.x) > lim) { sum += v.y; n++ }
    }
  })
  return n ? sum / n : 0
}

/**
 * 依「目前機種 × 是否勾選」決定要不要顯示參考模型，需要時才載入並快取。
 *
 * 【為什麼是懶載入】兩個 GLB 加起來 50 MB。沒勾就不該付這個代價——機庫
 * 平常是用來看自家模型的，疊圖只在校正外形時才需要。
 */
function syncRef(): void {
  if (refModel) refModel.visible = false
  refTris = null
  const id = SPECS[specIndex]!.id
  if (!refVisible) { refModel = null; return }

  refModel = refCache[id] ?? null
  if (refModel) {
    refModel.visible = true
    placeRef()
    frameOrtho()
    return
  }
  if (id in refCache) return          // 佔位中：載入尚未完成
  const cfg = REFS[id]
  if (!cfg) return
  refCache[id] = null                 // 佔位，避免連點時重複載入
  new GLTFLoader().load(cfg.url, (gltf) => {
    applyRefMaterial(gltf.scene)
    // 包一層 Group：內層做機首朝向的翻轉、外層做世界軸的俯仰與定位
    const wrapper = new Group()
    wrapper.add(gltf.scene)
    refCache[id] = wrapper
    scene.add(wrapper)
    wrapper.visible = refVisible && SPECS[specIndex]!.id === id
    if (wrapper.visible) { refModel = wrapper; placeRef(); frameOrtho() }
  })
}

/**
 * 疊圖用 30% 平塗橘色、只保留輪廓；「實體」模式改用一般材質看得到面線。
 *
 * 【為什麼不用線框】線框會把內裝、發動機、起落架全部畫出來，反而看不出
 * 輪廓。實心剪影才是要比對的東西。
 */
function applyRefMaterial(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    // 切換材質時回收舊的，否則反覆勾選會累積 GPU 資源
    for (const m of [mesh.material].flat()) m.dispose()
    mesh.material = refSolid
      ? new MeshStandardMaterial({ color: 0xb0b8c0, roughness: 0.6 })
      : new MeshBasicMaterial({
        color: 0xff5a3c, transparent: true, opacity: 0.30, depthWrite: false,
      })
  })
}

/**
 * 開發用：把已對齊的參考模型切片量測。三角形只蒐集一次，之後多次切片共用。
 *
 * 回傳的是**量測結果**，不是定案幾何——機翼與起落架會混進機身的切面，
 * 要先看剖面圖判斷哪幾段可信（見 sliceRef 的說明）。
 */
;(window as unknown as Record<string, unknown>)['__hangarSlice'] =
    (kind: 'radial' | 'extent', axis: Axis, o: Record<string, number | [number, number]>) => {
      if (!refModel) return null
      refTris ??= collectTriangles(refModel)
      return kind === 'radial'
        ? radialSlices(refTris, axis, o as never)
        : extentSlices(refTris, axis, o as never)
    }

// 開發用：外部工具（Playwright）用來開啟參考模型並等它載入完成。
;(window as unknown as Record<string, unknown>)['__hangarRef'] =
    async (on: boolean, solid = false) => {
      refSolid = solid
      refCheck.checked = on
      refVisible = on
      syncRef()
      // 回報是否已就緒，讓呼叫端可以輪詢而不是硬等
      return refModel !== null
    }

// 開發用：分別開關兩個模型，讓外部工具各自截一張純剪影來抽輪廓。
;(window as unknown as Record<string, unknown>)['__hangarShow'] =
    (mine: boolean, ref: boolean) => {
      if (model) model.group.visible = mine
      if (refModel) refModel.visible = ref
    }

let last = performance.now()
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now

  if (model) {
    const p = Number(rpm.value)
    propRotation += p * 30 * dt
    model.setPropSpin(propRotation, p >= 0.5)
    if (autoRotate && !orthoView) model.group.rotation.y += dt * 0.35
  }
  controls.update()
  renderer.render(scene, orthoView ? orthoCam : camera)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
