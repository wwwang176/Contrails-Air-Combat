import {
  AmbientLight, AxesHelper, Box3, type BufferGeometry, Color, DirectionalLight,
  GridHelper, HemisphereLight,
  Group, type Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PMREMGenerator, Scene, Vector3, WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { DEG } from '../core/math'
import { collectTriangles, extentSlices, radialSlices, type Axis } from './sliceRef'
import { buildAircraft, type AircraftModel } from '../render/geometry/buildAircraft'
import { barrelGeometry } from '../render/turretBarrels'
import { BARREL_SPACING } from '../world/turrets'
import { wobbleBasis } from '../weapons/turret'
import { P51D } from '../specs/p51d'
import { BF109G6 } from '../specs/bf109g6'
import { HE111 } from '../specs/he111'
import { B17G } from '../specs/b17g'
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

const SPECS: AircraftSpec[] = [P51D, BF109G6, HE111, B17G]

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
/** 正交框圖的中心（＝畫面中心對應的世界座標），量測腳本換算像素時要用。 */
const orthoCenter = new Vector3()

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
 * 但**檢查造型**時暗的那一檔會擋路：場景只有 0.15 環境光加一盞半球光，而
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

/**
 * 參考模型疊圖 —— 載入外部高面數模型，縮放對齊後疊在程序化模型上，用同一顆
 * 正交相機比對外形。
 *
 * 對齊參數寫在這裡而不是網址：三個值都是**量出來的**，不是每次調的旋鈕
 * ——一旦某台的 pitch 定案，下次開機庫沒有理由再打一次，打錯了還很難發現
 * （實測 P-51D 用 −9.5° 時剪影上看起來已經差不多平了，正確值卻是 −14.0°）。
 *
 * 【yaw：為什麼不自動判斷】試過用「螺旋槳端的 X 延伸較大」自動判向，但
 * 109 那個模型的機尾也有寬達 ±1.31 的部件，判準直接失效；第一版疊圖整台
 * 頭尾顛倒，還一度被讀成「機身形狀差很多」。
 *
 * 【yaw 為什麼從布林換成角度】2026-08-16 加 He 111 H-6 時發現原本的
 * `flip: boolean` 表達不了它 —— 那台模型的**長度在 X、翼展在 Z**，與另外
 * 兩台（長度在 Z）差 90°，不是 180°。
 *
 * 而且**順序有關係**：`pitch` 是繞世界 X 軸轉的，對一台長度還躺在 X 上的
 * 模型來說那是**滾轉不是俯仰**。所以一定要先繞 Y 把機身擺到 Z 上，pitch
 * 才有意義。`placeRef` 的內外兩層 Group 正是為此。
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
  /**
   * 繞**模型自己的** Y 軸轉正的角度，度。轉完之後機首要朝 −Z。
   *
   * 180 = 機首本來朝 +Z（P-51D、Bf 109 都是）
   *  90 = 機首本來朝 −X，長度躺在 X 上（He 111）
   */
  yaw: number
  /** 繞世界 X 軸轉正的角度，度。**在 yaw 之後套** */
  pitch: number
}
const REFS: Record<string, RefSpec> = {
  p51d: { url: '/ref/p51d.glb', yaw: 180, pitch: -14.0 },
  bf109g6: { url: '/ref/bf109e4.glb', yaw: 180, pitch: 0 },
  /**
   * He 111 H-6。**2026-08-16 量的，量法與數字見下。**
   *
   * ```
   *   yaw −90    長度在 X、機首朝 −X、翼展在 Z（另外兩台是長度在 Z）
   *              Z 的包圍盒對稱於 0（−1.881 / +1.883）→ 那是翼展軸
   *              【正負是實證的】我先憑算的寫成 +90，套下去機首朝 +Z。
   *              轉正後的驗收：機首在 −Z、翼展落在 X 且幅度 22.600 m、
   *              水平尾翼落在 Z 13.5~15.5（尾端）——三條都要對才算擺對
   *
   *   pitch 2.4  這台機首朝下 2.4°，所以要往上轉回來
   *              量法：沿弦向（X）切 33 刀，uWindow 限住 Z 只留單邊機翼，
   *              每站取 (vMin+vMax)/2 當中厚線，對 X 做最小平方
   *              右翼內段 2.85° / 右翼外段 1.54° / 左翼內段 2.82°
   * ```
   *
   * 【為什麼用機翼而不是坑 2 的掃描法】那一套比的是「參考值 − 本模型值」，
   * 需要自家模型存在。這裡用的是坑 2 自己的**驗收條件**（轉正之後機翼中線
   * 要整段吻合）當引導 —— 主翼安裝角只有 1~2°，所以「讓機翼弦線水平」是
   * 俯仰角的一階估計。自家模型出來之後要照坑 2 重掃一次定案。
   *
   * 【我第一次估錯了】先用機身背線估成 7~9°。後機身背線本來就往上收，那是
   * 真的外形不是姿態 —— 與坑 2「不要用剪影目測」是同一個教訓的另一個形式。
   *
   * 【這台量尺可信】依翼展縮放（係數 6.003285）之後全長 16.209 m 對真機
   * 16.40 m，只差 −1.2%。對照坑 21：Bf 109 那台主翼偏大 2.7%、尾翼偏小
   * 11%，是「位置可信、尺寸不可信」；這台兩項都可信。
   */
  he111: { url: '/ref/he_111-h6.glb', yaw: -90, pitch: 2.4 },
  /**
   * B-17G-60-VE Flying Fortress。**2026-08-18 量的，量法與數字見下。**
   *
   * ```
   *   yaw 180    機首本來朝 +Z、翼展本來就在 X（另外兩台也是 180，He 111
   *              才是 −90）。判翼展軸的準則是**包圍盒對稱於 0 的那一根**：
   *              X 的不對稱只有 0.0%，Y 51.9%、Z 36.5%
   *              轉正後的驗收三條都對：機首在 −Z、翼展落在 X 且幅度
   *              31.620 m、水平尾翼落在 Z 11.5~12.5（尾端）
   *
   *   scale      31.62 / 31.259 = 1.011554。**這台原始單位幾乎就是公尺**
   *
   *   pitch −1.03  機首朝上 1.03°，往下轉回來
   * ```
   *
   * 【pitch 用了三把尺，只有一把可信】沿 Z（弦向）切、每站取 (vMin+vMax)/2
   * 當中厚線、對 Z 做最小平方。左右完全鏡像，所以量到的不是滾轉：
   *
   * ```
   *                        角度     殘差RMS
   *   主翼 翼根段         −4.16°     0.026
   *   主翼 兩艙間         −3.47°     0.041
   *   主翼 外艙外         −2.92°     0.024
   *   主翼 外段           −3.05°     0.029
   *   平尾 內             −1.18°     0.042
   *   平尾 外             −1.04°     0.006   ← 採這一把
   *   機身中線 前段      −11.73°     0.154   ← 壞掉的尺
   *   機身中線 中段       +2.34°     0.126
   * ```
   *
   * 主翼那一組沿翼展有 1.1° 的梯度——那是**扭轉（washout）不是姿態**，B-17
   * 用對稱翼型（根 NACA 0018、尖 0010），所以中厚線就是弦線，梯度只能是
   * 扭轉。取它當姿態會把扭轉算進去。
   *
   * 機身中線那一組直接壞掉（殘差是平尾的 20 倍）：機首下傾、下巴砲塔、球形
   * 腹部砲塔全被算進「中線」。**這正是坑 2 的 He 111 版教訓的重演**——那次
   * 用機身背線估成 7~9°。機身不是尺。
   *
   * 平尾的安裝角在設計上接近 0、沒有扭轉、殘差只有 6 mm，所以採它。
   * **自家模型出來之後要照坑 2 重掃一次定案**（那一套比的是「參考值 −
   * 本模型值」，需要自家模型存在）。
   *
   * 【這台量尺可信，尺寸與位置都是】依翼展縮放之後，**沒有參與縮放**的
   * 水平尾翼展量到 13.05 對真機 13.11，只差 −0.5%。對照坑 21：Bf 109 那台
   * 主翼偏大 2.7%、尾翼偏小 11%，是「位置可信、尺寸不可信」；這台兩項都可信。
   *
   * 全長量到 23.52 對真機 22.66（+3.8%），但那一端是**尾砲塔的槍管**
   * （Z 15.0~16.0 那幾刀的 X 幅度只剩 0.29）——不是比例錯。
   */
  b17g: { url: '/ref/1943_boeing_b-17g-60-ve_flying_fortress.glb', yaw: 180, pitch: -1.03 },
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
/**
 * 暫時覆寫 REFS 的俯仰角，只給量測腳本用（見 __hangarRefPitch）。
 *
 * 【為什麼要留這個後門】求 pitch 的方法是**掃描**：跑一串候選值，找殘餘
 * 俯仰角過零的那個。定值寫在 REFS 裡是對的，但掃描時需要在同一個瀏覽器
 * 工作階段裡連續換值——不留這個口就得改原始碼再等 HMR，跑一輪五個值會
 * 慢到讓人放棄掃描、退回目測，而目測正是當初把 −14° 估成 −9.5° 的原因。
 */
let pitchOverride: number | null = null
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

/**
 * 砲塔的槍管，畫在**靜止位置**（`turret.axis`）上。
 *
 * 【為什麼機庫要畫它】槍管在遊戲裡是由 combatant 狀態驅動的
 * `InstancedMesh`，機庫沒有 combatant。但砲塔位置是這一輪最需要用眼睛驗
 * 的東西（十三座裡有六座是「量到的機身剖面 + 史實站位」推算出來的），而
 * 機庫是這個專案唯一截得到 3D 畫面的地方 —— 遊戲的畫布沒開
 * `preserveDrawingBuffer`，截圖只有 HUD。
 *
 * **幾何與側偏都與 `render/turretBarrels.ts` 共用同一份推導**，看到的就是
 * 遊戲裡會畫的那根管子。差別只有「這裡是靜止指向，遊戲裡會跟著砲塔轉」。
 */
/**
 * 釋放 `buildBarrels` 配置的幾何與材質。
 *
 * 【為什麼一根一根找而不是記在外面】那一組 mesh 共用同一份幾何與材質，所以
 * 取第一根的就夠；用 `Set` 收是為了「日後若改成一根一份」也不會漏。
 */
function disposeBarrels(g: Group): void {
  const geos = new Set<BufferGeometry>()
  const mats = new Set<Material>()
  for (const child of g.children) {
    if (!(child instanceof Mesh)) continue
    geos.add(child.geometry as BufferGeometry)
    if (Array.isArray(child.material)) for (const m of child.material) mats.add(m)
    else mats.add(child.material as Material)
  }
  for (const x of geos) x.dispose()
  for (const x of mats) x.dispose()
}

function buildBarrels(spec: AircraftSpec): Group {
  const g = new Group()
  if (spec.turrets.length === 0) return g
  const geo = barrelGeometry()
  const mat = new MeshBasicMaterial({ color: 0x101010 })
  const e1 = new Vector3()
  const e2 = new Vector3()
  for (const t of spec.turrets) {
    wobbleBasis(t.axis, e1, e2)
    for (let b = 0; b < t.guns; b++) {
      const side = t.guns > 1 ? (b === 0 ? -1 : 1) : 0
      const m = new Mesh(geo, mat)
      m.position.copy(t.position).addScaledVector(e1, side * BARREL_SPACING)
      // +Z 對準 −axis：管子由槍口往機體方向長
      m.quaternion.setFromUnitVectors(UNIT_Z, e2.copy(t.axis).negate())
      g.add(m)
    }
  }
  return g
}

const UNIT_Z = new Vector3(0, 0, 1)
let barrels: Group | null = null

function rebuild(): void {
  if (model) {
    scene.remove(model.group)
    model.dispose()
  }
  if (barrels) {
    scene.remove(barrels)
    // 【要 dispose 幾何與材質】`scene.remove` 只是把它從場景圖拿掉，three 的
    // `WebGLGeometries` / `WebGLMaterials` 是在 geometry 與 material 的
    // `dispose` 事件裡才釋放 GPU buffer 與著色器程式。少了這一步，每切換
    // 一次機種就漏一組 —— Codex 2026-08-21 抓到。
    disposeBarrels(barrels)
    barrels = null
  }
  const spec = SPECS[specIndex]!
  model = buildAircraft(spec)
  scene.add(model.group)
  barrels = buildBarrels(spec)
  scene.add(barrels)
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
  // 【為什麼查表而不是三元式】原本是 `id === 'p51d' ? 'P-51D' : 'Bf 109'`
  // —— 那在只有兩台時剛好對，第三台一加就會被標成「Bf 109」而且不會有
  // 任何東西提醒你。查表少一筆是一個 undefined，看得見
  b.textContent = ({ p51d: 'P-51D', bf109g6: 'Bf 109', he111: 'He 111', b17g: 'B-17G' } as Record<string, string>)[s.id] ?? s.id
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
  orthoCenter.copy(c)

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
const litBtn = $<HTMLButtonElement>('lit')
litBtn.onclick = () => {
  studio = !studio
  syncLight()
  litBtn.classList.toggle('on', studio)
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { autoRotate = !autoRotate; e.preventDefault() }
})

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
/**
 * 開發用：擺相機。**看向點可以指定**（`tx/ty/tz`，預設原點）。
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
  // 切片的三角形是**世界座標**快取的，這裡一動它就過期了。
  // 【實測後果】掃描俯仰角時三個不同的 pitch 量到一模一樣的數字，
  // 而且完全看不出是錯的——會直接把錯的角度當成答案。
  refTris = null
  const m = model.metrics
  refModel.scale.setScalar(1)
  refModel.position.set(0, 0, 0)
  // 轉向在內層（模型自己的軸向），俯仰在外層（世界 X 軸）——兩者若擠在
  // 同一個 Euler 上，180° 的翻轉會把俯仰的正負也一起翻掉。
  //
  // 【He 111 讓這件事更嚴重】它的 yaw 是 −90°，而 pitch 繞的是世界 X 軸 ——
  // 順序反過來的話 pitch 套在一台長度還躺在 X 上的模型上，那是滾轉不是俯仰。
  const cfg = REFS[SPECS[specIndex]!.id]!
  refModel.children[0]!.rotation.y = cfg.yaw * DEG
  refModel.rotation.x = (pitchOverride ?? cfg.pitch) * DEG
  refModel.updateMatrixWorld(true)
  /**
   * 縮放基準用**翼展**，不是全長。
   *
   * 【為什麼】全長被螺旋槳與姿態污染：實測兩個參考模型依全長縮放後，翼展
   * 都短了——Bf 109 是 9.481 對 9.87（−4.0%）、P-51D 是 11.030 對 11.286
   * （−2.3%）。整台縮小幾個百分點，之後量到的每一個尺寸都跟著錯。
   * 翼尖是乾淨的基準：±X 的極端點必然是翼尖，沒有起落架、螺旋槳、天線。
   *
   * 【`raw` 必須在**轉向之後**量 —— 2026-08-17 修】原本這一行在
   * `rotation.y` 之前，量到的是模型**自己座標系**的 X 幅度。
   *
   * P-51D 與 Bf 109 的 yaw 都是 180°，繞 Y 轉半圈不改 X 的幅度，所以那個
   * 順序錯誤在它們身上是隱形的。**He 111 的 yaw 是 −90°** —— 轉之前的 X
   * 是它的**長度軸**（2.890），轉之後才是翼展（3.765）。
   *
   * 後果是縮放算成 22.60/2.890 = 7.820 而不是 6.003：**整台大 30%**。
   * 而且它是**時好時壞**的：`placeRef` 第二次被呼叫時 `children[0]` 已經
   * 轉過了，量到的就是對的 —— 所以症狀是「勾一次太大、再勾一次就正常」，
   * 而中間沒有任何東西會提醒你第一次是錯的。
   */
  const raw = new Box3().setFromObject(refModel)
  refModel.scale.setScalar(SPECS[specIndex]!.wing.span / raw.getSize(new Vector3()).x)
  refModel.updateMatrixWorld(true)
  const scaled = new Box3().setFromObject(refModel)
  refModel.position.z = m.noseZ - scaled.min.z

  // 垂直對齊用**機首尖端**（＝推力線），與 Z 向同一個基準點。
  // 原本用翼尖，但翼尖的平均高度取決於上反角、翼尖形狀與取樣視窗寬度，
  // 三件事在兩個模型上都不一樣；機首尖端是一個點，兩邊都毫無歧義。
  // 詳見 HullMetrics.noseY。
  refModel.position.y = m.noseY - noseY(refModel)
}

