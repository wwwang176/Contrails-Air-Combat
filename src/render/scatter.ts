import { Vector3 } from 'three'

/**
 * 32 位元整數雜湊 → [0, 1)。
 *
 * 【為什麼不用 `Math.random()`】與 `battle/setup.ts` 的 `altitudeOffset`
 * 避開亂數同一個理由：亂數要嘛需要一顆種子與一個 PRNG，要嘛就毀掉可
 * 測試性。用索引的雜湊之後 `coneDirection` 是純函數，「恆在錐內」這一條
 * 才測得起來。
 */
export function hash01(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const AXIS = new Vector3()
const TANGENT = new Vector3()
const BITANGENT = new Vector3()

/**
 * 在軸周圍 `cone` 半角的圓錐內取一個方向，**由 `index` 決定**。
 *
 * `cone = Math.PI` 就是等向（整個球面），火球用它。
 *
 * 【為什麼是共用的而不是每個特效各抄一份】火花（法線錐）、火球（等向）、
 * 零件（沿飛行方向的錐）、噴濺（繞世界 +Y 的錐）要的都是同一件事，只有
 * 半角與軸不同。四份長得一樣的副本就是只有一份會被修好的那種危險。
 *
 * 熱路徑之外（每次事件十幾次），但仍然不配置。
 */
export function coneDirection(
  ax: number, ay: number, az: number, cone: number, index: number, out: Vector3,
): void {
  AXIS.set(ax, ay, az)
  const len = AXIS.length()
  // 【零向量的防護】NaN 一旦進入實例矩陣，整批粒子會靜靜地消失而且完全
  // 不報錯（與 assess.ts 的防護同一個理由）。
  if (len < 1e-6) AXIS.set(0, 1, 0)
  else AXIS.divideScalar(len)

  // 與 AXIS 最不平行的座標軸，拿來造切線
  const bx = Math.abs(AXIS.x)
  const by = Math.abs(AXIS.y)
  const bz = Math.abs(AXIS.z)
  if (bx <= by && bx <= bz) TANGENT.set(1, 0, 0)
  else if (by <= bz) TANGENT.set(0, 1, 0)
  else TANGENT.set(0, 0, 1)
  TANGENT.cross(AXIS).normalize()
  BITANGENT.copy(AXIS).cross(TANGENT)

  const phi = hash01(index) * Math.PI * 2
  const cosMax = Math.cos(cone)
  // 均勻取在 [cosMax, 1]：立體角上均勻，不會擠在錐心
  const cosT = cosMax + (1 - cosMax) * hash01(index * 2 + 1)
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT))

  out.copy(AXIS).multiplyScalar(cosT)
    .addScaledVector(TANGENT, Math.cos(phi) * sinT)
    .addScaledVector(BITANGENT, Math.sin(phi) * sinT)
  const l = out.length()
  if (l > 1e-9) out.divideScalar(l)
  else out.copy(AXIS)
}
