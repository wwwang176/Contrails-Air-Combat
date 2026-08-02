import { Vector3, type Quaternion } from 'three'
import { makeScratch } from '../core/pool'

export type HitPart = 'cockpit' | 'engine' | 'tail' | 'fuselage' | 'wingLeft' | 'wingRight'

export const HIT_PARTS: readonly HitPart[] = [
  'cockpit', 'engine', 'tail', 'fuselage', 'wingLeft', 'wingRight',
]

/** spec §6.2。 */
export const PART_MULTIPLIER: Readonly<Record<HitPart, number>> = {
  cockpit: 2.5,
  engine: 2.0,
  tail: 1.2,
  fuselage: 1.0,
  wingLeft: 0.7,
  wingRight: 0.7,
}

/**
 * 一個命中盒，**機體座標**的 AABB。
 *
 * 【為什麼定義在機體座標而不是世界座標】判定前把線段轉進機體座標，
 * 等價於世界座標的 OBB，飛機滾轉不失真。世界座標的 AABB 在 45° 滾轉時
 * 會膨脹到 1.41 倍——機翼是薄板，那等於憑空長出一公尺厚。
 */
export interface HitBox {
  part: HitPart
  center: Vector3
  half: Vector3
}

/** 以 min/max 建盒——資料寫成兩個角點比中心＋半尺寸好讀也好對照量測值。 */
export function makeHitBox(
  part: HitPart,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): HitBox {
  return {
    part,
    center: new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2),
    half: new Vector3((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2),
  }
}

/** 未命中。 */
export const NO_HIT = -1

/**
 * 線段 vs AABB（slab 法）。座標一律是**機體座標**。
 *
 * @returns 進入參數 t ∈ [0, 1]；起點已在盒內時為 0；未命中回傳 NO_HIT。
 */
export function segmentBox(
  ox: number, oy: number, oz: number,
  ex: number, ey: number, ez: number,
  box: HitBox,
): number {
  let tMin = 0
  let tMax = 1

  const c = box.center
  const h = box.half
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz
    const e = axis === 0 ? ex : axis === 1 ? ey : ez
    const cc = axis === 0 ? c.x : axis === 1 ? c.y : c.z
    const hh = axis === 0 ? h.x : axis === 1 ? h.y : h.z
    const d = e - o
    const lo = cc - hh
    const hi = cc + hh

    // 【平行於這一軸】不可以直接除——0 除會得到 ±Infinity，而
    // 0/0 會得到 NaN，NaN 的比較恆為 false，於是「未命中」會被靜靜地
    // 當成命中。改成先檢查起點是否落在這一軸的區間內。
    if (d > -1e-12 && d < 1e-12) {
      if (o < lo || o > hi) return NO_HIT
      continue
    }

    const inv = 1 / d
    let t0 = (lo - o) * inv
    let t1 = (hi - o) * inv
    if (t0 > t1) {
      const swap = t0
      t0 = t1
      t1 = swap
    }
    if (t0 > tMin) tMin = t0
    if (t1 < tMax) tMax = t1
    if (tMin > tMax) return NO_HIT
  }
  return tMin
}

export interface HitResult {
  /** 線段參數 t ∈ [0, 1]，取所有命中盒中**最近**的 */
  t: number
  /** 取所有命中盒中**倍率最高**的 */
  part: HitPart
  multiplier: number
}

export function createHitResult(): HitResult {
  return { t: 0, part: 'fuselage', multiplier: 1 }
}

const S = makeScratch(2)

/**
 * 世界座標線段對一架飛機的命中判定。
 *
 * 【t 取最近、倍率取最高，兩者不同】
 * `t` 決定「打到哪一架、打在線段的哪個位置」，那必須是最近的。
 * 倍率則必須取最高的——命中盒是巢狀的（座艙盒整個包在機身盒裡），
 * 從正面來的彈丸一定先進機身盒再進座艙盒，倍率若也取最近的那一個，
 * 座艙的 ×2.5 **永遠選不到**，整條是死碼。這與 M1 那次「黑視起點等於
 * 過載限制器上限、overG 恆為 0」是同一類缺陷。
 *
 * 熱路徑：不配置，out 由呼叫端持有。
 *
 * @returns 是否命中。false 時**不動 out**。
 */
export function hitAircraft(
  boxes: readonly HitBox[],
  position: Vector3,
  orientation: Quaternion,
  s0: Vector3,
  s1: Vector3,
  out: HitResult,
): boolean {
  // 世界 → 機體：先平移再套用姿態的逆旋轉。
  //
  // 【不可以呼叫 orientation.invert()】那是**就地**修改，會把呼叫端那架
  // 飛機的姿態毀掉。單位四元數的逆就是共軛，所以直接把三個虛部取負，
  // 交給 applyConjugate 展開——零配置，也不動輸入。
  const a = S.v[0]!.copy(s0).sub(position)
  const b = S.v[1]!.copy(s1).sub(position)
  const qx = -orientation.x, qy = -orientation.y, qz = -orientation.z, qw = orientation.w
  applyConjugate(a, qx, qy, qz, qw)
  applyConjugate(b, qx, qy, qz, qw)

  let bestT = Infinity
  let bestMul = -1
  let bestPart: HitPart = 'fuselage'
  for (const box of boxes) {
    const t = segmentBox(a.x, a.y, a.z, b.x, b.y, b.z, box)
    if (t === NO_HIT) continue
    if (t < bestT) bestT = t
    const mul = PART_MULTIPLIER[box.part]
    if (mul > bestMul) {
      bestMul = mul
      bestPart = box.part
    }
  }
  if (bestMul < 0) return false

  out.t = bestT
  out.part = bestPart
  out.multiplier = bestMul
  return true
}

/** v ← q* · v · q，其中 (qx, qy, qz, qw) 已經是共軛。就地修改，無配置。 */
function applyConjugate(v: Vector3, qx: number, qy: number, qz: number, qw: number): void {
  const { x, y, z } = v
  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z
  v.x = ix * qw + iw * -qx + iy * -qz - iz * -qy
  v.y = iy * qw + iw * -qy + iz * -qx - ix * -qz
  v.z = iz * qw + iw * -qz + ix * -qy - iy * -qx
}
