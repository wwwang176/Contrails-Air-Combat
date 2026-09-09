import {
  CircleGeometry, DoubleSide, Group, Material, Mesh, MeshStandardMaterial, Object3D, Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PROP_DISC_RENDER_ORDER, type AircraftModel, type HullMetrics } from './assembly'

/**
 * 由 GLB 載入的機種外型。
 *
 * ── 為什麼多這一條路 ────────────────────────────────────────────
 *
 * 程式化那幾台走的是「GLB 參考 → 射線量測 → 烘成錨點表 → 程式重建」。中間那兩步
 * 是這個專案絕大多數外型缺陷的來源，而且**它們不會報錯**：尾輪艙讓 F6F 的
 * 腹線量高 0.22 m、混進垂尾的整流罩外推成 0.24 高 0.085 寬的刀刃、翼尖圓化
 * 從 90% 展長就開始收又收不完。三個都產生平滑、單調、逐站連續的曲線，通過
 * 去尖刺、通過保邊平滑、通過剖面對切驗收。
 *
 * 在 Blender 裡畫、直接出 GLB，這一整類錯誤消失 —— 看到什麼就是什麼。
 *
 * ── 為什麼機身幾何換掉不會波及別處 ──────────────────────────
 *
 * 命中判定走的是 `weapons/*.ts` 裡另外定義的 `hitBoxes`（簡化的傷害體積，
 * 比機體小），不是這裡的三角形；`HullMetrics` 只有機庫在用。所以這條路只
 * 動 render 層。
 *
 * ── 為什麼還是同步的 ────────────────────────────────────────
 *
 * `buildAircraft` 被 `main.ts`、四個工具頁、以及**跑在 node 環境的單元測試**
 * 同步呼叫。改成非同步要動每一個呼叫點。這裡的做法是把非同步限制在
 * `loadGlbTemplate` —— 開場 await 一次，之後 `buildFromTemplate` 是同步的。
 */
export interface GlbAircraft {
  /** 瀏覽器取得 GLB 的路徑。放 `public/` 底下才會進 `vite build` 的產物。 */
  url: string
  /** 真機全長（含整流罩），m。GLB 給不了「真機」，只給得了模型。 */
  realLength: number
  /** 機首視角的眼點，機體座標 */
  eyePoint: Vector3
  /** **右**翼尖，機體座標 */
  wingTip: Vector3
  /**
   * 投彈瞄具的眼點與炸彈的產生位置，**機體座標**。**在機腹中央。**
   *
   * 量法：機體 x≈0、z≈0 那一帶（`z = 0` 是主翼四分之一弦線，也就是彈艙的
   * 位置）機身頂點的最低 y，見 `test/tools/belly-point.probe.ts`。
   *
   * 沒有掛彈的機種為 `null`。
   *
   * 【近平面幫了忙】`CAMERA_NEAR = 1`，相機一公尺內的蒙皮會被裁掉，視線
   * 自然穿得出機腹。
   */
  bombPoint: Vector3 | null
  bodyColor: number
  accentColor: number
  /**
   * GLB 裡的材質名 → 遊戲材質。
   *
   * 【為什麼要重貼而不是用 GLB 自己的】遊戲的四台共用同一組
   * `MeshStandardMaterial`（`flatShading`、固定 roughness、玻璃那份還要
   * `depthWrite: false`）。照抄 glTF 的 PBR 參數會讓新機種在同一個場景裡
   * 亮度與高光跟其他三台對不起來 —— 那不是「更真實」，是不一致。
   */
  materials: Readonly<Record<string, GlbMaterialKind>>
  /**
   * 每一具螺旋槳一筆。**是陣列而不是一筆**，因為 He 111 雙發、B-17G 四發
   * —— 與 `assembly.ts` 的 `props` 同一個理由：單一閉包會讓第二具以後
   * 永遠不轉。單發機就是一筆。
   */
  props: readonly GlbProp[]
}

