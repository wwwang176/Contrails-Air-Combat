import { countModelTriangles } from './hangarMeasurements'
import { buildArcs, buildBarrels, buildShipArcs, disposeBarrels } from './hangarWeapons'
import { disposeHangarShip, prepareHangarShip } from './hangarShipLoading'
import {
  AmbientLight, AxesHelper, Box3, Color,
  DirectionalLight, GridHelper, HemisphereLight,
  Group, Mesh, MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PMREMGenerator, Scene, Vector3, WebGLRenderer,
} from 'three'
import { createGltfLoader } from '../render/geometry/gltfLoader'
import { dressShipModel } from '../render/shipAssets'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import {
  buildAircraft, GLB_MODELS, preloadAircraftModels, preloadLiveryVariants, type AircraftModel,
} from '../render/geometry/buildAircraft'
import { SHIP_AA_ZONES } from '../world/shipAA'
import { P51D } from '../specs/p51d'
import { BF109K4 } from '../specs/bf109k4'
import { HE111 } from '../specs/he111'
import { B17G } from '../specs/b17g'
import { KI84 } from '../specs/ki84'
import { A6M5 } from '../specs/a6m5'
import { G4M } from '../specs/g4m'
import { F6F5 } from '../specs/f6f5'
import { F4F4 } from '../specs/f4f4'
import { JU87 } from '../specs/ju87'
import { YAK1B } from '../specs/yak1b'
import type { AircraftSpec } from '../specs/types'
import { assetUrl } from '../core/asset'

/**
 * 檢視台 —— 純檢視用的開發工具，不屬於遊戲。
 *
 * 【它不是遊戲裡的「機庫」】那一頁是玩家看飛機的地方（`src/app/showcase.ts`
 * 與 `src/ui/dossier.ts`）：海上飛行、拖曳轉視角、左邊一份機種檔案。這一支
 * 看的是機種模型、塗裝、槍管與射界，玩家到不了。
 *
 * 【為什麼直接 import buildAircraft】這裡看到的必須是實際會飛的那架飛機。
 * 若另外複製一份，看到的就不是遊戲裡的東西，這個工具反而會製造錯誤的信心。
 *
 * 進入方式：`npm run dev` 之後開 /tools/hangar.html。加 `?livery=winter` 看任務卡的冬季塗裝。
 */

const SPECS: AircraftSpec[] = [P51D, BF109K4, F6F5, F4F4, KI84, A6M5, HE111, JU87, B17G, G4M, YAK1B]

/** 網址 `?livery=` 指定的塗裝變體；這個機種沒登記那個變體就是 `undefined`（預設塗裝） */
function variantFor(spec: AircraftSpec): string | undefined {
  const v = new URLSearchParams(location.search).get('livery')
  return v !== null && GLB_MODELS[spec.id]?.liveryVariants?.[v] !== undefined ? v : undefined
}

const canvas = document.getElementById('scene') as HTMLCanvasElement
// preserveDrawingBuffer：外部工具截圖時要讀得到畫面，
// 否則讀到的是已經被清空的緩衝區。開發工具，效能無所謂。
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

const scene = new Scene()
scene.background = new Color(0x0d1620)

const camera = new PerspectiveCamera(42, 1, 0.1, 500)
camera.position.set(11, 5, 13)

/**
 * 正交視圖：側、俯、前三個正視方向。透視相機會讓靠近鏡頭的部件變大，
 * 正交投影才看得出真實的長度比例。
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
const hemi = new HemisphereLight(0xbfd8ee, 0x2a3a48, 0.9)
scene.add(hemi)
const ambient = new AmbientLight(0xffffff, 0.15)
scene.add(ambient)

// 環境反射預設關閉：遊戲場景目前沒有它，開著會讓機庫比遊戲好看。
// 按鈕可切換，用來評估「要不要把它加進遊戲」。
const pmrem = new PMREMGenerator(renderer)
const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.05).texture

const grid = new GridHelper(40, 40, 0x4f7ea8, 0x2b3f52)
grid.position.y = -3
grid.material.transparent = true
grid.material.opacity = 0.35
scene.add(grid)

/**
 * 亮／暗兩檔打光。**預設是暗的那一檔，而且那一檔才是「對」的。**
 *
 * 【為什麼不直接把機庫調亮】上面那行寫著「燈光刻意與遊戲場景一致，這樣機庫
 * 看到的明暗就是遊戲裡的明暗，而不是一個打光更討喜的攝影棚」。把預設調亮
 * 等於把那個約定作廢 —— 機庫從此會告訴你「這台飛機很好看」，而玩家在遊戲裡
 * 看到的是另一回事。
 *
 * 但**看細節**時暗的那一檔會擋路：場景只有 0.15 環境光加一盞半球光，而
 * 半球光的地面色是 0x2a3a48（暗藍灰）—— 機腹因此幾乎全黑，機腹吊艙的玻璃
 * 在畫面上看不出來。那不是模型的問題，是燈光的問題。
 *
 * 所以做成一個**明確要按的**開關：預設暗（＝遊戲的真相），要看細節時按亮。
 *
 * 【亮的那一檔動三個東西，都是為了照到機腹】
 *   背景        深藍 → 淺灰藍，剪影才分得出來
 *   半球光地面色 暗藍灰 → 淺灰，這一個才是真正照亮機腹的
 *   環境光      0.15 → 0.55，把最暗處拉離全黑
 * 太陽光不動 —— 它決定的是高光與陰影的方向，改了連形狀的讀法都會變。
 */
