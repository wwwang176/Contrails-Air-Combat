/** 佔位格網的格寬，m */
const OCC_CELL = 32
/** 佔位圓最大的半徑，m（大教堂 13 × 2 + 10）。查詢的範圍由它決定 */
const OCC_MAX = 36

/**
 * 已經佔掉的圓。**所有聚落共用一份**（`settlementFlora`）—— 相鄰的村可以只隔
 * 三四百公尺。依格分桶：鎮上幾千棟，逐一比對是平方的。
 */
export class Occupancy {
  private readonly xs: number[] = []
  private readonly zs: number[] = []
  private readonly rs: number[] = []
  private readonly cells = new Map<number, number[]>()

  private static key(i: number, j: number): number {
    return (i + 65536) * 131072 + (j + 65536)
  }

  free(x: number, z: number, r: number): boolean {
    const reach = Math.ceil((r + OCC_MAX) / OCC_CELL)
    const ci = Math.floor(x / OCC_CELL)
    const cj = Math.floor(z / OCC_CELL)
    for (let j = cj - reach; j <= cj + reach; j++) {
      for (let i = ci - reach; i <= ci + reach; i++) {
        const list = this.cells.get(Occupancy.key(i, j))
        if (list === undefined) continue
        for (const k of list) {
          if (Math.hypot(this.xs[k]! - x, this.zs[k]! - z) < this.rs[k]! + r) return false
        }
      }
    }
    return true
  }

  add(x: number, z: number, r: number): void {
    const k = this.xs.length
    this.xs.push(x)
    this.zs.push(z)
    this.rs.push(r)
    const key = Occupancy.key(Math.floor(x / OCC_CELL), Math.floor(z / OCC_CELL))
    const list = this.cells.get(key)
    if (list === undefined) this.cells.set(key, [k])
    else list.push(k)
  }
}