export interface GlbProp {
  /**
   * GLB 裡這一具槳葉那個物件的名字。多發機每一具各取一個名字
   * （`B17_Prop1`…），載入時靠名字把槳葉分到各自的轉軸底下。
   */
  node: string
  /** 轉軸的橫向位置（機體座標）。省略即 0（單發機在機首）。 */
  hubX?: number
  /** 轉軸位置（機體座標）。槳葉繞 +Z 轉。 */
  hubY: number
  hubZ: number
  /** 模糊圓盤半徑，m */
  radius: number
}

/**
 * 遊戲材質的種類。
 *
 *   `cockpit`  座艙內裝：暗色、**平滑**著色、刻意朝內的殼（與 `assembly.ts`
 *              的 `cockpitMat` 相同）。P-51D 從程式版搬過來時帶著它；沒有
 *              這一種，內裝要嘛被拒載、要嘛被貼成整流罩的暗色。
 *   `frame`    機身色但**兩面都畫**：玻璃的骨架是一條條窄帶，只有一個朝向，
 *              而 He 111 的全玻璃機首讓你從機外看到對側骨架的背面
 *              （`assembly.ts` 的 `bothSides`）。
 *   `inner`    暗色、**兩面都畫**：碗狀凹槽（進氣口、玻璃後面的暗艙）的
 *              內壁，從開口看進去看到的是背面（`assembly.ts` 的 `darkBothSides`）。
 *              它朝外，所以**不掛** inwardShell。
 */
export type GlbMaterialKind = 'body' | 'accent' | 'glass' | 'cockpit' | 'frame' | 'inner'

/** 載好、貼好材質、併好的一份樣板。每個機種一份，全場共用。 */
export interface GlbTemplate {
  group: Group
  metrics: HullMetrics
  eyePoint: Vector3
  wingTip: Vector3
  /** 見 `GlbAircraft.bombPoint`。`null` = 這一台掛不了彈 */
  bombPoint: Vector3 | null
  /** 每一具槳轂的位置，機體座標。見 `AircraftModel.enginePoints` */
  enginePoints: Vector3[]
  /** 樣板自己持有的 GPU 資源。整局結束才需要放。 */
  dispose(): void
}

const templates = new Map<string, GlbTemplate>()

export function glbTemplate(id: string): GlbTemplate | undefined {
  return templates.get(id)
}

/** 預設的取檔方式。node 測試自己讀檔再呼叫 `parseGlbTemplate`。 */
async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`載入 ${url} 失敗：HTTP ${res.status}`)
  return res.arrayBuffer()
}

export async function loadGlbTemplate(id: string, def: GlbAircraft): Promise<GlbTemplate> {
  const t = await parseGlbTemplate(await fetchBuffer(def.url), def)
  templates.set(id, t)
  return t
}

/** 給 node 測試用：已經拿到 ArrayBuffer 的版本。 */
export function registerGlbTemplate(id: string, t: GlbTemplate): void {
  templates.set(id, t)
}

