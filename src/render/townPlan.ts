/**
 * # 鎮的平面：放射主路、環路、同心街與橫街
 *
 * 德國中部的鎮：幾條古商路從四面八方匯到市集廣場，城牆拆掉的地方是一圈環路，
 * 後來的擴張沿著出城的路往外長。這裡用極座標表示一個鎮的每一點：θ 是方位角，
 * r 是輪廓比例（0 = 中心、1 = 輪廓）。世界座標
 *
 * ```
 * P(θ, r) = bend(中心 + r · R · outline(θ) · (cos θ, sin θ))
 * ```
 *
 * **所有的街都是 θ 固定或 r 固定的線**，所以每個街廓都是參數空間的矩形
 * `[θ0, θ1] × [r0, r1]`，四條邊都由 `P` 算出來。`bend` 是平滑的扭曲，讓每一條街
 * 都彎；老城彎得多。
 *
 * 同心街在每個扇區（兩條放射路之間）各自起算、橫街在每一圈各自切 —— 相鄰的
 * 扇區與圈錯開，路口多半是丁字路口，街廓大小不一。
 *
 * 這個檔案只有幾何，不碰聚落的亂數以外的狀態；房子怎麼沿街排見 `settlements.ts`。
 */

/** 一段街：街心線（世界座標）與半寬 */
export interface Street {
  readonly points: readonly (readonly [number, number])[]
  readonly half: number
}

/** 老城或外圍 */
export type Zone = 'old' | 'outer'

/**
 * 一個街廓：參數空間的梯形。內緣在 r0、θ 從 `t0a` 到 `t1a`；外緣在 r1、θ 從
 * `t0b` 到 `t1b`；兩側是直線（橫街是斜的，見 `planTown`）。`edges` 是四條邊的
 * 街半寬，次序是內、外、θ0 側、θ1 側；0 = 那一邊沒有街（鎮的外緣）
 */
export interface Cell {
  readonly t0a: number
  readonly t1a: number
  readonly t0b: number
  readonly t1b: number
  readonly r0: number
  readonly r1: number
  readonly zone: Zone
  readonly edges: readonly [number, number, number, number]
}

/** 街廓裡的一點：`u` 沿 θ、`v` 沿 r，都是 0～1 */
export function cellAt(plan: TownPlan, c: Cell, u: number, v: number, out: number[]): void {
  const ta = c.t0a + (c.t1a - c.t0a) * u
  const tb = c.t0b + (c.t1b - c.t0b) * u
  plan.at(ta + (tb - ta) * v, c.r0 + (c.r1 - c.r0) * v, out)
}

/** 街廓大約的寬（沿 θ）與深（沿 r），m：把公尺換成參數用 */
export function cellSize(plan: TownPlan, c: Cell): { W: number; H: number } {
  const rm = (c.r0 + c.r1) / 2
  return { W: ((c.t1a - c.t0a + c.t1b - c.t0b) / 2) * rm * plan.R, H: (c.r1 - c.r0) * plan.R }
}

/** 一個區的街：同心街的間距、橫街的間距（m，取亂數）、街的半寬 */
export interface ZoneStreets {
  readonly band: readonly [number, number]
  readonly cross: readonly [number, number]
  readonly half: number
}

export interface PlanSpec {
  /** 老城的外緣（輪廓比例），環路在這裡。0 = 沒有老城 */
  readonly oldTown: number
  readonly old: ZoneStreets
  readonly outer: ZoneStreets
  /** 放射主路、環路、市集廣場那一圈的半寬，m */
  readonly mainHalf: number
  readonly ringHalf: number
  readonly marketHalf: number
  /** 扭曲的振幅（老城、外圍）與波長，m */
  readonly warp: { readonly old: number; readonly outer: number; readonly wave: number }
}

export interface PlanInput {
  readonly x: number
  readonly z: number
  /** 聚落半徑，m（`settlementRadius`） */
  readonly R: number
  /** 輪廓在方位角 θ 的倍率（`outlineScale`） */
  readonly outline: (theta: number) => number
  /** 放射主路的方位角（`roadAngles`） */
  readonly roads: readonly number[]
  /** 市集廣場的半徑，m。放射路從這裡開始 */
  readonly market: number
  readonly rand: () => number
  /** 街碰到這些地方就斷開（河道、高速公路、礦坑、砲位） */
  readonly avoid: (x: number, z: number) => boolean
  readonly spec: PlanSpec
}

export interface TownPlan {
  readonly streets: Street[]
  readonly cells: Cell[]
  /** `P(θ, r)` 寫進 `out` */
  readonly at: (theta: number, r: number, out: number[]) => void
  readonly R: number
}

