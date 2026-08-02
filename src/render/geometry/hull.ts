import { BufferAttribute, BufferGeometry } from 'three'

/**
 * 一圈機身外殼，只存**右半**（x ≥ 0），由正上方繞到正下方。
 *
 * 【為什麼只存半圈】左半一律鏡像產生。參考模型本身不是左右對稱的（單側
 * 增壓器進氣口就是一例），照量測值兩邊各存一份會把那些不對稱烘進機身，
 * 看起來像量歪了。不對稱的特徵應該是**另外貼上去的零件**。
 *
 * 每一圈的點數必須一致，站位之間才能直接串成四邊形帶。
 */
export interface HullRing {
  z: number
  /** [x, y]，第一點在正上方（背線）、最後一點在正下方（腹線） */
  half: readonly (readonly [number, number])[]
}

/**
 * 座艙開口：把機身在這一段的**艙緣以上**整個挖掉。
 *
 * 【為什麼機身要真的挖洞】先前是把座艙罩當成貼在封閉機身上的一片殼，
 * 透過半透明玻璃看到的還是機身蒙皮，讀起來就不是座艙。想在 lofting 的
 * 封閉管子上做出凹口，唯一的辦法是壓扁該段截面，但截面一壓扁，同一站位
 * 的**寬度**也跟著縮——實測艙緣高度的半寬會由 0.401 掉到 0.314，機身在
 * 座艙處出現一個腰身。
 *
 * 改成烘焙成顯式頂點之後就沒有這個限制：直接不要輸出艙緣以上的面即可。
 */
export interface CockpitCut {
  /** 艙緣線，(z, y) 折線。z 範圍以外不挖。 */
  sill: readonly (readonly [number, number])[]
}

/** 折線在 z 處的值；超出範圍回傳 null（＝該站位不挖）。 */
function sillAt(cut: CockpitCut | undefined, z: number): number | null {
  if (!cut) return null
  const s = cut.sill
  if (z < s[0]![0] || z > s[s.length - 1]![0]) return null
  for (let i = 0; i < s.length - 1; i++) {
    const [z0, y0] = s[i]!
    const [z1, y1] = s[i + 1]!
    if (z > z1) continue
    return y0 + ((y1 - y0) * (z - z0)) / (z1 - z0)
  }
  return s[s.length - 1]![1]
}

/**
 * 半剖面在高度 y 的 x（沿折線內插）。艙緣落在兩個頂點之間時用它求交點，
 * 挖出來的邊緣才是一條水平線，而不是跟著多邊形頂點鋸齒狀。
 */
function xAtY(half: readonly (readonly [number, number])[], y: number): number {
  for (let i = 0; i < half.length - 1; i++) {
    const [x0, y0] = half[i]!
    const [x1, y1] = half[i + 1]!
    if ((y0 - y) * (y1 - y) > 0) continue
    if (y0 === y1) return Math.max(x0, x1)
    return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0)
  }
  return 0
}

/** 完整一圈（右半 + 鏡像左半），回傳 [x, y] 陣列。頭尾不重複。 */
function fullRing(half: readonly (readonly [number, number])[]): number[][] {
  const right = half.map(([x, y]) => [x, y])
  // 左半：由下往上，跳過正下方與正上方兩個共用點
  const left = half.slice(1, -1).reverse().map(([x, y]) => [-x, y])
  return [...right, ...left]
}


/** 兩圈之間逐點線性內插（點數相同才有意義）。 */
export function ringAt(rings: readonly HullRing[], z: number): HullRing {
  if (z <= rings[0]!.z) return rings[0]!
  const last = rings[rings.length - 1]!
  if (z >= last.z) return last
  let i = 0
  while (rings[i + 1]!.z < z) i++
  const a = rings[i]!, b = rings[i + 1]!
  const t = (z - a.z) / (b.z - a.z)
  return {
    z,
    half: a.half.map(([x, y], k) => [
      x + (b.half[k]![0] - x) * t,
      y + (b.half[k]![1] - y) * t,
    ] as const),
  }
}

/**
 * 在指定的 z 補上內插環並重新排序。
 *
 * 【為什麼要補】座艙開口的艙緣線與玻璃下緣必須落在**同一組 z**，否則兩者
 * 在站位之間各自線性內插，邊緣就對不齊，玻璃與機體之間會出現縫。
 */
export function prepareRings(rings: readonly HullRing[], extraZ: readonly number[]): HullRing[] {
  const out = [...rings]
  for (const z of extraZ) {
    if (out.some((r) => Math.abs(r.z - z) < 1e-6)) continue
    out.push(ringAt(rings, z))
  }
  return out.sort((a, b) => a.z - b.z)
}

/** 半剖面在高度 y 的 x —— 座艙玻璃要用它把下緣接到開口邊緣上。 */
export function hullXAtY(half: readonly (readonly [number, number])[], y: number): number {
  return xAtY(half, y)
}

export interface HullResult {
  geometry: BufferGeometry
  /**
   * 開口邊緣：每個被挖到的站位的 (z, x, y)，x 為右側艙緣的半寬。
   * 座艙玻璃與內裝直接接在這條線上，機體與玻璃因此一定銜接。
   */
  rim: { z: number; x: number; y: number }[]
}

/**
 * 由烘焙好的環產生機身，並可挖出座艙開口。
 *
 * 【為什麼不再用超橢圓參數即時算】環的數值是從參考模型切片量出來的，本來
 * 就是一組頂點；保留成頂點才有辦法挖洞。參數式只能生出封閉的管子。
 */
