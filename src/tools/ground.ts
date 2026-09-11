import {
  AmbientLight, AxesHelper, Box3, BoxGeometry, BufferGeometry, CanvasTexture, Color,
  DirectionalLight, EdgesGeometry, GridHelper, Group, HemisphereLight, LineBasicMaterial,
  LineSegments, Mesh, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera,
  PlaneGeometry, Scene, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { DEG } from '../core/math'
import {
  GROUND_UNITS, TRAIN_CONSIST, groundGeometry, preloadGroundModels,
  type GroundUnit, type GroundUnitId,
} from '../render/geometry/ground'
import { HUE, assemble, box } from '../render/geometry/ground/parts'

/**
 * 地面展示區 —— 純檢視用的開發工具，不屬於遊戲。
 *
 * 【為什麼與機庫分開】機庫的相機、正交框圖、參考模型疊圖全部繞著「一台
 * 飛機擺在原點」打轉，而地面單位要**一起看**：戰車與卡車擺在一起才知道
 * 大小關係對不對，火車要串成一列才知道車鉤高度有沒有對齊。把這些塞進機庫
 * 會讓那支工具長出第二套版面邏輯。
 *
 * 【絕對大小看面板，不看畫面】地面單位沒有翼展這種一望即知的尺寸，2.4 m
 * 高的戰車與 4.4 m 高的機車在空鏡頭裡看起來一樣大。判斷尺寸對不對要看
 * 面板那三行「模型 / 真車」，網格是 1 m 一格。
 *
 * 進入方式：`npm run dev` 之後開 /tools/ground.html。
 */

const canvas = document.getElementById('scene') as HTMLCanvasElement
const renderer = new WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

const scene = new Scene()
scene.background = new Color(0x0d1620)

const camera = new PerspectiveCamera(45, 1, 0.2, 2000)
const orthoCam = new OrthographicCamera(-1, 1, 1, -1, -500, 500)
let orthoView: 'side' | 'top' | 'front' | null = null

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08

// 燈光與遊戲場景（src/render/scene.ts）同一組 —— 展示區看到的明暗就是
// 遊戲裡的明暗，而不是一個打光更討喜的攝影棚。
const sun = new DirectionalLight(0xfff2e0, 2.2)
sun.position.set(14, 18, 10)
scene.add(sun)
const hemi = new HemisphereLight(0xbfd8ee, 0x2a3a48, 0.9)
scene.add(hemi)
const ambient = new AmbientLight(0xffffff, 0.15)
scene.add(ambient)

/**
 * 亮／暗兩檔打光，與機庫同一個約定：**預設是暗的那一檔，而且那一檔才是
 * 「對」的**。地面單位的問題比飛機更嚴重 —— 車底、履帶、砲座全在陰影裡，
 * 暗檔下幾乎讀不出來，所以要看細節時按亮。
 */
let studio = false
function syncLight(): void {
  scene.background = new Color(studio ? 0x8ea6ba : 0x0d1620)
  hemi.groundColor.set(studio ? 0xc4ced6 : 0x2a3a48)
  hemi.intensity = studio ? 1.1 : 0.9
  ambient.intensity = studio ? 0.55 : 0.15
}
syncLight()

// 地面：一片啞光的土綠，不是網格 —— 車輛坐在實面上才看得出有沒有陷地。
const ground = new Mesh(
  new PlaneGeometry(400, 400),
  new MeshStandardMaterial({ color: 0x3c4630, roughness: 1 }),
)
ground.rotation.x = -Math.PI / 2
ground.position.y = -0.01
scene.add(ground)

const grid = new GridHelper(120, 120, 0x4f7ea8, 0x2b3f52)
grid.material.transparent = true
grid.material.opacity = 0.28
scene.add(grid)

const axes = new AxesHelper(4)
axes.visible = false
scene.add(axes)

const material = new MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.06,
})

/** 名牌。深度測試關掉 —— 被車體擋住的名牌等於沒有名牌。 */
function nameplate(text: string): Sprite {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 96
  const g = c.getContext('2d')
  if (g === null) throw new Error('拿不到 2D context')
  g.font = 'bold 56px ui-monospace, Consolas, monospace'
  g.fillStyle = '#dcebf8'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 256, 52)
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  const s = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  s.scale.set(7, 1.31, 1)
  return s
}

