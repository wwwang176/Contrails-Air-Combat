import { BufferGeometry, Frustum, Matrix4, type Camera } from 'three'

/**
 * # 逐段剔除的共用零件
 *
 * 植被與近海都是「一條緩衝、好幾格內容」：看不到的格不畫，看得到的格在緩衝裡
 * 連成幾段（run），一段一次 draw call。這裡是與 three 物件無關的那一半 ——
 * 平面、盒子、段 —— 讓它們可以在 node 裡單獨測。
 */

/**
 * 剔除的總開關。**量測出口**：`main.ts` 的 `__cull` 切它，同頁 A/B 用。
 * 關掉時每一池畫整條、近海每一層整條畫、佈景不剔 —— 與改動前的行為相同。
 */
export const CULL = { enabled: true }

const FRUSTUM = new Frustum()
const VIEW_PROJ = new Matrix4()

/**
 * 相機的六個平面寫進 `out`（每個平面 nx, ny, nz, d 四個數，共 24 個）。點在平面內側
 * 時 `n·p + d ≥ 0`，與 three 的 `Plane.distanceToPoint` 同號。
 *
 * 【相機的矩陣要是新的】在 `scene.onBeforeRender` 裡呼叫時，three 已經更新過
 * `matrixWorldInverse`。
 */
export function frustumPlanesOf(camera: Camera, out: Float64Array): void {
  VIEW_PROJ.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  FRUSTUM.setFromProjectionMatrix(VIEW_PROJ)
  for (let k = 0; k < 6; k++) {
    const p = FRUSTUM.planes[k]!
    out[k * 4] = p.normal.x
    out[k * 4 + 1] = p.normal.y
    out[k * 4 + 2] = p.normal.z
    out[k * 4 + 3] = p.constant
  }
}

/**
 * 盒子整個在某一個平面外側就回 true。與 three 的 `Frustum.intersectsBox` 同一個
 * 判法（取朝平面法線最遠的那個角）—— 保守：回 false 的盒子不一定看得到，
 * 回 true 的一定看不到。
 */
export function boxOutside(
  p: Float64Array,
  minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
): boolean {
  for (let k = 0; k < 24; k += 4) {
    const nx = p[k]!
    const ny = p[k + 1]!
    const nz = p[k + 2]!
    const d = nx * (nx > 0 ? maxX : minX) + ny * (ny > 0 ? maxY : minY)
      + nz * (nz > 0 ? maxZ : minZ) + p[k + 3]!
    if (d < 0) return true
  }
  return false
}

/**
 * 格座標在希爾伯特曲線上的位置。**打包順序用它。**
 *
 * 【為什麼是希爾伯特而不是依方位排】順序與重建中心無關：只有髒的池會重建，
 * 各池可能是不同時刻打包的，而同一個座標在每一池、每一次重建都排在同一個位置。
 * 曲線在空間上連續，視錐看得到的格在上面接成少數幾段（6 km 圈、97° 視野，
 * 上限四段時只多畫 4.5% 的格）。
 *
 * 格號 ±32,768（250 m 的格是 ±8,000 km）。
 */
export function hilbertKey(i: number, j: number): number {
  let x = i + 32768
  let y = j + 32768
  let d = 0
  for (let s = 32768; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0
    const ry = (y & s) > 0 ? 1 : 0
    d += s * s * ((3 * rx) ^ ry)
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x
        y = s - 1 - y
      }
      const t = x
      x = y
      y = t
    }
  }
  return d
}

/**
 * 共用頂點屬性與索引的另一顆幾何，各段各自的 `drawRange` 設在自己身上。
 *
 * 【每一段一顆，不共用】three 的 VAO 以幾何為鍵，共用一顆的話同一幀裡幾段輪流改
 * 同一組指標。屬性物件是同一批，所以上傳仍然只有一次。
 */
export function shareGeometry(base: BufferGeometry): BufferGeometry {
  const g = new BufferGeometry()
  for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr)
  g.setIndex(base.index)
  return g
}

/**
 * 看得到的筆接成段，寫進 `outStart` / `outEnd`，回段數。
 *
 * 第 k 筆涵蓋實例 `[starts[k], ends[k])`、包圍盒是 `boxes[k*6 .. k*6+6)`
 *（minX, minY, minZ, maxX, maxY, maxZ）。相鄰兩筆首尾相接才併成同一段。
 *
 * 【段數超過 `cap` 就把間隔最小的兩段併起來】多畫一些看不到的實例，換少一次
 * draw call。間隔一樣大時併前面的，結果與輸入順序一一對應。
 *
 * `outStart` / `outEnd` 至少要有 `n` 格。不配置。
 */
export function visibleRuns(
  n: number, starts: Int32Array, ends: Int32Array, boxes: Float32Array,
  planes: Float64Array, cap: number, outStart: Int32Array, outEnd: Int32Array,
): number {
  let runs = 0
  for (let k = 0; k < n; k++) {
    const b = k * 6
    if (boxOutside(planes, boxes[b]!, boxes[b + 1]!, boxes[b + 2]!,
      boxes[b + 3]!, boxes[b + 4]!, boxes[b + 5]!)) continue
    if (runs > 0 && outEnd[runs - 1] === starts[k]) {
      outEnd[runs - 1] = ends[k]!
    } else {
      outStart[runs] = starts[k]!
      outEnd[runs] = ends[k]!
      runs++
    }
  }
  while (runs > cap) {
    let at = 0
    let gap = Infinity
    for (let r = 0; r + 1 < runs; r++) {
      const g = outStart[r + 1]! - outEnd[r]!
      if (g < gap) {
        gap = g
        at = r
      }
    }
    outEnd[at] = outEnd[at + 1]!
    for (let r = at + 1; r + 1 < runs; r++) {
      outStart[r] = outStart[r + 1]!
      outEnd[r] = outEnd[r + 1]!
    }
    runs--
  }
  return runs
}
