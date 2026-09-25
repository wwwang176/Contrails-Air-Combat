/**
 * # 河：中心線、水面縱剖面、地圖外的延伸、查詢索引
 *
 * 純函數，不碰 three。水面與河岸的網格在 `render/river.ts`。
 *
 * 【水面鋪在地表上，河槽不挖】高度場一格 80 m，而河實際寬 50–80 m ——
 * **在 80 m 的格子上挖不出比 160 m 窄的槽**，挖了會被相鄰格點的內插填回去，
 * 水面反而被兩岸埋掉。所以每一點取當地地形的高度加一點餘裕；投彈高度看下去
 * 與挖出來的沒有差別，貼地飛過去會發現河沒有岸。
 *
 * 【水面不能是一個全域平面】河在 30 km 裡有落差（渠化、有船閘）。固定高度
 * 不是淹掉上游就是露出下游。水面做成**沿折線的帶子**，每一點各自取高度。
 */

export interface RiverFile {
  readonly rivers: readonly {
    readonly name: string
    readonly points: readonly (readonly [number, number])[]
  }[]
}

/** 地形高度。**場外要回 0 不是 −Infinity** —— 延伸段整段都在場外 */
export type HeightSampler = (x: number, z: number) => number

/** 一條河重新取樣之後的中心線，含每一點的水面高度 */
export interface WaterLine {
  readonly name: string
  readonly points: readonly (readonly [number, number])[]
  /** 水面高度，與 `points` 等長 */
  readonly level: readonly number[]
  /** 地圖外的延伸段：外環是平的，河岸的草甸不必橫向切段 */
  readonly coarse: boolean
}

/** 水面的半寬，m */
export const CHANNEL_HALF = 45
/**
 * 水面高出當地地形多少，m。
 *
 * 【它不是防閃爍的主力】遠平面 5,000 km，2 km 高度的深度解析度是 0.25 m、
 * 4 km 是 1 m —— 靠抬高度抬到不閃，就看得出河浮在田上。閃爍由材質的
 * `polygonOffset` 治，這個值只是餘裕。**上限兩公尺**，再高低空看得出來。
 */
export const CLEARANCE = 1.2
/** 折線重新取樣的間距，m。要比高度場的一格細，否則彎道會切角 */
const STEP = 60
/** 縱剖面的平滑窗，取樣數。河面不該跟著地形的雜訊上下抖 */
const SMOOTH = 15
/** 水面的半寬加一點，用來取橫斷面上最高的地 */
const CROSS = CHANNEL_HALF + 30

/** 折線依固定間距重新取樣 */
function resample(pts: readonly (readonly [number, number])[], step: number): [number, number][] {
  const out: [number, number][] = [[pts[0]![0], pts[0]![1]]]
  let carry = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1e-6) continue
    for (let d = step - carry; d < len; d += step) {
      const t = d / len
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
    carry = (carry + len) % step
  }
  out.push([pts[pts.length - 1]![0], pts[pts.length - 1]![1]])
  return out
}

/**
 * 一條河的水面縱剖面。
 *
 * 【要取橫斷面的最高點不是中心線】水面是一條 90 m 寬的帶子，只看中心線的
 * 高度的話，帶子的兩緣會插進兩側略高的地裡 —— 畫面上是一條斷斷續續的河。
 *
 * 【平滑之後還要再頂一次】平滑會把局部的高點抹掉，抹掉的地方就是會露出
 * 地面的地方。所以取「平滑值與當地最高點的較大者」。
 */
function profile(sample: HeightSampler, pts: readonly (readonly [number, number])[]): number[] {
  const n = pts.length
  const top: number[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!
    const b = pts[Math.min(n - 1, i + 1)]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz) || 1
    const nx = -dz / len
    const nz = dx / len
    const p = pts[i]!
    let hi = -Infinity
    for (const s of [-1, -0.5, 0, 0.5, 1]) {
      hi = Math.max(hi, sample(p[0] + nx * CROSS * s, p[1] + nz * CROSS * s))
    }
    top.push(hi)
  }
  return top.map((h, i) => {
    let sum = 0
    let m = 0
    for (let k = Math.max(0, i - SMOOTH); k <= Math.min(n - 1, i + SMOOTH); k++) {
      sum += top[k]!
      m++
    }
    return Math.max(sum / m, h) + CLEARANCE
  })
}

