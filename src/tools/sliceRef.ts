import { Mesh, Object3D, Vector3 } from 'three'

/**
 * 把參考模型沿三根軸各切 N 刀，量出每一刀的截面輪廓。
 *
 * 【為什麼是切片而不是分類節點】先前試過解析 GLB 再挑出「機身」節點：解析
 * 沒問題（三角形數與檔頭一致），但第三方模型有兩百多個節點，蒙皮、內裝、
 * 發動機、起落架、螺旋槳混在一起，靠幾何猜測分類並不可靠——實測某一站位
 * 量到的半寬是 ±0.22，而被判為「機身」的節點包圍盒卻說 ±0.55。
 *
 * 切片完全不需要分類：往外射線取**最外側**的交點就好，內裝、座椅、發動機
 * 都在蒙皮之內，自然落選。
 *
 * 【為什麼三根軸都要切】一組切面只描述得了一種零件：
 *
 *   Z 切（橫剖）  機身剖面。射線由機身軸心往外，得到 r(θ)。
 *   X 切（縱剖）  機翼翼型。在翼展站位 x 上，截面的 z 幅度是弦長、
 *                 y 幅度是厚度——機翼的厚弦比直接量得到。
 *   Y 切（水平）  平面形。在機翼高度上，截面的 x 幅度是翼展，
 *                 每個 x 的 z 幅度是該站位弦長，前後緣位置一併得到。
 *
 * 【兩個東西一定會混進來】機翼與起落架是真的長在外面的。Z 切在翼根站位，
 * 水平方向的射線會先穿出機身、再打到機翼；朝下的射線會打到輪子。靠
 * maxRadius 上限擋掉大部分，剩下的要看剖面圖人工確認。
 *
 * 所以輸出的是**量測結果**而不是定案幾何。
 */

export type Axis = 'x' | 'y' | 'z'

/** 截面上的一條線段，座標是「切軸以外的兩根軸」，順序見 planeAxes。 */
export interface Seg { u0: number; v0: number; u1: number; v1: number }

/** 切 axis 軸時，截面平面上的 (u, v) 各是哪根軸。 */
export function planeAxes(axis: Axis): [Axis, Axis] {
  return axis === 'z' ? ['x', 'y'] : axis === 'y' ? ['x', 'z'] : ['z', 'y']
}

const IDX: Record<Axis, number> = { x: 0, y: 1, z: 2 }

/**
 * 世界座標的三角形，攤平成 [ax,ay,az, bx,by,bz, cx,cy,cz] × T。
 *
 * 【`only` 是 2026-08-17 為玻璃機首加的，而且它是坑 5 的**例外**不是反例】
 * 坑 5 說「不要靠節點分類去隔離機身」—— 因為蒙皮、隔框、內裝在第三方模型
 * 裡混成一團，猜錯了不會有任何症狀。但**玻璃**是另一種材質，任何模型都會
 * 把它分成獨立 mesh，名字也叫得出來（這台是 `windows_windows_0`）。
 *
 * 更關鍵的是：玻璃的範圍**根本沒有別的量法**。射線只回報「最外側打到什麼」，
 * 不會說那是蒙皮還是玻璃 —— 不給名字就只能用眼睛看照片猜（坑 15）。
 */
export function collectTriangles(root: Object3D, only?: RegExp): Float32Array {
  root.updateMatrixWorld(true)
  const out: number[] = []
  const v = new Vector3()
  root.traverse((o) => {
    const mesh = o as Mesh
    const pos = mesh.geometry?.getAttribute?.('position')
    if (!pos) return
    if (only && !only.test(mesh.name)) return
    const idx = mesh.geometry.index
    const count = idx ? idx.count : pos.count
    for (let i = 0; i < count; i++) {
      const k = idx ? idx.getX(i) : i
      v.set(pos.getX(k), pos.getY(k), pos.getZ(k)).applyMatrix4(mesh.matrixWorld)
      out.push(v.x, v.y, v.z)
    }
  })
  return new Float32Array(out)
}

/** 三角形與「axis = plane」的交線段。 */
export function crossSection(tris: Float32Array, axis: Axis, plane: number): Seg[] {
  const a = IDX[axis]
  const [uA, vA] = planeAxes(axis)
  const u = IDX[uA], v = IDX[vA]
  const segs: Seg[] = []
  for (let t = 0; t < tris.length; t += 9) {
    const pts: number[][] = []
    for (let e = 0; e < 3; e++) {
      const i = t + e * 3
      const j = t + ((e + 1) % 3) * 3
      const p0 = tris[i + a]!, p1 = tris[j + a]!
      if ((p0 - plane) * (p1 - plane) > 0 || p0 === p1) continue
      const s = (plane - p0) / (p1 - p0)
      pts.push([
        tris[i + u]! + (tris[j + u]! - tris[i + u]!) * s,
        tris[i + v]! + (tris[j + v]! - tris[i + v]!) * s,
      ])
    }
    if (pts.length >= 2) {
      segs.push({ u0: pts[0]![0]!, v0: pts[0]![1]!, u1: pts[1]![0]!, v1: pts[1]![1]! })
    }
  }
  return segs
}

