/**
 * **產生貼合外形的命中盒，直接貼進 `specs/*.ts`。** 不是測試。
 *
 * 跑法：`npx vite-node test/tools/hitbox-emit.probe.ts`
 *
 * 分段數不是挑的，是**掃出來取轉折點**：段數再加一段、正後方投影面積改善
 * 不到 `KNEE` 就停。各機種的曲線在不同的地方轉折，因為那由網格自己的展向
 * 站位決定（K-4 的機翼只有幾站，切三段與切兩段是同一組盒）。
 *
 * 【機翼盒一定要包住槍口】翼槍的槍管伸在前緣之外（P-51D 0.35 m、F6F
 * 0.25/0.12/0.00 m）。純粹由網格頂點推出來的段盒不含它們，子彈會從機體外面
 * 冒出來 —— 所以切完之後要把落在該段展向範圍內的槍口併進去。
 *
 * 【發動機走找空隙不走等分】四具發動機之間本來就是空的。順帶修掉一個現行
 * 缺陷：B-17G 的單一發動機盒橫跨 x ±7.00，把兩具發動機之間那一大片**內翼**
 * 一起包了進去 —— 而倍率取最高，於是整片內翼現在都算 engine 2.0。
 */
import { Mesh, Vector3 } from 'three'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { loadGlbTemplatesForNode } from '../fixtures/glb'
import { makeHitBox, type HitBox, type HitPart } from '../../src/world/hit'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { F6F5 } from '../../src/specs/f6f5'
import { HE111 } from '../../src/specs/he111'
import { B17G } from '../../src/specs/b17g'
import type { AircraftSpec } from '../../src/specs/types'

await loadGlbTemplatesForNode()

const CELL = 0.04
const PAD = 0.02
const NACELLE_GAP = 0.60
/** 再多切一段的改善低於這個比例就停 */
const KNEE = 0.10
const MAX_SEG = 10
type Axis = 'x' | 'y' | 'z'

function mesh(spec: AircraftSpec): { pts: Vector3[]; tris: number[][] } {
  const m = buildAircraft(spec)
  m.group.updateMatrixWorld(true)
  const pts: Vector3[] = []
  const tris: number[][] = []
  m.group.traverse((o) => {
    if (o.userData['spinning']) return
    const g = (o as Mesh).geometry
    const pos = g?.getAttribute?.('position')
    if (!pos) return
    const base = pts.length
    const v = new Vector3()
    for (let i = 0; i < pos.count; i++) {
      pts.push(v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld).clone())
    }
    const idx = g.getIndex()
    const count = idx ? idx.count : pos.count
    for (let k = 0; k + 2 < count; k += 3) {
      const a = idx ? idx.getX(k) : k
      const b = idx ? idx.getX(k + 1) : k + 1
      const c = idx ? idx.getX(k + 2) : k + 2
      const p = pts[base + a]!, q = pts[base + b]!, r = pts[base + c]!
      tris.push([p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z])
    }
  })
  m.dispose()
  return { pts, tris }
}

function tight(part: HitPart, list: readonly Vector3[]): HitBox | null {
  if (!list.length) return null
  const a = new Vector3(Infinity, Infinity, Infinity)
  const b = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const p of list) { a.min(p); b.max(p) }
  const lo = (v: number): number => Math.floor((v - PAD) * 100) / 100
  const hi = (v: number): number => Math.ceil((v + PAD) * 100) / 100
  return makeHitBox(part, [lo(a.x), lo(a.y), lo(a.z)], [hi(b.x), hi(b.y), hi(b.z)])
}

const inBox = (p: Vector3, b: HitBox): boolean =>
  Math.abs(p.x - b.center.x) <= b.half.x && Math.abs(p.y - b.center.y) <= b.half.y
  && Math.abs(p.z - b.center.z) <= b.half.z

/**
 * 把三角形夾在 a ≤ x ≤ b 這一片裡，回傳夾完之後的多邊形頂點。
 *
 * 【為什麼非夾三角形不可】第一版是把**頂點**依 x 分堆再各取緊包圍盒。
 * 頂點覆蓋率完美（`hitbox.test.ts` 只檢查頂點），但機翼的展向站位很稀疏
 * —— P-51D 的兩段切出來是 x 1.27…2.08 與 4.83…5.66，中間 2.7 m 的**翼面
 * 完全沒有盒子**。症狀是那一段打得到卻不扣血，而且沒有任何測試會紅：
 * 候選盒組的正後方投影量出 0.85×，比真實外形還小 —— 幾何上不可能，
 * 那個數字本身就是缺陷的告示。
 */