/** 每一條河的中心線與水面高度。**不動高度場**，見檔頭 */
export function riverLines(sample: HeightSampler, file: RiverFile): WaterLine[] {
  const lines: WaterLine[] = []
  for (const r of file.rivers) {
    if (r.points.length < 2) continue
    const pts = resample(r.points, STEP)
    lines.push({ name: r.name, points: pts, level: profile(sample, pts), coarse: false })
  }
  return lines
}

/** 延伸段一路往外拉多遠，m。霧在 100 km 已經吃掉 86% */
export const EXTEND_REACH = 60_000
/** 延伸段的點距，m。要比一個彎的四分之一還短，否則彎道是鋸齒 */
export const EXTEND_STEP = 150
/** 端點離地圖邊緣這個距離內才算「流出地圖」，m。其餘的端點是匯流口 */
export const EDGE_TOUCH = 1000
/**
 * 延伸段的走向與出圖法線最多差幾度。**這是不繞回地圖的保證** —— 夾在 90°
 * 以內，每一步都在往外走。
 */
export const EXTEND_MAX_TURN = (80 * Math.PI) / 180
/**
 * 起步那一段的上限：順著河端的切線走，而貼著地圖邊流出去的河（Luppe 沿著
 * 北緣）切線與法線差到 84°。仍在 90° 以內，照樣往外。
 */
const EXTEND_START_TURN = (89 * Math.PI) / 180
/**
 * 主方向（不含擺動）與出圖法線最多差幾度。主方向決定河往哪裡去；擺動疊在
 * 它上面，總角度再夾進 `EXTEND_MAX_TURN`。
 */
const EXTEND_BASE_TURN = (25 * Math.PI) / 180
/**
 * 蜿蜒：主方向上疊一個正弦擺動。每過半個波（擺動為 0 的那一刻）重抽一次
 * 波長與擺幅 —— 方向在那一刻不跳，而彎與彎不會一模一樣。
 *
 * 【數字從哪來】地圖內的真河每 3 km 的彎曲度（沿線長度 ÷ 直線距離）是
 * 1.25～1.45。正弦擺幅 θ 的彎曲度約 1 / J₀(θ)：30°～65° 落在 1.07～1.40。
 */
const MEANDER_WAVE = [900, 3200] as const
const MEANDER_AMP = [(30 * Math.PI) / 180, (65 * Math.PI) / 180] as const
/**
 * 長波的慢擺：每條河一個固定的波長與相位。只有短波的話是一條規律的正弦蛇；
 * 真河在好幾公里的尺度上也會左右偏。左右擺幅約 λ·θ/2π ≈ 480 m。
 */
const DRIFT_WAVE = [8000, 15000] as const
const DRIFT_AMP = (12 * Math.PI) / 180
/** 水面從端點的高度漸變到外環高度要幾點 */
const EXTEND_RAMP = 12
/** 從河端的切線轉進蜿蜒要幾步 */
const EXTEND_BLEND = 6

/** 種子進、序列出。**不得 `Math.random`** —— 每次進場的河要一樣 */
function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function hashEnd(name: string, x: number, z: number): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  h = Math.imul(h ^ Math.round(x), 16777619)
  h = Math.imul(h ^ Math.round(z), 16777619)
  return h >>> 0
}

/**
 * 某一個河端不照預設規則走。**沒列的河端照預設**：往最近的地圖邊流出去。
 *
 * 【為什麼要有】沿著地圖邊流的支流兩端都碰得到邊，預設規則會讓它兩端都各自
 * 流出去 —— 下游那一端變成一條與主流並排走 60 km 的假河。
 */
