import type { BufferGeometry, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * 會轉的砲塔：GLB 裡兩個空節點的名字。`traverse` 是水平旋轉軸、`elevate` 是耳軸，
 * 節點的原點就是轉軸。**登記了就一定要有**：少了在載入時丟錯，不靜靜退回不轉。
 */
export interface GroundTurretNodes {
  readonly traverse: string
  readonly elevate: string
}

/** 拆開的砲塔掛在固定那一塊幾何的 `userData` 上的鍵 */
export const GUN_TURRET_KEY = 'gunTurret'

/**
 * 拆開的兩塊。`traverse` 以 `traversePivot` 為原點，`elevate` 以耳軸為原點；
 * 擺上去時水平轉那一塊放在 `traversePivot`（模型座標），上下抬那一塊放在水平轉那一塊
 * 底下的 `elevatePivot`（相對於 `traversePivot`）。
 */
export interface GunTurretParts {
  readonly traverse: BufferGeometry
  readonly elevate: BufferGeometry
  readonly traversePivot: Vector3
  readonly elevatePivot: Vector3
}

/**
 * 整台在靜止姿勢（yaw 0、pitch 0）的合併幾何。沒有拆開的砲塔就回原物；有的話回**新的**
 * 幾何，呼叫端負責釋放。給量整台的地方用（展示頁、尺寸與命中盒的護欄）。
 */
export function restGeometry(geo: BufferGeometry): BufferGeometry {
  const t = geo.userData[GUN_TURRET_KEY] as GunTurretParts | undefined
  if (t === undefined) return geo
  const tp = t.traversePivot
  const ep = t.elevatePivot
  const trav = t.traverse.clone().translate(tp.x, tp.y, tp.z)
  const elev = t.elevate.clone().translate(tp.x + ep.x, tp.y + ep.y, tp.z + ep.z)
  const fixed = geo.clone()
  fixed.userData = {}
  const out = mergeGeometries([fixed, trav, elev])
  for (const g of [fixed, trav, elev]) g.dispose()
  if (out === null) throw new Error('砲塔放回靜止姿勢時合併失敗 —— 屬性不一致')
  return out
}