/** 模型機首尖端的 Y（離最前端 3 cm 以內的頂點，上下取中）。 */
function noseY(obj: Object3D): number {
  const v = new Vector3()
  let minZ = Infinity
  const pts: [number, number][] = []
  obj.traverse((o) => {
    const pos = (o as Mesh).geometry?.getAttribute?.('position')
    if (!pos) return
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld)
      pts.push([v.z, v.y])
      if (v.z < minZ) minZ = v.z
    }
  })
  let lo = Infinity, hi = -Infinity
  for (const [z, y] of pts) {
    if (z > minZ + 0.03) continue
    lo = Math.min(lo, y); hi = Math.max(hi, y)
  }
  return (lo + hi) / 2
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
    /**
     * 【原材質的名字只有這一刻讀得到】下一行就把它 dispose 掉換成平塗了。
     *
     * 【為什麼要留】skill 第 5b 步要按 mesh 名稱分別打射線，才能量出「那裡
     * 到底是不是玻璃」。但那招吃的是**名字**——B-17G 那台把每個 mesh 都叫
     * `Object_12`、`Object_14`，名字一點資訊都沒有。而**材質**一定有：玻璃
     * 在任何 GLB 裡都是另一份材質（透明、或名字就叫 Glass）。
     *
     * 只在第一次記（`=== undefined`）：反覆勾選「實體」會重跑這個函式，
     * 那時讀到的已經是平塗材質自己的名字了。
     */
    if (mesh.userData['refMat'] === undefined) {
      const m0 = [mesh.material].flat()[0] as (Material & {
        opacity?: number; transmission?: number
      }) | undefined
      mesh.userData['refMat'] = m0
        ? `${m0.name || '(無名)'}`
          + `${m0.transparent ? ' 透明' : ''}`
          + `${(m0.opacity ?? 1) < 1 ? ` α${m0.opacity!.toFixed(2)}` : ''}`
          + `${(m0.transmission ?? 0) > 0 ? ` 穿透${m0.transmission!.toFixed(2)}` : ''}`
        : '(無材質)'
    }
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
/**
 * 開發用：把量測腳本需要的東西一次交出去。
 *
 * 【為什麼要有 ortho 這一段】抽剪影輪廓時要把像素換回世界座標。那個換算
 * （框圖公式、螢幕右邊是 −Z、每像素幾公尺）先前是在腳本裡**手推**的，推過
 * 至少四次，而且錯過一次——第一版的百分比表整個左右顛倒，機首機尾對調。
 * 相機自己知道答案，直接問它就不會錯：
 *
 *   world = center + right·(px − W/2)·mPerPx + up·(H/2 − py)·mPerPx
 */
