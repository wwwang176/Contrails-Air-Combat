import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { makeHitBox, lowestPoint } from '../../src/world/hit'

/** 暴力解：把八個角點都轉過去，取最低的那個。 */
function brute(
  box: ReturnType<typeof makeHitBox>, q: Quaternion, pos: Vector3,
): { y: number; p: Vector3 } {
  let best = Infinity
  const bp = new Vector3()
  const t = new Vector3()
  for (let s = 0; s < 8; s++) {
    t.set(
      box.center.x + (s & 1 ? box.half.x : -box.half.x),
      box.center.y + (s & 2 ? box.half.y : -box.half.y),
      box.center.z + (s & 4 ? box.half.z : -box.half.z),
    ).applyQuaternion(q).add(pos)
    if (t.y < best) {
      best = t.y
      bp.copy(t)
    }
  }
  return { y: best, p: bp }
}

/** 把八個角點都轉到世界座標。 */
function corners(
  box: ReturnType<typeof makeHitBox>, q: Quaternion, pos: Vector3,
): Vector3[] {
  const out: Vector3[] = []
  for (let s = 0; s < 8; s++) {
    out.push(new Vector3(
      box.center.x + (s & 1 ? box.half.x : -box.half.x),
      box.center.y + (s & 2 ? box.half.y : -box.half.y),
      box.center.z + (s & 4 ? box.half.z : -box.half.z),
    ).applyQuaternion(q).add(pos))
  }
  return out
}

/** 由索引決定的可重現「隨機」四元數 —— 不用 Math.random()，失敗可重放。 */
function poseOf(i: number): Quaternion {
  const a = (i * 0.7853981633974483) % (Math.PI * 2)
  const b = (i * 1.1071487177940904) % (Math.PI * 2)
  const c = (i * 0.4636476090008061) % (Math.PI * 2)
  return new Quaternion()
    .setFromAxisAngle(new Vector3(1, 0, 0), a)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), b))
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), c))
}

const WING = makeHitBox('wingRight', [0.44, -0.86, -0.97], [5.65, -0.08, 2.06])

describe('lowestPoint —— 旋轉後 OBB 的最低點（M8 spec §9.1）', () => {
  it('無旋轉時就是盒底', () => {
    const out = new Vector3()
    const y = lowestPoint(WING, new Quaternion(), new Vector3(0, 100, 0), out)
    expect(y).toBeCloseTo(100 - 0.86, 6)
    expect(out.y).toBeCloseTo(y, 9)
  })

  it('最低高度與暴力列舉八個角點一致 —— 1000 個姿態', () => {
    // 【為什麼要對照暴力解】解析式是這份計畫裡唯一一段「算錯了只會看起來
    // 有點怪」的數學：翼尖入水的時機差半個翼展，在畫面上只是「水花好像
    // 晚了一點」，不會壞給你看。
    const out = new Vector3()
    const pos = new Vector3()
    for (let i = 1; i <= 1000; i++) {
      const q = poseOf(i)
      pos.set(i % 37, 200 + (i % 11), -(i % 23))
      const y = lowestPoint(WING, q, pos, out)
      expect(y).toBeCloseTo(brute(WING, q, pos).y, 6)
    }
  })

  it('out 是一個真的角點，而且它的高度就是回傳值', () => {
    // 【為什麼不斷言「等於暴力解挑中的那一個」】旋轉矩陣第二列有某一項為
    // 零時（例如 i=8 那個姿態的 r2 = −2.8e−17），那一軸對世界 Y 沒有貢獻，
    // 於是**兩個角點的高度完全相同** —— 兩個都是合法的最低角點，暴力解挑
    // 哪一個只取決於它的迴圈順序。契約是「最低的高度」與「out 落在盒上」，
    // 不是「與某個特定實作挑中同一個角」。
    const out = new Vector3()
    const pos = new Vector3()
    for (let i = 1; i <= 1000; i++) {
      const q = poseOf(i)
      pos.set(i % 37, 200 + (i % 11), -(i % 23))
      const y = lowestPoint(WING, q, pos, out)
      expect(out.y).toBeCloseTo(y, 9)
      const onBox = corners(WING, q, pos).some((c) => c.distanceTo(out) < 1e-6)
      expect(onBox).toBe(true)
    }
  })

  it('翻滾中翼尖比機身重心低 —— 這就是要它的理由', () => {
    // 繞 Z 轉 −90°：右翼盒（機體 +X）被轉到下方
    const out = new Vector3()
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2)
    const y = lowestPoint(WING, q, new Vector3(0, 0, 0), out)
    // 翼尖在機體 x = 5.65 —— 最低點應該低到 −5.65，不是盒底的 −0.86
    expect(y).toBeCloseTo(-5.65, 6)
  })
})
