import { Vector3, type Mesh } from 'three'
import type { GroundTarget } from '../world/groundTargets'

export interface GroundGunSource {
  readonly index: number
  /** 已掛在車身／水平轉軸下的上下抬砲管網格。 */
  readonly barrel: Mesh
  readonly scale?: number
  /** 四聯砲依累計發數輪流使用管口；省略則由單管模型量測。 */
  readonly muzzles?: readonly Vector3[]
}

/**
 * 地面砲模型的最前端是砲管口（模型前方 −Z）。取前端截面的中心，座標屬於耳軸，
 * 開火時再套用整條砲塔階層的變換；不使用模擬中固定高度的近似出膛點。
 */
export function groundGunMuzzleOf(barrel: Mesh): Vector3 {
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

/** Flak 38 與 M16 的四個共面管口：以前端截面中心分成四區，各取自己的截面中心。只在建場量測。 */
export function groundQuadGunMuzzlesOf(barrel: Mesh): Vector3[] {
  const center = groundGunMuzzleOf(barrel)
  const bounds = Array.from({ length: 4 }, () => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }))
  const positions = barrel.geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    if (Math.abs(positions.getZ(i) - center.z) > 1e-4) continue
    const x = positions.getX(i), y = positions.getY(i)
    const b = bounds[(x > center.x ? 1 : 0) + (y > center.y ? 2 : 0)]!
    b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x)
    b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y)
  }
  return bounds.map(b => {
    if (!Number.isFinite(b.minX)) throw new Error('四聯砲模型缺少管口截面')
    return new Vector3((b.minX + b.maxX) * 0.5, (b.minY + b.maxY) * 0.5, center.z)
  })
}

/** 更新整條模型階層後讀出砲口；輸出向量由呼叫端重用。 */
export function readGroundGunMuzzle(barrel: Mesh, local: Vector3, position: Vector3, direction: Vector3): void {
  barrel.updateWorldMatrix(true, false)
  position.copy(local).applyMatrix4(barrel.matrixWorld)
  direction.set(0, 0, -1).transformDirection(barrel.matrixWorld)
}

/**
 * 讀累計發數，而不是只有 0.03 秒的槍焰旗標，低幀率也不漏發。
 * 每台一幀最多補八次；只在建場配置，更新幀重用座標。
 */
export function createGroundGunShots(
  sources: readonly GroundGunSource[], targets: readonly GroundTarget[],
  onShot: (x: number, y: number, z: number, dx: number, dy: number, dz: number, scale: number) => void,
) {
  const muzzles = sources.map(s => s.muzzles ?? [groundGunMuzzleOf(s.barrel)])
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
          for (let n = 0; n < count; n++) {
            const local = muzzles[k]!
            readGroundGunMuzzle(source.barrel, local[(shots - count + n) % local.length]!, position, direction)
            onShot(position.x, position.y, position.z, direction.x, direction.y, direction.z, source.scale ?? 1)
          }
        }
      }
    },
    reset(): void {
      previous.fill(0)
    },
  }
}