/**
 * 由 (axisU, axisV) 往角度 th 射出，回傳與所有線段交點中**最外側**且不超過
 * maxRadius 的距離；沒有交點回傳 0。
 *
 * 【axisU 是 2026-08-16 為 He 111 加的】原本原點固定在 u = 0（機身軸心）。
 * 那對單發戰機夠用，但**掛在機翼上的發動機艙**在 u = ±3 m 外 —— 從機身
 * 軸心射出去的射線會先穿過機身、再穿過機翼，取到的「最外側」是機翼下表面
 * 或翼尖，不是發動機艙。
 *
 * 這與座艙罩那一招是同一個手法（`aircraft-from-reference` 第 2 步）：
 * **換一個射線原點，就能把被擋住的東西單獨量出來。** 那次移的是 v，
 * 這次移的是 u。
 */
function castRay(
  segs: readonly Seg[], axisU: number, axisV: number, th: number, maxRadius: number,
): number {
  const du = Math.cos(th), dv = Math.sin(th)
  let best = 0
  for (const s of segs) {
    const eu = s.u1 - s.u0, ev = s.v1 - s.v0
    const den = du * ev - dv * eu
    if (Math.abs(den) < 1e-12) continue
    const pu = s.u0 - axisU, pv = s.v0 - axisV
    const t = (pu * ev - pv * eu) / den          // 沿射線的距離
    const w = (pu * dv - pv * du) / den          // 線段參數
    if (t <= 0 || t > maxRadius || w < 0 || w > 1) continue
    if (t > best) best = t
  }
  return best
}

export interface RadialSlices {
  axis: Axis
  planes: number[]
  theta: number[]
  /** r[平面][角度]，量不到就是 0 */
  r: number[][]
  /** 射線原點，量到的 r 要配這一組才還原得回座標 */
  axisU: number
  axisV: number
}

/**
 * 沿 axis 切 N 刀，每刀量 r(θ)。用於機身剖面。
 *
 * `axisU` 省略時是 0（機身軸心），與 2026-08-16 之前的行為逐字相同。
 */
export function radialSlices(
  tris: Float32Array, axis: Axis,
  o: {
    from: number; to: number; count: number; angles: number
    axisV: number; maxRadius: number
    /** 射線原點的橫向偏移。發動機艙那類離軸的零件要用，見 castRay */
    axisU?: number
  },
): RadialSlices {
  const axisU = o.axisU ?? 0
  const theta = Array.from({ length: o.angles }, (_, j) => (j / o.angles) * Math.PI * 2)
  const planes: number[] = []
  const r: number[][] = []
  for (let k = 0; k < o.count; k++) {
    const p = o.from + ((o.to - o.from) * k) / (o.count - 1)
    const segs = crossSection(tris, axis, p)
    planes.push(p)
    r.push(theta.map((th) => castRay(segs, axisU, o.axisV, th, o.maxRadius)))
  }
  return { axis, planes, theta, r, axisU, axisV: o.axisV }
}

export interface ExtentSlices {
  axis: Axis
  planes: number[]
  /** 截面在 (u, v) 兩軸的範圍；沒有截面則四個值都是 NaN */
  uMin: number[]; uMax: number[]; vMin: number[]; vMax: number[]
  /** 落在截面內的線段數，太少代表這一刀不可信 */
  count: number[]
}

/**
 * 沿 axis 切 N 刀，只回報每刀的 (u, v) 範圍。
 * 機翼用這個就夠了：X 切得到弦長與厚度，Y 切得到平面形。
 */
export function extentSlices(
  tris: Float32Array, axis: Axis,
  o: { from: number; to: number; count: number; uWindow?: [number, number] },
): ExtentSlices {
  const out: ExtentSlices = {
    axis, planes: [], uMin: [], uMax: [], vMin: [], vMax: [], count: [],
  }
  for (let k = 0; k < o.count; k++) {
    const p = o.from + ((o.to - o.from) * k) / (o.count - 1)
    const segs = crossSection(tris, axis, p)
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity, n = 0
    for (const s of segs) {
      for (const [u, v] of [[s.u0, s.v0], [s.u1, s.v1]] as const) {
        if (o.uWindow && (u! < o.uWindow[0] || u! > o.uWindow[1])) continue
        uMin = Math.min(uMin, u!); uMax = Math.max(uMax, u!)
        vMin = Math.min(vMin, v!); vMax = Math.max(vMax, v!)
        n++
      }
    }
    out.planes.push(p)
    out.uMin.push(uMin); out.uMax.push(uMax)
    out.vMin.push(vMin); out.vMax.push(vMax)
    out.count.push(n)
  }
  return out
}