let studio = false
function syncLight(): void {
  scene.background = new Color(studio ? 0x8ea6ba : 0x0d1620)
  hemi.groundColor.set(studio ? 0xc4ced6 : 0x2a3a48)
  hemi.intensity = studio ? 1.1 : 0.9
  ambient.intensity = studio ? 0.55 : 0.15
  grid.material.opacity = studio ? 0.18 : 0.35
}

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

function applyWireframe(m: AircraftModel, on: boolean): void {
  m.group.traverse((o) => {
    const mat = (o as Mesh).material as MeshStandardMaterial | undefined
    if (mat && 'wireframe' in mat) mat.wireframe = on
  })
}

/**
 * 軍艦 —— 機庫裡只是**看射界**用，不做飛行模型。
 *
 * 直接載遊戲用的那一支 GLB。射界錐的位置讀 `world/shipAA.ts`，它與 GLB 的砲座
 * 位置一致，GLB 換了要跟著對。
 */
const SHIPS: readonly { id: string; name: string; url: string; loa: number }[] = [
  { id: 'essex', name: 'Essex CV-9', url: '/models/essex.glb', loa: 265.79 },
  { id: 'fletcher', name: 'Fletcher DD-445', url: '/models/fletcher.glb', loa: 114.75 },
  { id: 'wichita', name: 'Wichita CA-45', url: '/models/wichita.glb', loa: 185.42 },
  { id: 'lst', name: 'LST-1', url: '/models/lst.glb', loa: 103.86 },
]
let barrels: Group | null = null
let arcs: Group | null = null
let arcsOn = false

let shipGroup: Group | null = null

/** 把飛機那一組（機體、砲管、射界錐）全部拿掉並釋放。 */
function clearAircraft(): void {
  if (model) { scene.remove(model.group); model.dispose(); model = null }
  if (barrels) { scene.remove(barrels); disposeBarrels(barrels); barrels = null }
  if (arcs) { scene.remove(arcs); disposeBarrels(arcs); arcs = null }
}

function clearShip(): void {
  if (shipGroup) { scene.remove(shipGroup); disposeHangarShip(shipGroup); shipGroup = null }
}

/**
 * 切到某一艘船：載 GLB、依 `world/shipAA.ts` 的併區表擺射界錐。
 *
 * 【相機的遠平面要拉開】500 不夠 —— 265 m 的 Essex 加上 42 m 的射界錐，
 * 用預設值會被遠平面切掉一半，而且**畫面上看起來像船尾被削平了**。
 */