export interface RiverEndRule {
  /** 河端的位置，m。離它 `END_MATCH` 以內的那一端套用 */
  readonly at: readonly [number, number]
  /** 在延伸段上匯入這一條河（河名）。給了就不自己往外流 */
  readonly joins?: string
  /** 往這個方位流出去，rad：0 = 北（−Z）、正 = 往東（+X）。不給就朝最近的地圖邊 */
  readonly bearing?: number
}

/** 規則的 `at` 離河端多近才算同一端，m */
const END_MATCH = 500
/** 匯流口在主流延伸段的下游多遠，m */
export const JOIN_DOWNSTREAM = 3000

/**
 * 伸到地圖邊緣的河端往外編一段河道。
 *
 * `half` 是細節地形的半邊長；端點的 x 或 z 離 `±half` 在 `EDGE_TOUCH` 以內才延伸。
 * 起點就是端點、第一步是端點的切線（兩段水面接得上）；之後轉進「主方向 ＋ 長波
 * 慢擺 ＋ 短波蜿蜒」。`rules` 可以讓某一端改方位，或改成匯入另一條河。
 *
 * 【河道是編的】沒有真實資料 —— 從地圖內看出去只要它繼續、彎得自然、淡進霧裡。
 */
export function extendRivers(
  lines: readonly WaterLine[], half: number, sample: HeightSampler, rules: readonly RiverEndRule[] = [],
): WaterLine[] {
  const out: WaterLine[] = []
  const joins: { line: WaterLine; end: number; into: string }[] = []
  for (const line of lines) {
    const n = line.points.length
    if (n < 2) continue
    for (const end of [0, n - 1]) {
      const p = line.points[end]!
      const ax = Math.abs(p[0])
      const az = Math.abs(p[1])
      if (Math.max(ax, az) < half - EDGE_TOUCH) continue
      const rule = rules.find((r) => Math.hypot(r.at[0] - p[0], r.at[1] - p[1]) <= END_MATCH)
      if (rule?.joins !== undefined) {
        joins.push({ line, end, into: rule.joins })
        continue
      }
      // 出圖方向：指定方位，或離哪一條邊近就朝哪一邊
      const nx = rule?.bearing !== undefined ? Math.sin(rule.bearing) : ax >= az ? Math.sign(p[0]) : 0
      const nz = rule?.bearing !== undefined ? -Math.cos(rule.bearing) : ax >= az ? 0 : Math.sign(p[1])
      const q = line.points[end === 0 ? 1 : n - 2]!
      const tx = p[0] - q[0]
      const tz = p[1] - q[1]
      // 切線相對出圖方向的角度，逆時針為正
      const a0 = Math.max(-EXTEND_START_TURN, Math.min(EXTEND_START_TURN,
        Math.atan2(nx * tz - nz * tx, nx * tx + nz * tz)))
      // 【主方向是從地圖中心射出的放射線】同一個中心射出去的線只會越離越遠，
      // 而夾角範圍保住次序 —— 同一條邊上的幾條河不會在霧裡打結。它們在邊上
      // 至少相隔 2 km，短波加長波的左右擺幅每條最多約 1 km。指定了方位的
      // 就直直朝那個方位
      const radial = rule?.bearing !== undefined
        ? 0
        : Math.atan2(nx * p[1] - nz * p[0], nx * p[0] + nz * p[1])
      const base = Math.max(-EXTEND_BASE_TURN, Math.min(EXTEND_BASE_TURN, radial))
      const rand = makeRand(hashEnd(line.name, p[0], p[1]))
      const pick = (r: readonly [number, number]): number => r[0] + rand() * (r[1] - r[0])
      const driftWave = pick(DRIFT_WAVE)
      const driftPhase = rand() * Math.PI * 2
      // 【接上河端的方向】短波的相位補上切線與「主方向＋慢擺」的差
      let wave = pick(MEANDER_WAVE)
      let amp = pick(MEANDER_AMP)
      const start = base + DRIFT_AMP * Math.sin(driftPhase)
      let phase = Math.asin(Math.max(-1, Math.min(1, (a0 - start) / amp)))
      const startLevel = line.level[end]!
      const pts: [number, number][] = [[p[0], p[1]]]
      const level: number[] = [startLevel]
      let x = p[0]
      let z = p[1]
      const steps = Math.round(EXTEND_REACH / EXTEND_STEP)
      for (let i = 1; i <= steps; i++) {
        const before = Math.floor(phase / Math.PI)
        phase += (2 * Math.PI * EXTEND_STEP) / wave
        if (Math.floor(phase / Math.PI) !== before) {
          wave = pick(MEANDER_WAVE)
          amp = pick(MEANDER_AMP)
        }
        const drift = DRIFT_AMP * Math.sin(driftPhase + (2 * Math.PI * i * EXTEND_STEP) / driftWave)
        const wander = Math.max(-EXTEND_MAX_TURN, Math.min(EXTEND_MAX_TURN, base + drift + amp * Math.sin(phase)))
        // 【第一步順著河端的切線】水面帶的端面垂直於最後一段，兩段方向差多少，
        // 接頭外側就裂開多寬。前幾步從切線平滑地轉進蜿蜒
        const t = Math.min(1, (i - 1) / EXTEND_BLEND)
        const a = a0 + (wander - a0) * t * t * (3 - 2 * t)
        const c = Math.cos(a)
        const s = Math.sin(a)
        x += (nx * c - nz * s) * EXTEND_STEP
        z += (nx * s + nz * c) * EXTEND_STEP
        pts.push([x, z])
        const k = Math.max(0, 1 - i / EXTEND_RAMP)
        const flat = CLEARANCE + (startLevel - CLEARANCE) * k
        level.push(Math.max(flat, sample(x, z) + CLEARANCE))
      }
      out.push({ name: `${line.name}（延伸）`, points: pts, level, coarse: true })
    }
  }
  for (const j of joins) {
    const line = joinInto(j.line, j.end, j.into, out)
    if (line !== null) out.push(line)
  }
  return out
}

