/** 命中盒候選的幾何裁切、合併與補漏；不載入模型或執行報表。 */
import { Vector3 } from 'three'
import { makeHitBox, type HitBox, type HitPart } from '../../src/world/hit'

const PAD = 0.02
type Axis = 'x' | 'y' | 'z'

function tight(part: HitPart, list: readonly Vector3[]): HitBox | null {
  if (!list.length) return null
  const a = new Vector3(Infinity, Infinity, Infinity)
  const b = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const p of list) { a.min(p); b.max(p) }
  const lo = (v: number): number => Math.floor((v - PAD) * 100) / 100
  const hi = (v: number): number => Math.ceil((v + PAD) * 100) / 100
  return makeHitBox(part, [lo(a.x), lo(a.y), lo(a.z)], [hi(b.x), hi(b.y), hi(b.z)])
}

export const inBox = (p: Vector3, b: HitBox): boolean =>
  Math.abs(p.x - b.center.x) <= b.half.x && Math.abs(p.y - b.center.y) <= b.half.y
  && Math.abs(p.z - b.center.z) <= b.half.z

/**
 * 把三角形夾在 a ≤ x ≤ b 這一片裡，回傳夾完之後的多邊形頂點。
 *
 * 【為什麼非夾三角形不可】把**頂點**依 x 分堆再各取緊包圍盒的話，頂點
 * 覆蓋率完美（`hitbox.test.ts` 只檢查頂點），但機翼的展向站位很稀疏
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
export function sliceWing(
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
export function mergeEmpty(boxes: readonly HitBox[], pts: readonly Vector3[]): HitBox[] {
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

export function cluster(part: HitPart, pts: readonly Vector3[], axis: Axis, gap: number): HitBox[] {
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
export function grow(b: HitBox, p: Vector3): HitBox {
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
export function splitTail(tris: readonly number[][], region: HitBox[], cut: number): HitBox[] {
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

/**
 * 把「落在所有盒之外」的表面補起來。
 *
 * 【為什麼會有漏的】這一支是拿**現行的盒**當要細分的區域，所以現行盒蓋不到
 * 的地方，細分之後照樣蓋不到。兩台轟炸機的盒訂好之後才長出砲塔與發動機艙
 * 前端，於是 B-17G 有 6,012 個頂點、He 111 有 412 個在所有盒之外 —— 那些
 * 地方**打得到但不扣血**，而覆蓋率掃描只含三台戰鬥機，沒有人會發現。
 *
 * 【怎麼補】漏的點按 0.8 m 鏈結距離分群（破洞通常是一整個零件，不是散點），
 * 每一群補一個緊盒，部位取**離它最近的那個盒**的部位 —— 尾砲塔補進 tail、
 * 上部砲塔補進 fuselage、發動機艙前端補進 engine，都落在該落的地方。
 *
 * 【邊界為什麼要含整個三角形】只包漏掉的頂點的話，跨在邊界上的三角形會有一
 * 段面落在兩個盒之間 —— 就是前面那個「頂點覆蓋率完美但面有洞」的坑。凡是
 * 碰到這一群的三角形，三個頂點一起算進盒裡，接縫就一定是重疊。
 */
export function patchHoles(boxes: readonly HitBox[], pts: readonly Vector3[], tris: readonly number[][]): HitBox[] {
  const missed = pts.filter((p) => !boxes.some((b) => inBox(p, b)))
  if (!missed.length) return [...boxes]
  const rest = [...missed]
  const groups: Vector3[][] = []
  while (rest.length) {
    const g = [rest.pop()!]
    for (let i = 0; i < g.length; i++) {
      for (let j = rest.length - 1; j >= 0; j--) {
        if (g[i]!.distanceTo(rest[j]!) < 0.8) g.push(rest.splice(j, 1)[0]!)
      }
    }
    groups.push(g)
  }
  const out = [...boxes]
  const v = new Vector3()
  for (const g of groups) {
    const set = new Set(g.map((p) => `${p.x},${p.y},${p.z}`))
    const all = [...g]
    for (const t of tris) {
      const vs = [0, 1, 2].map((i) => new Vector3(t[i * 3], t[i * 3 + 1], t[i * 3 + 2]))
      if (vs.some((q) => set.has(`${q.x},${q.y},${q.z}`))) all.push(...vs)
    }
    const c = new Vector3()
    for (const p of g) c.add(p)
    c.divideScalar(g.length)
    // 最近的盒 —— 點到 AABB 的距離，盒內為 0
    let near = out[0]!
    let bd = Infinity
    for (const b of out) {
      const d = v.set(
        Math.max(0, Math.abs(c.x - b.center.x) - b.half.x),
        Math.max(0, Math.abs(c.y - b.center.y) - b.half.y),
        Math.max(0, Math.abs(c.z - b.center.z) - b.half.z),
      ).length()
      if (d < bd) { bd = d; near = b }
    }
    out.push(tight(near.part, all)!)
  }
  return out
}

