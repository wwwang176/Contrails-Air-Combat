import type { GlbTemplate } from './glbInstance'
export { buildFromTemplate, type GlbTemplate } from './glbInstance'
import {
  CircleGeometry, DoubleSide, Group, Material, Mesh, MeshStandardMaterial, Object3D,
  SRGBColorSpace, TextureLoader, Vector3, type Texture,
} from 'three'
import { createGltfLoader } from './gltfLoader'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PROP_DISC_RENDER_ORDER, type HullMetrics } from './assembly'
import { assetUrl } from '../../core/asset'
import { applyLiveryUv, liveryMoveFor, type LiveryLayout } from './livery'

/**
 * 由 GLB 載入的機種外型。
 *
 * ── 為什麼機身幾何換掉不會波及別處 ──────────────────────────
 *
 * 命中判定走的是 `weapons/*.ts` 裡另外定義的 `hitBoxes`（簡化的傷害體積，
 * 比機體小），不是這裡的三角形；`HullMetrics` 只有機庫在用。所以換 GLB 只
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
   * 沒有機腹瞄準視角的機種為 `null`：掛彈戰鬥機與 Ju 87 按 B 直接投彈，
   * 掛不了彈的也是 `null`（兩者由 `main.ts` 的 `syncBombLoad` 依掛載分開）。
   *
   * 【近平面幫了忙】`CAMERA_NEAR = 1`，相機一公尺內的蒙皮會被裁掉，視線
   * 自然穿得出機腹。
   */
  bombPoint: Vector3 | null
  bodyColor: number
  accentColor: number
  /**
   * 塗裝。有的話 `body` 材質改吃貼圖，機身色的面在載入時照版面算 UV
   * （`livery.ts`），GLB 本身不帶 UV。`bodyColor` 仍然是 `frame`（窗框）與
   * 停機坪烘焙的顏色。
   */
  livery?: LiveryLayout
  /**
   * 塗裝變體：變體名 → 貼圖路徑（`public/` 底下）。**版面與 `livery` 共用**（同一份 UV），只換圖。
   * 任務卡用 `MissionBattle.liveries` 以機種 id 指名變體；沒指名的任務、遭遇戰與機庫用 `livery.url`。
   */
  liveryVariants?: Readonly<Record<string, string>>
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
   * —— 單一閉包會讓第二具以後永遠不轉。單發機就是一筆。
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
 *   `cockpit`  座艙內裝：暗色、**平滑**著色、刻意朝內的殼。沒有這一種，
 *              內裝要嘛被拒載、要嘛被貼成整流罩的暗色。
 *   `frame`    機身色但**兩面都畫**：玻璃的骨架是一條條窄帶，只有一個朝向，
 *              而 He 111 的全玻璃機首讓你從機外看到對側骨架的背面。
 *   `inner`    暗色、**兩面都畫**：碗狀凹槽（進氣口、玻璃後面的暗艙）的
 *              內壁，從開口看進去看到的是背面。
 *              它朝外，所以**不掛** inwardShell。
 */
export type GlbMaterialKind = 'body' | 'accent' | 'glass' | 'cockpit' | 'frame' | 'inner'

const templates = new Map<string, GlbTemplate>()

/** 樣板的快取鍵：預設塗裝就是機種 id，變體是 `id#變體` */
function templateKey(id: string, variant?: string): string {
  return variant === undefined ? id : `${id}#${variant}`
}

/** `variant` 省略 = 預設塗裝的樣板；變體的樣板要先 `loadGlbTemplate` 或 `registerGlbTemplate` */
export function glbTemplate(id: string, variant?: string): GlbTemplate | undefined {
  return templates.get(templateKey(id, variant))
}

/** 預設的取檔方式。node 測試自己讀檔再呼叫 `parseGlbTemplate`。 */
async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(assetUrl(url))
  if (!res.ok) throw new Error(`載入 ${url} 失敗：HTTP ${res.status}`)
  return res.arrayBuffer()
}

/**
 * 載入一份樣板。`variant` 給了就載那個塗裝變體（貼圖換成 `def.liveryVariants[variant]`，GLB 與版面不變）；
 * 變體沒登記就拋錯。
 */
export async function loadGlbTemplate(id: string, def: GlbAircraft, variant?: string): Promise<GlbTemplate> {
  const url = variant === undefined ? def.livery?.url : def.liveryVariants?.[variant]
  if (variant !== undefined && url === undefined) throw new Error(`機種 ${id} 沒有塗裝變體「${variant}」`)
  const [buf, livery] = await Promise.all([
    fetchBuffer(def.url),
    url === undefined ? null : loadLivery(url),
  ])
  const t = await parseGlbTemplate(buf, def, livery)
  templates.set(templateKey(id, variant), t)
  return t
}

/** 給 node 測試用：已經拿到 ArrayBuffer 的版本。 */
export function registerGlbTemplate(id: string, t: GlbTemplate, variant?: string): void {
  templates.set(templateKey(id, variant), t)
}

/**
 * 塗裝貼圖。
 *
 * 【flipY = false】UV 的原點在圖的左上角（`livery.ts`）；`TextureLoader` 預設
 * 會把圖上下翻，那樣整張塗裝倒過來貼。
 *
 * 【依路徑快取、不歸樣板持有】主模型與低模貼同一張圖。歸其中一份樣板的話，
 * 它 dispose 時另一份就失去貼圖。整場遊戲只有幾張，不放。
 */
const liveries = new Map<string, Promise<Texture>>()