/** 老城與外圍交界的漸變寬度（輪廓比例），扭曲的振幅在這一段內換過去 */
const WARP_BLEND = 0.15
/** 同心街最窄的一圈，m。比這窄就併進下一圈 */
const MIN_BAND = 35
/** 街心線的取樣間距，m */
export const STREET_STEP = 10
/** 放射路伸出輪廓多遠（輪廓比例）：出城的路頭 */
const ROAD_TAIL = 1.08
/**
 * 橫街兩頭各自偏多少（佔一格角寬的比例）。位置的抖動是 ±0.25 格，兩頭再各偏
 * ±0.2 格，相鄰兩條橫街不會交叉
 */
const CROSS_SKEW = 0.4

/**
 * 放射主路的方向：往最近的八個聚落，夾角小於 30° 的併掉（留近的），最多六條；
 * 相鄰兩條隔超過 120° 就在中間補一條，所以至少三條
 */
export function roadAngles(x: number, z: number, others: readonly { x: number; z: number }[]): number[] {
  const near = others
    .map((o) => ({ d: Math.hypot(o.x - x, o.z - z), a: Math.atan2(o.z - z, o.x - x) }))
    .filter((o) => o.d > 1 && o.d < 12000)
    .sort((a, b) => a.d - b.d)
    .slice(0, 8)
  const picked: number[] = []
  for (const o of near) {
    if (picked.length >= 6) break
    if (picked.some((a) => angleGap(a, o.a) < Math.PI / 6)) continue
    picked.push(o.a)
  }
  const out = picked.map(wrap).sort((a, b) => a - b)
  if (out.length === 0) out.push(0)
  // 補空檔：最大的空檔超過 120° 就在中間加一條，直到沒有
  for (;;) {
    let gap = 0
    let at = -1
    for (let i = 0; i < out.length; i++) {
      const g = (i + 1 < out.length ? out[i + 1]! : out[0]! + Math.PI * 2) - out[i]!
      if (g > gap) {
        gap = g
        at = i
      }
    }
    if (gap <= (Math.PI * 2) / 3 + 1e-9) break
    out.splice(at + 1, 0, wrap(out[at]! + gap / 2))
    out.sort((a, b) => a - b)
  }
  return out
}