function clipTriX(t: readonly number[], a: number, b: number): number[][] {
  let poly: number[][] = [[t[0]!, t[1]!, t[2]!], [t[3]!, t[4]!, t[5]!], [t[6]!, t[7]!, t[8]!]]
  for (const [keepAbove, bound] of [[true, a], [false, b]] as const) {
    const out: number[][] = []
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!, q = poly[(i + 1) % poly.length]!
      const inP = keepAbove ? p[0]! >= bound : p[0]! <= bound
      const inQ = keepAbove ? q[0]! >= bound : q[0]! <= bound
      if (inP) out.push(p)
      if (inP !== inQ) {
        const s = (bound - p[0]!) / (q[0]! - p[0]!)
        out.push([bound, p[1]! + (q[1]! - p[1]!) * s, p[2]! + (q[2]! - p[2]!) * s])
      }
    }
    poly = out
    if (!poly.length) return []
  }
  return poly
}

/**
 * 沿展向等分成 n 段。
 *
 * 【x 用切分面本身當邊界】相鄰兩段共用切分面、各自往外讓 PAD，接縫是重疊
 * 不是縫隙。y/z 取「把所有三角形夾進這一片、再只留下落在**原機翼盒之內**
 * 的那些點」的緊界。
 *
 * 【為什麼不先把三角形分類成「機翼的」】試過「三個頂點全在機翼盒內」那個
 * 判準，結果是翼根與翼尖被排掉、五段裡有三段夾不到東西，切出來的盒組在
 * 正後方的投影 **比真實外形還小**（0.91×）—— 幾何上不可能，那個數字本身
 * 就是缺陷的告示。改成「夾完之後再用原盒篩點」，任何原本被機翼盒蓋住的
 * 表面點都還在，覆蓋率不會退。
 */
function sliceWing(
  part: HitPart, tris: readonly number[][], old: readonly HitBox[], n: number,
): HitBox[] {
  // eslint-disable-next-line no-param-reassign -- 站位不夠時實際段數會少於要求
  // 【區域取所有同部位盒的聯集】這一支要能**重複跑**：第一次跑完之後
  // specs 裡的機翼已經是三個盒了，若只讀第一個，第二次跑就會把區域縮成
  // 第一段，切出來的盒組漏掉三分之二的機翼。實測症狀是覆蓋率由 0 變成
  // 348 點、投影倍數掉到 1.03×。
  const lo = Math.min(...old.map((b) => b.center.x - b.half.x))
  const hi = Math.max(...old.map((b) => b.center.x + b.half.x))
  const out: HitBox[] = []
  const v = new Vector3()
  for (let k = 0; k < n; k++) {
    const a = lo + (hi - lo) * k / n
    const b = lo + (hi - lo) * (k + 1) / n
    const pts: Vector3[] = []
    for (const t of tris) {
      for (const q of clipTriX(t, a, b)) {
        if (old.some((b) => inBox(v.set(q[0]!, q[1]!, q[2]!), b))) pts.push(v.clone())
      }
    }
    if (!pts.length) continue
    const box = tight(part, pts)!
    const c = box.center, h = box.half
    const x0 = Math.floor((a - PAD) * 100) / 100
    const x1 = Math.ceil((b + PAD) * 100) / 100
    out.push(makeHitBox(part, [x0, c.y - h.y, c.z - h.z], [x1, c.y + h.y, c.z + h.z]))
  }
  return out
}

/**
 * 把「一個頂點都不含」的段併進相鄰的那一段。
 *
 * 【為什麼要這一步】等分的切分面會落在兩個展向站位之間，那一段裡有翼面
 * 卻一個頂點都沒有 —— `hitbox.test.ts` 的「沒有空盒」因此紅。那條測試沒
 * 有錯：它要擋的是打不到的裝飾盒，而它只看得到頂點。**併進鄰居**而不是
 * 丟掉，展向仍然是連續的，覆蓋率一格都不會少。
 *
 * 【為什麼不改成對齊站位】試過。切分面吸到站位之後，相鄰兩段的邊界不再
 * 是同一個平面，中間出現縫隙 —— 候選盒組的投影量出 0.77～1.03×，又是那個
 * 幾何上不可能的數字。
 */
