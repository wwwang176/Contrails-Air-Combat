import { BufferAttribute, BufferGeometry } from 'three'
import { hullXAtY, ringAt, type HullRing } from './hull'

/** 座艙罩的一個縱向站位——側視圖上該 z 的上下兩條線。 */
export interface CanopyStation {
  z: number
  /** 艙緣高度。機身在這裡被挖開，玻璃的下緣就接在開口邊上。 */
  sill: number
  /** 罩頂高度。低於或等於 sill 時玻璃收成一點（尾端斜切靠這個收掉）。 */
  roof: number
}

/**
 * 座艙玻璃 —— 蓋在機身開口上的一頂罩子。
 *
 * 截面只有四個點：左右艙緣 + 左右罩頂角。109 的座艙罩是平板玻璃拼起來的，
 * 正視圖就是一個梯形：
 *
 *      /‾‾\     ← topWidth（罩頂平板）
 *     /    \    ← 平的側玻璃
 *    ┴──────┴   ← 艙緣，寬度直接取自機身開口的邊緣
 *
 * 【下緣為什麼一定貼合】艙緣的 x 是用**同一組機身環**求出來的，而且機身在
 * 挖洞時被強制補上了相同 z 的環（見 prepareRings）。兩者算的是同一個交點，
 * 不是各自逼近，所以不會有縫。
 */
export function buildCanopy(
  rings: readonly HullRing[], stations: readonly CanopyStation[], topWidth: number,
): BufferGeometry {
  const outline = (st: CanopyStation): number[][] => {
    if (st.roof <= st.sill) {
      return [[0, st.roof, st.z], [0, st.roof, st.z], [0, st.roof, st.z], [0, st.roof, st.z]]
    }
    const x = hullXAtY(ringAt(rings, st.z).half, st.sill)
    return [
      [x, st.sill, st.z], [topWidth, st.roof, st.z],
      [-topWidth, st.roof, st.z], [-x, st.sill, st.z],
    ]
  }

  const outlines = stations.map(outline)
  const positions: number[] = []
  const tri = (a: number[], b: number[], c: number[]) => {
    positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  }
  // 輪廓方向是 +X → −X、站位方向是 +Z，(−X)×(+Z) = +Y，法線因此朝外
  for (let s = 0; s < outlines.length - 1; s++) {
    const A = outlines[s]!, B = outlines[s + 1]!
    for (let i = 0; i < 3; i++) {
      tri(A[i]!, A[i + 1]!, B[i]!)
      tri(A[i + 1]!, B[i + 1]!, B[i]!)
    }
  }
  // 風擋：首站的輪廓與艙緣連線圍出的面
  const f = outlines[0]!
  const c0 = [0, stations[0]!.sill, stations[0]!.z]
  for (let i = 0; i < 3; i++) tri(c0, f[i + 1]!, f[i]!)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}
