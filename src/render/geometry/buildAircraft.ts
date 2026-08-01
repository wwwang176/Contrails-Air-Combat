import {
  BoxGeometry, CircleGeometry, ConeGeometry, Group, Mesh, MeshStandardMaterial,
} from 'three'
import { DEG } from '../../core/math'
import { buildFuselage } from './fuselage'
import { buildWingPanel } from './wing'
import {
  SILHOUETTES, hullOffsetZ, type Blister, type FinParams, type LoftPart,
} from './silhouettes'
import type { AircraftSpec } from '../../specs/types'

export interface AircraftModel {
  group: Group
  /** rotation 為累積弧度；blurred 為 true 時切換為半透明圓盤 */
  setPropSpin(rotation: number, blurred: boolean): void
  dispose(): void
}

/**
 * 程序化機體幾何。
 *
 * 【為什麼沒有可動舵面】原本副翼／升降舵／方向舵是三組可旋轉的 Group，由
 * setSurfaces 依控制指令偏轉。專案負責人實測後裁決移除：遊戲中的觀看距離
 * （追尾相機 26 m、空戰對手更遠）下，22° 的舵面偏轉在畫面上不到一個像素，
 * 看不出來。省下的 48 個三角形改投入看得見的地方——機身剖面、座艙罩形狀、
 * 機首整流罩與各機種的識別特徵。
 */
export function buildAircraft(spec: AircraftSpec): AircraftModel {
  const sil = SILHOUETTES[spec.id]
  if (!sil) throw new Error(`未定義機種外型：${spec.id}`)

  const group = new Group()
  // 造型座標的原點是隨手訂的，機體座標的原點必須是**重心**。內層 group
  // 承擔這個位移，外層 group 留給 main.ts 寫入物理位置與姿態。
  const hull = new Group()
  hull.position.z = hullOffsetZ(sil)
  group.add(hull)

  const body = new MeshStandardMaterial({ color: sil.bodyColor, flatShading: true, roughness: 0.75 })
  const accent = new MeshStandardMaterial({ color: sil.accentColor, flatShading: true, roughness: 0.6 })
  const glass = new MeshStandardMaterial({
    color: 0x9fd4e8, flatShading: true, transparent: true, opacity: 0.45, roughness: 0.2,
  })
  const blur = new MeshStandardMaterial({
    color: 0xc8d0d8, transparent: true, opacity: 0.22, roughness: 0.5,
  })

  const disposables: { dispose(): void }[] = [body, accent, glass, blur]
  const add = (mesh: Mesh) => {
    disposables.push(mesh.geometry)
    hull.add(mesh)
    return mesh
  }
  const loft = (part: LoftPart, mat: MeshStandardMaterial) =>
    add(new Mesh(buildFuselage(part.sections, part.segments, part.roundness), mat))

  loft(sil.fuselage, body)
  loft(sil.canopy, glass)
  if (sil.scoop) loft(sil.scoop, accent)

  // 主翼與水平尾翼皆為全翼展固定翼面（見上方「為什麼沒有可動舵面」）。
  add(new Mesh(buildWingPanel(sil.wing, false), body))
  add(new Mesh(buildWingPanel(sil.wing, true), body))
  add(new Mesh(buildWingPanel(sil.tailplane, false), body))
  add(new Mesh(buildWingPanel(sil.tailplane, true), body))

  // 垂直安定面與背鰭：都是水平翼面板繞 Z 軸立起 90°（+X → +Y）。
  const upright = (f: FinParams, thickness: number, tipRound?: number) => {
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
  }
  // 垂尾頂端是圓的；背鰭是整流罩不是翼面，維持方角
  upright(sil.fin, 0.12, 0.35)
  if (sil.finFillet) upright(sil.finFillet, 0.22)

  const addBlister = (b: Blister, sx: number) => {
    const mesh = new Mesh(
      new BoxGeometry(b.width, b.height, b.length), b.bodyColor ? body : accent,
    )
    mesh.position.set(sx * b.x, b.y, b.z)
    if (b.rotZ) mesh.rotation.z = sx * b.rotZ
    add(mesh)
  }
  for (const b of sil.blisters) {
    addBlister(b, 1)
    if (b.mirror) addBlister(b, -1)
  }

  // 螺旋槳整流罩：圓錐預設沿 +Y、頂點在上，繞 X 轉 −90° 讓頂點指向 −Z（機首）。
  const spinner = new Mesh(
    new ConeGeometry(sil.spinner.radius, sil.spinner.length, 8), accent,
  )
  spinner.rotation.x = -90 * DEG
  spinner.position.set(0, sil.spinner.y ?? 0, sil.fuselage.sections[0]!.z - sil.spinner.length / 2)
  add(spinner)

  // 槳葉：從整流罩外緣長到槳尖的**單片**葉片。
  // 【原本是貫穿直徑的長條】三根長條在畫面上是六片槳葉；真機 P-51D 四葉、
  // Bf 109 三葉，葉數是辨識機種的線索之一。
  const propHub = new Group()
  propHub.position.set(0, sil.spinner.y ?? 0, sil.propZ)
  const bladeRoot = sil.spinner.radius * 0.8
  const bladeLength = sil.propRadius - bladeRoot
  const blades: Mesh[] = []
  for (let i = 0; i < sil.propBlades; i++) {
    const blade = new Mesh(new BoxGeometry(0.16, bladeLength, 0.05), accent)
    // 葉片自己偏離軸心，再由 arm 繞軸排開；直接把 Mesh 收進 blades 以便
    // 切換可見性——藏 arm（Group）不會改變子 Mesh 自身的 visible 旗標。
    blade.position.y = bladeRoot + bladeLength / 2
    const arm = new Group()
    arm.rotation.z = (i / sil.propBlades) * Math.PI * 2
    arm.add(blade)
    disposables.push(blade.geometry)
    propHub.add(arm)
    blades.push(blade)
  }
  const propDisc = new Mesh(new CircleGeometry(sil.propRadius, 16), blur)
  propDisc.visible = false
  disposables.push(propDisc.geometry)
  propHub.add(propDisc)
  hull.add(propHub)

  return {
    group,
    setPropSpin(rotation, blurred) {
      propHub.rotation.z = rotation
      propDisc.visible = blurred
      for (const b of blades) b.visible = !blurred
    },
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}