export async function parseGlbTemplate(buf: ArrayBuffer, def: GlbAircraft): Promise<GlbTemplate> {
  // 【`parse` 是非同步的】它的 onLoad 走 Promise，不是同步回呼。照
  // 「GLB 沒有外部資源就會同步完成」寫，拿到的是 null。
  const scene = await new Promise<Group>((res, rej) => {
    new GLTFLoader().parse(buf, '', (gltf) => res(gltf.scene), rej)
  })

  const body = new MeshStandardMaterial({
    color: def.bodyColor, flatShading: true, roughness: 0.75,
  })
  const accent = new MeshStandardMaterial({
    color: def.accentColor, flatShading: true, roughness: 0.6,
  })
  // 與 assembly.ts 的 `glass` 逐項相同 —— 玻璃是四台共用的觀感
  const glass = new MeshStandardMaterial({
    color: 0x9fd4e8, flatShading: true, transparent: true, opacity: 0.45,
    roughness: 0.2, depthWrite: false,
  })
  const blur = new MeshStandardMaterial({
    color: 0xc8d0d8, transparent: true, opacity: 0.22, roughness: 0.5,
    depthWrite: false, side: DoubleSide,
  })
  const cockpit = new MeshStandardMaterial({ color: 0x191d1a, roughness: 0.95 })
  // 與 assembly.ts 的 `bothSides`、`darkBothSides` 逐項相同，見 GlbMaterialKind
  const frame = new MeshStandardMaterial({
    color: def.bodyColor, flatShading: true, roughness: 0.75, side: DoubleSide,
  })
  const inner = new MeshStandardMaterial({ color: 0x191d1a, roughness: 0.95, side: DoubleSide })
  const mats = { body, accent, glass, cockpit, frame, inner }
  const owned: { dispose(): void }[] = [body, accent, glass, cockpit, frame, inner, blur]

  const group = new Group()
  const hull = new Group()
  group.add(hull)

  // ── 走一遍場景，把每個 mesh 的頂點烘進機體座標、重貼材質 ──────────
  //
  // 【為什麼這裡可以烘變換】`assembly.ts` 的 `mergeStatic` 刻意不烘，因為那
  // 會讓程式化那幾台的像素改變（float64 vs float32 的最低位）。GLB 機種是新的，
  // 沒有「不能動的既有畫面」要守；而且 Blender 匯出時已經 apply 過，實測
  // 每個節點的矩陣都是單位矩陣，烘進去等於什麼都沒做。
  const propMeshes: Mesh[][] = def.props.map(() => [])
  const statics: Mesh[] = []
  const seen = new Set<string>()
  scene.updateMatrixWorld(true)
  scene.traverse((o: Object3D) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const srcName = (mesh.material as Material).name
    seen.add(srcName)
    const kind = def.materials[srcName]
    if (!kind) throw new Error(`GLB 材質 ${srcName} 沒有對應的遊戲材質`)
    const geo = mesh.geometry.clone()
    geo.applyMatrix4(mesh.matrixWorld)
    geo.deleteAttribute('uv')
    const out = new Mesh(geo, mats[kind])
    // 內裝的法線朝內是刻意的；`geometry.test.ts` 的「法線朝外」靠這個旗標略過
    if (kind === 'cockpit') out.userData['inwardShell'] = true
    // 翼板的 `part='wingN'` 標記（glTF extras）跟著走：`geometry.test.ts` 的
    // 「四分之一弦線壓在重心上」靠它認主翼。沒標的機種（F6F-5）什麼都不變。
    const part = mesh.userData['part']
    if (typeof part === 'string') out.userData['part'] = part
    owned.push(geo)
    // 節點名會被加尾碼（F6F_Prop.030 → 載入後 F6F_Prop030），見 isNamed
    const at = def.props.findIndex((p) => isNamed(mesh, p.node))
    if (at >= 0) propMeshes[at]!.push(out)
    else statics.push(out)
  })
  for (const name of Object.keys(def.materials)) {
    if (!seen.has(name)) throw new Error(`GLB 裡沒有材質 ${name} —— manifest 過期了`)
  }
  def.props.forEach((p, i) => {
    if (propMeshes[i]!.length === 0) throw new Error(`GLB 裡找不到螺旋槳節點 ${p.node}`)
  })

  // ── 按材質合併靜態零件 ──────────────────────────────────────
  //
  // 【為什麼一定要做】這條分支就是在砍 draw call。GLB 一個物件一個 primitive，
  // 照收就是 8 次；併完剩 3 次（機身色、暗色、玻璃），跟程式化那四台同級。
  //
  // 【有索引與沒索引的分開併】`mergeGeometries` 要求整批要嘛都有 index、要嘛
  // 都沒有。從程式版匯出的 P-51D 兩種都有（`BoxGeometry` 帶索引、lofting 的
  // 機身不帶），混在一起它回 null。分開併多一個 draw call，頂點一個都不動 ——
  // 把索引展開（`toNonIndexed`）才是會改頂點數的那條路。
  //
  // 【翼板逐 part 各自一組】與 `assembly.ts` 的 `mergeStatic` 同一個理由：併成
  // 一塊之後「哪一個 mesh 是主翼」就認不出來。每架多兩三個 draw call。
  const byMat = new Map<string, { mat: MeshStandardMaterial; list: Mesh[] }>()
  for (const m of statics) {
    const mat = m.material as MeshStandardMaterial
    const key = `${mat.uuid}/${m.geometry.index ? 'indexed' : 'flat'}/${m.userData['part'] ?? ''}`
    const bucket = byMat.get(key)
    if (bucket) bucket.list.push(m)
    else byMat.set(key, { mat, list: [m] })
  }
  for (const { mat, list } of byMat.values()) {
    if (list.length === 1) { hull.add(list[0]!); continue }
    const merged = mergeGeometries(list.map((m) => m.geometry), false)
    if (merged === null) throw new Error('mergeGeometries 回 null：屬性集合不一致')
    for (const m of list) {
      m.geometry.dispose()
      const at = owned.indexOf(m.geometry)
      if (at >= 0) owned.splice(at, 1)
    }
    owned.push(merged)
    const mesh = new Mesh(merged, mat)
    mesh.userData['merged'] = true
    if (list.some((m) => m.userData['inwardShell'])) mesh.userData['inwardShell'] = true
    const part = list[0]!.userData['part']
    if (typeof part === 'string') mesh.userData['part'] = part
    hull.add(mesh)
  }

  // ── 螺旋槳：每一具搬到一個以自己轉軸為原點的 Group 底下 ─────────────
  def.props.forEach((p, i) => {
    const hx = p.hubX ?? 0
    const hub = new Group()
    hub.position.set(hx, p.hubY, p.hubZ)
    // `buildFromTemplate` 靠這個旗標認轉軸；多發機有好幾個
    hub.userData['propHub'] = true
    for (const m of propMeshes[i]!) {
      m.geometry.translate(-hx, -p.hubY, -p.hubZ)
      // 命中盒覆蓋率測試靠這個旗標排除掃掠面（見 assembly.ts 的 propeller）
      m.userData['spinning'] = true
      hub.add(m)
    }
    const disc = new Mesh(new CircleGeometry(p.radius, 16), blur)
    disc.visible = false
    disc.renderOrder = PROP_DISC_RENDER_ORDER
    disc.userData['spinning'] = true
    owned.push(disc.geometry)
    hub.add(disc)
    hull.add(hub)
  })

  group.updateMatrixWorld(true)
  return {
    group,
    metrics: measure(group, def.realLength),
    eyePoint: def.eyePoint.clone(),
    wingTip: def.wingTip.clone(),
    bombPoint: def.bombPoint === null ? null : def.bombPoint.clone(),
    // 【從場景圖量，不從 `def` 抄】槳轂掛在 `hull` 底下，而 `hull` 相對
    // `group` 帶著重心位移。抄 `def.hubZ` 會少掉那一段，火點就偏了。
    // 【在樣板上量一次】每一架複本的槳轂位置都相同，逐架重算是白費
    enginePoints: hubPoints(group),
    dispose() { for (const d of owned) d.dispose() },
  }
}