/** 一段鐵軌：兩條鋼軌加枕木。`len` 沿 Z。 */
function buildTrack(len: number): BufferGeometry {
  const p: BufferGeometry[] = []
  for (const s of [-1, 1]) {
    p.push(box(0.09, 0.16, len, HUE.steel, { x: s * 0.72, y: 0.08 }))
  }
  const step = 0.65
  for (let z = -len / 2 + step / 2; z < len / 2; z += step) {
    p.push(box(2.40, 0.12, 0.24, HUE.wood, { y: 0.06, z }))
  }
  return assemble(p)
}

interface Entry {
  unit: GroundUnit
  group: Group
  /** 世界座標的包圍盒，不含名牌。相機取景用。 */
  bounds: Box3
  /**
   * **本體座標**的包圍盒，只含這個單位自己。
   *
   * 【為什麼不能現場用世界座標量】列車那一排整個轉了 90°，世界座標量到的
   * 長與寬會對調 —— 尺寸對照表因此會把「長 13 m 的機車」報成寬 13 m，而那
   * 讀起來像模型建錯了。
   */
  local: Box3
  /** 命中盒的線框，掛在 group 底下。 */
  hits: Group
  /** 這一份幾何的三角形數。 */
  triangles: number
}

const entries: Entry[] = []
const byId = new Map<GroundUnitId, GroundUnit>(GROUND_UNITS.map((u) => [u.id, u]))

// GLB 那幾台要先載進來，之後 groundGeometry 才是同步的（與機庫載機種同一個做法）
await preloadGroundModels()

/** 命中盒的線框。預設收著，面板「命中盒」打開。 */
const hitMaterial = new LineBasicMaterial({ color: 0xff5a3c })
function hitFrames(unit: GroundUnit): Group {
  const g = new Group()
  for (const b of unit.hull) {
    const edges = new EdgesGeometry(new BoxGeometry(b.half.x * 2, b.half.y * 2, b.half.z * 2))
    const lines = new LineSegments(edges, hitMaterial)
    lines.position.copy(b.center)
    g.add(lines)
  }
  g.visible = false
  return g
}

/** 把一個單位擺進場景，附上名牌。 */
function place(unit: GroundUnit, x: number, z: number, ry: number): Entry {
  const geo = groundGeometry(unit)
  const group = new Group()
  group.position.set(x, 0, z)
  group.rotation.y = ry

  const mesh = new Mesh(geo, material)
  group.add(mesh)
  const hits = hitFrames(unit)
  group.add(hits)

  const local = new Box3().setFromObject(mesh)
  const plate = nameplate(unit.name)
  plate.position.set(0, local.max.y + 1.3, 0)
  group.add(plate)

  scene.add(group)
  group.updateMatrixWorld(true)

  // 取景的包圍盒**不含名牌**。名牌是 7 m 寬的 sprite，一台 2.4 m 的防空砲
  // 把它算進去之後，相機會為了裝下一塊看板而退到三倍遠。
  const bounds = new Box3().setFromObject(mesh)

  const tri = geo.getAttribute('position').count / 3
  return { unit, group, bounds, local, hits, triangles: tri }
}

/**
 * 版面：車輛沿 X 排成一列，火車在旁邊**串成真的一列車**。
 *
 * 【火車一定要串起來】車鉤高度、緩衝器位置、輪徑是否一致，這三件事分開
 * 擺一輩子都看不出錯。接起來之後，任何一節對不上都是肉眼可見的錯位。
 */
const VEHICLE_ROW: GroundUnitId[] = ['tank', 'truck', 'flakHeavy', 'flakLight']
const ROW_GAP = 4.0
/**
 * 列車那一排的 Z。**列車與車輛平行排開，不是交叉的兩條線** —— 排成 L 形時
 * 全景的包圍盒有一大半是空地，畫面就得拉遠一倍才裝得下。
 */
const TRAIN_Z = 22

{
  let x = 0
  for (const id of VEHICLE_ROW) {
    const unit = byId.get(id)
    if (unit === undefined) throw new Error(`登記表裡沒有 ${id}`)
    const half = unit.realWidth / 2
    x += half
    entries.push(place(unit, x, 0, 0))
    x += half + ROW_GAP
  }
  // 整列往 −X 移，讓它以原點為中心。包圍盒跟著平移就好 —— 重新
  // setFromObject 會把名牌算進來，取景又會被那塊看板撐開。
  const shift = x - ROW_GAP
  for (const e of entries) {
    e.group.position.x -= shift / 2
    e.bounds.translate(new Vector3(-shift / 2, 0, 0))
  }
}