;(window as unknown as Record<string, unknown>)['__hangarInfo'] = () => {
  if (!model) return null
  const e = orthoCam.matrixWorld.elements
  const half = (orthoCam.top - orthoCam.bottom) / 2
  return {
    specId: SPECS[specIndex]!.id,
    metrics: model.metrics,
    span: SPECS[specIndex]!.wing.span,
    ...countTriangles(model),
    ortho: orthoView === null ? null : {
      view: orthoView,
      mPerPx: (2 * half) / renderer.domElement.height * renderer.getPixelRatio(),
      center: orthoCenter.toArray(),
      right: [e[0]!, e[1]!, e[2]!],
      up: [e[4]!, e[5]!, e[6]!],
    },
  }
}

/** 開發用：切換機種，免得腳本要去點 DOM 按鈕。 */
;(window as unknown as Record<string, unknown>)['__hangarSpec'] = (id: string) => {
  const i = SPECS.findIndex((sp) => sp.id === id)
  if (i < 0) return false
  specIndex = i
  rebuild()
  return true
}

/** 開發用：暫時覆寫參考模型的俯仰角；傳 null 回到 REFS 的定值。見 pitchOverride。 */
;(window as unknown as Record<string, unknown>)['__hangarRefPitch'] = (deg: number | null) => {
  pitchOverride = deg
  placeRef()
  frameOrtho()
}