const wrap = (a: number): number => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
const angleGap = (a: number, b: number): number => {
  const d = Math.abs(wrap(a) - wrap(b))
  return Math.min(d, Math.PI * 2 - d)
}
const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** 生成一個鎮的街網與街廓。**只吃 `rand` 的序列** —— 同一個鎮每次一樣 */
export function planTown(inp: PlanInput): TownPlan {
  const { x, z, R, spec, rand } = inp
  const ph0 = rand() * 6.3
  const ph1 = rand() * 6.3
  const old = spec.oldTown
  // 【扭曲用離中心的距離，不用世界座標】波長固定、振幅隨半徑漸變 —— 用世界座標
  // 的話相位對座標的導數是幾千公尺乘一個小數，扭曲會折疊
  const bend = (px: number, pz: number, out: number[]): void => {
    const dx = px - x
    const dz = pz - z
    const t = old > 0 ? smooth(old - WARP_BLEND, old + WARP_BLEND, Math.hypot(dx, dz) / R) : 1
    const amp = spec.warp.old + (spec.warp.outer - spec.warp.old) * t
    out[0] = px + amp * Math.sin(dz / spec.warp.wave + ph0)
    out[1] = pz + amp * Math.sin(dx / spec.warp.wave + ph1)
  }
  const at = (theta: number, r: number, out: number[]): void => {
    const rho = r * R * inp.outline(theta)
    bend(x + Math.cos(theta) * rho, z + Math.sin(theta) * rho, out)
  }
  const roads = inp.roads.length >= 3 ? [...inp.roads] : roadAngles(x, z, [])
  const rm = inp.market / R
  const hasOld = old > 0 && (old - rm) * R >= MIN_BAND
  const streets: Street[] = []
  const cells: Cell[] = []
  const q: number[] = [0, 0]

  /** 沿參數曲線取樣成街，碰到避開的地方斷開 */
  const street = (f: (s: number) => [number, number], length: number, half: number): void => {
    const n = Math.max(2, Math.ceil(length / STREET_STEP))
    let run: [number, number][] = []
    for (let i = 0; i <= n; i++) {
      const [t, r] = f(i / n)
      at(t, r, q)
      if (inp.avoid(q[0]!, q[1]!)) {
        if (run.length >= 2) streets.push({ points: run, half })
        run = []
        continue
      }
      run.push([q[0]!, q[1]!])
    }
    if (run.length >= 2) streets.push({ points: run, half })
  }
  const arc = (t0: number, t1: number, r: number, half: number): void =>
    street((s) => [t0 + (t1 - t0) * s, r], (t1 - t0) * r * R, half)
  /** (ta, r0) 到 (tb, r1) 的直線：放射路 ta = tb，橫街是斜的 */
  const ray = (ta: number, tb: number, r0: number, r1: number, half: number): void =>
    street((s) => [ta + (tb - ta) * s, r0 + (r1 - r0) * s],
      Math.hypot((r1 - r0) * R, (tb - ta) * ((r0 + r1) / 2) * R), half)

  // 市集廣場那一圈、環路、放射主路
  arc(0, Math.PI * 2, rm, spec.marketHalf)
  if (hasOld) arc(0, Math.PI * 2, old, spec.ringHalf)
  for (const a of roads) ray(a, a, rm, ROAD_TAIL, spec.mainHalf)

  const zones: { zone: Zone; r0: number; r1: number; s: ZoneStreets; in0: number; out1: number }[] = hasOld
    ? [
      { zone: 'old', r0: rm, r1: old, s: spec.old, in0: spec.marketHalf, out1: spec.ringHalf },
      { zone: 'outer', r0: old, r1: 1, s: spec.outer, in0: spec.ringHalf, out1: 0 },
    ]
    : [{ zone: 'outer', r0: rm, r1: 1, s: spec.outer, in0: spec.marketHalf, out1: 0 }]
  const pick = (r: readonly [number, number]): number => r[0] + rand() * (r[1] - r[0])

  for (const zn of zones) {
    for (let k = 0; k < roads.length; k++) {
      const ta = roads[k]!
      const tb = k + 1 < roads.length ? roads[k + 1]! : roads[0]! + Math.PI * 2
      // 同心街：這個扇區自己起算，第一條錯開半圈到一圈
      const rs = [zn.r0]
      let cur = zn.r0 + (pick(zn.s.band) * (0.5 + 0.5 * rand())) / R
      while (cur < zn.r1 - MIN_BAND / R) {
        rs.push(cur)
        cur += pick(zn.s.band) / R
      }
      rs.push(zn.r1)
      for (let j = 0; j + 1 < rs.length; j++) {
        const ra = rs[j]!
        const rb = rs[j + 1]!
        if (j > 0) arc(ta, tb, ra, zn.s.half)
        // 橫街：照這一圈中間的弧長切，位置抖動；兩頭各自再抖一點，斜著切 ——
        // 全部指向中心的話整個鎮是一個標靶
        const len = (tb - ta) * ((ra + rb) / 2) * R
        const n = Math.max(1, Math.round(len / pick(zn.s.cross)))
        const w = (tb - ta) / n
        const tsa = [ta]
        const tsb = [ta]
        for (let i = 1; i < n; i++) {
          const mid = ta + w * (i + (rand() - 0.5) * 0.5)
          const skew = (rand() - 0.5) * w * CROSS_SKEW
          tsa.push(mid - skew)
          tsb.push(mid + skew)
        }
        tsa.push(tb)
        tsb.push(tb)
        for (let i = 1; i < tsa.length - 1; i++) ray(tsa[i]!, tsb[i]!, ra, rb, zn.s.half)
        const inner = j === 0 ? zn.in0 : zn.s.half
        const outer = j + 2 === rs.length ? zn.out1 : zn.s.half
        for (let i = 0; i + 1 < tsa.length; i++) {
          cells.push({
            t0a: tsa[i]!, t1a: tsa[i + 1]!, t0b: tsb[i]!, t1b: tsb[i + 1]!, r0: ra, r1: rb, zone: zn.zone,
            edges: [inner, outer, i === 0 ? spec.mainHalf : zn.s.half, i + 2 === tsa.length ? spec.mainHalf : zn.s.half],
          })
        }
      }
    }
  }
  return { streets, cells, at, R }
}

/**
 * 街廓的一條邊畫成街心線：每 `step` m 一點，附累計弧長。邊的次序同
 * `Cell.edges`；θ 側的邊由 r0 走到 r1、r 側的由 θ0 走到 θ1
 */
export function edgeLine(plan: TownPlan, c: Cell, e: number, step: number): { xs: number[]; zs: number[]; len: number[] } {
  const q: number[] = [0, 0]
  const f = (s: number): [number, number] => {
    if (e === 0) return [c.t0a + (c.t1a - c.t0a) * s, c.r0]
    if (e === 1) return [c.t0b + (c.t1b - c.t0b) * s, c.r1]
    const ta = e === 2 ? c.t0a : c.t1a
    const tb = e === 2 ? c.t0b : c.t1b
    return [ta + (tb - ta) * s, c.r0 + (c.r1 - c.r0) * s]
  }
  const approx = e === 0 ? (c.t1a - c.t0a) * c.r0 * plan.R
    : e === 1 ? (c.t1b - c.t0b) * c.r1 * plan.R
      : (c.r1 - c.r0) * plan.R * 1.2
  const n = Math.max(2, Math.ceil(approx / step))
  const xs: number[] = []
  const zs: number[] = []
  const len: number[] = []
  for (let i = 0; i <= n; i++) {
    const [t, r] = f(i / n)
    plan.at(t, r, q)
    xs.push(q[0]!)
    zs.push(q[1]!)
    len.push(i === 0 ? 0 : len[i - 1]! + Math.hypot(q[0]! - xs[i - 1]!, q[1]! - zs[i - 1]!))
  }
  return { xs, zs, len }
}

