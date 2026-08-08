import {
  BoxGeometry, CircleGeometry, ConeGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial,
  SphereGeometry, Vector3,
} from 'three'
import { DEG } from '../../core/math'
import { buildFuselage, type FuselageSection } from './fuselage'
import { buildCanopy, type CanopyShape, type CanopyStation } from './canopy'
import { buildCockpitTub, buildHull, type CockpitCut, type HullRing } from './hull'
import { buildWingPanel, type WingParams } from './wing'

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
  /** 槳葉數：P-51D 四葉、Bf 109 三葉 */
  blades: number
  propZ: number
  propRadius: number
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
const PROP_DISC_RENDER_ORDER = 10

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

  const disposables: { dispose(): void }[] = [body, accent, glass, blur, cockpitMat]
  const add = (mesh: Mesh): Mesh => {
    disposables.push(mesh.geometry)
    hull.add(mesh)
    return mesh
  }

  let setPropSpin: AircraftModel['setPropSpin'] = () => {}

  const api = {
    body, accent, glass, add,

    /** 管狀部件（機身、氣泡座艙罩、散熱器導管）。 */
    loft(part: LoftPart, mat: MeshStandardMaterial): Mesh {
      return add(new Mesh(buildFuselage(part.sections, part.segments, part.roundness), mat))
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

    /** 左右成對的翼面（主翼、水平尾翼）。 */
    wingPair(p: WingParams): void {
      add(new Mesh(buildWingPanel(p, false), body))
      add(new Mesh(buildWingPanel(p, true), body))
    },

    /** 垂直安定面／背鰭：水平翼面板繞 Z 軸立起 90°（+X → +Y）。 */
    upright(f: FinParams, thickness: number, tipRound?: number): void {
      const mesh = new Mesh(buildWingPanel({
        rootChord: f.chordRoot, tipChord: f.chordTip, halfSpan: f.height,
        sweep: f.sweep, dihedral: 0, thickness, rootZ: f.z, rootY: 0,
        ...(tipRound === undefined ? {} : { tipRound }),
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

    /** 整流罩 + 槳葉 + 模糊圓盤。noseZ 是機身首站的 Z。 */
    propeller(p: PropSpec, noseZ: number): void {
      // 圓錐預設沿 +Y、頂點在上，繞 X 轉 −90° 讓頂點指向 −Z（機首）。
      const spinner = new Mesh(new ConeGeometry(p.spinnerRadius, p.spinnerLength, 8), accent)
      spinner.rotation.x = -90 * DEG
      spinner.position.set(0, p.spinnerY, noseZ - p.spinnerLength / 2)
      add(spinner)

      // 槳葉：從整流罩外緣長到槳尖的**單片**葉片。
      // 【原本是貫穿直徑的長條】三根長條在畫面上是六片槳葉；真機 P-51D
      // 四葉、Bf 109 三葉，葉數是辨識機種的線索之一。
      const propHub = new Group()
      propHub.position.set(0, p.spinnerY, p.propZ)
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

      setPropSpin = (rotation, blurred) => {
        propHub.rotation.z = rotation
        disc.visible = blurred
        for (const b of blades) b.visible = !blurred
      }
    },

    /** 收尾：量出 HullMetrics 並組成 AircraftModel。 */
    finish(): AircraftModel {
      group.updateMatrixWorld(true)
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
        metrics: {
          realLength: spec.realLength, noseZ,
          noseY: (noseLo + noseHi) / 2,
          tipY: n ? sum / n : 0,
        },
        setPropSpin: (r, b) => setPropSpin(r, b),
        dispose() {
          for (const d of disposables) d.dispose()
        },
      }
    },
  }
  return api
}