function rebuildShip(id: string): void {
  clearAircraft()
  clearShip()
  const cfg = SHIPS.find((sp) => sp.id === id)!
  camera.far = 4000; camera.near = 1; camera.updateProjectionMatrix()
  orthoCam.far = 4000; orthoCam.updateProjectionMatrix()
  const g = new Group()
  shipGroup = g
  scene.add(g)
  g.add(buildShipArcs(id))
  const zones = SHIP_AA_ZONES[id] ?? []
  const n: Record<string, number> = {}
  for (const z of zones) n[z.tier] = (n[z.tier] ?? 0) + z.mountsInZone
  stats.textContent =
    `${cfg.name}
` +
    `全長      ${cfg.loa.toFixed(2)} m（史實）
` +
    `砲區      ${zones.length}（上限 8）
` +
    `兩用砲    ${n['flak'] ?? 0} 門 → 遠距空炸（黑霧）
` +
    `40 mm     ${n['autocannon'] ?? 0} 門 → 中距曳光
` +
    `20 mm     ${n['mg'] ?? 0} 門 → 近距曳光
` +
    `射界是起始值，由試飛裁定`
  createGltfLoader().load(assetUrl(cfg.url), async (gltf) => {
    // 【塗裝與遊戲同一支】自己載的 GLB 不經過 `preloadShipModels`
    try {
      if (!await prepareHangarShip(gltf.scene, () => shipGroup === g, (root) => dressShipModel(id, root))) return
    } catch (error) {
      console.error('機庫船艦塗裝失敗', error)
      return
    }
    if (shipGroup !== g) { disposeHangarShip(gltf.scene); return }
    g.add(gltf.scene)
    const box = new Box3().setFromObject(gltf.scene)
    controls.target.copy(box.getCenter(new Vector3()))
    camera.position.copy(controls.target).add(new Vector3(cfg.loa * 0.55, cfg.loa * 0.35, cfg.loa * 0.7))
    controls.update()
    frameOrtho()
  })
  for (const b of specButtons) b.classList.remove('on')
  for (const b of shipButtons) b.classList.toggle('on', b.dataset['id'] === id)
}

function rebuild(): void {
  clearShip()
  camera.far = 500; camera.near = 0.1; camera.updateProjectionMatrix()
  orthoCam.far = 500; orthoCam.updateProjectionMatrix()
  for (const b of shipButtons) b.classList.remove('on')
  if (model) {
    scene.remove(model.group)
    model.dispose()
  }
  if (arcs) {
    scene.remove(arcs)
    disposeBarrels(arcs)
    arcs = null
  }
  if (barrels) {
    scene.remove(barrels)
    // 【要 dispose 幾何與材質】`scene.remove` 只是把它從場景圖拿掉，three 的
    // `WebGLGeometries` / `WebGLMaterials` 是在 geometry 與 material 的
    // `dispose` 事件裡才釋放 GPU buffer 與著色器程式。少了這一步，每切換
    // 一次機種就漏一組。
    disposeBarrels(barrels)
    barrels = null
  }
  const spec = SPECS[specIndex]!
  model = buildAircraft(spec, variantFor(spec))
  scene.add(model.group)
  barrels = buildBarrels(spec)
  scene.add(barrels)
  arcs = buildArcs(spec)
  arcs.visible = arcsOn
  scene.add(arcs)
  applyWireframe(model, wireframe)

  const box = new Box3().setFromObject(model.group)
  const size = new Vector3()
  const center = new Vector3()
  box.getSize(size)
  box.getCenter(center)
  controls.target.copy(center)

  // 翼展與全長同時列出「網格的」與「真機的」，換了 GLB 之後偏離史實
  // 會立刻看得出來，不用等測試跑。
  const { tris, meshes } = countModelTriangles(model.group)
  stats.textContent =
    `${spec.name}\n` +
    `三角形  ${tris}\n` +
    `mesh    ${meshes}\n` +
    `翼展    ${size.x.toFixed(2)} / 真機 ${spec.wing.span.toFixed(2)} m\n` +
    `全長    ${size.z.toFixed(2)} / 真機 ${model.metrics.realLength.toFixed(2)} m\n` +
    `高      ${size.y.toFixed(2)} m`

  for (const b of specButtons) b.classList.toggle('on', SPECS[specIndex]!.id === b.dataset['id'])
  syncProp()
  frameOrtho()
}

// 機種切換按鈕
const specRow = $<HTMLDivElement>('specRow')
const specButtons = SPECS.map((s, i) => {
  const b = document.createElement('button')
  // 【為什麼查表而不是三元式】`id === 'p51d' ? 'P-51D' : 'Bf 109'`
  // —— 那在只有兩台時剛好對，第三台一加就會被標成「Bf 109」而且不會有
  // 任何東西提醒你。查表少一筆是一個 undefined，看得見
  b.textContent = ({ p51d: 'P-51D', bf109k4: 'Bf 109 K-4', f6f5: 'F6F-5', f4f4: 'F4F-4', ki84: 'Ki-84', a6m5: 'A6M5', g4m: 'G4M', he111: 'He 111', ju87: 'Ju 87', b17g: 'B-17G', yak1b: 'Yak-1B' } as Record<string, string>)[s.id] ?? s.id
  b.dataset['id'] = s.id
  b.onclick = () => { specIndex = i; rebuild() }
  specRow.appendChild(b)
  return b
})