function mergeEmpty(boxes: readonly HitBox[], pts: readonly Vector3[]): HitBox[] {
  const has = (b: HitBox): boolean => pts.some((p) => inBox(p, b))
  const join = (a: HitBox, b: HitBox): HitBox => {
    const lo = a.center.clone().sub(a.half).min(b.center.clone().sub(b.half))
    const hi = a.center.clone().add(a.half).max(b.center.clone().add(b.half))
    return makeHitBox(a.part, [lo.x, lo.y, lo.z], [hi.x, hi.y, hi.z])
  }
  const out = [...boxes]
  for (let i = 0; i < out.length; i++) {
    if (out.length === 1 || has(out[i]!)) continue
    const j = i > 0 ? i - 1 : 1
    out[j] = join(out[j]!, out[i]!)
    out.splice(i, 1)
    i = -1
  }
  return out
}

function cluster(part: HitPart, pts: readonly Vector3[], axis: Axis, gap: number): HitBox[] {
  if (!pts.length) return []
  const sorted = [...pts].sort((a, b) => a[axis] - b[axis])
  const out: HitBox[] = []
  let run: Vector3[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]![axis] - sorted[i - 1]![axis] > gap) { out.push(tight(part, run)!); run = [] }
    run.push(sorted[i]!)
  }
  if (run.length) out.push(tight(part, run)!)
  return out
}

/** 把一個盒撐大到含住 p（回傳新的盒，座標仍然是 0.01 的整數倍）。 */
function grow(b: HitBox, p: Vector3): HitBox {
  const lo = b.center.clone().sub(b.half).min(new Vector3(p.x - PAD, p.y - PAD, p.z - PAD))
  const hi = b.center.clone().add(b.half).max(new Vector3(p.x + PAD, p.y + PAD, p.z + PAD))
  const f = (v: number): number => Math.floor(v * 100) / 100
  const c = (v: number): number => Math.ceil(v * 100) / 100
  return makeHitBox(b.part, [f(lo.x), f(lo.y), f(lo.z)], [c(hi.x), c(hi.y), c(hi.z)])
}

/**
 * 尾段拆成「平尾薄板」＋「垂尾＋尾錐薄板」。切分面 |x| = cut 掃出來取最小。
 *
 * 【平尾板橫跨中線，所以不會有縫】板子的 x 範圍是整個平尾展長（含中間那
 * 一段），y/z 只由 |x| ≥ cut 的表面決定。|x| < cut 的表面由垂尾盒蓋住，
 * 兩者的聯集因此沒有洞。
 */
function splitTail(tris: readonly number[][], region: HitBox[], cut: number): HitBox[] {
  const v = new Vector3()
  const inRegion = (q: readonly number[]): boolean =>
    region.some((b) => inBox(v.set(q[0]!, q[1]!, q[2]!), b))
  const outer: Vector3[] = []
  const inner: Vector3[] = []
  for (const t of tris) {
    for (const [a, b, dst] of [
      [cut, Infinity, outer], [-Infinity, -cut, outer], [-cut, cut, inner],
    ] as const) {
      for (const q of clipTriX(t, a, b)) {
        if (inRegion(q)) (dst as Vector3[]).push(new Vector3(q[0], q[1], q[2]))
      }
    }
  }
  const h = tight('tail', outer)
  const w = tight('tail', inner)
  return [h, w].filter((b): b is HitBox => b !== null)
}

const D = Math.PI / 180
const dirOf = (az: number, el: number): Vector3 => new Vector3(
  Math.sin(az * D) * Math.cos(el * D), Math.sin(el * D), Math.cos(az * D) * Math.cos(el * D),
).normalize()
const ASPECTS = [
  { name: '正後方', s: dirOf(0, 0) },
  { name: '後上方30', s: dirOf(0, 30) },
  { name: '側方90', s: dirOf(90, 0) },
  { name: '正上方', s: dirOf(0, 90) },
] as const