/**
 * 河端出地圖之後匯進主流的延伸段：一條三次貝茲曲線，起點順著河端的切線、
 * 終點順著主流在匯流口的方向，接在主流下游 `JOIN_DOWNSTREAM` 處。
 * 主流沒有延伸段（它沒流出地圖）就回 `null`。
 */
function joinInto(line: WaterLine, end: number, into: string, exts: readonly WaterLine[]): WaterLine | null {
  const n = line.points.length
  const p = line.points[end]!
  const q = line.points[end === 0 ? 1 : n - 2]!
  let target: WaterLine | null = null
  let best = Infinity
  for (const e of exts) {
    if (e.name !== `${into}（延伸）`) continue
    const s = e.points[0]!
    const d = Math.hypot(s[0] - p[0], s[1] - p[1])
    if (d < best) { best = d; target = e }
  }
  if (target === null) return null
  const k = Math.min(target.points.length - 2, Math.round(JOIN_DOWNSTREAM / EXTEND_STEP))
  const p3 = target.points[k]!
  const a = target.points[k - 1]!
  const b = target.points[k + 1]!
  const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const sx = (b[0] - a[0]) / tl
  const sz = (b[1] - a[1]) / tl
  const ql = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1
  const ux = (p[0] - q[0]) / ql
  const uz = (p[1] - q[1]) / ql
  // 【先順著切線直走一步】曲線上的第一條弦已經在轉彎，接頭外側會裂開一條縫
  const s0 = [p[0] + ux * EXTEND_STEP, p[1] + uz * EXTEND_STEP] as const
  const span = Math.hypot(p3[0] - s0[0], p3[1] - s0[1])
  const p1 = [s0[0] + ux * span * 0.4, s0[1] + uz * span * 0.4]
  const p2 = [p3[0] - sx * span * 0.4, p3[1] - sz * span * 0.4]
  const m = Math.max(4, Math.ceil((span * 1.3) / EXTEND_STEP))
  const l0 = line.level[end]!
  const l1 = target.level[k]!
  const pts: [number, number][] = [[p[0], p[1]]]
  const level: number[] = [l0]
  for (let i = 0; i <= m; i++) {
    const t = i / m
    const u = 1 - t
    const w0 = u * u * u
    const w1 = 3 * u * u * t
    const w2 = 3 * u * t * t
    const w3 = t * t * t
    pts.push([
      w0 * s0[0] + w1 * p1[0]! + w2 * p2[0]! + w3 * p3[0],
      w0 * s0[1] + w1 * p1[1]! + w2 * p2[1]! + w3 * p3[1],
    ])
    level.push(l0 + (l1 - l0) * t)
  }
  return { name: `${line.name}（匯流）`, points: pts, level, coarse: true }
}

