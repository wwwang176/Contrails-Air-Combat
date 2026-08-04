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
/**
 * slab 測試找到的入射面。
 *
 * `axis`：0 = X、1 = Y、2 = Z；**−1 代表沒有入射面**（線段起點就在盒內）。
 * `sign`：+1 = 從該軸的高面進入（法線 +axis），−1 = 從低面進入（法線 −axis）。
 */
export interface FaceNormal {
  axis: number
  sign: number
}

export function segmentBox(
  ox: number, oy: number, oz: number,
  ex: number, ey: number, ez: number,
  box: HitBox,
  outFace?: FaceNormal,
): number {
  let tMin = 0
  let tMax = 1
  // 【−1 代表「沒有入射面」而不是「還沒算」】tMin 起始為 0，若三個軸都
  // 沒有抬高過它（起點在盒內），這個值就會原樣留到最後（M7 spec §3.2）。
  let hitAxis = -1
  let hitSign = 0

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
    if (t0 > tMin) {
      tMin = t0
      hitAxis = axis
      // 沿 +axis 前進 → 從低面進入 → 法線指向 −axis，反之亦然
      hitSign = d > 0 ? -1 : 1
    }
    if (t1 < tMax) tMax = t1
    if (tMin > tMax) return NO_HIT
  }

  // 【只在確定命中之後才寫】未命中的路徑全部提早 return，所以呼叫端在
  // NO_HIT 時拿到的是上一次的值——與「false 時不動 out」同一條約定。
  if (outFace !== undefined) {
    outFace.axis = hitAxis
    outFace.sign = hitSign
  }
  return tMin
}

/**
 * 覆蓋全部命中盒的包圍球半徑，以**機體原點**為心。
 *
 * 給命中判定的粗篩用：線段離機體重心比這個遠，就一定碰不到任何盒子，
 * 可以跳過六次 slab 測試與兩次四元數旋轉。
 *
 * 【必須是上界，不能只是「差不多」】算小了會靜靜地漏掉命中——玩家看到
 * 曳光彈穿過機翼卻不扣血，而且只在特定角度發生。所以取每個盒**離原點
 * 最遠的角**：該角在各軸上是 |center| + half。
 */
export function boundingRadius(boxes: readonly HitBox[]): number {
  let r2 = 0
  for (const b of boxes) {
    const x = Math.abs(b.center.x) + b.half.x
    const y = Math.abs(b.center.y) + b.half.y
    const z = Math.abs(b.center.z) + b.half.z
    const d2 = x * x + y * y + z * z
    if (d2 > r2) r2 = d2
  }
  return Math.sqrt(r2)
}

/** `lowestPoint` 的暫存。模組私有、每次呼叫重用（熱路徑之外，但仍不配置）。 */
const LOW = new Vector3()

/**
 * 旋轉後的 OBB 在世界 Y 上的最低點。回傳最低的世界 Y，`out` 收最低角點的
 * 世界座標。
 *
 * 【為什麼不是列舉八個角點】列舉要八次四元數旋轉；解析式只要旋轉矩陣的
 * **第二列**（世界 Y 在機體三軸上的投影）：
 *
 *     minY = pos.y + (R10·cx + R11·cy + R12·cz) − (|R10|·hx + |R11|·hy + |R12|·hz)
 *
 * 前半是盒心的世界高度，後半是半尺寸在世界 Y 上能往下延伸的最大量。最低
 * 角點各軸取 `−sign(R1j)`。六個盒一具殘骸每幀 18 次乘法 —— 可以忽略。
 *
 * 【為什麼殘骸需要它】殘骸是**翻滾**的，翼尖會比重心早很多碰到水。用重心
 * 判定會讓水花晚一整個翼展才出現（M8 spec §9.1）。
 */
export function lowestPoint(
  box: HitBox, q: Quaternion, pos: Vector3, out: Vector3,
): number {
  const x = q.x
  const y = q.y
  const z = q.z
  const w = q.w
  // 旋轉矩陣的第二列
  const r0 = 2 * (x * y + w * z)
  const r1 = 1 - 2 * (x * x + z * z)
  const r2 = 2 * (y * z - w * x)

  const h = box.half
  const c = box.center
  // 各軸取讓世界 Y 最小的那一側
  const sx = r0 > 0 ? -h.x : h.x
  const sy = r1 > 0 ? -h.y : h.y
  const sz = r2 > 0 ? -h.z : h.z

  LOW.set(c.x + sx, c.y + sy, c.z + sz).applyQuaternion(q).add(pos)
  out.copy(LOW)
  return LOW.y
}

/**
 * 點到線段的最短距離平方。粗篩用，所以只回傳平方值——省一次 sqrt，
 * 呼叫端與半徑的平方比較即可。
 */
export function segmentPointDistanceSq(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  px: number, py: number, pz: number,
): number {
  const dx = bx - ax, dy = by - ay, dz = bz - az
  const wx = px - ax, wy = py - ay, wz = pz - az
  const len2 = dx * dx + dy * dy + dz * dz
  // 零長度線段退化成點到點
  let t = len2 > 0 ? (wx * dx + wy * dy + wz * dz) / len2 : 0
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const ex = wx - t * dx, ey = wy - t * dy, ez = wz - t * dz
  return ex * ex + ey * ey + ez * ez
}

export interface HitResult {
  /** 線段參數 t ∈ [0, 1]，取所有命中盒中**最近**的 */
  t: number
  /** 取所有命中盒中**倍率最高**的 */
  part: HitPart
  multiplier: number
  /**
   * 入射面的法線，**機體座標**的單位向量。三分量皆為 0 = 線段起點就在
   * 盒內，沒有入射面（M7 spec §3.2）。
   *
   * 【它跟著 `t` 走而不是跟著 `multiplier` 走】命中盒是巢狀的（座艙整個
   * 包在機身裡）。倍率取最高的那個盒是**內層**，而彈丸真正先碰到的表面
   * 是**外層**。跟著倍率走的話火花會從機體內部噴出來。
   */
  nx: number
  ny: number
  nz: number
}

export function createHitResult(): HitResult {
  return { t: 0, part: 'fuselage', multiplier: 1, nx: 0, ny: 0, nz: 0 }
}

const S = makeScratch(2)
/** slab 測試的入射面。模組私有、每次呼叫重用（熱路徑零配置） */
const FACE: FaceNormal = { axis: -1, sign: 0 }

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
  let bestAxis = -1
  let bestSign = 0
  for (const box of boxes) {
    const t = segmentBox(a.x, a.y, a.z, b.x, b.y, b.z, box, FACE)
    if (t === NO_HIT) continue
    if (t < bestT) {
      bestT = t
      // 【法線跟著 t 走】見 HitResult.nx 的註解
      bestAxis = FACE.axis
      bestSign = FACE.sign
    }
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
  out.nx = bestAxis === 0 ? bestSign : 0
  out.ny = bestAxis === 1 ? bestSign : 0
  out.nz = bestAxis === 2 ? bestSign : 0
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
