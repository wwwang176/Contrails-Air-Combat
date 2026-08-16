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
export interface CanopyShape {
  /** 罩頂平板的半寬。圓罩（bubble）時忽略。 */
  topWidth: number
  /**
   * 圓罩：截面由艙緣沿四分之一超橢圓收到罩頂，指數越大越飽滿。
   * 省略即平板梯形（Bf 109 那種方框罩）。
   *
   * 【為什麼要兩種】P-51D 的氣泡罩是真的圓的，用梯形做出來像個雞籠；
   * 109 的方框罩是平板玻璃拼的，用圓弧做出來則太圓潤。
   */
  roundness?: number
  /** 圓罩沿弧線的分段數 */
  arcSegments?: number
}

/**
 * 玻璃的骨架 —— 環向的隔框 + 縱向的桁條。
 *
 * 【為什麼玻璃一定要有骨架】一大片沒有分割線的透明曲面在遊戲距離下讀不出
 * 「那是玻璃」，只讀得出「那裡破了一個洞」。真機的玻璃是用金屬框把一小片
 * 一小片拼起來的，而**框線才是眼睛認得出玻璃的線索** —— 尤其 He 111 的
 * 全玻璃機首，照片上最搶眼的就是那張網格。
 *
 * 【為什麼不做成一整圈實體，而是貼在表面上的帶子】骨架的真實斷面只有幾
 * 公分，做成實體在低多邊形下必然變成一根粗棍。貼在表面上的帶子沒有厚度，
 * 遠看就是一條線、近看是一條窄面 —— 這正是要的。
 *
 * 【`out` 非有不可】帶子與玻璃**完全共面**時 z-fighting，症狀是骨架隨相機
 * 移動一閃一閃。往外撐出 1～2 cm 就分開了，而那個量在視覺上讀不出來。
 */
export interface FrameSpec {
  /** 環向隔框的 z 站位 */
  hoops: readonly number[]
  /** 縱向桁條走哪幾個剖面頂點（`HullRing.half` 的索引），左右各一條 */
  rails: readonly number[]
  /** 縱向桁條的 z 範圍 */
  from: number
  to: number
  /** 帶子的半寬（隔框取 z 向、桁條取環向） */
  width: number
  /** 往外撐出多少，避開 z-fighting */
  out: number
}

