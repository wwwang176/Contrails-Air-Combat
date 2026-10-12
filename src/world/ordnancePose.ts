/** 彈藥的一組位置與速度；模型以速度決定朝向。 */
export interface OrdnancePose {
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
  readonly vx: Float64Array
  readonly vy: Float64Array
  readonly vz: Float64Array
}

/** 上一個物理步的姿態，供顯示內插；不參與彈道或碰撞判定。 */
export class OrdnanceSnapshot implements OrdnancePose {
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
  readonly vx: Float64Array
  readonly vy: Float64Array
  readonly vz: Float64Array

  constructor(capacity: number) {
    this.x = new Float64Array(capacity)
    this.y = new Float64Array(capacity)
    this.z = new Float64Array(capacity)
    this.vx = new Float64Array(capacity)
    this.vy = new Float64Array(capacity)
    this.vz = new Float64Array(capacity)
  }

  /** 每個物理步開始前保存；投放或重用槽位時也呼叫，避免從舊彈藥的位置內插。 */
  copyFrom(pool: OrdnancePose, i: number): void {
    this.x[i] = pool.x[i]!
    this.y[i] = pool.y[i]!
    this.z[i] = pool.z[i]!
    this.vx[i] = pool.vx[i]!
    this.vy[i] = pool.vy[i]!
    this.vz[i] = pool.vz[i]!
  }
}