/** 牆的外框：中心、面寬方向（單位向量）、半面寬、半進深 */
export interface Rect {
  readonly x: number
  readonly z: number
  readonly ax: number
  readonly az: number
  readonly hw: number
  readonly hd: number
}

const reachOf = (r: Rect): number => Math.hypot(r.hw, r.hd)
const project = (r: Rect, nx: number, nz: number): number =>
  r.hw * Math.abs(r.ax * nx + r.az * nz) + r.hd * Math.abs(-r.az * nx + r.ax * nz)

/** 兩個外框隔多遠（分離軸上的最大間隙）；負的是相交的深度 */
export function rectGap(a: Rect, b: Rect): number {
  let best = -Infinity
  for (const [nx, nz] of [[a.ax, a.az], [-a.az, a.ax], [b.ax, b.az], [-b.az, b.ax]] as const) {
    const d = Math.abs((b.x - a.x) * nx + (b.z - a.z) * nz)
    best = Math.max(best, d - project(a, nx, nz) - project(b, nx, nz))
  }
  return best
}

const CELL = 32
const key = (i: number, j: number): number => (i + 65536) * 131072 + (j + 65536)

/** 已經放的牆外框，依格分桶。**精確的分離軸檢查**，不是外接圓 */
export class Footprints {
  private readonly cells = new Map<number, Rect[]>()
  private maxReach = 0

  add(r: Rect): void {
    const k = key(Math.floor(r.x / CELL), Math.floor(r.z / CELL))
    const list = this.cells.get(k)
    if (list === undefined) this.cells.set(k, [r])
    else list.push(r)
    this.maxReach = Math.max(this.maxReach, reachOf(r))
  }

  /** 與每一個已經放的外框至少隔 `gap` m 嗎 */
  free(r: Rect, gap: number): boolean {
    const reach = Math.ceil((reachOf(r) + this.maxReach + gap) / CELL)
    const ci = Math.floor(r.x / CELL)
    const cj = Math.floor(r.z / CELL)
    for (let j = cj - reach; j <= cj + reach; j++) {
      for (let i = ci - reach; i <= ci + reach; i++) {
        const list = this.cells.get(key(i, j))
        if (list === undefined) continue
        for (const o of list) if (rectGap(r, o) < gap) return false
      }
    }
    return true
  }
}

/** 街心點取樣的間距，m。**要比最窄的街半寬小** —— 外框從兩點之間穿過街會漏掉 */
const STREET_PROBE = 2

/** 全部街心點，依格分桶。問「這個外框壓不壓到街」 */
export class StreetIndex {
  private readonly cells = new Map<number, number[]>()
  private maxHalf = 0

  constructor(streets: readonly Street[]) {
    for (const s of streets) {
      this.maxHalf = Math.max(this.maxHalf, s.half)
      for (let i = 0; i + 1 < s.points.length; i++) {
        const [ax, az] = s.points[i]!
        const [bx, bz] = s.points[i + 1]!
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STREET_PROBE))
        for (let k = 0; k <= n; k++) {
          const px = ax + ((bx - ax) * k) / n
          const pz = az + ((bz - az) * k) / n
          const kk = key(Math.floor(px / CELL), Math.floor(pz / CELL))
          const list = this.cells.get(kk)
          if (list === undefined) this.cells.set(kk, [px, pz, s.half])
          else list.push(px, pz, s.half)
        }
      }
    }
  }

  /** 外框離每一個街心點都超過「那條街的半寬 + `margin`」嗎 */
  clear(r: Rect, margin: number): boolean {
    const reach = Math.ceil((reachOf(r) + this.maxHalf + margin) / CELL)
    const ci = Math.floor(r.x / CELL)
    const cj = Math.floor(r.z / CELL)
    for (let j = cj - reach; j <= cj + reach; j++) {
      for (let i = ci - reach; i <= ci + reach; i++) {
        const list = this.cells.get(key(i, j))
        if (list === undefined) continue
        for (let k = 0; k < list.length; k += 3) {
          const dx = list[k]! - r.x
          const dz = list[k + 1]! - r.z
          const u = Math.max(0, Math.abs(dx * r.ax + dz * r.az) - r.hw)
          const v = Math.max(0, Math.abs(-dx * r.az + dz * r.ax) - r.hd)
          if (Math.hypot(u, v) < list[k + 2]! + margin) return false
        }
      }
    }
    return true
  }
}