;(window as unknown as Record<string, unknown>)['__hangarSlice'] =
    (
      kind: 'radial' | 'extent', axis: Axis,
      o: Record<string, number | [number, number]>,
      /**
       * 切誰。預設切參考模型。
       *
       * 【為什麼自家模型也要能切】驗收時要的是「逐站數值比對表」，而不是
       * 盯著疊圖猜像素——實測過一次背鰭疑似浮起 0.23 m，用像素量出來的，
       * 結果那 0.23 是水平尾翼擋在前面造成的錯覺，背鰭本身差 0.02。
       * 兩邊用同一支切片器，量到的才是同一個定義下的同一件事。
       */
      target: 'ref' | 'mine' = 'ref',
      /** 只收名字符合的 mesh。玻璃機首要用（見 collectTriangles 的 `only`） */
      only?: string,
    ) => {
      const root = target === 'mine' ? model?.group : refModel
      if (!root) return null
      // 自家模型平常在自動旋轉，切片用的是**世界座標**——不歸零的話量到的是
      // 一個斜著的機身，而且數字看起來完全正常（實測第一次跑就中招：機背
      // 整段量不到、尾段量成 0.51）。歸零順便停掉旋轉，免得下一刀又轉走了。
      if (target === 'mine' && model) {
        autoRotate = false
        model.group.rotation.y = 0
        model.group.updateMatrixWorld(true)
      }
      // 自家模型每次重建都是新物件，不快取；參考模型很大，快取（placeRef 會清）
      // 【指名 mesh 時不吃快取】快取存的是整台，過濾後的是另一組三角形
      const tris = only
        ? collectTriangles(root, new RegExp(only))
        : target === 'mine' ? collectTriangles(root) : (refTris ??= collectTriangles(root))
      return kind === 'radial'
        ? radialSlices(tris, axis, o as never)
        : extentSlices(tris, axis, o as never)
    }