/**
 * 場景圖裡每一個螺旋槳轉軸的位置，**`group` 的區域座標**。
 * 呼叫端要先 `group.updateMatrixWorld(true)`。
 */
function hubPoints(group: Group): Vector3[] {
  const out: Vector3[] = []
  group.traverse((o) => {
    if (o.userData['propHub']) out.push(group.worldToLocal(o.getWorldPosition(new Vector3())))
  })
  return out
}

/**
 * 節點名是不是 `base` 或它的複本。Blender 給複本加的尾碼是 `.001`，但
 * `GLTFLoader` 載入時會把名字裡的點拿掉（`PropertyBinding.sanitizeNodeName`），
 * 看到的是 `P51_Prop001` —— 所以尾碼只認「可有可無的分隔符＋數字」。
 * 不認任意前綴：`F6F_PropHub` 這種名字不該被當成槳葉。
 */
function isNamed(o: Object3D, base: string): boolean {
  if (!o.name.startsWith(base)) return false
  const tail = o.name.slice(base.length)
  return tail === '' || /^[._]?\d+$/.test(tail)
}

/** 與 `assembly.ts` 的 `finish()` 同一套量法，好讓機庫的兩條路讀數可比。 */
function measure(root: Object3D, realLength: number): HullMetrics {
  const v = new Vector3()
  let noseZ = Infinity
  let maxAbsX = 0
  const verts: { mesh: Mesh; i: number }[] = []
  root.traverse((o) => {
    const mesh = o as Mesh
    const pos = mesh.geometry?.getAttribute?.('position')
    if (!pos) return
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld)
      noseZ = Math.min(noseZ, v.z)
      maxAbsX = Math.max(maxAbsX, Math.abs(v.x))
      verts.push({ mesh, i })
    }
  })
  const lim = maxAbsX * 0.92
  let sum = 0, n = 0
  let noseLo = Infinity, noseHi = -Infinity
  for (const { mesh, i } of verts) {
    const pos = mesh.geometry.getAttribute('position')
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld)
    if (Math.abs(v.x) > lim) { sum += v.y; n++ }
    if (v.z < noseZ + 0.03) { noseLo = Math.min(noseLo, v.y); noseHi = Math.max(noseHi, v.y) }
  }
  return { realLength, noseZ, noseY: (noseLo + noseHi) / 2, tipY: n ? sum / n : 0 }
}

