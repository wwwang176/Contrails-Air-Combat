import type { Vector3 } from 'three'

/** 無解。`interceptTime` 與 `solveLead` 共用這個哨兵值。 */
export const NO_INTERCEPT = -1

/**
 * 攔截時間：在**射手座標系**解 `|P + V·t| = s·t` 的最小正根。
 *
 *     (V·V − s²)·t² + 2(P·V)·t + P·P = 0
 *     a = V·V − s²、b = 2(P·V)、c = P·P（c > 0，除非目標與射手重疊）
 *
 * @param P     相對位置＝目標位置 − 射手位置
 * @param V     相對速度＝目標速度 − 射手速度
 * @param speed 槍口初速，m/s
 * @returns     最小正根；無解回傳 NO_INTERCEPT
 *
 * 閉式解，不迭代。不修改 P 與 V。
 */
export function interceptTime(P: Vector3, V: Vector3, speed: number): number {
  const c = P.lengthSq()
  if (c === 0) return 0

  const a = V.lengthSq() - speed * speed
  const b = 2 * (P.x * V.x + P.y * V.y + P.z * V.z)

  // 【退化成一次式】|a| 很小時**不可以**直接除以 a：一個根會飛到無限大，
  // 另一個由浮點誤差主導，預瞄環於是閃爍或飛走。改解 b·t + c = 0；
  // c > 0 恆成立，所以只有 b < 0（正在接近）才有正根。
  if (Math.abs(a) <= 1e-9 * speed * speed) return b < 0 ? -c / b : NO_INTERCEPT

  // 【目標比彈快（a > 0）且正在遠離（b ≥ 0）】兩根之和 −b/a ≤ 0、乘積
  // c/a > 0，不可能有正根。提早退出省一次 sqrt。
  //
  // 注意這**不是**「目標比彈快就無解」——那是錯的。a > 0 而 b < 0
  // （迎頭接近）時照樣有解，見下方。
  if (a > 0 && b >= 0) return NO_INTERCEPT

  const disc = b * b - 4 * a * c
  if (disc < 0) return NO_INTERCEPT

  // 【數值穩定式】直接用 (−b ± √disc)/(2a)，在 b² ≫ 4ac 時其中一根會發生
  // 災難性相消（兩個相近的大數相減）。改取
  //     q = −(b + sign(b)·√disc)/2，兩根為 q/a 與 c/q。
  // 上面兩個提早退出保證此處 q ≠ 0：a < 0 時 √disc > |b|；a > 0 時 b < 0
  // 使 q = (√disc − b)/2 > 0。
  const root = Math.sqrt(disc)
  const q = -0.5 * (b + (b >= 0 ? root : -root))
  const t1 = q / a
  const t2 = c / q

  // a < 0：乘積 c/a < 0，恰有一個正根。
  // a > 0 且 b < 0：兩根皆正，取小的。
  const lo = t1 < t2 ? t1 : t2
  const hi = t1 < t2 ? t2 : t1
  if (lo > 0) return lo
  if (hi > 0) return hi
  return NO_INTERCEPT
}

/**
 * 預瞄方向 = `normalize(P + V·t)`，寫進 out。
 *
 * @returns 攔截時間；無解回傳 NO_INTERCEPT，且**不動 out**——呼叫端因此
 *          可以安全地沿用上一幀的值，不必先清空。
 */
export function solveLead(P: Vector3, V: Vector3, speed: number, out: Vector3): number {
  const t = interceptTime(P, V, speed)
  if (t === NO_INTERCEPT) return NO_INTERCEPT
  out.copy(P).addScaledVector(V, t).normalize()
  return t
}