function raster(items: readonly number[][], ex: Vector3, ey: Vector3, cells: Set<number>): void {
  const K = 8192
  for (const t of items) {
    const px: number[] = [], py: number[] = []
    for (let i = 0; i < 3; i++) {
      const x = t[i * 3]!, y = t[i * 3 + 1]!, z = t[i * 3 + 2]!
      px.push(x * ex.x + y * ex.y + z * ex.z)
      py.push(x * ey.x + y * ey.y + z * ey.z)
    }
    const i0 = Math.floor(Math.min(...px) / CELL), i1 = Math.ceil(Math.max(...px) / CELL)
    const j0 = Math.floor(Math.min(...py) / CELL), j1 = Math.ceil(Math.max(...py) / CELL)
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const cx = (i + 0.5) * CELL, cy = (j + 0.5) * CELL
        const d1 = (cx - px[1]!) * (py[0]! - py[1]!) - (px[0]! - px[1]!) * (cy - py[1]!)
        const d2 = (cx - px[2]!) * (py[1]! - py[2]!) - (px[1]! - px[2]!) * (cy - py[2]!)
        const d3 = (cx - px[0]!) * (py[2]! - py[0]!) - (px[2]! - px[0]!) * (cy - py[0]!)
        if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue
        cells.add((i + K) * (2 * K) + (j + K))
      }
    }
  }
}

function boxTris(b: HitBox): number[][] {
  const c = b.center, h = b.half
  const P = (s: readonly [number, number, number]): number[] =>
    [c.x + s[0] * h.x, c.y + s[1] * h.y, c.z + s[2] * h.z]
  const out: number[][] = []
  for (const ax of [0, 1, 2]) {
    for (const sg of [-1, 1]) {
      const q = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([u, v]) => {
        const s: [number, number, number] = [0, 0, 0]
        s[ax] = sg
        s[(ax + 1) % 3] = u
        s[(ax + 2) % 3] = v
        return s
      })
      out.push([...P(q[0]!), ...P(q[1]!), ...P(q[2]!)])
      out.push([...P(q[0]!), ...P(q[2]!), ...P(q[3]!)])
    }
  }
  return out
}

function areaOf(items: readonly number[][], ex: Vector3, ey: Vector3): number {
  const cells = new Set<number>()
  raster(items, ex, ey, cells)
  return cells.size * CELL * CELL
}

const f = (v: number, d = 2): string => v.toFixed(d)
const f1 = (v: number): string => v.toFixed(1)
const line = (b: HitBox, tag: string): string => {
  const lo = b.center.clone().sub(b.half), hi = b.center.clone().add(b.half)
  return `    makeHitBox('${b.part}', [${f(lo.x)}, ${f(lo.y)}, ${f(lo.z)}], `
    + `[${f(hi.x)}, ${f(hi.y)}, ${f(hi.z)}]),`.padEnd(34) + `// ${tag}`
}