/**
 * 開發用：列出參考模型的每一個 mesh —— 名字、三角形數、**對齊後**的包圍盒。
 *
 * 【為什麼需要它】射線法適合量「連續的蒙皮輪廓」，不適合量「掛在機身上的
 * 小零件」。從機身裡往外打的射線會飛過砲塔打到對側機身或機翼，`max` 那一欄
 * 因此被遠處的幾何主導 —— 實測 B-17 的上部砲塔，maxRadius 0.9 量到 0.89、
 * 換成 1.4 就變成 1.34，兩者永遠不一致（那正是「換一個更大的半徑重跑看輪廓
 * 有沒有變」這條驗收判準要抓的東西）。
 *
 * 砲塔若在模型裡是獨立命名的節點，直接讀它的包圍盒就結束了。`__hangarSlice`
 * 的第五個參數本來就吃 mesh 名稱的 RegExp（見 `aircraft-from-reference`
 * 第 5b 步），這個出口只是先讓人知道有哪些名字可以填。
 *
 * 座標系與 `__hangarSlice` 相同（都走 `refModel` 的世界矩陣），所以量到的
 * 數字直接可以填進 spec —— 不必自己再換算一次（坑 16）。
 */
;(window as unknown as Record<string, unknown>)['__hangarRefNodes'] = () => {
  if (!refModel) return null
  refModel.updateMatrixWorld(true)
  const out: { name: string; tris: number; box: number[] }[] = []
  const v = new Vector3()
  refModel.traverse((o) => {
    const mesh = o as Mesh
    const pos = mesh.geometry?.getAttribute?.('position')
    if (!pos) return
    let x0 = Infinity, y0 = Infinity, z0 = Infinity
    let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld)
      if (v.x < x0) x0 = v.x
      if (v.y < y0) y0 = v.y
      if (v.z < z0) z0 = v.z
      if (v.x > x1) x1 = v.x
      if (v.y > y1) y1 = v.y
      if (v.z > z1) z1 = v.z
    }
    const idx = mesh.geometry.index
    out.push({
      name: mesh.name,
      tris: Math.round((idx ? idx.count : pos.count) / 3),
      box: [x0, y0, z0, x1, y1, z1],
    })
  })
  return out
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

