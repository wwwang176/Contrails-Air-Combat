/**
 * 單幀經過時間的上限，秒。**整個遊戲共用這一個數。**
 *
 * 【為什麼要夾】分頁在背景時 requestAnimationFrame 整個暫停，回來的第一幀帶著
 * 整段離開的秒數。不夾的話戰鬥的物理會想一次補完那段時間，機庫的開火、拋彈、
 * 搖晃與鏡頭則會一口氣走完 —— 整串炸彈在半空中憑空消失、鏡頭快速轉圈。
 *
 * 【為什麼是 0.25】要比換機種那一幀長（實測 40…90 ms），否則機庫每次換機種都
 * 會整頁慢動作一下；又要短到分頁切回來時看不出跳動。
 */
export const MAX_FRAME_SECONDS = 0.25

/**
 * 把一幀的經過時間夾到上限，超過的部分當作沒有發生。
 *
 * 戰鬥的步進與 `main.ts` 的幀迴圈都吃這一支 —— 兩邊各寫一份的話，改了一邊
 * 另一邊不會跟著動，而且不會報錯。
 */
export function clampFrameSeconds(
  frameSeconds: number, max: number = MAX_FRAME_SECONDS,
): number {
  return frameSeconds > max ? max : frameSeconds
}

export interface FixedStepOptions {
  /** 物理步頻率，Hz。專案預設 240。 */
  stepHz: number
  /** 每幀最多執行的子步數。超過即丟棄剩餘 accumulator，避免螺旋死亡。 */
  maxSubsteps: number
  /** 單幀經過時間上限，秒。防止分頁切回時的巨大 dt。專案預設 `MAX_FRAME_SECONDS`。 */
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
    this.accumulator += clampFrameSeconds(frameSeconds, this.maxFrameSeconds)

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