for (const spec of [P51D, F6F5, BF109K4, HE111, B17G]) {
  const { pts, tris } = mesh(spec)
  const axes = ASPECTS.map((a) => {
    const dir = a.s.clone().multiplyScalar(-1)
    const up = Math.abs(dir.y) > 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
    const ex = new Vector3().crossVectors(dir, up).normalize()
    return [ex, new Vector3().crossVectors(ex, dir).normalize()] as const
  })
  const boxArea = (bs: readonly HitBox[], i: number): number =>
    areaOf(bs.flatMap(boxTris), ...axes[i]!)
  const inside = (part: HitPart): Vector3[] => {
    const bs = spec.hitBoxes.filter((b) => b.part === part)
    return pts.filter((p) => bs.some((b) => inBox(p, b)))
  }
  const cur = (part: HitPart): HitBox[] => spec.hitBoxes.filter((b) => b.part === part)

  console.log(`\n══ ${spec.name} ═════════════════════════════════════════`)

  // ── 機翼：掃段數取轉折 ───────────────────────────────────────
  /**
   * 【只算右翼，左翼用鏡射】飛機是左右對稱的，而三角形夾出來的數字不是
   * —— 網格本身有 0.01 級的不對稱（K-4 只有左舷有增壓器進氣口、B-17G 的
   * 翼尖圓化收尾差一格），照兩邊各自算會得到差 0.01～0.35 m 的兩組盒，
   * `hitbox.test.ts` 的「左右翼盒左右對稱」直接紅。鏡射是對的做法：命中盒
   * 是**簡化的傷害體積**，不是外形的複製品。
   */
  const mirror = (b: HitBox): HitBox => {
    const lo = b.center.clone().sub(b.half), hi = b.center.clone().add(b.half)
    return makeHitBox('wingLeft', [-hi.x, lo.y, lo.z], [-lo.x, hi.y, hi.z])
  }
  const wingAt = (n: number): HitBox[] => {
    const r = mergeEmpty(sliceWing('wingRight', tris, cur('wingRight'), n), pts)
    return [...r, ...r.map(mirror)]
  }
  const curve: number[] = []
  for (let n = 1; n <= MAX_SEG; n++) curve.push(boxArea(n === 1 ? [...cur('wingRight'), ...cur('wingLeft')] : wingAt(n), 0))
  // 【要看兩步不能只看一步】只看下一步的話會停在**平台**上：B-17G 由 2 段
  // 切到 3 段只改善 1%（那兩段的切分面剛好都落在同一個結構帶），但 3 段切到
  // 4 段又改善 13%。停在 2 段就把後面那一大截讓掉了。
  const gain = (n: number): number => (curve[n - 1]! - curve[n]!) / curve[n - 1]!
  let segs = MAX_SEG
  for (let n = 2; n <= MAX_SEG - 2; n++) {
    if (gain(n) < KNEE && gain(n + 1) < KNEE) { segs = n; break }
  }
  console.log('  機翼正後方投影 '
    + curve.map((v, i) => `${i + 1}段 ${f1(v)}(${i === 0 ? 2 : wingAt(i + 1).length}盒)`).join('  '))
  console.log(`  → 取 ${segs} 段（再切一段的改善 < ${KNEE * 100}%）`)

  // ── 槍口：把每一挺併進它所屬的那一段 ─────────────────────────
  //
  // 【只看翼槍】109 的武裝全在中軸線附近（穿槳轂的 MK 108 在 x = 0、兩挺
  // MG 131 在 x = ±0.20），那些槍口在機身／發動機盒裡，不該把機翼盒往機首
  // 拉。第一版沒擋，右翼第一段被拉到 z = −2.60（砲口在錐尖），左右因此還
  // 不對稱。判準是「槍口的展向位置落在機翼的展向範圍內」。
  let wings = wingAt(segs)
  {
    const wr = wings.filter((b) => b.part === 'wingRight')
    const xLo = Math.min(...wr.map((b) => b.center.x - b.half.x))
    const xHi = Math.max(...wr.map((b) => b.center.x + b.half.x))
    for (const m of spec.battery.mounts) {
      const x = Math.abs(m.position.x)
      if (x < xLo || x > xHi) continue
      let best = wr[0]!
      let bd = Infinity
      for (const b of wr) {
        const d = Math.abs(x - b.center.x)
        if (d < bd) { bd = d; best = b }
      }
      const grown = grow(best, new Vector3(x, m.position.y, m.position.z))
      wings = wings.map((b) => (b === best ? grown : b))
      wr[wr.indexOf(best)] = grown
    }
    wings = [...wr, ...wr.map(mirror)]
  }

  // ── 尾段：掃切分面 ──────────────────────────────────────────
  //
  // 【為什麼要重推而不是沿用】P-51D 的外型 2026-08-31 換成 GLB 並在 Blender
  // 修過五處，用舊網格算出來的盒可能已經不貼合。一律由當下的網格重推。
  const tailRegion = cur('tail')
  let bestCut = 0.3
  let bestArea = Infinity
  let tail: HitBox[] = tailRegion
  for (let c = 0.15; c <= 2.2001; c += 0.05) {
    const t = splitTail(tris, tailRegion, c)
    if (t.length < 2) continue
    const a = boxArea(t, 0)
    if (a < bestArea) { bestArea = a; bestCut = c; tail = t }
  }
  console.log(`  尾段切分 |x| = ${f(bestCut)}　正後方 `
    + `${f1(boxArea(tailRegion, 0))} → ${f1(bestArea)} m²`)

  // ── 發動機：找空隙 ──────────────────────────────────────────
  const engPts = inside('engine')
  const engCl = cluster('engine', engPts, 'x', NACELLE_GAP)
  const engine = engCl.length > 1 ? engCl : cur('engine')
  if (engCl.length > 1) {
    console.log(`  發動機 1 盒 → ${engCl.length} 盒　正後方 `
      + `${f1(boxArea(cur('engine'), 0))} → ${f1(boxArea(engCl, 0))} m²`)
  }

  const next = [...cur('cockpit'), ...engine, ...cur('fuselage'), ...tail, ...wings]
  console.log('  投影 m²      ' + ASPECTS.map((a) => a.name.padStart(10)).join(''))
  console.log('  真實外形    ' + axes.map(([ex, ey]) => f1(areaOf(tris, ex, ey)).padStart(10)).join(''))
  console.log('  現行        ' + ASPECTS.map((_, i) => f1(boxArea(spec.hitBoxes, i)).padStart(10)).join('')
    + `   ${spec.hitBoxes.length} 盒`)
  console.log('  候選        ' + ASPECTS.map((_, i) => f1(boxArea(next, i)).padStart(10)).join('')
    + `   ${next.length} 盒`)
  console.log('  放大倍數    ' + ASPECTS.map((_, i) => {
    const r = boxArea(next, i) / areaOf(tris, ...axes[i]!)
    return `${f(r)}×`.padStart(10)
  }).join(''))

  // 【幾何自洽】盒的聯集投影不可能比真實外形小。小了就代表盒組漏掉了
  // 一片表面，而頂點覆蓋率檢查不到（頂點在盒裡、頂點之間的面不在）。
  for (let i = 0; i < ASPECTS.length; i++) {
    const r = boxArea(next, i) / areaOf(tris, ...axes[i]!)
    if (r < 1) console.log(`  ★ ${ASPECTS[i]!.name} 的盒投影只有真實外形的 ${f(r)} —— 盒組有洞`)
  }
  const missed = pts.filter((p) => !next.some((b) => inBox(p, b)))
  const missedNow = pts.filter((p) => !spec.hitBoxes.some((b) => inBox(p, b)))
  console.log(`  覆蓋率檢查：現行漏網 ${missedNow.length} 點、候選漏網 ${missed.length} 點`)
  if (missed.length) {
    const a = new Vector3(Infinity, Infinity, Infinity)
    const b = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const p of missed) { a.min(p); b.max(p) }
    console.log(`     漏網包圍盒 X${f(a.x)}…${f(b.x)} Y${f(a.y)}…${f(b.y)} Z${f(a.z)}…${f(b.z)}`)
    const wasEngine = missed.filter((p) => cur('engine').some((bx) => inBox(p, bx))).length
    const wasWing = missed.filter((p) => [...cur('wingRight'), ...cur('wingLeft')]
      .some((bx) => inBox(p, bx))).length
    console.log(`     其中原本被發動機盒蓋住 ${wasEngine}、被機翼盒蓋住 ${wasWing}`)
  }
  for (const m of spec.battery.mounts) {
    if (!next.some((b) => inBox(m.position, b))) {
      console.log(`  ★ 槍口 ${m.position.toArray().map((v) => f(v)).join(',')} 不在任何盒內`)
    }
  }

  console.log('  ── 貼進 specs ──')
  for (const b of cur('cockpit')) console.log(line(b, '座艙'))
  engine.forEach((b, i) => console.log(line(b, engine.length > 1 ? `發動機艙 ${i + 1}` : '發動機')))
  for (const b of cur('fuselage')) console.log(line(b, '機身'))
  tail.forEach((b, i) => console.log(line(b, i === 0 ? '平尾' : '垂尾＋尾錐')))
  for (const p of ['wingRight', 'wingLeft'] as const) {
    wings.filter((b) => b.part === p).sort((a, b) => Math.abs(a.center.x) - Math.abs(b.center.x))
      .forEach((b, i) => console.log(line(b, `${p === 'wingRight' ? '右' : '左'}翼第 ${i + 1} 段`)))
  }
}