// 軍艦切換按鈕（只看射界，不是飛行載具）
const shipRow = $<HTMLDivElement>('shipRow')
const shipButtons = SHIPS.map((sp) => {
  const b = document.createElement('button')
  b.textContent = sp.name
  b.dataset['id'] = sp.id
  b.onclick = () => { rebuildShip(sp.id) }
  shipRow.appendChild(b)
  return b
})

const rpm = $<HTMLInputElement>('rpm')

function syncProp(): void {
  const p = Number(rpm.value)
  $<HTMLSpanElement>('rpmV').textContent = p === 0 ? '停' : p < 0.5 ? '慢轉' : '模糊'
}
rpm.addEventListener('input', syncProp)

/** 把正交相機框到整台飛機（含 8% 邊界），並擺到指定的正視方向。 */
/**
 * 把正交相機框到某一個包圍盒上。**遠平面與退後距離跟著盒子走** —— 寫死 200／60
 * 的話 265 m 的 Essex 會被切掉一半，而畫面上看起來像船尾被削平了。
 */
function frameBox(box: Box3): void {
  if (!orthoView) return
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
  const d = Math.max(60, size.length())
  orthoCam.near = 0.1
  orthoCam.far = d * 4
  orthoCam.up.set(0, orthoView === 'top' ? 0 : 1, orthoView === 'top' ? -1 : 0)
  orthoCam.position.copy(c).add(
    orthoView === 'side' ? new Vector3(d, 0, 0)
      : orthoView === 'top' ? new Vector3(0, d, 0)
        : new Vector3(0, 0, -d),
  )
  orthoCam.lookAt(c)
  orthoCam.updateProjectionMatrix()
}

function frameOrtho(): void {
  if (!orthoView) return
  if (shipGroup) {
    shipGroup.updateMatrixWorld(true)
    frameBox(new Box3().setFromObject(shipGroup))
    return
  }
  if (!model) return
  model.group.rotation.y = 0
  model.group.updateMatrixWorld(true)
  frameBox(new Box3().setFromObject(model.group))
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
const arcBtn = $<HTMLButtonElement>('arcs')
arcBtn.onclick = () => {
  arcsOn = !arcsOn
  if (arcs) arcs.visible = arcsOn
  arcBtn.classList.toggle('on', arcsOn)
}

$<HTMLButtonElement>('axes').onclick = (ev) => {
  axes.visible = !axes.visible
  ;(ev.currentTarget as HTMLElement).classList.toggle('on', axes.visible)
}
const litBtn = $<HTMLButtonElement>('lit')
litBtn.onclick = () => {
  studio = !studio
  syncLight()
  litBtn.classList.toggle('on', studio)
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { autoRotate = !autoRotate; e.preventDefault() }
})

/**
 * 把掛在 scene 上的附件對齊機身的變換。
 *
 * 【為什麼這些附件不是 `model.group` 的子物件】掛成子物件會污染面板上的讀數，
 * 而且不會報錯：`Box3.setFromObject` 的翼展／全長／高（尾砲塔槍口在 z 16.85
 * 而機身只到 16.25），以及 `countModelTriangles` 的三角形數。
 *
 * 代價是「轉盤日後長出新的自由度要記得補」—— 所以這裡複製的是整組
 * `rotation`／`position`／`scale`，不是只有 `rotation.y`。
 * 護欄見 `test/tools/turret-spin.probe.ts`。
 */
function syncToModel(g: Group | null): void {
  if (!g || !model) return
  g.rotation.copy(model.group.rotation)
  g.position.copy(model.group.position)
  g.scale.copy(model.group.scale)
}

function resize(): void {
  const w = window.innerWidth
  const h = window.innerHeight
  // updateStyle 不能關——關掉之後 dpr>1 的螢幕上 canvas 會排版成視窗的
  // dpr 倍大，只看得到左上角那一塊（見 render/scene.ts 的同一行）
  renderer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  frameOrtho()
}
window.addEventListener('resize', resize)
resize()

// 【GLB 機種要先載完再 rebuild】`buildAircraft` 是同步的，遇到還沒載好的
// 機種會直接拋。頂層 await 也順便擋住機種按鈕在載入完成前被按到。
await preloadAircraftModels()
// 【`?livery=winter` 看任務卡的塗裝變體】只給這個檢視台的網址參數；遊戲的機庫與遭遇戰沒有這個入口。
// 沒登記那個變體的機種照舊用預設塗裝
const liveryVariant = new URLSearchParams(location.search).get('livery') ?? undefined
if (liveryVariant !== undefined) {
  await preloadLiveryVariants(Object.fromEntries(
    SPECS.filter((s) => variantFor(s) !== undefined).map((s) => [s.id, liveryVariant]),
  ))
}
rebuild()