export function buildHull(rings: readonly HullRing[], cut?: CockpitCut): HullResult {
  const n = rings[0]!.half.length
  const ringCount = 2 * n - 2

  /** 每個站位：完整一圈的座標，以及「哪些點被艙緣壓平了」。 */
  const built = rings.map((r) => {
    const sill = sillAt(cut, r.z)
    const pts = fullRing(r.half)
    const cutFlag = pts.map(() => false)
    if (sill !== null) {
      const xs = xAtY(r.half, sill)
      for (let i = 0; i < pts.length; i++) {
        if (pts[i]![1]! <= sill) continue
        pts[i] = [Math.sign(pts[i]![0]!) * xs, sill]
        cutFlag[i] = true
      }
    }
    return { z: r.z, pts, cutFlag, sill, xs: sill === null ? 0 : xAtY(r.half, sill) }
  })

  const positions: number[] = []
  const tri = (a: number[], b: number[], c: number[], z0: number, z1: number, z2: number) => {
    positions.push(a[0]!, a[1]!, z0, b[0]!, b[1]!, z1, c[0]!, c[1]!, z2)
  }

  for (let s = 0; s < built.length - 1; s++) {
    const A = built[s]!
    const B = built[s + 1]!
    for (let i = 0; i < ringCount; i++) {
      const j = (i + 1) % ringCount
      // 四個角都被壓到艙緣 → 這一塊整個在開口裡，不輸出
      if (A.cutFlag[i] && A.cutFlag[j] && B.cutFlag[i] && B.cutFlag[j]) continue
      // 環是由正上方**順時針**繞回正上方（右半由上而下、左半由下而上），
      // 站位方向是 +Z。右側的 (−Y)×(+Z) = −X 是朝內的，所以要用下面這個
      // 順序才會朝外——與 buildFuselage 的逆時針環剛好相反。
      tri(A.pts[i]!, B.pts[i]!, B.pts[j]!, A.z, B.z, B.z)
      tri(A.pts[i]!, B.pts[j]!, A.pts[j]!, A.z, B.z, A.z)
    }
  }

  // 首尾封口。開口不會延伸到頭尾，所以這裡一定是完整的圈。
  const cap = (r: typeof built[number], reverse: boolean) => {
    const cy = (r.pts[0]![1]! + r.pts[n - 1]![1]!) / 2
    for (let i = 0; i < ringCount; i++) {
      const j = (i + 1) % ringCount
      if (reverse) tri([0, cy], r.pts[i]!, r.pts[j]!, r.z, r.z, r.z)
      else tri([0, cy], r.pts[j]!, r.pts[i]!, r.z, r.z, r.z)
    }
  }
  cap(built[0]!, true)
  cap(built[built.length - 1]!, false)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()

  const rim = built.filter((b) => b.sill !== null)
    .map((b) => ({ z: b.z, x: b.xs, y: b.sill! }))
  return { geometry, rim }
}

/**
 * 座艙內裝 —— 開口下方的一層暗色內殼。
 *
 * 【為什麼一定要有】機身挖洞之後，從開口看進去會直接穿到另一側蒙皮的
 * **背面**；背面被剔除，於是看到的是背景。內裝把洞封起來，同時提供
 * 「凹進去」的暗影。
 */
export function buildCockpitTub(
  rings: readonly HullRing[], cut: CockpitCut, inset: number, floor: number,
): BufferGeometry {
  const inRange = (z: number) => sillAt(cut, z) !== null
  const used = rings.filter((r) => inRange(r.z))
  if (used.length < 2) return new BufferGeometry()

  /** 每站位一圈內殼：由右艙緣沿內縮的剖面往下繞到左艙緣，底部收平到 floor。 */
  const loop = (r: HullRing): number[][] => {
    const sill = sillAt(cut, r.z)!
    const pts: number[][] = []
    for (const [x, y] of r.half) {
      if (y > sill) continue
      pts.push([x * inset, Math.max(floor, y * inset + (1 - inset) * sill), r.z])
    }
    if (!pts.length) pts.push([0, floor, r.z])
    const mirrored = pts.slice(0, -1).reverse().map((p) => [-p[0]!, p[1]!, p[2]!])
    return [...pts, ...mirrored]
  }

  const loops = used.map(loop)
  const m = Math.min(...loops.map((l) => l.length))
  const positions: number[] = []
  const tri = (a: number[], b: number[], c: number[]) => {
    positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  }
  // 法線朝**內**（從開口往下看要看得到），因此纏繞方向與機身相反
  for (let s = 0; s < loops.length - 1; s++) {
    const A = loops[s]!, B = loops[s + 1]!
    for (let i = 0; i < m - 1; i++) {
      tri(A[i]!, B[i]!, B[i + 1]!)
      tri(A[i]!, B[i + 1]!, A[i + 1]!)
    }
  }
  // 前後隔板，否則從斜前方能看穿座艙
  const bulkhead = (l: number[][], reverse: boolean) => {
    const c = [0, floor, l[0]![2]!]
    for (let i = 0; i < m - 1; i++) {
      if (reverse) tri(c, l[i + 1]!, l[i]!)
      else tri(c, l[i]!, l[i + 1]!)
    }
  }
  bulkhead(loops[0]!, false)
  bulkhead(loops[loops.length - 1]!, true)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}
