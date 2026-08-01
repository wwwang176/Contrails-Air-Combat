import {
  BoxGeometry, CircleGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry,
} from 'three'
import { DEG, clamp } from '../../core/math'
import { buildFuselage } from './fuselage'
import { buildWingPanel } from './wing'
import { SILHOUETTES } from './silhouettes'
import type { AircraftSpec } from '../../specs/types'

const MAX_SURFACE_DEFLECTION = 22 * DEG

export interface AircraftModel {
  group: Group
  /** 舵面偏轉，輸入為 −1..1 的指令值 */
  setSurfaces(aileron: number, elevator: number, rudder: number): void
  /** rotation 為累積弧度；blurred 為 true 時切換為半透明圓盤 */
  setPropSpin(rotation: number, blurred: boolean): void
  dispose(): void
}

export function buildAircraft(spec: AircraftSpec): AircraftModel {
  const sil = SILHOUETTES[spec.id]
  if (!sil) throw new Error(`未定義機種外型：${spec.id}`)

  const group = new Group()
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
    group.add(mesh)
    return mesh
  }

  add(new Mesh(buildFuselage(sil.fuselage, 8), body))

  // 主翼：固定內段 + 可動副翼（外段）
  const wingInner = { ...sil.wing, halfSpan: sil.wing.halfSpan * 0.62 }
  add(new Mesh(buildWingPanel(wingInner, false), body))
  add(new Mesh(buildWingPanel(wingInner, true), body))

  const aileronSpan = sil.wing.halfSpan * 0.38
  const makeAileron = (mirrored: boolean) => {
    const pivot = new Group()
    const sx = mirrored ? -1 : 1
    pivot.position.set(
      sx * wingInner.halfSpan,
      sil.wing.rootY + Math.tan(sil.wing.dihedral) * wingInner.halfSpan,
      sil.wing.rootZ - Math.tan(sil.wing.sweep) * wingInner.halfSpan + sil.wing.rootChord * 0.78,
    )
    const chord = sil.wing.tipChord * 0.42
    const mesh = new Mesh(new BoxGeometry(aileronSpan, sil.wing.thickness * 0.7, chord), accent)
    mesh.position.set((sx * aileronSpan) / 2, 0, chord / 2)
    disposables.push(mesh.geometry)
    pivot.add(mesh)
    group.add(pivot)
    return pivot
  }
  const aileronR = makeAileron(false)
  const aileronL = makeAileron(true)

  // 水平尾翼 + 升降舵
  add(new Mesh(buildWingPanel(sil.tailplane, false), body))
  add(new Mesh(buildWingPanel(sil.tailplane, true), body))
  const elevatorPivot = new Group()
  elevatorPivot.position.set(0, sil.tailplane.rootY, sil.tailplane.rootZ + sil.tailplane.rootChord * 0.72)
  const elevatorMesh = new Mesh(
    new BoxGeometry(sil.tailplane.halfSpan * 2, sil.tailplane.thickness * 0.8, sil.tailplane.rootChord * 0.34),
    accent,
  )
  elevatorMesh.position.z = (sil.tailplane.rootChord * 0.34) / 2
  disposables.push(elevatorMesh.geometry)
  elevatorPivot.add(elevatorMesh)
  group.add(elevatorPivot)

  // 垂直安定面（以水平翼面板旋轉 90° 立起）+ 方向舵
  const finPanel = buildWingPanel({
    rootChord: sil.fin.chordRoot, tipChord: sil.fin.chordTip, halfSpan: sil.fin.height,
    sweep: sil.fin.sweep, dihedral: 0, thickness: 0.12, rootZ: sil.fin.z, rootY: 0,
  }, false)
  const fin = new Mesh(finPanel, body)
  fin.rotation.z = 90 * DEG
  add(fin)

  const rudderPivot = new Group()
  rudderPivot.position.set(0, 0.2, sil.fin.z + sil.fin.chordRoot * 0.74)
  const rudderMesh = new Mesh(
    new BoxGeometry(0.12, sil.fin.height * 0.85, sil.fin.chordRoot * 0.30), accent,
  )
  rudderMesh.position.set(0, sil.fin.height * 0.45, (sil.fin.chordRoot * 0.30) / 2)
  disposables.push(rudderMesh.geometry)
  rudderPivot.add(rudderMesh)
  group.add(rudderPivot)

  // 座艙罩：淚滴形用球體壓扁，方框形用箱體
  const canopy = sil.canopy.teardrop
    ? new Mesh(new SphereGeometry(1, 10, 6), glass)
    : new Mesh(new BoxGeometry(1, 1, 1), glass)
  canopy.scale.set(sil.canopy.halfWidth, sil.canopy.height, sil.canopy.length / 2)
  canopy.position.set(0, 0.62, sil.canopy.z)
  add(canopy)

  // 散熱器 / 進氣口
  const intake = new Mesh(new BoxGeometry(1, 1, 1), accent)
  intake.scale.set(sil.intake.halfWidth * 2, sil.intake.height, sil.intake.length)
  intake.position.set(0, sil.intake.centerY, sil.intake.z)
  add(intake)

  // 螺旋槳：三葉 + 轉動圓盤
  const propHub = new Group()
  propHub.position.z = sil.propZ
  for (let i = 0; i < 3; i++) {
    const blade = new Mesh(new BoxGeometry(0.14, sil.propRadius * 2, 0.05), accent)
    blade.rotation.z = (i / 3) * Math.PI * 2
    disposables.push(blade.geometry)
    propHub.add(blade)
  }
  const propDisc = new Mesh(new CircleGeometry(sil.propRadius, 16), blur)
  propDisc.visible = false
  disposables.push(propDisc.geometry)
  propHub.add(propDisc)
  group.add(propHub)
  const blades = propHub.children.filter((c) => c !== propDisc)

  return {
    group,
    setSurfaces(aileron, elevator, rudder) {
      const a = clamp(aileron, -1, 1) * MAX_SURFACE_DEFLECTION
      // 副翼差動：右滾時右副翼上、左副翼下
      aileronR.rotation.x = -a
      aileronL.rotation.x = a
      elevatorPivot.rotation.x = -clamp(elevator, -1, 1) * MAX_SURFACE_DEFLECTION
      rudderPivot.rotation.y = -clamp(rudder, -1, 1) * MAX_SURFACE_DEFLECTION
    },
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