/**
 * 開發用：載入一份**還沒有自家模型**的參考模型，量它的原始尺寸。
 *
 * 【為什麼機庫需要這個口】`aircraft-from-reference` 的第 1 步是「確認機首
 * 朝向與姿態」，而那一步**一定發生在自家模型存在之前** —— 新增機種時參考
 * 模型永遠先到。但既有的路徑走不了：`syncRef` 用機種 id 查 `REFS`，
 * `placeRef` 又要求 `model` 存在（它把參考模型縮放對齊到自家模型上）。
 *
 * 少了這個口，第 1 步只能先瞎寫一份 spec 出來湊 —— 而那份 spec 的翼展正是
 * 後面要拿來當縮放基準的東西（坑 1）。**用一個猜出來的數字當量尺的基準，
 * 整條產線從第一格就歪了。**
 *
 * 【為什麼刻意不呼叫 placeRef】那會把 He 111 縮放到當前自家模型（P-51D）的
 * 翼展上 —— 疊出來很好看，量出來全是錯的。
 *
 * 【align：量測要在對齊後的座標系裡做】不給 `align` 時回的是原始座標系，
 * 那是第 1 步（確認朝向與姿態）要的。第 2 步開始就要給 —— 坑 16 要求
 * **所有零件在同一個座標系裡量**，而把量出來的原始數字拿回腳本裡二次換算
 * 就是「自己手推換算」的另一種形式（`__hangarInfo` 的註解記過那個教訓：
 * 推過至少四次，錯過一次）。讓場景先轉好，切片器量到的就直接是答案。
 *
 * 【內外兩層與 placeRef 同構】內層繞模型自己的 Y 轉正朝向、外層繞世界 X
 * 轉正俯仰。擠在同一個 Euler 上的話，轉向會把俯仰的正負一起翻掉。
 *
 * 【三角形數要看】`crossSection` 每切一刀就掃過全部三角形。He 111 H-6 是
 * 3.6 M（P-51D 的 4 倍），實測 29 刀約 6 秒。
 */
