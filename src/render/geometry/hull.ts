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

/**
 * 外殼上的一塊玻璃 —— z 範圍 × 剖面點索引範圍，左右對稱。
 *
 * 【為什麼玻璃是「外殼的一部分」而不是貼上去的零件】另外兩台的座艙罩確實
 * 是加在蒙皮上的罩子，但轟炸機的機背機槍座與機腹吊艙不是：那幾片**就是
 * 蒙皮**，只是材質不同。實測參考模型的 `windows` mesh，玻璃的下緣與蒙皮的
 * 下緣逐字相同。
 *
 * 用「哪幾片」而不是「哪個高度」來描述，是因為外殼已經是烘焙好的頂點 ——
 * 索引直接對應 `HullRing.half` 的第幾點，量測腳本的 `glass` 那一格印出來的
 * 就是這個索引。
 */
export interface GlassPatch {
  from: number
  to: number
  /** `HullRing.half` 的索引範圍（含）。0 = 正上方、最後一點 = 正下方 */
  i0: number
  i1: number
}

export interface HullResult {
  geometry: BufferGeometry
  /**
   * 玻璃那幾片。**與 `geometry` 互補** —— 兩者合起來仍然是完整的一層外殼，
   * 玻璃只是被挑出來換材質。
   */
  glassGeometry: BufferGeometry
  /**
   * 玻璃後面的暗色襯裡。
   *
   * 【為什麼非有不可】玻璃是半透明的，透過去看到的是機身**另一側的背面**
   * ——而背面被剔除，於是看到的是背景。機首那一段靠後段外殼的前封口擋住
   * （那就是真機的隔框），但機背與機腹那兩塊沒有東西擋。
   *
   * 襯裡是同幾片往內縮的複製品，法線仍然朝外 —— 從玻璃看進去看到的是它的
   * 正面，讀起來就是「玻璃後面有個暗艙」。
   */
  glassBackGeometry: BufferGeometry
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
export function buildHull(
  rings: readonly HullRing[], cut?: CockpitCut,
  /**
   * 首尾要不要封口。預設都封。
   *
   * 【為什麼會有不封的情形】He 111 的**全玻璃機首**：機身外殼在某一站切成
   * 兩截，前段用玻璃材質、後段用機身色。兩截都封口的話，接縫處會有兩張
   * 完全重疊的面 —— z-fighting，而且透過玻璃看過去閃爍得很明顯。
   *
   * 讓玻璃那一截**不封後端**，只留機身那一截的前封口 —— 那張面就是真機
   * 玻璃機首後方的**隔框**，本來就該在那裡。
   */
  caps?: { front?: boolean; back?: boolean },
  glass?: readonly GlassPatch[],
): HullResult {
  const n = rings[0]!.half.length
  const ringCount = 2 * n - 2
  /**
   * 完整一圈的索引 → `half` 的索引。右半 0…n−1 直接對應；左半 n…2n−3 是
   * `half.slice(1, -1).reverse()`，所以是 2n−2−k。
   */
  const halfIndex = (k: number) => (k < n ? k : ringCount - k)
  /** 這一片（跨站位 s→s+1、跨環向 i→j）是不是玻璃 */
  const isGlass = (z: number, i: number, j: number): boolean => {
    if (!glass) return false
    const a = halfIndex(i), b = halfIndex(j)
    return glass.some((p) => (
      z >= p.from && z <= p.to
      && a >= p.i0 && a <= p.i1 && b >= p.i0 && b <= p.i1
    ))
  }
  /**
   * ── 玻璃是**凹槽**，不是貼平的一片窗 ────────────────────────
   *
   * 【P-51D 的做法，以及為什麼要照抄】它的座艙是 `CockpitCut` 把艙緣以上的
   * 面**整片不輸出**（機身真的挖開）、底下墊一層暗色內裝、玻璃再蓋上去。
   * 那三件事合起來才讀得出「這裡凹進去了」。
   *
   * 第一版的玻璃與蒙皮**共面** —— 只是同一批三角形換了材質。低多邊形下那
   * 讀起來是一張貼紙，不是艙口。
   *
   * 【為什麼不直接用 CockpitCut】它只支援**一個**開口、而且永遠切頂部
   * （艙緣是一條 (z, y) 折線，把該高度以上壓平）。機腹吊艙在正下方、側窗在
   * 腰線 —— 三個都要，所以改成「任意角度區段」的版本。
   *
   * 【三個數字】
   *   蒙皮      1.00  那幾片不輸出，機身在這裡是破的
   *   玻璃      0.94  沉下去約 6 cm（機身半徑 ~1 m）
   *   襯裡      0.84  再往內 10 cm，暗色，擋住「看穿到背景」
   * 中間由**框壁**接起來 —— 沒有框壁的話蒙皮與玻璃之間是一圈空隙，凹槽
   * 讀不出來而且側面看得到破口。
   */
  const GLASS_SINK = 0.94
  const BACK_INSET = 0.84

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
  const glassPos: number[] = []
  const backPos: number[] = []
  const into = (out: number[]) =>
    (a: number[], b: number[], c: number[], z0: number, z1: number, z2: number) => {
      out.push(a[0]!, a[1]!, z0, b[0]!, b[1]!, z1, c[0]!, c[1]!, z2)
    }
  const tri = into(positions)
  const triGlass = into(glassPos)
  const triBack = into(backPos)

  /** 剖面中心（背線與腹線的中點）—— 玻璃與襯裡都往這裡縮 */
  const centerY = (r: typeof built[number]) => (r.pts[0]![1]! + r.pts[n - 1]![1]!) / 2
  const sink = (r: typeof built[number], p: number[], k: number): number[] => {
    const cy = centerY(r)
    return [p[0]! * k, cy + (p[1]! - cy) * k]
  }

  /** 站位 s→s+1、環向 i→i+1 那一片是不是玻璃（超出範圍算不是） */
  const glassQuad = (s: number, i: number): boolean => {
    if (s < 0 || s >= built.length - 1) return false
    const k = ((i % ringCount) + ringCount) % ringCount
    return isGlass((built[s]!.z + built[s + 1]!.z) / 2, k, (k + 1) % ringCount)
  }

  for (let s = 0; s < built.length - 1; s++) {
    const A = built[s]!
    const B = built[s + 1]!
    const zMid = (A.z + B.z) / 2
    for (let i = 0; i < ringCount; i++) {
      const j = (i + 1) % ringCount
      // 四個角都被壓到艙緣 → 這一塊整個在開口裡，不輸出
      if (A.cutFlag[i] && A.cutFlag[j] && B.cutFlag[i] && B.cutFlag[j]) continue

      if (!isGlass(zMid, i, j)) {
        // 環是由正上方**順時針**繞回正上方（右半由上而下、左半由下而上），
        // 站位方向是 +Z。右側的 (−Y)×(+Z) = −X 是朝內的，所以要用下面這個
        // 順序才會朝外——與 buildFuselage 的逆時針環剛好相反。
        tri(A.pts[i]!, B.pts[i]!, B.pts[j]!, A.z, B.z, B.z)
        tri(A.pts[i]!, B.pts[j]!, A.pts[j]!, A.z, B.z, A.z)
        continue
      }

      // ── 凹槽：蒙皮那一片不輸出，改成沉下去的玻璃 + 暗色襯裡 ──
      const [gAi, gAj] = [sink(A, A.pts[i]!, GLASS_SINK), sink(A, A.pts[j]!, GLASS_SINK)]
      const [gBi, gBj] = [sink(B, B.pts[i]!, GLASS_SINK), sink(B, B.pts[j]!, GLASS_SINK)]
      triGlass(gAi, gBi, gBj, A.z, B.z, B.z)
      triGlass(gAi, gBj, gAj, A.z, B.z, A.z)

      const [bAi, bAj] = [sink(A, A.pts[i]!, BACK_INSET), sink(A, A.pts[j]!, BACK_INSET)]
      const [bBi, bBj] = [sink(B, B.pts[i]!, BACK_INSET), sink(B, B.pts[j]!, BACK_INSET)]
      triBack(bAi, bBi, bBj, A.z, B.z, B.z)
      triBack(bAi, bBj, bAj, A.z, B.z, A.z)

      /**
       * ── 框壁：只長在**凹槽的邊界**上 ────────────────────────
       *
       * 【兩面各畫一次】框壁只有 6 cm 高，從凹槽外側與內側都看得到。逐邊
       * 判斷該朝哪一面是四個 case（前緣朝 +Z、後緣朝 −Z、左右各一），
       * **錯一個那一片就整條消失**而且不會有任何錯誤 —— 兩面各畫一次比較
       * 便宜，也不可能錯。帶符號體積互相抵銷，所以「法線朝外」那條護欄
       * 仍然量得到機身本體。
       */
      const wall = (p0: number[], p1: number[], q0: number[], q1: number[],
        z0: number, z1: number) => {
        tri(p0, p1, q1, z0, z1, z1); tri(p0, q1, q0, z0, z1, z0)
        tri(p0, q1, p1, z0, z1, z1); tri(p0, q0, q1, z0, z0, z1)
      }
      // 前緣（站位 A 那一側）／後緣（站位 B 那一側）
      if (!glassQuad(s - 1, i)) wall(A.pts[i]!, A.pts[j]!, gAi, gAj, A.z, A.z)
      if (!glassQuad(s + 1, i)) wall(B.pts[i]!, B.pts[j]!, gBi, gBj, B.z, B.z)
      // 環向的兩側
      if (!glassQuad(s, i - 1)) wall(A.pts[i]!, B.pts[i]!, gAi, gBi, A.z, B.z)
      if (!glassQuad(s, i + 1)) wall(A.pts[j]!, B.pts[j]!, gAj, gBj, A.z, B.z)
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
  if (caps?.front !== false) cap(built[0]!, true)
  if (caps?.back !== false) cap(built[built.length - 1]!, false)

  const mesh = (pts: readonly number[]): BufferGeometry => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3))
    g.computeVertexNormals()
    return g
  }

