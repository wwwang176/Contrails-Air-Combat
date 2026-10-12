import { BufferGeometry, Float32BufferAttribute, Mesh, Quaternion, Vector3, type Object3D } from 'three'
import { SHIP_GUN_LAYOUTS } from '../../specs/shipGunLayouts'
import type { ShipClassId } from '../../world/ships'

export const SHIP_GUN_PREFIX = 'shipGun.'
const EPSILON = 0.00015

/** Split animated mounts after livery projection so UVs and vertex tones survive. */
export function prepareShipGuns(root: Object3D, shipClass: ShipClassId): void {
  const layout = SHIP_GUN_LAYOUTS[shipClass]
  if (!layout) return
  const definitions = Object.entries(layout.mounts).filter(([id, def]) => {
    const name = SHIP_GUN_PREFIX + id
    if (root.getObjectByName(name)) return false
    if (!def.modelNode) {
      if (!def.bodyBounds || !def.barrelBounds) throw new Error(`${shipClass} has no extraction bounds for ${id}`)
      return true
    }
    const body = root.getObjectByName(def.modelNode) as Mesh | undefined
    const barrel = body?.children[0] as Mesh | undefined
    if (!body?.isMesh || !barrel?.isMesh) throw new Error(`${shipClass} is missing authored mount ${def.modelNode}`)
    body.name = name
    barrel.name = name + '.barrels'
    return false
  })
  if (definitions.length === 0) return
  const source = root.getObjectByName(layout.mesh) as Mesh | undefined
  if (!source?.isMesh) throw new Error(`${shipClass} is missing ${layout.mesh}`)
  root.updateMatrixWorld(true)
  const geometry = source.geometry.index ? source.geometry.toNonIndexed() : source.geometry.clone()
  geometry.applyMatrix4(source.matrixWorld)
  const positions = geometry.getAttribute('position')
  const buckets = Array.from({ length: definitions.length * 2 + 1 }, () => [] as number[])
  function contains(bounds: readonly number[], first: number): boolean {
    for (let v = first; v < first + 3; v++) {
      if (positions.getX(v) < bounds[0]! - EPSILON || positions.getX(v) > bounds[3]! + EPSILON
        || positions.getY(v) < bounds[1]! - EPSILON || positions.getY(v) > bounds[4]! + EPSILON
        || positions.getZ(v) < bounds[2]! - EPSILON || positions.getZ(v) > bounds[5]! + EPSILON) return false
    }
    return true
  }
  for (let first = 0; first < positions.count; first += 3) {
    let bucket = buckets.length - 1
    for (let k = 0; k < definitions.length; k++) {
      const def = definitions[k]![1]
      if (contains(def.barrelBounds!, first)) { bucket = k * 2 + 1; break }
      if (contains(def.bodyBounds!, first)) { bucket = k * 2; break }
    }
    buckets[bucket]!.push(first, first + 1, first + 2)
  }
  function piece(indices: number[]): BufferGeometry {
    const out = new BufferGeometry()
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      const values = new Float32Array(indices.length * attribute.itemSize)
      for (let n = 0; n < indices.length; n++) {
        for (let c = 0; c < attribute.itemSize; c++) values[n * attribute.itemSize + c] = attribute.getComponent(indices[n]!, c)
      }
      out.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize))
    }
    return out
  }
  const yaw = new Quaternion(), pitch = new Quaternion(), inverse = new Quaternion()
  const yAxis = new Vector3(0, 1, 0), xAxis = new Vector3(1, 0, 0), elevation = new Vector3()
  for (let k = 0; k < definitions.length; k++) {
    const [id, def] = definitions[k]!
    if (!buckets[k * 2]!.length || !buckets[k * 2 + 1]!.length) throw new Error(`${shipClass} gun geometry not found: ${id}`)
    yaw.setFromAxisAngle(yAxis, def.restYaw)
    pitch.setFromAxisAngle(xAxis, def.restPitch)
    const bodyGeo = piece(buckets[k * 2]!)
      .translate(-def.pivot.x, -def.pivot.y, -def.pivot.z).applyQuaternion(inverse.copy(yaw).invert())
    elevation.copy(def.elevationPivot!).applyQuaternion(yaw).add(def.pivot)
    const barrelGeo = piece(buckets[k * 2 + 1]!)
      .translate(-elevation.x, -elevation.y, -elevation.z)
      .applyQuaternion(inverse.multiplyQuaternions(yaw, pitch).invert())
    const body = new Mesh(bodyGeo, source.material)
    body.name = SHIP_GUN_PREFIX + id
    body.position.copy(def.pivot)
    body.quaternion.copy(yaw)
    const barrel = new Mesh(barrelGeo, source.material)
    barrel.name = body.name + '.barrels'
    barrel.position.copy(def.elevationPivot!)
    barrel.quaternion.copy(pitch)
    body.add(barrel)
    root.add(body)
  }
  const rest = piece(buckets[buckets.length - 1]!)
  // The remainder stays under its original parent; undo the world-space classification transform.
  rest.applyMatrix4(source.matrixWorld.clone().invert())
  source.geometry.dispose()
  source.geometry = rest
  geometry.dispose()
}