{
  // 車鉤面相接：每一節佔用自己的真車全長，節與節之間留 0.25 m。
  let total = 0
  for (const id of TRAIN_CONSIST) {
    const unit = byId.get(id)
    if (unit === undefined) throw new Error(`車序裡沒有 ${id}`)
    total += unit.realLength + 0.25
  }
  // 各節轉 90° 沿 X 排開，車頭朝 −X。軌道跟著轉。
  const track = new Mesh(buildTrack(total + 14), material)
  track.rotation.y = Math.PI / 2
  track.position.set(0, 0, TRAIN_Z)
  scene.add(track)

  // ry = +90° 讓各節的車頭（本體 −Z）朝向 −X，所以機車排在最左邊。
  let x = -total / 2
  for (const id of TRAIN_CONSIST) {
    const unit = byId.get(id)
    if (unit === undefined) throw new Error(`車序裡沒有 ${id}`)
    x += unit.realLength / 2
    entries.push(place(unit, x, TRAIN_Z, Math.PI / 2))
    x += unit.realLength / 2 + 0.25
  }
}

const sceneBounds = new Box3()
for (const e of entries) sceneBounds.union(e.bounds)

// ── 相機 ────────────────────────────────────────────────────────────────

const target = new Vector3()
const size = new Vector3()
/** null = 全景。 */
let focused: Entry | null = null

const VIEW_DIR = /* @__PURE__ */ new Vector3(0.62, 0.44, 1).normalize()
const camRight = /* @__PURE__ */ new Vector3()
const camUp = /* @__PURE__ */ new Vector3()
const camFwd = /* @__PURE__ */ new Vector3()
const corner = /* @__PURE__ */ new Vector3()

/**
 * 把包圍盒剛好填滿畫面。
 *
 * 【為什麼要逐角落算，不用外接球】外接球取的是對角線，而全景是一個又扁又
 * 長的長方形 —— 用對角線當半徑會把畫面推遠到一倍以上，整個展示區縮成中間
 * 一小塊。逐角落投影到相機基底上求「這個角落要多遠才進得了視錐」，取最大
 * 值，兩個方向就都剛好裝滿。
 */
function frame(bounds: Box3): void {
  bounds.getCenter(target)
  bounds.getSize(size)
  const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1)
  const tanV = Math.tan(camera.fov * DEG / 2)
  const tanH = tanV * aspect

  camFwd.copy(VIEW_DIR).negate()
  camRight.set(camFwd.z, 0, -camFwd.x).normalize()
  camUp.crossVectors(camRight, camFwd).normalize()

  let dist = 1
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? bounds.max.x : bounds.min.x,
      i & 2 ? bounds.max.y : bounds.min.y,
      i & 4 ? bounds.max.z : bounds.min.z,
    ).sub(target)
    const depth = corner.dot(camFwd)
    dist = Math.max(
      dist,
      Math.abs(corner.dot(camRight)) / tanH - depth,
      Math.abs(corner.dot(camUp)) / tanV - depth,
    )
  }
  dist *= 1.06

  controls.target.copy(target)
  camera.position.copy(target).addScaledVector(VIEW_DIR, dist)
  camera.near = Math.max(dist * 0.01, 0.05)
  camera.far = dist * 8 + 400
  camera.updateProjectionMatrix()
  controls.update()
}

function focus(e: Entry | null): void {
  focused = e
  frame(e === null ? sceneBounds : e.bounds)
  syncStats()
  syncButtons()
}

/**
 * 正交三視圖 —— 判剪影用。**只作用在目前聚焦的單位上**，全景時無意義。
 *
 * 【為什麼要正交】透視會讓靠近鏡頭的一端變大，車長與砲管長度在畫面上就不是
 * 真的。要拿剪影跟照片比對，投影方式必須一致。
 */
function applyOrtho(view: 'side' | 'top' | 'front'): void {
  const b = focused === null ? sceneBounds : focused.bounds
  b.getCenter(target)
  b.getSize(size)
  const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1)
  const half = (view === 'top' ? Math.max(size.x, size.z) : Math.max(size.x, size.y, size.z)) * 0.62
  orthoCam.left = -half * aspect
  orthoCam.right = half * aspect
  orthoCam.top = half
  orthoCam.bottom = -half
  const d = Math.max(size.x, size.y, size.z) * 3 + 20
  if (view === 'side') orthoCam.position.set(target.x + d, target.y, target.z)
  else if (view === 'top') orthoCam.position.set(target.x, target.y + d, target.z)
  else orthoCam.position.set(target.x, target.y, target.z - d)
  orthoCam.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0)
  orthoCam.lookAt(target)
  orthoCam.updateProjectionMatrix()
}

// ── 面板 ────────────────────────────────────────────────────────────────

