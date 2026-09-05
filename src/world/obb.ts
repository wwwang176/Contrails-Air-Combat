import { Vector3, type Quaternion } from 'three'

/**
 * 兩個帶姿態的盒相交嗎 —— 分離軸測試（SAT）。
 *
 * 【為什麼一定要 15 條軸而不是 6 條】只測兩個盒各自的三個面法線，會漏掉
 * 「兩根細棒十字交叉」那一類：六個面軸的投影全部重疊，只有 `a_i × b_j`
 * 那九條叉乘軸分得開。漏掉的症狀是**飛機從艦橋旁邊擦過去卻判成撞上**，
 * 而且只在特定角度發生。
 *
 * 【為什麼不是把飛機的盒轉進船體座標再做 AABB】那等價於把飛機的 OBB 換成
 * 它在船體座標的包圍 AABB —— 45° 時膨脹到 1.41 倍，與 `hit.ts` 的 `HitBox`
 * 註解裡拒絕的是同一件事。
 *
 * 【平行軸不加容差】兩軸平行時叉乘長度是 0，那條軸上的投影恆為 0、不可能
 * 分離，所以直接跳過。加容差反而會讓「剛好貼面」變成不相交。
 *
 * 熱路徑（每架每步，通過包圍球粗篩之後）：不配置，也**不修改任何輸入**。
 */
export function obbOverlap(
  ac: Vector3, ah: Vector3, aq: Quaternion,
  bc: Vector3, bh: Vector3, bq: Quaternion,
): boolean {
  basis(aq, A0, A1, A2)
  basis(bq, B0, B1, B2)
  D.copy(bc).sub(ac)

  // 六條面軸
  if (separated(A0, ah, bh)) return false
  if (separated(A1, ah, bh)) return false
  if (separated(A2, ah, bh)) return false
  if (separated(B0, ah, bh)) return false
  if (separated(B1, ah, bh)) return false
  if (separated(B2, ah, bh)) return false

  // 九條叉乘軸
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      L.crossVectors(A[i]!, B[j]!)
      // 【平行】長度平方接近 0 —— 這一條分不開任何東西，跳過
      if (L.lengthSq() < 1e-12) continue
      if (separated(L, ah, bh)) return false
    }
  }
  return true
}

// ── 模組私有暫存，熱路徑零配置。禁止跨模組共用。 ──────────
const A0 = /* @__PURE__ */ new Vector3()
const A1 = /* @__PURE__ */ new Vector3()
const A2 = /* @__PURE__ */ new Vector3()
const B0 = /* @__PURE__ */ new Vector3()
const B1 = /* @__PURE__ */ new Vector3()
const B2 = /* @__PURE__ */ new Vector3()
const D = /* @__PURE__ */ new Vector3()
const L = /* @__PURE__ */ new Vector3()
/**
 * 給叉乘那個雙重迴圈用的。**在模組層建一次** —— 寫成函數內的陣列字面值
 * 的話每次呼叫配置兩個陣列，而這支函數是每架每步跑的。
 */
const A: readonly Vector3[] = [A0, A1, A2]
const B: readonly Vector3[] = [B0, B1, B2]

/** 四元數的三個基底向量。就地寫進三個 out。 */
function basis(q: Quaternion, e0: Vector3, e1: Vector3, e2: Vector3): void {
  const { x, y, z, w } = q
  const xx = x * x, yy = y * y, zz = z * z
  const xy = x * y, xz = x * z, yz = y * z
  const wx = w * x, wy = w * y, wz = w * z
  e0.set(1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy))
  e1.set(2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx))
  e2.set(2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy))
}

/**
 * 沿 `axis` 投影，兩個盒分得開嗎。
 *
 * `axis` 不必是單位向量 —— 兩邊同時等比縮放，不等式不變。這讓叉乘軸
 * 省掉一次 `normalize()`（每步九次平方根）。
 *
 * 呼叫前 `D`、`A0..A2`、`B0..B2` 必須已經是這一對盒的值。
 */
function separated(axis: Vector3, ah: Vector3, bh: Vector3): boolean {
  const ra = Math.abs(A0.dot(axis)) * ah.x
    + Math.abs(A1.dot(axis)) * ah.y
    + Math.abs(A2.dot(axis)) * ah.z
  const rb = Math.abs(B0.dot(axis)) * bh.x
    + Math.abs(B1.dot(axis)) * bh.y
    + Math.abs(B2.dot(axis)) * bh.z
  return Math.abs(D.dot(axis)) > ra + rb
}
