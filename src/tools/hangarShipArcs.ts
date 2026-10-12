import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group,
  LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, SphereGeometry,
} from 'three'
import { SHIP_GUN_LAYOUTS } from '../specs/shipGunLayouts'
import type { ShipGunMount } from '../specs/shipGunMounts'
import type { ShipClassId } from '../world/ships'
import { GUN_PITCH_MAX, GUN_PITCH_MIN } from '../weapons/gunAim'

export const SHIP_ARC_COLORS = { flak: 0xff7043, autocannon: 0xffd54f, mg: 0x4fc3f7 } as const
export const SHIP_ARC_LABELS = { flak: '5 吋砲', autocannon: '40 mm', mg: '20 mm' } as const
const FULL_YAW = [[-Math.PI, Math.PI]] as const
const STEP = Math.PI / 36

/** Traverse/elevation limits of the physical model, not the battery's target acquisition cone. */
export function shipArcLimits(mount: ShipGunMount) {
  return {
    yaw: mount.yawSectors ?? FULL_YAW,
    pitch: [Math.max(GUN_PITCH_MIN, mount.pitchRange?.[0] ?? GUN_PITCH_MIN),
      Math.min(GUN_PITCH_MAX, mount.pitchRange?.[1] ?? GUN_PITCH_MAX)] as const,
  }
}

function point(yaw: number, pitch: number, radius: number): number[] {
  const horizontal = Math.cos(pitch) * radius
  return [-Math.sin(yaw) * horizontal, Math.sin(pitch) * radius, -Math.cos(yaw) * horizontal]
}

/** Separate patches for each allowed sector: no face ever bridges a forbidden yaw interval. */
function sectorGeometry(lo: number, hi: number, bottom: number, top: number, radius: number) {
  const faces: number[] = [], edges: number[] = []
  const ny = Math.max(1, Math.ceil((hi - lo) / STEP)), np = Math.max(1, Math.ceil((top - bottom) / STEP))
  const yaw = (i: number) => lo + (hi - lo) * i / ny
  const pitch = (i: number) => bottom + (top - bottom) * i / np
  const at = (i: number, j: number) => point(yaw(i), pitch(j), radius)
  const origin = [0, 0, 0]
  for (let i = 0; i < ny; i++) {
    for (let j = 0; j < np; j++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1)
      faces.push(...a, ...b, ...c, ...a, ...c, ...d)
    }
    for (const j of [0, np]) {
      // Upper/lower fans expose the elevation cutoff, including when viewed from above.
      faces.push(...origin, ...at(i, j), ...at(i + 1, j))
      edges.push(...at(i, j), ...at(i + 1, j))
    }
  }
  if (hi - lo < Math.PI * 2 - 1e-8) {
    for (const i of [0, ny]) {
      for (let j = 0; j < np; j++) {
        faces.push(...origin, ...at(i, j), ...at(i, j + 1))
        edges.push(...at(i, j), ...at(i, j + 1))
      }
      for (const j of [0, np]) edges.push(...origin, ...at(i, j))
    }
  }
  return {
    surface: new BufferGeometry().setAttribute('position', new Float32BufferAttribute(faces, 3)),
    outline: new BufferGeometry().setAttribute('position', new Float32BufferAttribute(edges, 3)),
  }
}

/** One independently selectable volume per physical mount; twin barrels share one traverse axis. */
export function buildShipArcs(shipId: string): Group {
  const root = new Group()
  root.name = 'shipArcs'
  for (const mount of Object.values(SHIP_GUN_LAYOUTS[shipId as ShipClassId]?.mounts ?? {})) {
    const g = new Group(), color = SHIP_ARC_COLORS[mount.tier]
    g.name = mount.id
    g.position.copy(mount.pivot)
    const limits = shipArcLimits(mount)
    const radius = mount.tier === 'flak' ? 22 : mount.tier === 'autocannon' ? 15 : 10
    const surface = new MeshBasicMaterial({ color, transparent: true, opacity: 0.075, depthWrite: false, side: DoubleSide })
    const outline = new LineBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false })
    for (const [lo, hi] of limits.yaw) {
      const geo = sectorGeometry(lo, hi, limits.pitch[0], limits.pitch[1], radius)
      g.add(new Mesh(geo.surface, surface), new LineSegments(geo.outline, outline))
    }
    const marker = new Mesh(new SphereGeometry(0.35, 8, 6), new MeshBasicMaterial({ color }))
    marker.name = 'pivot'
    g.add(marker)
    root.add(g)
  }
  return root
}

/** Highlight one mount without rebuilding GPU resources. */
export function selectShipArc(root: Group, id: string): void {
  for (const g of root.children) {
    g.visible = id === '' || g.name === id
    g.traverse(o => {
      if (o instanceof Mesh && o.name !== 'pivot') (o.material as MeshBasicMaterial).opacity = id === '' ? 0.075 : 0.1
    })
  }
}

export function shipArcDescription(mount: ShipGunMount): string {
  const limits = shipArcLimits(mount)
  const deg = (value: number) => `${Math.round(value * 180 / Math.PI)}°`
  return `水平 ${limits.yaw.map(([lo, hi]) => `${deg(lo)}～${deg(hi)}`).join('、')}\n仰角 ${deg(limits.pitch[0])}～${deg(limits.pitch[1])}`
}
