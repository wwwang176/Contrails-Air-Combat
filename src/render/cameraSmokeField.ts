import { Color, Vector3, type InstancedBufferAttribute, type InstancedMesh, type Object3D } from 'three'

/** 距離以粒子直徑為單位；只在鏡頭進入煙團後交接，擦過外側不會整幕變黑。 */
export const CAMERA_SMOKE_INNER = 0.18
export const CAMERA_SMOKE_OUTER = 0.5

export const cameraSmokeEnabled = { value: 0 }

export interface CameraSmokeSource {
  readonly object: InstancedMesh
  readonly alpha: InstancedBufferAttribute
  readonly slots: Uint32Array
  readonly handoff: InstancedBufferAttribute
  count: number
}

/** 池建立與銷毀時登記；不每幀掃描整個場景，也不掃已死亡的粒子。 */
const sources = new Set<CameraSmokeSource>()
type SmokeTint = (color: Color, centre: Vector3, viewBackward: Vector3) => void
const lighting = new WeakMap<InstancedMesh, SmokeTint>()
/** 光照配方由原本的煙材質提供；遮罩只接收結果，不自行判斷哪些煙應該受光。 */
export function setCameraSmokeLighting(mesh: InstancedMesh, sample: SmokeTint): void { lighting.set(mesh, sample) }
export function registerCameraSmoke(source: CameraSmokeSource): void { sources.add(source) }
export function unregisterCameraSmoke(source: CameraSmokeSource): void { sources.delete(source) }

export function cameraSmokeWeight(distance: number, diameter: number): number {
  if (diameter <= 0) return 0
  const t = Math.max(0, Math.min(1,
    (distance / diameter - CAMERA_SMOKE_INNER) / (CAMERA_SMOKE_OUTER - CAMERA_SMOKE_INNER)))
  return 1 - t * t * (3 - 2 * t)
}

export interface CameraSmokeSample {
  density: number
  diameter: number
  readonly color: Color
}

const position = new Vector3()
const tint = new Color()
const BACKWARD = new Vector3(0, 0, 1)

function inScene(object: Object3D, scene: Object3D): boolean {
  for (let p: Object3D | null = object; p !== null; p = p.parent) {
    if (!p.visible) return false
    if (p === scene) return true
  }
  return false
}

/** 提供活躍煙池給螢幕遮罩，不另建一份登記表。 */
export function visitCameraSmokeSources(scene: Object3D, visit: (source: CameraSmokeSource) => void): void {
  for (const source of sources) {
    const mesh = source.object
    const material = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material
    if (!source.count || !material.visible || !inScene(mesh, scene)) continue
    mesh.updateWorldMatrix(true, false)
    visit(source)
  }
}

export function tintCameraSmoke(mesh: InstancedMesh, color: Color, centre: Vector3, backward: Vector3): void {
  lighting.get(mesh)?.(color, centre, backward)
}

/** 使用已更新的呈現位置、年齡透明度與逐顆顏色；黑煙、蒸汽、塵土自然混色。 */
export function sampleCameraSmoke(
  scene: Object3D, cameraPosition: Vector3, out: CameraSmokeSample, viewBackward = BACKWARD,
): void {
  out.density = 0
  out.diameter = 0
  out.color.setRGB(0, 0, 0)
  for (const source of sources) {
    const mesh = source.object
    if (source.count === 0 || !inScene(mesh, scene)) continue
    const material = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material
    if (!material.visible) continue
    mesh.updateWorldMatrix(true, false)
    const transform = mesh.matrixWorld.elements
    const worldScale = Math.hypot(transform[0]!, transform[1]!, transform[2]!)
    const matrices = mesh.instanceMatrix.array
    for (let j = 0; j < source.count; j++) {
      const slot = source.slots[j]!
      const offset = slot * 16
      const diameter = matrices[offset]! * worldScale
      position.set(matrices[offset + 12]!, matrices[offset + 13]!, matrices[offset + 14]!)
        .applyMatrix4(mesh.matrixWorld)
      const weight = cameraSmokeWeight(position.distanceTo(cameraPosition), diameter)
      if (weight <= 0) continue
      const alpha = Math.min(0.99, Math.max(0, source.alpha.getX(slot) * material.opacity))
      // 光學厚度相加：兩團薄煙會比一團濃，不以平均透明度沖淡濃煙。
      const density = -Math.log1p(-alpha) * weight
      mesh.getColorAt(slot, tint)
      if ('color' in material) tint.multiply(material.color as Color)
      lighting.get(mesh)?.(tint, position, viewBackward)
      out.color.add(tint.multiplyScalar(density))
      out.density += density
      out.diameter += diameter * density
    }
  }
  if (out.density > 0) {
    out.color.multiplyScalar(1 / out.density)
    out.diameter /= out.density
  }
}

/** 快速穿煙縮短反應時間；慢速與靜止保留少量平滑，不留下長時間的黑色拖尾。 */
export function cameraSmokeResponse(dt: number, speed: number): number {
  const seconds = Math.max(0.008, Math.min(0.06, 1.5 / Math.max(speed, 1)))
  return 1 - Math.exp(-Math.max(0, dt) / seconds)
}