export function buildFrames(
  rings: readonly HullRing[], spec: FrameSpec,
): BufferGeometry {
  const positions: number[] = []
  const tri = (a: number[], b: number[], c: number[]) => {
    positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  }
  /** 撐出：剖面點沿「由剖面中心指向該點」的方向往外推。 */
  const push = (r: HullRing, i: number, sx: number): [number, number] => {
    const half = r.half
    const cy = (half[0]![1] + half[half.length - 1]![1]) / 2
    const [x, y] = half[i]!
    const d = Math.hypot(x, y - cy) || 1
    return [sx * (x + (x / d) * spec.out), y + ((y - cy) / d) * spec.out]
  }

  // ── 環向隔框：整圈的窄帶，z ± width ──────────────────────
  for (const z of spec.hoops) {
    const r = ringAt(rings, z)
    const n = r.half.length
    /** 一整圈（右半由上而下、左半由下而上），頭尾不重複 */
    const loop: [number, number][] = []
    for (let i = 0; i < n; i++) loop.push(push(r, i, 1))
    for (let i = n - 2; i >= 1; i--) loop.push(push(r, i, -1))
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!, b = loop[(i + 1) % loop.length]!
      const A0 = [a[0], a[1], z - spec.width], A1 = [a[0], a[1], z + spec.width]
      const B0 = [b[0], b[1], z - spec.width], B1 = [b[0], b[1], z + spec.width]
      // 【繞法】環是「正上方 → 右半往下 → 正下方 → 左半往上」，在 XY 平面
      // 由 +Z 看是順時針。照 (A0,B0,B1) 寫出來的法線指**向內**，要反過來。
      tri(A0, B1, B0); tri(A0, A1, B1)
    }
  }

  // ── 縱向桁條：沿某一個剖面頂點掃過各站位的窄帶 ────────────
  const used = rings.filter((r) => r.z >= spec.from && r.z <= spec.to)
  for (const i of spec.rails) {
    // 落在中線上的頂點（正上方、正下方）左右鏡像會產生**完全重合**的兩份，
    // 那是 z-fighting 的教科書寫法。只畫一次。
    const onAxis = used.every((r) => Math.abs(r.half[i]![0]) < 1e-6)
    for (const sx of onAxis ? [1] : [1, -1]) {
      for (let s = 0; s < used.length - 1; s++) {
        const A = used[s]!, B = used[s + 1]!
        const [ax, ay] = push(A, i, sx)
        const [bx, by] = push(B, i, sx)
        // 帶寬取環向：往剖面上相鄰的頂點方向各讓 width
        const wa = tangent(A, i, sx, spec.width)
        const wb = tangent(B, i, sx, spec.width)
        const A0 = [ax - wa[0], ay - wa[1], A.z], A1 = [ax + wa[0], ay + wa[1], A.z]
        const B0 = [bx - wb[0], by - wb[1], B.z], B1 = [bx + wb[0], by + wb[1], B.z]
        tri(A0, B0, B1); tri(A0, B1, A1)
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}

/** 剖面上第 i 個頂點的切線方向 × 半寬。用相鄰兩頂點的連線近似。 */
function tangent(r: HullRing, i: number, sx: number, width: number): [number, number] {
  const n = r.half.length
  const a = r.half[Math.max(0, i - 1)]!
  const b = r.half[Math.min(n - 1, i + 1)]!
  const dx = sx * (b[0] - a[0]), dy = b[1] - a[1]
  const d = Math.hypot(dx, dy)
  // 退化時退回水平帶。剖面的頂點不會重合，但呼叫端給的環有可能是收成一點的
  // 首尾站位（機首尖端、尾錐尖端）
  if (d < 1e-6) return [width, 0]
  return [(dx / d) * width, (dy / d) * width]
}

export function buildCanopy(
  rings: readonly HullRing[], stations: readonly CanopyStation[], shape: CanopyShape,
): BufferGeometry {
  const seg = shape.roundness ? (shape.arcSegments ?? 4) : 1
  const half = seg + 1          // 單側的點數（含艙緣與罩頂）

  const outline = (st: CanopyStation): number[][] => {
    if (st.roof <= st.sill) {
      return Array.from({ length: half * 2 }, () => [0, st.roof, st.z])
    }
    const x = hullXAtY(ringAt(rings, st.z).half, st.sill)
    const side: number[][] = []
    if (shape.roundness) {
      // 四分之一超橢圓：u=0 在艙緣、u=1 在罩頂正中
      const n = shape.roundness
      for (let i = 0; i <= seg; i++) {
        const u = i / seg
        side.push([x * (1 - u ** n) ** (1 / n), st.sill + (st.roof - st.sill) * u, st.z])
      }
    } else {
      side.push([x, st.sill, st.z], [shape.topWidth, st.roof, st.z])
    }
    return [...side, ...side.slice().reverse().map((p) => [-p[0]!, p[1]!, p[2]!])]
  }

  const outlines = stations.map(outline)
  const positions: number[] = []
  const tri = (a: number[], b: number[], c: number[]) => {
    positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  }
  // 輪廓方向是 +X → −X、站位方向是 +Z，(−X)×(+Z) = +Y，法線因此朝外
  const last = half * 2 - 1
  for (let s = 0; s < outlines.length - 1; s++) {
    const A = outlines[s]!, B = outlines[s + 1]!
    for (let i = 0; i < last; i++) {
      tri(A[i]!, A[i + 1]!, B[i]!)
      tri(A[i + 1]!, B[i + 1]!, B[i]!)
    }
  }
  // 風擋：首站的輪廓與艙緣連線圍出的面
  const f = outlines[0]!
  const c0 = [0, stations[0]!.sill, stations[0]!.z]
  for (let i = 0; i < last; i++) tri(c0, f[i + 1]!, f[i]!)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}