/**
 * 河道的查詢索引：均勻格網，每一格記著「離這一格 `reach` 以內的線段」。
 *
 * 【數字鍵、不配置】`waterAt` 在碎片與殘骸的每幀更新裡，每一顆每一幀都問 ——
 * 字串鍵的 Map 每問一次就配一個字串。
 *
 * 【保證】離查詢點 `reach` 以內的線段一定在那一格的清單裡。超過 `reach` 的
 * 距離不保證正確（回 `Infinity`）。
 *
 * 只用 `distance` 的話任何折線都能用 —— 高速公路擋植被也是它（水面高度填 0）。
 */
export class RiverIndex {
  /** 每一段：x0, z0, x1, z1, 水面 0, 水面 1 */
  private readonly segs: Float64Array
  private readonly start: Int32Array
  private readonly list: Int32Array
  private readonly x0: number
  private readonly z0: number
  private readonly cols: number
  private readonly rows: number
  private readonly cell: number

  constructor(lines: readonly WaterLine[], readonly reach: number) {
    let count = 0
    for (const l of lines) count += Math.max(0, l.points.length - 1)
    this.segs = new Float64Array(count * 6)
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    let k = 0
    for (const l of lines) {
      for (let i = 0; i + 1 < l.points.length; i++) {
        const a = l.points[i]!
        const b = l.points[i + 1]!
        this.segs.set([a[0], a[1], b[0], b[1], l.level[i]!, l.level[i + 1]!], k * 6)
        minX = Math.min(minX, a[0], b[0])
        maxX = Math.max(maxX, a[0], b[0])
        minZ = Math.min(minZ, a[1], b[1])
        maxZ = Math.max(maxZ, a[1], b[1])
        k++
      }
    }
    this.cell = Math.max(500, reach * 2)
    if (count === 0) { minX = minZ = 0; maxX = maxZ = 0 }
    this.x0 = minX - reach
    this.z0 = minZ - reach
    // 【floor + 1 不是 ceil】寬度剛好是格寬的整數倍時，ceil 會少最外那一格 ——
    // 查詢半徑最外緣的點會被判成出界
    this.cols = Math.floor((maxX + reach - this.x0) / this.cell) + 1
    this.rows = Math.floor((maxZ + reach - this.z0) / this.cell) + 1
    const cells = this.cols * this.rows
    const counts = new Int32Array(cells + 1)
    const visit = (s: number, fn: (c: number) => void): void => {
      const o = s * 6
      const i0 = Math.floor((Math.min(this.segs[o]!, this.segs[o + 2]!) - reach - this.x0) / this.cell)
      const i1 = Math.floor((Math.max(this.segs[o]!, this.segs[o + 2]!) + reach - this.x0) / this.cell)
      const j0 = Math.floor((Math.min(this.segs[o + 1]!, this.segs[o + 3]!) - reach - this.z0) / this.cell)
      const j1 = Math.floor((Math.max(this.segs[o + 1]!, this.segs[o + 3]!) + reach - this.z0) / this.cell)
      for (let j = Math.max(0, j0); j <= Math.min(this.rows - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(this.cols - 1, i1); i++) fn(j * this.cols + i)
      }
    }
    for (let s = 0; s < count; s++) visit(s, (c) => { counts[c + 1] = counts[c + 1]! + 1 })
    for (let c = 0; c < cells; c++) counts[c + 1] = counts[c + 1]! + counts[c]!
    this.start = counts
    this.list = new Int32Array(counts[cells]!)
    const fill = counts.slice(0, cells)
    for (let s = 0; s < count; s++) {
      visit(s, (c) => {
        this.list[fill[c]!] = s
        fill[c] = fill[c]! + 1
      })
    }
  }

