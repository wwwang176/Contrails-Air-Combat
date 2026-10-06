import type { Street } from './townPlan'

/** 聚落配置的建築外框與道路避讓查詢；街網生成見 townPlan.ts。 */
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
