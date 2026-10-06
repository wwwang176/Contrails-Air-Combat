import { CHANNEL_HALF, type WaterLine } from './riverTypes'

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