const listEl = document.getElementById('list') as HTMLDivElement
const statsEl = document.getElementById('stats') as HTMLDivElement

const buttons = new Map<GroundUnit | null, HTMLButtonElement>()

function addButton(label: string, e: Entry | null): void {
  const b = document.createElement('button')
  b.textContent = label
  b.addEventListener('click', () => {
    orthoView = null
    focus(e)
  })
  listEl.appendChild(b)
  buttons.set(e === null ? null : e.unit, b)
}

addButton('全景', null)
for (const e of entries) {
  // 同一個單位在列車裡出現兩次（兩節棚車），只放第一顆按鈕。
  if (buttons.has(e.unit)) continue
  addButton(e.unit.name, e)
}

function syncButtons(): void {
  for (const [unit, b] of buttons) {
    b.classList.toggle('on', unit === (focused === null ? null : focused.unit))
  }
}

function fmt(v: number): string {
  return v.toFixed(2).padStart(6)
}

/**
 * 尺寸對照。**「模型 vs 真車」那三行是這個工具真正的產出** —— 差超過幾個
 * 百分點就表示某個零件的座標寫錯了，而那種錯不會報錯，只會讓單位在地圖上
 * 靜靜地比它該有的尺寸小一截。
 */
function syncStats(): void {
  if (focused === null) {
    const tri = entries.reduce((s, e) => s + e.triangles, 0)
    statsEl.textContent = `${entries.length} 個單位　三角形合計 ${tri}\n`
      + `登記表 ${GROUND_UNITS.length} 種　列車 ${TRAIN_CONSIST.length} 節`
    return
  }
  const u = focused.unit
  const b = focused.local
  b.getSize(size)
  const rows: [string, number, number][] = [
    ['長 Z', size.z, u.realLength],
    ['寬 X', size.x, u.realWidth],
    ['高 Y', size.y, u.realHeight],
  ]
  const lines = rows.map(([k, got, want]) => {
    const err = ((got - want) / want) * 100
    return `${k} ${fmt(got)} / ${fmt(want)}  ${err >= 0 ? '+' : ''}${err.toFixed(1)}%`
  })
  statsEl.textContent = `${u.note}\n\n`
    + `        模型 /   真車\n${lines.join('\n')}\n\n`
    + `底面 y ${fmt(b.min.y)}\n三角形 ${focused.triangles}`
}

function toggle(id: string, fn: (on: boolean) => void): void {
  const b = document.getElementById(id) as HTMLButtonElement
  let on = false
  b.addEventListener('click', () => {
    on = !on
    b.classList.toggle('on', on)
    fn(on)
  })
}

toggle('wire', (on) => { material.wireframe = on })
toggle('lit', (on) => { studio = on; syncLight() })
toggle('axes', (on) => { axes.visible = on })
toggle('grid', (on) => { grid.visible = !on })
toggle('hit', (on) => { for (const e of entries) e.hits.visible = on })

for (const [id, view] of [['vSide', 'side'], ['vTop', 'top'], ['vFront', 'front']] as const) {
  const b = document.getElementById(id) as HTMLButtonElement
  b.addEventListener('click', () => {
    orthoView = orthoView === view ? null : view
    for (const other of ['vSide', 'vTop', 'vFront']) {
      document.getElementById(other)?.classList.toggle('on', other === id && orthoView !== null)
    }
  })
}

// ── 主迴圈 ──────────────────────────────────────────────────────────────

let spin = false
window.addEventListener('keydown', (ev) => {
  if (ev.code === 'Space') {
    ev.preventDefault()
    spin = !spin
  }
})

function resize(): void {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width === w && canvas.height === h) return
  renderer.setSize(w, h, false)
  camera.aspect = w / Math.max(h, 1)
  camera.updateProjectionMatrix()
}

// resize 要先跑：frame() 靠 canvas 的實際長寬算視角，畫布還是 0×0 時算出來的
// 距離會讓全景整個飛出畫面。
resize()
focus(null)

renderer.setAnimationLoop(() => {
  resize()
  if (spin && orthoView === null) {
    const t = target
    const dx = camera.position.x - t.x
    const dz = camera.position.z - t.z
    const a = 0.0035
    camera.position.x = t.x + dx * Math.cos(a) - dz * Math.sin(a)
    camera.position.z = t.z + dx * Math.sin(a) + dz * Math.cos(a)
  }
  controls.update()
  if (orthoView !== null) {
    applyOrtho(orthoView)
    renderer.render(scene, orthoCam)
  } else {
    renderer.render(scene, camera)
  }
})
