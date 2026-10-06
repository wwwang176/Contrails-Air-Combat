import {
  BufferAttribute, BufferGeometry, DoubleSide, Group, type Material,
  Mesh, MeshBasicMaterial, Vector3,
} from 'three'
import { DEG } from '../core/math'
import { barrelGeometry } from '../render/turretBarrels'
import { BARREL_SPACING } from '../world/turrets'
import { turretPivot, wobbleBasis } from '../weapons/turret'
import { SHIP_AA_ARC_DEFAULTS, SHIP_AA_ZONES, type ShipAAZone } from '../world/shipAA'
import type { AircraftSpec } from '../specs/types'

/**
 * 砲塔的槍管，畫在**靜止位置**（`turret.axis`）上。
 *
 * 【為什麼機庫要畫它】槍管在遊戲裡是由 combatant 狀態驅動的
 * `InstancedMesh`，機庫沒有 combatant。但砲塔位置最需要用眼睛驗，而
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
export function disposeBarrels(g: Group): void {
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

export function buildBarrels(spec: Pick<AircraftSpec, 'turrets'>): Group {
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

/**
 * 射界錐的**斜邊**長度，m。
 *
 * 【為什麼是斜邊而不是軸向長度】半角 80° 的錐（球形腹部與上部砲塔）用
 * 「軸向長度 × tan」算半徑會得到 5.67 倍 —— 一個橫跨半個機庫的大盤子。
 * 用斜邊參數化的話，錐緣恆在離頂點 `ARC_LENGTH` 的球面上：80° 的錐是一個
 * 又寬又淺的碗（軸向只有 0.17 倍），那才是 80° 真正的樣子。
 */
const ARC_LENGTH = 8
/** 錐緣的分段數。24 段在 80° 的大錐上也看不出稜。 */
const ARC_SEGMENTS = 24

/**
 * 一個射界錐的側面 —— 頂點在原點、繞 **+Z**、半角 `half`、斜邊 `ARC_LENGTH`。
 *
 * 只畫側面不封底：封了之後從錐內往外看是一片不透明的蓋子，而「站在砲塔的
 * 位置往外看射界」正是這個開關要回答的問題。
 */
function arcGeometry(half: number, len = ARC_LENGTH): BufferGeometry {
  const s = Math.sin(half) * len
  const c = Math.cos(half) * len
  const v: number[] = []
  for (let k = 0; k < ARC_SEGMENTS; k++) {
    const a0 = (k / ARC_SEGMENTS) * Math.PI * 2
    const a1 = ((k + 1) / ARC_SEGMENTS) * Math.PI * 2
    v.push(0, 0, 0)
    v.push(Math.cos(a0) * s, Math.sin(a0) * s, c)
    v.push(Math.cos(a1) * s, Math.sin(a1) * s, c)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(Float32Array.from(v), 3))
  return g
}

/**
 * 全部砲塔的射界錐，**頂點在旋轉點**（`turretPivot`，不是槍口）。
 *
 * 【為什麼要半透明而且不寫深度】十三個錐互相重疊，寫深度的話誰蓋住誰完全
 * 取決於繪製順序，看起來像一團破碎的補丁。`depthWrite: false` + 低不透明度
 * 讓重疊區自然疊深，重疊得多的方向（例如正後方）顏色也就深 —— 那反而是
 * 有用的資訊。
 */
export function buildArcs(spec: Pick<AircraftSpec, 'turrets'>): Group {
  const g = new Group()
  const pivot = new Vector3()
  for (const t of spec.turrets) {
    const mesh = new Mesh(arcGeometry(t.halfAngle), new MeshBasicMaterial({
      color: 0x4fc3f7, transparent: true, opacity: 0.16,
      depthWrite: false, side: DoubleSide,
    }))
    mesh.position.copy(turretPivot(t, pivot))
    mesh.quaternion.setFromUnitVectors(UNIT_Z, t.axis)
    g.add(mesh)
  }
  return g
}

/** 一層一個顏色：遠（黑霧）暖色、中距黃、近距青。 */
const TIER_COLOR: Record<string, number> = {
  flak: 0xff7043, autocannon: 0xffd54f, mg: 0x4fc3f7,
}
/** 射界錐的斜邊，m。船比飛機大一個量級，8 m 的錐在 265 m 的船上看不見。 */
const SHIP_ARC_LENGTH = 42

/**
 * 一個砲位的射界錐軸：水平分量朝**舷外**，抬 `elevationDeg`。
 * 中線上的砲（Fletcher 的 5 吋）沒有「舷外」可言，改成朝正上。
 */
function shipArcAxis(z: ShipAAZone): Vector3 {
  const e = SHIP_AA_ARC_DEFAULTS[z.tier].elevationDeg * DEG
  const out = Math.abs(z.position.x) < 0.6 ? 0 : Math.sign(z.position.x)
  if (out === 0) return new Vector3(0, 1, 0)
  return new Vector3(out * Math.cos(e), Math.sin(e), 0).normalize()
}

export function buildShipArcs(shipId: string): Group {
  const g = new Group()
  for (const z of SHIP_AA_ZONES[shipId] ?? []) {
    const half = SHIP_AA_ARC_DEFAULTS[z.tier].halfAngleDeg * DEG
    const mesh = new Mesh(arcGeometry(half, SHIP_ARC_LENGTH), new MeshBasicMaterial({
      color: TIER_COLOR[z.tier] ?? 0xffffff, transparent: true, opacity: 0.13,
      depthWrite: false, side: DoubleSide,
    }))
    mesh.position.copy(z.position)
    mesh.quaternion.setFromUnitVectors(UNIT_Z, shipArcAxis(z))
    g.add(mesh)
  }
  return g
}

const UNIT_Z = new Vector3(0, 0, 1)
