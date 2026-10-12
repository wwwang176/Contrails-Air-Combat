import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import type { GroundTarget } from '../world/groundTargets'
import { FLASH_SECONDS } from '../weapons/muzzleFlash'
import { crossFlare, createMuzzleMaterial } from './muzzle'
import { groundGunMuzzleOf, readGroundGunMuzzle, type GroundGunSource } from './groundGunShots'

/** 地面連射武器沿用戰鬥機的十字槍焰；每座一格，依累計發數輪替實際管口。 */
export function createGroundMuzzles(sources: readonly GroundGunSource[], targets: readonly GroundTarget[]) {
  const geometry = crossFlare()
  const material = createMuzzleMaterial()
  const object = new InstancedMesh(geometry, material, sources.length)
  object.name = 'groundModels.muzzles'
  object.frustumCulled = false
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  object.count = 0
  const previous = sources.map(s => targets[s.index]?.guns[0]?.shots ?? 0)
  const muzzles = sources.map(s => s.muzzles ?? [groundGunMuzzleOf(s.barrel)])
  const left = new Float32Array(sources.length)
  const position = new Vector3(), direction = new Vector3(), scale = new Vector3()
  const axis = new Vector3(0, 0, 1)
  const rotation = new Quaternion(), matrix = new Matrix4(), tint = new Color()
  const hidden = new Matrix4().makeScale(0, 0, 0)
  for (let k = 0; k < sources.length; k++) {
    object.setMatrixAt(k, hidden)
    object.setColorAt(k, tint.setRGB(0, 0, 0))
  }

  return {
    object,
    update(list: readonly GroundTarget[], seconds: number): void {
      let hi = -1, touched = false
      for (let k = 0; k < sources.length; k++) {
        const source = sources[k]!, target = list[source.index], gun = target?.guns[0]
        const wasLit = left[k]! > 0
        if (seconds > 0) {
          const shots = gun?.shots ?? 0
          left[k] = shots > previous[k]! ? FLASH_SECONDS
            : shots < previous[k]! ? 0 : Math.max(0, left[k]! - seconds)
          previous[k] = shots
        }
        if (!target?.alive || target.dormant || target.departed || target.arrived || !gun?.alive) left[k] = 0
        if (left[k]! <= 0) {
          if (wasLit) { object.setMatrixAt(k, hidden); touched = true }
          continue
        }
        // 使用目前模型姿態，移動中的 M16 與轉動砲管不會把槍焰留在上一幀的位置。
        const local = muzzles[k]!
        readGroundGunMuzzle(source.barrel, local[(previous[k]! - 1) % local.length]!, position, direction)
        const f = Math.min(1, left[k]! / FLASH_SECONDS)
        rotation.setFromUnitVectors(axis, direction)
        scale.setScalar(f)
        matrix.compose(position, rotation, scale)
        object.setMatrixAt(k, matrix)
        object.setColorAt(k, tint.setRGB(f, f * 0.8, f * 0.45))
        hi = k
        touched = true
      }
      object.count = hi + 1
      if (touched) {
        object.instanceMatrix.needsUpdate = true
        if (object.instanceColor) object.instanceColor.needsUpdate = true
      }
    },
    reset(): void {
      previous.fill(0)
      left.fill(0)
      for (let k = 0; k < sources.length; k++) object.setMatrixAt(k, hidden)
      object.instanceMatrix.needsUpdate = true
      object.count = 0
    },
    dispose(): void { geometry.dispose(); material.dispose(); object.dispose() },
  }
}
