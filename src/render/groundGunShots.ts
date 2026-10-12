import { Vector3, type Mesh } from 'three'
import type { GroundTarget } from '../world/groundTargets'

export interface GroundGunSource {
  readonly index: number
  /** 已掛在車身／水平轉軸下的上下抬砲管網格。 */
  readonly barrel: Mesh
}

/**
 * 90 mm 的最前端是砲管口（模型前方 −Z）。取前端截面的中心，座標屬於耳軸，
 * 開火時再套用整條砲塔階層的變換；不使用模擬中固定高度的近似出膛點。
 */
function muzzleOf(barrel: Mesh): Vector3 {
  const geometry = barrel.geometry
  if (geometry.boundingBox === null) geometry.computeBoundingBox()
  const z = geometry.boundingBox!.min.z
  const positions = geometry.getAttribute('position')
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < positions.count; i++) {
    if (Math.abs(positions.getZ(i) - z) > 1e-4) continue
    minX = Math.min(minX, positions.getX(i))
    maxX = Math.max(maxX, positions.getX(i))
    minY = Math.min(minY, positions.getY(i))
    maxY = Math.max(maxY, positions.getY(i))
  }
  return new Vector3((minX + maxX) * 0.5, (minY + maxY) * 0.5, z)
}

/**
 * 讀累計發數，而不是只有 0.03 秒的槍焰旗標，低幀率也不漏發。
 * 每台一幀最多補八次；只在建場配置，更新幀重用座標。
 */
export function createGroundGunShots(
  sources: readonly GroundGunSource[], targets: readonly GroundTarget[],
  onShot: (x: number, y: number, z: number, dx: number, dy: number, dz: number) => void,
) {
  const muzzles = sources.map(s => muzzleOf(s.barrel))
  const previous = sources.map(s => targets[s.index]?.guns[0]?.shots ?? 0)
  const position = new Vector3()
  const direction = new Vector3()

  return {
    update(list: readonly GroundTarget[], seconds: number): void {
      if (seconds > 0) {
        for (let k = 0; k < sources.length; k++) {
          const source = sources[k]!
          const target = list[source.index]
          const gun = target?.guns[0]
          const shots = gun?.shots ?? 0
          const count = Math.min(8, Math.max(0, shots - previous[k]!))
          previous[k] = shots
          if (count === 0 || target === undefined || !target.alive || target.dormant
            || target.departed || target.arrived || gun?.alive !== true) continue
          source.barrel.updateWorldMatrix(true, false)
          position.copy(muzzles[k]!).applyMatrix4(source.barrel.matrixWorld)
          direction.set(0, 0, -1).transformDirection(source.barrel.matrixWorld)
          for (let n = 0; n < count; n++) {
            onShot(position.x, position.y, position.z, direction.x, direction.y, direction.z)
          }
        }
      }
    },
    reset(): void {
      previous.fill(0)
    },
  }
}