function loadLivery(url: string): Promise<Texture> {
  let t = liveries.get(url)
  if (t === undefined) {
    t = new TextureLoader().loadAsync(assetUrl(url)).then((tex) => {
      tex.flipY = false
      tex.colorSpace = SRGBColorSpace
      // 機翼常是斜著看的，沒有異向過濾的話標誌遠一點就糊成一團。three 會壓到顯卡的上限
      tex.anisotropy = 8
      return tex
    })
    liveries.set(url, t)
  }
  return t
}

/** 某張塗裝貼圖（同一個路徑回同一份），給載入畫面先傳上 GPU */
export function liveryTexture(url: string): Promise<Texture> {
  return loadLivery(url)
}

/**
 * `livery` 是已經載好的塗裝貼圖。node 測試沒有圖可載，傳 null：UV 照留、
 * 材質維持單色。
 */
export async function parseGlbTemplate(
  buf: ArrayBuffer, def: GlbAircraft, livery: Texture | null = null,
): Promise<GlbTemplate> {
  // 【`parse` 是非同步的】它的 onLoad 走 Promise，不是同步回呼。照
  // 「GLB 沒有外部資源就會同步完成」寫，拿到的是 null。
  const scene = await new Promise<Group>((res, rej) => {
    createGltfLoader().parse(buf, '', (gltf) => res(gltf.scene), rej)
  })

  const body = new MeshStandardMaterial({
    color: livery === null ? def.bodyColor : 0xffffff, map: livery,
    flatShading: true, roughness: 0.75,
  })
  // 烘成頂點色的那幾條路（停機坪）讀不到貼圖，取這個單色
  if (livery !== null) body.userData['bakeColor'] = def.bodyColor
  const accent = new MeshStandardMaterial({
    color: def.accentColor, flatShading: true, roughness: 0.6,
  })
  // 玻璃是所有機種共用的觀感
  const glass = new MeshStandardMaterial({
    color: 0x9fd4e8, flatShading: true, transparent: true, opacity: 0.45,
    roughness: 0.2, depthWrite: false,
  })
  // 【DoubleSide】圓盤朝 −Z，單面的話只有從飛機後方才畫得出來，從前方看螺旋槳整個不見。
  // 【forceSinglePass】three 對「透明＋雙面」預設分背面、正面兩趟畫，每一趟都把材質標髒、
  // 重算 shader program，20 架就是每幀 40 次。圓盤是平的，一趟畫出來的像素與兩趟相同
  const blur = new MeshStandardMaterial({
    color: 0xc8d0d8, transparent: true, opacity: 0.22, roughness: 0.5,
    depthWrite: false, side: DoubleSide, forceSinglePass: true,
  })
  const cockpit = new MeshStandardMaterial({ color: 0x191d1a, roughness: 0.95 })
  // 見 GlbMaterialKind
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
  // 【烘進去不改頂點】GLB 的節點變換應已套用在頂點上（每個節點的矩陣都是
  // 單位矩陣），烘進去等於什麼都沒做；萬一某個節點帶了變換，烘進去才放得對位置。
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
    let geo = mesh.geometry.clone()
    geo.applyMatrix4(mesh.matrixWorld)
    geo.deleteAttribute('uv')
    // 【機身色的面一律帶 UV】同一個材質的面要嘛全有、要嘛全沒有，否則下面按
    // 材質合併時 `mergeGeometries` 會回 null。有索引的先展開：相鄰的面可能
    // 歸到不同視圖，共用頂點只能有一組 UV
    if (def.livery !== undefined && kind === 'body') {
      if (geo.index !== null) {
        const flat = geo.toNonIndexed()
        geo.dispose()
        geo = flat
      }
      applyLiveryUv(geo, def.livery, liveryMoveFor(def.livery, mesh.name, mesh.userData['part']))
    }
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
  // 照收就是 8 次；併完剩 3 次（機身色、暗色、玻璃）。
  //
  // 【有索引與沒索引的分開併】`mergeGeometries` 要求整批要嘛都有 index、要嘛
  // 都沒有。同一支 GLB 可能兩種都有，混在一起它回 null。分開併多一個 draw call，
  // 頂點一個都不動 —— 把索引展開（`toNonIndexed`）才是會改頂點數的那條路。
  //
  // 【翼板逐 part 各自一組】併成一塊之後「哪一個 mesh 是主翼」就認不出來。
  // 每架多兩三個 draw call。
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
      // 命中盒覆蓋率測試靠這個旗標排除掃掠面
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
 * 節點名是不是 `base` 或它的複本。複本的尾碼是 `.001`，但
 * `GLTFLoader` 載入時會把名字裡的點拿掉（`PropertyBinding.sanitizeNodeName`），
 * 看到的是 `P51_Prop001` —— 所以尾碼只認「可有可無的分隔符＋數字」。
 * 不認任意前綴：`F6F_PropHub` 這種名字不該被當成槳葉。
 */
function isNamed(o: Object3D, base: string): boolean {
  if (!o.name.startsWith(base)) return false
  const tail = o.name.slice(base.length)
  return tail === '' || /^[._]?\d+$/.test(tail)
}

/** 機首尖端的 Z：所有頂點（世界座標）的最小 z。 */
function measure(root: Object3D, realLength: number): HullMetrics {
  const v = new Vector3()
  let noseZ = Infinity
  root.traverse((o) => {
    const mesh = o as Mesh
    const pos = mesh.geometry?.getAttribute?.('position')
    if (!pos) return
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld)
      noseZ = Math.min(noseZ, v.z)
    }
  })
  return { realLength, noseZ }
}
