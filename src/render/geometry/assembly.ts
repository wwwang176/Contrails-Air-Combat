import {
  BoxGeometry, BufferGeometry, CircleGeometry, ConeGeometry, DoubleSide, Float32BufferAttribute,
  Group, Material, Matrix4, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { DEG } from '../../core/math'
import { buildFuselage, type FuselageSection } from './fuselage'
import {
  buildCanopy, buildFrames, type CanopyShape, type CanopyStation, type FrameSpec,
} from './canopy'
import {
  buildCockpitTub, buildHull, ringAt,
  type CockpitCut, type GlassPatch, type HullRing,
} from './hull'
import { buildWingPanel, type Break, type WingParams } from './wing'

/**
 * 機體組裝的共用鷹架 —— **不含任何機種的造型**。
 *
 * 【為什麼造型要一機一檔】原本兩台飛機共用一份 `Silhouette` 結構與一支
 * buildAircraft。隨著外形逼近真機，共用的代價愈來愈明顯：
 *
 *   座艙罩  P-51D 是架在機背上的氣泡罩、109 是嵌進機身的方框罩，
 *           連建構方式都不同（獨立 loft ／ 貼機身的殼）
 *   機腹    P-51D 有散熱器導管，109 沒有
 *   背鰭    P-51D 有 dorsal fillet，109 沒有
 *   翼尖    P-51D 圓翼尖，109 E 方翼尖
 *   支柱    109 E 有尾翼支撐桿，P-51D 沒有
 *
 * 共用結構於是長滿 optional 欄位與 kind 標籤，改一台就得同時想另一台。
 * 專案負責人裁決分開：**造型各自成檔，只共用低階零件**。
 *
 * 這一檔留下的都是與機種無關的東西：材質、把網格收進場景並登記回收、
 * 螺旋槳組（兩台的差異只有槳葉數與尺寸），以及量測產出的 HullMetrics。
 */

export interface HullMetrics {
  /** 真機全長（含整流罩），m。機庫拿它跟模型包圍盒對照。 */
  realLength: number
  /** 機首尖端在**機體座標**的 Z（已含重心位移）。 */
  noseZ: number
  /**
   * 機首尖端的垂直位置（＝推力線）。參考模型疊圖時用它對齊 Y。
   *
   * 【為什麼用機首而不是翼尖】翼尖的平均高度取決於上反角、翼尖形狀、以及
   * 取樣視窗取多寬——三件事在兩個模型上都不一樣。機首尖端是**一個點**，
   * 兩邊都毫無歧義，而且 Z 向本來就是拿它對齊的，用同一個點當基準最一致。
   *
   * 實測 P-51D：用翼尖對齊時機翼吻合到 ±0.015 m 而機身差 0.37 m；改用機首
   * 對齊則機身吻合、機翼差 0.37 m。同一個落差，基準只決定它落在哪裡——
   * 但推力線是機身的自然基準（引擎就裝在上面），量機身時該用它。
   */
  noseY: number
  /** 翼尖的平均高度。診斷用：與 noseY 一起看才知道落差落在機身還是機翼。 */
  tipY: number
}

export interface AircraftModel {
  group: Group
  metrics: HullMetrics
  /** 機首視角的眼點，**機體座標**（已含重心位移）。見 HullSpec.eyePoint */
  eyePoint: Vector3
  /** **右**翼尖，**機體座標**（已含重心位移）。左翼取 −x。見 HullSpec.wingTip */
  wingTip: Vector3
  /** rotation 為累積弧度；blurred 為 true 時切換為半透明圓盤 */
  setPropSpin(rotation: number, blurred: boolean): void
  dispose(): void
}

/** 一個 lofting 部件：截面串 + 超橢圓指數 + 徑向分段數。 */
export interface LoftPart {
  sections: readonly FuselageSection[]
  /** 超橢圓指數：2 = 橢圓，越大越接近圓角矩形。見 buildFuselage。 */
  roundness: number
  segments: number
  /** 首尾封口，省略即兩端都封。碗狀的凹槽要 `{ front: false }`。 */
  caps?: { front?: boolean; back?: boolean }
  /** 只吐這一段角度的面（度），省略即整圈。給了就不封口，見 buildFuselage。 */
  arc?: { fromDeg: number; toDeg: number }
}

/** 垂直安定面／背鰭延伸板，以 WingParams 立起 90° 描述。 */
export interface FinParams {
  chordRoot: number
  chordTip: number
  height: number
  sweep: number
  z: number
  /**
   * 翼根的垂直位置。省略即 0。
   *
   * 【為什麼需要】垂尾原本一律從 y=0 長起，但機身後段的中心線是抬高的，
   * 下半截因此埋在機身裡。等它從背線冒出來時，前緣已被後掠角帶往機尾——
   * 實測 109 可見的垂尾根部落在全長 86.7%，設計值卻是 82%，看起來又小
   * 又靠後。P-51D 的背鰭更嚴重：高 0.42 但該站位背線在 0.570，**整片
   * 看不見**。
   */
  rootY?: number
  /** 展向轉折。前緣是凹曲線時用，見 `WingParams.breaks`。 */
  breaks?: readonly Break[]
}

/**
 * 凸起塊：進氣口、翼下散熱器、排氣管、尾翼支柱——這些在照片裡都是
 * 「貼在主體上的一小塊」，形狀差異在遊戲距離下看不出來，共用一個盒體
 * 即可，差別只在位置與尺寸。
 */
export interface Blister {
  x: number
  y: number
  z: number
  /** 翼展向 × 垂直 × 縱向 */
  width: number
  height: number
  length: number
  /** 繞 Z 軸傾斜（尾翼支柱用），rad */
  rotZ?: number
  /** true 時鏡像到 −X 側（位置與 rotZ 同時取負） */
  mirror?: boolean
  /** true 用機身色，預設用強調色 */
  bodyColor?: boolean
  /** true 時用低多邊形橢球而非方盒（鼓包是圓的，進氣口與散熱器是方管） */
  round?: boolean
}

export interface PropSpec {
  spinnerRadius: number
  spinnerLength: number
  /** 整流罩軸心的垂直位置，需與機首環中心一致 */
  spinnerY: number
  /** 槳葉數：P-51D 四葉、Bf 109／He 111 三葉 */
  blades: number
  propZ: number
  propRadius: number
  /**
   * 軸心的橫向位置。省略即 0（機首）。
   *
   * 【為什麼需要】He 111 的兩具發動機掛在機翼上，x = ±2.6。單發機的整流罩
   * 一律在機身軸線上，所以在它之前這個欄位不存在。
   */
  x?: number
  /**
   * 整流罩尖端的 Z。省略時由 `propeller` 的第二個參數（機身首站）給。
   *
   * 【為什麼需要】單發機的整流罩接在機首上，所以「機身首站」就是答案。
   * 掛在機翼上的發動機艙與機首毫無關係 —— 這台的艙前緣在 z = −2.75，
   * 而機首在 −3.25。
   */
  noseZ?: number
}

export interface HullSpec {
  bodyColor: number
  accentColor: number
  realLength: number
  /**
   * 造型座標 → 機體座標的 Z 位移：讓機翼四分之一弦線落在原點。
   *
   * 【為什麼需要】原點是物理模型的**重心**（`state.position` 就是重心）。
   * 造型站位是照著「機首在負 Z」手打的，重心落在哪裡是碰運氣——實測
   * P-51D 差了 0.81 m、Bf 109 差了 2.08 m。四分之一弦線是次音速氣動中心
   * 的標準近似，重心壓在它附近才是正常的飛機配置。
   *
   * 用位移而不是把站位全部重打，是為了讓造型數字保持可讀（機首負、機尾
   * 正），而且日後移動機翼不必連帶重算其他四十個座標。
   */
  offsetZ: number
  /**
   * 飛行員眼點，**造型座標**（與座艙罩站位同一個座標系，finish 會補上 offsetZ）。
   *
   * 【為什麼一機一個值而不是相機的共用預設】兩台的座艙差很多：P-51D 的泡罩
   * 開口 z 0.085…2.485、艙緣 0.520、罩頂 1.066；Bf 109 的方框罩開口 z
   * 0.255…1.695、艙緣 0.520、罩頂 0.965。共用一個偏移必然有一台的眼睛在
   * 玻璃外面。值寫在各機種的造型檔裡，就緊挨著它推導所依據的量測站位。
   */
  eyePoint: Vector3
  /**
   * **右**翼尖，**造型座標**（`finish` 會補上 `offsetZ`）。左翼取 −x。
   *
   * 取的是**翼尖弦的中點**：`x` = 半翼展、`y` = 翼尖站位的高度（含上反角）、
   * `z` = 翼尖前緣 + 弦長/2。
   *
   * 【為什麼一機一個值而不是從幾何推】與 `eyePoint` 同一個理由，而且更明顯：
   * 每一台的機翼位置都不一樣（後掠、上反、翼根站位、翼尖收縮各不相同），
   * 沒有一條共用的推導規則對兩台都準。原本的實作是「取 |x| > 0.92 × 半翼展
   * 那批頂點的平均」—— 它對現在這兩台碰巧夠用，但那個 0.92 是個會被下一台
   * 飛機（雙尾桁、大水平尾翼、橢圓翼）默默弄壞的啟發式，而壞掉的症狀是
   * 尾跡從機身中間冒出來，不會有任何錯誤。
   *
   * 【不會與幾何漂開】`geometry.test.ts` 有一條護欄：宣告的這個點必須真的
   * 落在建出來的翼尖上（x 等於包圍盒半翼展，y／z 落在翼尖那一站的範圍內）。
   * 移動機翼卻忘了改這裡就會紅。
   *
   * 【用途】翼尖凝結尾（`render/vortex.ts`）要知道渦從哪裡脫離。
   */
  wingTip: Vector3
}

/**
 * 模糊圓盤的繪製順序。**要比所有其他透明物件都晚畫。**
 *
 * 【為什麼只關 `depthWrite` 還不夠】關掉之後遮擋不再是「把後面的東西丟掉」
 * 而是「混合」，但混合的先後仍然由 three 的**逐物件**排序決定 —— 而曳光彈
 * 整批是一個 `InstancedMesh`，它的排序深度取的是**世界原點**，與子彈實際
 * 飛在哪裡無關。同一時刻必然有些子彈在圓盤前、有些在後，一個 draw call
 * 不可能同時排對，所以「把順序排正確」這個選項根本不存在。
 *
 * 於是選一個對常見情形正確的固定順序：子彈**在圓盤後方**時，圓盤最後畫、
 * 22% 混合上去，那正是應該看到的樣子。代價是「子彈在圓盤與相機之間」時
 * 會被蓋上 22% 的顏色 —— 少見，而且不刺眼。
 *
 * 【為什麼是 10】任何正數都可以（全專案只有天空球設過 renderOrder，而它是
 * −1000）。取 10 是留位子給日後可能插進來的東西。
 */
export const PROP_DISC_RENDER_ORDER = 10

/**
 * 建立一副空機體，回傳各種「把零件裝上去」的方法。
 *
 * 外層 group 留給 main.ts 寫入物理位置與姿態；內層 group 承擔重心位移。
 */
export function createHull(spec: HullSpec) {
  const group = new Group()
  const hull = new Group()
  hull.position.z = spec.offsetZ
  group.add(hull)

  const body = new MeshStandardMaterial({
    color: spec.bodyColor, flatShading: true, roughness: 0.75,
  })
  const accent = new MeshStandardMaterial({
    color: spec.accentColor, flatShading: true, roughness: 0.6,
  })
  /**
   * 【`depthWrite: false` 非有不可】半透明的東西寫深度緩衝，等於把後面的
   * 東西**整條丟掉**而不是混合出來 —— 一片 45% 的座艙罩會讓它後面的曳光彈
   * 完全消失。專案裡其他每一個透明材質（曳光彈、槍焰、火球、煙、噴濺、
   * 火花、水柱）都是這樣寫的；這兩個是 M1 留下的，比那條慣例更早。
   *
   * `depthTest` 仍然開著，所以不透明的機體照樣擋得住它們。
   */
  const glass = new MeshStandardMaterial({
    color: 0x9fd4e8, flatShading: true, transparent: true, opacity: 0.45,
    roughness: 0.2, depthWrite: false,
  })
  /**
   * 模糊圓盤的材質。
   *
   * 【`side: DoubleSide` 非有不可】`CircleGeometry` 的法線指 +Z，而機首朝
   * −Z —— 預設的 `FrontSide` 讓圓盤**只有從飛機後方才畫得出來**。而
   * `setPropSpin` 在 blurred 時會把槳葉全部藏起來（見下方），所以油門一過
   * 0.15，從前方或斜前方看螺旋槳就整個不存在。
   *
   * 座艙相機永遠在圓盤後方，所以這個缺陷從 M1 活到上帝視角才被看見 ——
   * 那是第一個會從機頭方向看自己飛機的視角。
   */
  const blur = new MeshStandardMaterial({
    color: 0xc8d0d8, transparent: true, opacity: 0.22, roughness: 0.5,
    depthWrite: false, side: DoubleSide,
  })
  /** 座艙內裝：機身開口下方的暗色內殼，見 buildCockpitTub。 */
  const cockpitMat = new MeshStandardMaterial({ color: 0x191d1a, roughness: 0.95 })
  /**
   * 機身色，但**兩面都畫**。
   *
   * 【為什麼非有不可】玻璃的骨架（`buildFrames`）是一條條窄帶 —— 一片面只有
   * 一個朝向，背面被剔除就整條消失。而 He 111 的機首是**整個透明**的，於是
   * 從機外看得到對側的骨架，而對側骨架給你看的正是它的背面：專案負責人
   * 回報的「從背面看支架是透明的」。
   *
   * `DoubleSide` 下 three.js 會替背面翻轉法線（`gl_FrontFacing`），所以打光
   * 仍然正確，不會變成一條黑帶。
   *
   * 【為什麼不改 `body`】機身外殼、機翼、發動機艙都是封閉實體，開雙面只是
   * 讓 GPU 白畫一份看不見的內面。窄帶才需要。
   */
  const bothSides = new MeshStandardMaterial({
    color: spec.bodyColor, flatShading: true, roughness: 0.75, side: DoubleSide,
  })

  const disposables: { dispose(): void }[] = [body, accent, glass, blur, cockpitMat, bothSides]
  const add = (mesh: Mesh): Mesh => {
    disposables.push(mesh.geometry)
    hull.add(mesh)
    return mesh
  }

  /**
   * 翼板的合併分組編號 —— **每一次 `wingPair` 呼叫各自一組**。
   *
   * 【為什麼不能全部併成一組】一架有好幾對翼板（主翼、翼根整流、平尾），
   * 併成一塊之後「哪一個 mesh 是主翼」就認不出來了，而
   * `geometry.test.ts` 的「四分之一弦線壓在重心上」正是靠主翼的翼根弦量的。
   * 逐呼叫分組讓每一對仍然是一個 mesh，那條不變量量得到的東西與合併前一樣。
   */
  let wingGroup = 0

  /** 標記一對翼板屬於哪一次 `wingPair`。見 `mergeStatic`。 */
  const wingPanel = (mesh: Mesh, group: number): Mesh => {
    mesh.userData['part'] = `wing${group}`
    return mesh
  }

  /**
   * 全部的螺旋槳組。**是一個陣列而不是一個**，因為 He 111 是雙發。
   *
   * 【原本是一個被覆寫的閉包】`propeller()` 每次呼叫都把 `setPropSpin`
   * 整個換掉 —— 對單發機沒差，但雙發時第二次呼叫會把第一具的驅動丟掉，
   * 症狀是**左邊那具螺旋槳永遠不轉**（而且它靜止時看起來只是「還沒起動」，
   * 不像壞掉）。
   */
  const props: { hub: Group; disc: Mesh; blades: Mesh[] }[] = []

  /**
   * 碗狀凹槽的內壁。**暗色而且兩面都畫。**
   *
   * 【為什麼一定要雙面】凹槽是一根朝前開口、法線朝外的管子；從開口看進去，
   * 看到的是它的**內側**，也就是背面。單面材質下背面被剔除 —— 專案負責人
   * 回報的「側面內壁畫反了」。`gl_FrontFacing` 會替背面翻法線，所以內壁
   * 照樣有明暗，不是一片死黑。
   *
   * 【為什麼不與 `cockpitMat` 共用】座艙內裝是朝內的殼、法線本來就對，開了
   * 雙面只是白畫一份。而且那一份掛著 `inwardShell` 給護欄看。
   */
  const darkBothSides = new MeshStandardMaterial({
    color: 0x191d1a, roughness: 0.95, side: DoubleSide,
  })
  disposables.push(darkBothSides)

  /**
   * **把不會動的靜態零件按材質併成一個 `Mesh`。**
   *
   * 【它在買什麼】一架是三十幾個 `Mesh`，20v20 就是 1,220 次 draw call。
   * 併完 40 架省下約兩百次。
   *
   * 【為什麼只併「局部矩陣是單位矩陣」的】要併不同座標系的零件就得把變換烘進
   * 頂點（`clone().applyMatrix4(matrixWorld)`）。那一步一定改像素：CPU 用
   * float64 算完存成 float32，GPU 是 float32 矩陣乘 float32 頂點，最低位不同，
   * 三角形邊緣的像素必然翻動（Codex 2026-08-30 實跑 96 組有 82 組有 byte 差）。
   *
   * 單位矩陣的零件不必烘：併出來的 mesh 仍然掛在 `hull` 底下，世界矩陣一模
   * 一樣，頂點資料一個 bit 都沒動。代價是整流罩、凸出物那一批（`scale` ＋
   * `position` 的 `BoxGeometry`）併不進來。
   *
   * 【半透明不併】它們要逐物件排序，併起來就失去排序。
   *
   * 【分組鑰匙要帶屬性簽名】`mergeGeometries` 對混用 indexed／non-indexed 會
   * 直接回 `null`。目前四個機種全部是 `normal,position` 的 non-indexed，但加
   * 一個帶 uv 的零件就會踩到。
   *
   * 【視錐剔除由逐 mesh 變成逐合併塊】半出畫面的飛機會整塊畫 —— 那是**多畫**
   * 不是少畫，畫面不變；而一架戰鬥機也才 2,700 個三角形。
   */
  const mergeStatic = (): void => {
    const moving = new Set<Object3D>()
    for (const p of props) p.hub.traverse((o) => moving.add(o))
    const I = new Matrix4()
    const groups = new Map<string, Mesh[]>()
    for (const child of hull.children) {
      const mesh = child as Mesh
      if (!mesh.isMesh || moving.has(mesh)) continue
      if ((mesh.material as Material).transparent) continue
      if (!mesh.matrix.equals(I)) continue
      const attrs = Object.keys(mesh.geometry.attributes).sort().join(',')
      const part = mesh.userData['part'] ?? ''
      const key = `${(mesh.material as Material).uuid}|${attrs}`
        + `|${mesh.geometry.index ? 'i' : 'n'}|${String(part)}`
      const list = groups.get(key)
      if (list) list.push(mesh)
      else groups.set(key, [mesh])
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue
      const merged = mergeGeometries(list.map((m) => m.geometry), false)
      if (merged === null) throw new Error('mergeGeometries 回 null：屬性集合不一致')
      for (const m of list) {
        hull.remove(m)
        const at = disposables.indexOf(m.geometry)
        if (at >= 0) disposables.splice(at, 1)
        m.geometry.dispose()
      }
      const mesh = new Mesh(merged, list[0]!.material)
      mesh.userData['merged'] = true
      const part = list[0]!.userData['part']
      if (part !== undefined) mesh.userData['part'] = part
      disposables.push(merged)
      hull.add(mesh)
    }
  }

  const api = {
    body, accent, glass, add,
    /** 暗色內襯。玻璃後面用的就是它。 */
    dark: cockpitMat,
    /** 碗狀凹槽的內壁（暗色、雙面）。進氣口裡面用的是它。 */
    darkInner: darkBothSides,

    /** 管狀部件（機身、氣泡座艙罩、散熱器導管）。 */
    loft(part: LoftPart, mat: MeshStandardMaterial): Mesh {
      return add(new Mesh(
        buildFuselage(part.sections, part.segments, part.roundness, part.caps, part.arc), mat,
      ))
    },

    /**
     * 烘焙好的機身外殼，並在座艙段挖開；連同開口下方的暗色內裝與玻璃罩。
     *
     * 三者共用同一組環（prepareRings 已把玻璃的站位補進去），所以開口邊緣、
     * 內裝上緣、玻璃下緣算的是**同一個交點**——機體與玻璃不會有縫。
     */
    cockpit(
      rings: readonly HullRing[], stations: readonly CanopyStation[], shape: CanopyShape,
    ): void {
      const cut: CockpitCut = { sill: stations.map((s) => [s.z, s.sill] as const) }
      add(new Mesh(buildHull(rings, cut).geometry, body))
      const tub = add(new Mesh(buildCockpitTub(rings, cut, 0.90, 0.08), cockpitMat))
      // 內裝是**朝內**的殼——從開口往下看要看得到它的內側。標記出來，
      // 免得「法線朝外」的檢查把這個刻意的方向當成缺陷。
      tub.userData['inwardShell'] = true
      add(new Mesh(buildCanopy(rings, stations, shape), glass))
    },

    /**
     * 全玻璃機首 —— 機身外殼在 `splitZ` 切成兩截，前段玻璃、後段機身色。
     *
     * 【為什麼不是「在機身上蓋一頂罩子」】另外兩台的座艙是「機身開一個口、
     * 蓋一頂罩子」，因為它們的玻璃確實是加在蒙皮上的一個零件。He 111 不是：
     * 2026-08-17 只切參考模型的 `windows` mesh 量到 ——
     *
     * ```
     *   機體Z    玻璃佔剖面   蒙皮腹底   玻璃腹底
     *   −2.75      93.1%       0.077      —（前端）
     *   −2.55      97.2%      −0.058     −0.058   ← 一模一樣
     *   −2.15      75.0%      −0.329     −0.329
     *   −1.75      62.5%      −0.491     −0.491
     *   −1.35      54.2%      −0.616      —
     *   −1.15       8.3%                        ← 玻璃結束
     * ```
     *
     * 玻璃的下緣**逐字等於蒙皮的下緣** —— 那一段機身沒有蒙皮，玻璃就是外殼。
     * 用罩子做出來的是「機背上一條窄玻璃 + 底下一大片綠漆」，而真機的機首
     * 是整個透明的。
     *
     * 【接縫的封口只留一張】見 `buildHull` 的 `caps`：玻璃那一截不封後端，
     * 機身那一截的前封口就是真機的隔框。
     */
    glazedNose(
      rings: readonly HullRing[], splitZ: number,
      /**
       * 機首之外的玻璃 —— 機背機槍座、機腹吊艙、機身側窗。
       *
       * 【為什麼它們不能也用切一刀的做法】機首是**整個剖面**都是玻璃，所以
       * 沿 z 切開就對了。這三塊只佔剖面的一小段角度（實測：機背是第 0～3 點、
       * 機腹是第 13～15 點、側窗是第 5～7 點），沿 z 切會把整圈都變成玻璃。
       */
      patches?: readonly GlassPatch[],
    ): void {
      const at = ringAt(rings, splitZ)
      const nose = [...rings.filter((r) => r.z < splitZ - 1e-6), at]
      const aft = [at, ...rings.filter((r) => r.z > splitZ + 1e-6)]
      /**
       * 【玻璃機首後面的黑色隔框】
       *
       * 玻璃是 45% 半透明而且 `depthWrite: false`，所以從機外看進去，光線
       * 穿過近側玻璃、穿過空的艙內、再穿過對側玻璃**看到天空**。
       *
       * 第一版是把整組環往內縮一份做成暗色內襯 —— 專案負責人否決：「機頭
       * 玻璃內不應該有一個黑色物體，機頭你用黑色剖面直接垂直連接玻璃與機身
       * 的位置就好。」縮小的殼從外面看就是**罩子裡飄著一個小飛機**。
       *
       * 現在只放一片東西：`splitZ` 前面 1 cm 的一片**整剖面**的黑板。它是
       * 真機的前隔框，把「看穿」擋在該擋的地方，而玻璃罩裡是空的。
       *
       * 【為什麼要前移 1 cm】後段外殼自己的前封口就在 `splitZ`，同一平面
       * 會閃爍。1 cm 在畫面上量不出來。
       */
      const BULKHEAD = 0.010
      add(new Mesh(buildHull(
        [{ z: at.z - BULKHEAD - 0.002, half: at.half }, { z: at.z - BULKHEAD, half: at.half }],
        undefined, { back: false },
      ).geometry, cockpitMat))
      add(new Mesh(buildHull(nose, undefined, { back: false }).geometry, glass))
      const rear = buildHull(aft, undefined, undefined, patches)
      add(new Mesh(rear.geometry, body))
      if (patches?.length) {
        add(new Mesh(rear.glassGeometry, glass))
        /**
         * 襯裡是實心的暗色殼，不是內裝 —— 它朝外，所以不掛 inwardShell。
         *
         * 【這一塊夠用，不要再加整圈的暗艙】2026-08-18 我以為它是一張浮片、
         * 斜看會從邊緣漏過去，還替每個補丁補了一圈整圈的內殼 —— 渲染出來
         * **一個像素都沒變**。把 `cockpitMat` 暫時改成純紅重跑，機背罩內整片
         * 是紅的：襯裡本來就擋住了。
         *
         * 罩內看起來偏亮（實測 (150,170,180)）不是漏光，是**玻璃自己**：45%
         * 不透明、顏色 0x9fd4e8、roughness 0.2，掠角下鏡面很強，那一半的貢獻
         * 就有這麼亮。要更黑只能動 `glass` 材質，而那是三台共用的觀感。
         */
        add(new Mesh(rear.glassBackGeometry, cockpitMat))
      }
    },

    /**
     * **直接給四個角**的平板玻璃。
     *
     * 【為什麼需要它】`GlassPatch` 是「z 範圍 × 環索引範圍」的矩形，貼出來的
     * 形狀由**網格**決定 —— 一格要嘛整格落在玻璃裡、要嘛不是玻璃。風擋是一片
     * 斜穿六個站位的四邊形，網格湊不出它的邊：前端那個銳角沒有一格整格落在
     * 裡面，兩片補丁的交界又對不齊，算圖上就是缺角加糊出去。
     *
     * 這裡反過來：**玻璃是輸入**。四個角照量到的值擺，兩個三角形，沿法線
     * 外推 `lift` 讓它浮在蒙皮上一點點（蒙皮在那一段本來就烘在同一個平面上，
     * 不推的話 z-fighting）。蒙皮留成金屬 —— 它是玻璃後面的結構，透過 45%
     * 的玻璃看出去正好。
     *
     * 【纏繞方向】頂點照 A→B→C→D 給，(A,B,C) 的法線就是平面的外法線；反了
     * 的話正面被剔除，從機外看整片消失。
     */
    flatGlass(quads: readonly (readonly (readonly [number, number, number])[])[],
      lift = 0.004): void {
      const pos: number[] = []
      for (const q of quads) {
        const [a, b, c] = [q[0]!, q[1]!, q[2]!]
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0]]
        const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1
        const off = n.map((t) => (t / len) * lift)
        const put = (p: readonly [number, number, number]): void => {
          pos.push(p[0] + off[0]!, p[1] + off[1]!, p[2] + off[2]!)
        }
        put(q[0]!); put(q[1]!); put(q[2]!)
        put(q[0]!); put(q[2]!); put(q[3]!)
      }
      const g = new BufferGeometry()
      g.setAttribute('position', new Float32BufferAttribute(pos, 3))
      g.computeVertexNormals()
      add(new Mesh(g, glass))
    },

    /**
     * **直接給一圈緣**的碗狀暗色內襯 —— 玻璃後面的艙、進氣口裡的凹槽。
     *
     * 【為什麼不能沿用 `glassBackGeometry`】那一份是「補丁覆蓋的那串頂點搬到
     * 兩端的**弦**上」。弦要成立，補丁在環向上得跨好幾格；風擋只跨兩格
     * （索引 1→2、2→3），弦幾乎就是蒙皮自己 —— 做出來是一片貼著機殼隆起的
     * 暗色薄板，而且下緣還會從蒙皮戳出去。專案負責人：「駕駛玻璃內的黑碗
     * 應該要內凹」。
     *
     * 玻璃既然已經是**輸入**（`flatGlass`），它後面的碗就該由同一組角決定：
     *
     * ```
     *   緣    = 傳進來的那一圈點（風擋就是那四個角，與玻璃逐點重合）
     *   碗底  = 形心再往內 depth
     *   中間  = 往形心收 t、往內沉 depth·t(2−t)（在緣上切線與緣共面，不起稜）
     * ```
     *
     * 【材質是 `darkInner`】雙面。碗是從**開口那一側**看進去的，看到的是
     * 內面；單面材質下背面被剔除，整個碗消失（坑 23 的第一種錯法）。雙面
     * 就不必去推纏繞方向該是哪一邊。
     */
    bowl(rim: readonly (readonly [number, number, number])[], depth: number,
      rings = 3): void {
      const m = rim.length
      const c = [0, 0, 0]
      for (const p of rim) { c[0]! += p[0] / m; c[1]! += p[1] / m; c[2]! += p[2] / m }
      // Newell 法線：不必假設緣是平的（進氣口那一圈就不是）
      const n = [0, 0, 0]
      for (let i = 0; i < m; i++) {
        const a = rim[i]!, b = rim[(i + 1) % m]!
        n[0]! += (a[1] - b[1]) * (a[2] + b[2])
        n[1]! += (a[2] - b[2]) * (a[0] + b[0])
        n[2]! += (a[0] - b[0]) * (a[1] + b[1])
      }
      const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1
      const at = (k: number, i: number): number[] => {
        const t = k / rings
        const d = depth * t * (2 - t)
        const p = rim[i % m]!
        return [0, 1, 2].map((j) =>
          p[j]! + (c[j]! - p[j]!) * t - (n[j]! / len) * d)
      }
      const pos: number[] = []
      const put = (p: readonly number[]): void => { pos.push(p[0]!, p[1]!, p[2]!) }
      for (let k = 0; k < rings; k++) {
        for (let i = 0; i < m; i++) {
          const a = at(k, i), b = at(k, i + 1)
          // 最後一圈收在碗底那一點，只吐一個三角形——不然是一整排零面積的面，
          // `computeVertexNormals` 會在那裡吐出 NaN 法線。
          if (k === rings - 1) { put(a); put(b); put(at(rings, 0)); continue }
          const d = at(k + 1, i), e = at(k + 1, i + 1)
          put(a); put(b); put(e)
          put(a); put(e); put(d)
        }
      }
      const g = new BufferGeometry()
      g.setAttribute('position', new Float32BufferAttribute(pos, 3))
      g.computeVertexNormals()
      add(new Mesh(g, darkBothSides))
    },

    /**
     * 玻璃的骨架（隔框 + 桁條）。機身色 —— 它是結構不是裝飾。
     *
     * 【材質是 `bothSides`】窄帶只有一個朝向，而全玻璃機首讓你從機外看到
     * **對側骨架的背面**。見那個材質的註解。
     */
    frames(rings: readonly HullRing[], spec: FrameSpec): void {
      add(new Mesh(buildFrames(rings, spec), bothSides))
    },

    /** 左右成對的翼面（主翼、水平尾翼）。 */
    wingPair(p: WingParams): void {
      // 【逐呼叫各自一組】見 `wingGroup`。
      const g = wingGroup++
      add(wingPanel(new Mesh(buildWingPanel(p, false), body), g))
      add(wingPanel(new Mesh(buildWingPanel(p, true), body), g))
    },

    /**
     * 垂直安定面／背鰭：水平翼面板繞 Z 軸立起 90°（+X → +Y）。
     *
     * 【`tipThickness` 是 2026-08-18 為 B-17G 加的】不給的話 `buildWingPanel`
     * 退回「厚弦比固定」，而垂尾要疊好幾片來配一條凹的前緣時，每一片的弦長
     * 比都很大 —— 背鰭那片 5.218/14.295，厚度會被收到 0.183，而量到的是
     * 0.468。層與層之間於是差一倍，側視是一疊階梯。
     */
    upright(
      f: FinParams, thickness: number, tipRound?: number, tipThickness?: number,
    ): void {
      const mesh = new Mesh(buildWingPanel({
        rootChord: f.chordRoot, tipChord: f.chordTip, halfSpan: f.height,
        sweep: f.sweep, dihedral: 0, thickness, rootZ: f.z, rootY: 0,
        ...(tipRound === undefined ? {} : { tipRound }),
        ...(tipThickness === undefined ? {} : { tipThickness }),
        ...(f.breaks === undefined ? {} : { breaks: f.breaks }),
      }, false), body)
      // 面板繞 Z 轉 90° 後，它自己的 rootY 會變成 X 向偏移，所以垂直位置
      // 必須由 mesh.position.y 承擔，不能寫進 WingParams.rootY。
      mesh.rotation.z = 90 * DEG
      mesh.position.y = f.rootY ?? 0
      add(mesh)
    },

    blisters(list: readonly Blister[]): void {
      const one = (b: Blister, sx: number) => {
        const geo = b.round
          // 8×4 分段：6×3 在側視會讀成截頭金字塔，稜線太少撐不出「鼓」的感覺
          ? new SphereGeometry(0.5, 8, 4)
          : new BoxGeometry(1, 1, 1)
        const mesh = new Mesh(geo, b.bodyColor ? body : accent)
        mesh.scale.set(b.width, b.height, b.length)
        mesh.position.set(sx * b.x, b.y, b.z)
        if (b.rotZ) mesh.rotation.z = sx * b.rotZ
        add(mesh)
      }
      for (const b of list) {
        one(b, 1)
        if (b.mirror) one(b, -1)
      }
    },

    /**
     * 整流罩 + 槳葉 + 模糊圓盤。`noseZ` 是機身首站的 Z，`p.noseZ` 可以覆寫它
     * （掛在機翼上的發動機艙用），`p.x` 給橫向位置。
     *
     * **可以呼叫多次** —— 每一具各自登記，`setPropSpin` 一起驅動。
     */
    propeller(p: PropSpec, noseZ: number): void {
      const px = p.x ?? 0
      const tip = p.noseZ ?? noseZ
      // 圓錐預設沿 +Y、頂點在上，繞 X 轉 −90° 讓頂點指向 −Z（機首）。
      const spinner = new Mesh(new ConeGeometry(p.spinnerRadius, p.spinnerLength, 8), accent)
      spinner.rotation.x = -90 * DEG
      spinner.position.set(px, p.spinnerY, tip - p.spinnerLength / 2)
      add(spinner)

      // 槳葉：從整流罩外緣長到槳尖的**單片**葉片。
      // 【原本是貫穿直徑的長條】三根長條在畫面上是六片槳葉；真機 P-51D
      // 四葉、Bf 109 三葉，葉數是辨識機種的線索之一。
      const propHub = new Group()
      propHub.position.set(px, p.spinnerY, p.propZ)
      const bladeRoot = p.spinnerRadius * 0.8
      const bladeLength = p.propRadius - bladeRoot
      const blades: Mesh[] = []
      for (let i = 0; i < p.blades; i++) {
        const blade = new Mesh(new BoxGeometry(0.16, bladeLength, 0.05), accent)
        // 葉片自己偏離軸心，再由 arm 繞軸排開；直接把 Mesh 收進 blades 以便
        // 切換可見性——藏 arm（Group）不會改變子 Mesh 自身的 visible 旗標。
        blade.position.y = bladeRoot + bladeLength / 2
        const arm = new Group()
        arm.rotation.z = (i / p.blades) * Math.PI * 2
        arm.add(blade)
        disposables.push(blade.geometry)
        propHub.add(arm)
        // 槳葉與模糊圓盤掃出的是一個半徑 1.7 m 的圓面。那是動畫，不是命中面
        // ——命中盒的覆蓋率測試（test/unit/hitbox.test.ts）要靠這個旗標排除
        // 它們，否則得在機首前方擺一個 3.4 × 3.4 m 的盒子。
        blade.userData['spinning'] = true
        blades.push(blade)
      }
      const disc = new Mesh(new CircleGeometry(p.propRadius, 16), blur)
      disc.visible = false
      disc.renderOrder = PROP_DISC_RENDER_ORDER
      disc.userData['spinning'] = true
      disposables.push(disc.geometry)
      propHub.add(disc)
      hull.add(propHub)

      props.push({ hub: propHub, disc, blades })
    },

    /** 收尾：量出 HullMetrics 並組成 AircraftModel。 */
    finish(): AircraftModel {
      group.updateMatrixWorld(true)
      mergeStatic()
      const v = new Vector3()
      let noseZ = Infinity
      let maxAbsX = 0
      const verts: { mesh: Mesh; i: number }[] = []
      group.traverse((o) => {
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
        // 機首尖端：離最前端 3 cm 以內的頂點，上下取中即整流罩軸心
        if (v.z < noseZ + 0.03) { noseLo = Math.min(noseLo, v.y); noseHi = Math.max(noseHi, v.y) }
      }
      return {
        group,
        eyePoint: new Vector3(spec.eyePoint.x, spec.eyePoint.y, spec.eyePoint.z + spec.offsetZ),
        wingTip: new Vector3(spec.wingTip.x, spec.wingTip.y, spec.wingTip.z + spec.offsetZ),
        metrics: {
          realLength: spec.realLength, noseZ,
          noseY: (noseLo + noseHi) / 2,
          tipY: n ? sum / n : 0,
        },
        setPropSpin: (r, b) => {
          for (const p of props) {
            p.hub.rotation.z = r
            p.disc.visible = b
            for (const blade of p.blades) blade.visible = !b
          }
        },
        dispose() {
          for (const d of disposables) d.dispose()
        },
      }
    },
  }
  return api
}