/**
 * 由樣板複製一架。
 *
 * 【幾何與材質是共用的，不是複製的】`Object3D.clone()` 預設就共用
 * `BufferGeometry` 與 `Material`。20v20 是 40 架共用同一份頂點緩衝 ——
 * 這正是這條分支在買的東西（每幀上傳與 draw call）。代價是 `dispose()`
 * 不能放共用資源，所以它是空的；樣板的資源由 `GlbTemplate.dispose` 放。
 */
export function buildFromTemplate(t: GlbTemplate): AircraftModel {
  const group = t.group.clone(true)
  // 每一具螺旋槳一組（多發機有好幾組），與 assembly.ts 的 `props` 同構
  const props: { hub: Object3D; disc: Mesh; blades: Mesh[] }[] = []
  group.traverse((o) => {
    if (!o.userData['propHub']) return
    let disc: Mesh | null = null
    const blades: Mesh[] = []
    for (const c of o.children) {
      const mesh = c as Mesh
      if (!mesh.userData['spinning']) continue
      if ((mesh.geometry as { type?: string } | undefined)?.type === 'CircleGeometry') disc = mesh
      else blades.push(mesh)
    }
    if (disc === null) throw new Error('樣板的螺旋槳轉軸底下沒有槳盤')
    props.push({ hub: o, disc, blades })
  })
  if (props.length === 0) throw new Error('樣板缺少螺旋槳節點')
  return {
    group,
    metrics: t.metrics,
    eyePoint: t.eyePoint.clone(),
    wingTip: t.wingTip.clone(),
    bombPoint: t.bombPoint === null ? null : t.bombPoint.clone(),
    // 【複製而不是共用】殘骸那一層只讀不寫，但共用一份可變向量是等著出事
    enginePoints: t.enginePoints.map((p) => p.clone()),
    setPropSpin(r, b) {
      for (const p of props) {
        p.hub.rotation.z = r
        p.disc.visible = b
        for (const blade of p.blades) blade.visible = !b
      }
    },
    dispose() { /* 幾何與材質由樣板持有，見上方說明 */ },
  }
}