/**
 * 開發用：擺相機，給 Playwright 之類的外部工具截圖。
 * （不用 import.meta.env.DEV 判斷——專案沒有 vite/client 型別，
 * tsc --noEmit 會報 ImportMeta.env 不存在。機庫本身就是開發工具。）
 ***看向點可以指定**（`tx/ty/tz`，預設原點）。
 *
 * 【為什麼需要看向點】沒有它就只能看原點，而要看的東西（發動機艙在
 * x 2.6、腹艙在 z 3.9）都不在原點上 —— 近拍時它們被推到畫面角落，或者
 * 乾脆被機翼擋住。把看向點放到零件上才叫近拍。
 */
;(window as unknown as Record<string, unknown>)['__hangarCam'] =
    (x: number, y: number, z: number, tx = 0, ty = 0, tz = 0) => {
      autoRotate = false
      orthoView = null
      if (model) model.group.rotation.y = 0
      camera.position.set(x, y, z)
      // 只有正上方俯視需要換 up（否則 lookAt 退化）；其餘一律 +Y 朝上，
      // 不然斜視角會被轉得歪七扭八。
      const overhead = x === tx && z === tz
      camera.up.set(0, overhead ? 0 : 1, overhead ? -1 : 0)
      controls.target.set(tx, ty, tz)
      controls.update()
    }

/** 開發用：切換機種，免得腳本要去點 DOM 按鈕。 */
;(window as unknown as Record<string, unknown>)['__hangarSpec'] = (id: string) => {
  const i = SPECS.findIndex((sp) => sp.id === id)
  if (i < 0) return false
  specIndex = i
  rebuild()
  return true
}

/**
 * 開發用：讀機身與槍管的旋轉角，量「槍管有沒有跟著轉」。
 *
 * 【為什麼需要一個出口】這個缺陷**在截圖上不存在** —— `__hangarCam` 會把
 * `rotation.y` 歸零並停掉自動旋轉，所以外部工具拍出來的每一張都落在
 * 「兩者都是 0」的情況上。只有讓它轉起來再讀兩個角度才看得到。
 * 見 `test/tools/turret-spin.probe.ts`。
 */
/** 開發用：開關射界錐，讓截圖腳本不必去點 DOM。回傳目前是不是開著。 */
;(window as unknown as Record<string, unknown>)['__hangarArcs'] = (on: boolean) => {
  arcsOn = on
  if (arcs) arcs.visible = on
  arcBtn.classList.toggle('on', on)
  return arcs ? arcs.children.length : 0
}

;(window as unknown as Record<string, unknown>)['__hangarSpin'] = () => ({
  model: model ? model.group.rotation.y : 0,
  barrels: barrels ? barrels.rotation.y : 0,
  arcs: arcs ? arcs.rotation.y : 0,
  barrelCount: barrels ? barrels.children.length : 0,
  arcCount: arcs ? arcs.children.length : 0,
})

let last = performance.now()
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now

  if (model) {
    const p = Number(rpm.value)
    propRotation += p * 30 * dt
    model.setPropSpin(propRotation, p >= 0.5)
    if (autoRotate && !orthoView) model.group.rotation.y += dt * 0.35
    /**
     * 【槍管每幀跟上機身的變換】少了這一段，機庫的飛機一轉，機槍就留在
     * 原地。`barrels` 是**掛在 scene 上的兄弟節點**，不是
     * `model.group` 的子物件，所以轉盤動它不會動。
     *
     * 【為什麼不乾脆掛成子物件】那會污染面板上的讀數，而且不會報錯：
     *
     *   `Box3.setFromObject`          翼展／全長／高的讀數。尾砲塔的槍口在
     *                                 z 16.85 而機身只到 16.25，全長會多 0.6
     *   `countModelTriangles`         三角形數與 mesh 數（+96 / +12）
     *
     * 複製變換是兩邊各一份，代價是「日後轉盤若長出新的自由度要記得補」——
     * 所以這裡複製的是整組 `rotation`／`position`／`scale`，不是只有 `rotation.y`。
     *
     * 【截圖為什麼看起來是對的】`__hangarCam` 會把 `rotation.y` 歸零並停掉
     * 自動旋轉，所以逐座近照那一輪剛好落在「兩者都是 0」的情況上 —— 這個
     * 缺陷只有在**互動時**看得到。
     */
    syncToModel(barrels)
    syncToModel(arcs)
  }
  controls.update()
  renderer.render(scene, orthoView ? orthoCam : camera)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