  const rim = built.filter((b) => b.sill !== null)
    .map((b) => ({ z: b.z, x: b.xs, y: b.sill! }))
  return {
    geometry: mesh(positions),
    glassGeometry: mesh(glassPos),
    glassBackGeometry: mesh(backPos),
    rim,
  }
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
  /**
   * 法線朝**內** —— 從開口往下看，看到的是這層殼的內側。
   *
   * 【第一版寫成跟機身同向了】那讓內裝的正面朝外、被機身擋住，而朝內的是
   * 背面、被背面剔除掉——結果是「暗色內裝完全看不到」，從開口直接看穿。
   * 機身的朝外順序是 (A_i, B_i, B_j)，這裡必須整個反過來。
   */
  for (let s = 0; s < loops.length - 1; s++) {
    const A = loops[s]!, B = loops[s + 1]!
    for (let i = 0; i < m - 1; i++) {
      tri(A[i]!, B[i + 1]!, B[i]!)
      tri(A[i]!, A[i + 1]!, B[i + 1]!)
    }
  }
  // 前後隔板，否則從斜前方能看穿座艙
  const bulkhead = (l: number[][], reverse: boolean) => {
    const c = [0, floor, l[0]![2]!]
    for (let i = 0; i < m - 1; i++) {
      if (reverse) tri(c, l[i]!, l[i + 1]!)
      else tri(c, l[i + 1]!, l[i]!)
    }
  }
  bulkhead(loops[0]!, false)
  bulkhead(loops[loops.length - 1]!, true)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}
