export interface FixedStepOptions {
  /** 物理步頻率，Hz。專案預設 240。 */
  stepHz: number
  /** 每幀最多執行的子步數。超過即丟棄剩餘 accumulator，避免螺旋死亡。 */
  maxSubsteps: number
  /** 單幀經過時間上限，秒。防止分頁切回時的巨大 dt。 */
  maxFrameSeconds: number
}

export class FixedStepAccumulator {
  private accumulator = 0
  private step_ = 0
  private readonly maxSubsteps: number
  private readonly maxFrameSeconds: number

  /** 上次 advance 實際執行的子步數，供效能覆蓋層讀取。 */
  lastSubstepCount = 0

  constructor(opts: FixedStepOptions) {
    this.step_ = 1 / opts.stepHz
    this.maxSubsteps = opts.maxSubsteps
    this.maxFrameSeconds = opts.maxFrameSeconds
  }

  get stepSeconds(): number {
    return this.step_
  }

  /** 變更步長。會清空 accumulator，避免以舊步長累積的餘數被新步長誤讀。 */
  setStepHz(hz: number): void {
    this.step_ = 1 / hz
    this.accumulator = 0
  }

  /**
   * 消耗一幀的經過時間，執行對應數量的固定步長子步。
   * @returns 內插係數 alpha ∈ [0, 1)，供渲染端內插 position/quaternion。
   */
  advance(frameSeconds: number, step: (dt: number) => void): number {
    const clamped = frameSeconds > this.maxFrameSeconds ? this.maxFrameSeconds : frameSeconds
    this.accumulator += clamped

    let n = 0
    const epsilon = 1e-10
    while (this.accumulator >= this.step_ - epsilon && n < this.maxSubsteps) {
      step(this.step_)
      this.accumulator -= this.step_
      n++
    }
    this.lastSubstepCount = n

    // 觸及子步上限代表機器跟不上，丟棄剩餘時間讓遊戲進入慢動作而非卡死。
    if (n === this.maxSubsteps && this.accumulator >= this.step_ - epsilon) {
      this.accumulator = 0
    }

    return this.accumulator / this.step_
  }
}
