import { BufferAttribute, type BufferGeometry } from 'three'
import type { GroundLivery } from '../../../specs/ground'
import { GUN_TURRET_KEY, type GunTurretParts } from './turret'

/**
 * GLB 烘出來的幾何上，冬季頂點色（與 `color` 同一個頂點順序的 `Float32Array`）放在
 * `userData` 的這個鍵。程序化的單位沒有它
 */
export const WINTER_COLOR_KEY = 'winterColor'

/** 換一份頂點色的複本。沒有冬季資料就回 null */
function recolored(geo: BufferGeometry): BufferGeometry | null {
  const winter = geo.userData[WINTER_COLOR_KEY] as Float32Array | undefined
  if (winter === undefined) return null
  const out = geo.clone()
  out.setAttribute('color', new BufferAttribute(winter.slice(), 3))
  return out
}

/**
 * 這一台在 `livery` 塗裝下的幾何。純頂點色，形狀、法線、砲塔轉軸都不動。
 *
 * - 有冬季資料（GLB 那幾台）：回**新的**幾何，拆開的砲塔兩塊也換成新的；呼叫端負責釋放
 *   （`disposeLivery`）
 * - 沒有（程序化的步兵、火車、廠房）：回原物
 *
 * 【複本而不是共用屬性】共用的位置屬性在釋放複本時會連 GPU 緩衝一起刪，原物下一次畫的時候
 * 才重傳 —— 不會錯，但是每換一場都白傳一次。地面模型一支幾千個頂點，複一份比較單純
 */
export function liveryGeometry(geo: BufferGeometry, livery: GroundLivery): BufferGeometry {
  if (livery !== 'winter') return geo
  const out = recolored(geo)
  if (out === null) return geo
  const t = geo.userData[GUN_TURRET_KEY] as GunTurretParts | undefined
  if (t !== undefined) {
    const parts: GunTurretParts = {
      traverse: recolored(t.traverse) ?? t.traverse.clone(),
      elevate: recolored(t.elevate) ?? t.elevate.clone(),
      traversePivot: t.traversePivot,
      elevatePivot: t.elevatePivot,
    }
    out.userData = { ...geo.userData, [GUN_TURRET_KEY]: parts }
  }
  return out
}

/** 釋放 `liveryGeometry` 回的新幾何（連同砲塔兩塊） */
export function disposeLivery(geo: BufferGeometry): void {
  const t = geo.userData[GUN_TURRET_KEY] as GunTurretParts | undefined
  if (t !== undefined) {
    t.traverse.dispose()
    t.elevate.dispose()
  }
  geo.dispose()
}