;(window as unknown as Record<string, unknown>)['__hangarProbe'] =
    (
      url: string,
      align?: { yaw: number; pitch: number; scale: number },
    ) => new Promise((resolve, reject) => {
      new GLTFLoader().load(url, (gltf) => {
        // 【要在量之前套】節點的位移／旋轉／縮放都在矩陣上，不套的話量到的
        // 是各 mesh 自己的區域座標 —— 而那正是「原始包圍盒讀起來很怪」的
        // 成因（有的模型把整台的縮放放在節點上，accessor 正規化到 ±1）
        gltf.scene.updateMatrixWorld(true)

        // 舊的參考模型讓位，並清掉世界座標的三角形快取（坑 2c）
        if (refModel) refModel.visible = false
        refTris = null
        applyRefMaterial(gltf.scene)

        let root: Object3D = gltf.scene
        if (align) {
          const inner = new Group()
          inner.add(gltf.scene)
          inner.rotation.y = align.yaw * DEG
          const outer = new Group()
          outer.add(inner)
          outer.rotation.x = align.pitch * DEG
          outer.scale.setScalar(align.scale)
          outer.updateMatrixWorld(true)
          root = outer
        }
        scene.add(root)
        refModel = root
        refVisible = true
        refCheck.checked = true

        const box = new Box3().setFromObject(root)
        const size = new Vector3()
        box.getSize(size)

        /**
         * 逐 mesh 的世界包圍盒。
         *
         * 【為什麼要逐 mesh 而不只是整體】整體包圍盒被**任何一片**離群幾何
         * 撐大之後就不能拿來推比例了 —— 而那一片在算圖上可能完全看不見
         * （無材質、在鏡頭外、或整片透明）。實測 He 111 H-6：整體算出來的
         * 「高」是真機的三倍。逐 mesh 一列就指得出是誰。
         *
         * 【這不是坑 5 的節點分類】那條說的是「不要靠猜測挑出機身再去量」。
         * 這裡不挑、不猜、不排除任何東西，只是把每一片各報一行給人看。
         */
        const parts: {
          name: string; mat: string; tris: number
          min: number[]; max: number[]; size: number[]
        }[] = []
        // 【從 root 走而不是從 gltf.scene】兩者涵蓋的 mesh 相同，但只有
        // 從 root 走才保證讀到的 `matrixWorld` 已經含 align 那兩層
        const pb = new Box3()
        root.traverse((o) => {
          const mesh = o as Mesh
          const g = mesh.geometry
          if (!g?.getAttribute) return
          const p = g.getAttribute('position')
          if (!p) return
          g.computeBoundingBox()
          pb.copy(g.boundingBox!).applyMatrix4(mesh.matrixWorld)
          const s = new Vector3()
          pb.getSize(s)
          parts.push({
            name: o.name === '' ? '(無名)' : o.name,
            // 原材質的摘要——名字沒資訊時，靠它認出哪一片是玻璃
            mat: String(mesh.userData['refMat'] ?? ''),
            tris: (g.index ? g.index.count : p.count) / 3,
            min: pb.min.toArray(), max: pb.max.toArray(), size: s.toArray(),
          })
        })

        resolve({
          url,
          tris: parts.reduce((n, p) => n + p.tris, 0),
          meshes: parts.length,
          min: box.min.toArray(), max: box.max.toArray(), size: size.toArray(),
          parts,
        })
      }, undefined, reject)
    })

// 開發用：分別開關兩個模型，讓外部工具各自截一張純剪影來抽輪廓。
;(window as unknown as Record<string, unknown>)['__hangarShow'] =
    (mine: boolean, ref: boolean) => {
      if (model) model.group.visible = mine
      if (refModel) refModel.visible = ref
    }

/**
 * 開發用：切換亮／暗兩檔打光（＝面板上的「打光」按鈕）。
 *
 * 【為什麼截圖腳本需要它】機腹在暗的那一檔幾乎全黑，截圖交出去看不出東西。
 * 但預設**不能**改成亮的，理由見 `syncLight` 的檔頭 —— 所以留一個口給腳本
 * 自己開。
 */
;(window as unknown as Record<string, unknown>)['__hangarLit'] =
    (on: boolean) => {
      studio = on
      syncLight()
      litBtn.classList.toggle('on', studio)
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