  /** 最近的一段與投影參數寫進這兩格。沒有就是 −1 */
  private nearSeg = -1
  private nearT = 0

  /** 到最近一條中心線的距離，m。`reach` 以外回 `Infinity` */
  distance(x: number, z: number): number {
    this.nearSeg = -1
    const i = Math.floor((x - this.x0) / this.cell)
    const j = Math.floor((z - this.z0) / this.cell)
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return Infinity
    const c = j * this.cols + i
    let best = Infinity
    for (let k = this.start[c]!; k < this.start[c + 1]!; k++) {
      const o = this.list[k]! * 6
      const ax = this.segs[o]!
      const az = this.segs[o + 1]!
      const vx = this.segs[o + 2]! - ax
      const vz = this.segs[o + 3]! - az
      const l2 = vx * vx + vz * vz
      let t = l2 <= 0 ? 0 : ((x - ax) * vx + (z - az) * vz) / l2
      t = t < 0 ? 0 : t > 1 ? 1 : t
      // 【手寫開根號】V8 的 Math.hypot 每次呼叫都會配置；植被補格時每一株都問
      const ex = x - (ax + vx * t)
      const ez = z - (az + vz * t)
      const d = Math.sqrt(ex * ex + ez * ez)
      if (d < best) {
        best = d
        this.nearSeg = o
        this.nearT = t
      }
    }
    return best <= this.reach ? best : Infinity
  }

  /**
   * 這個方框裡**可能**有點離中心線在 `reach` 以內嗎。保守：回 false 時框裡一定
   * 沒有；回 true 時不一定有。
   *
   * 【為什麼成立】每一段登錄在它外接盒外擴 `reach` 碰到的每一格；框裡任何一點若
   * 離某一段在 `reach` 以內，那一點所在的格就登錄了那一段。框蓋到的格全是空的，
   * 框裡就沒有這樣的點。植被逐格先問它，離河遠的格整格不必逐株查
   */
  mayReach(x0: number, z0: number, x1: number, z1: number): boolean {
    const i0 = Math.max(0, Math.floor((x0 - this.x0) / this.cell))
    const i1 = Math.min(this.cols - 1, Math.floor((x1 - this.x0) / this.cell))
    const j0 = Math.max(0, Math.floor((z0 - this.z0) / this.cell))
    const j1 = Math.min(this.rows - 1, Math.floor((z1 - this.z0) / this.cell))
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * this.cols + i
        if (this.start[c + 1]! > this.start[c]!) return true
      }
    }
    return false
  }

  /** 水面高度，m。不在水面上回 `-Infinity` —— 與 `Terrain.waterAt` 同一個約定 */
  waterAt(x: number, z: number): number {
    if (!(this.distance(x, z) <= CHANNEL_HALF) || this.nearSeg < 0) return -Infinity
    return this.nearLevel()
  }

  /** 最近那一段中心線的水面高度，m —— 不管在不在水面上。`reach` 外回 `-Infinity` */
  levelNear(x: number, z: number): number {
    if (!(this.distance(x, z) <= this.reach) || this.nearSeg < 0) return -Infinity
    return this.nearLevel()
  }

  private nearLevel(): number {
    const o = this.nearSeg
    return this.segs[o + 4]! + (this.segs[o + 5]! - this.segs[o + 4]!) * this.nearT
  }
}
