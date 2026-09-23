import { Audio, AudioListener, Object3D } from 'three'

/**
 * # 定位聲道：自己算左右，不用 `PannerNode`
 *
 * `PannerNode` 的位置只要一動，Chrome 就把那一段逐取樣重算方位與距離；而
 * listener 一動，每一個 panner 都被拖進去。離線實測 40 條聲道：three 預設的
 * 每幀漸變 67%、每幀直接設值 19～41%、自己算交給增益節點 10～15%（位置不動是
 * 8～13%）。音訊執行緒算不完時瀏覽器塞靜音補上，聽起來是一陣劈啪。
 *
 * 所以聲道是 three 的 `Audio`（來源、低通、音量都照舊），出口改接一個 2×2 的
 * 增益矩陣：`音量 → 拆左右 → 四個增益 → 合回左右 → listener`。矩陣由 `pan.ts`
 * 算，逐幀平滑過去。
 */

/**
 * 不寫位置的 listener。**聲道已經不用 panner**，listener 的位置參數沒人讀；
 * three 預設每幀對它排九條漸變，那是白做的。
 */
export class SilentListener extends AudioListener {
  override updateMatrixWorld(force?: boolean): void {
    Object3D.prototype.updateMatrixWorld.call(this, force)
  }
}

/** 矩陣的四格，與 `equalPowerMatrix` 的 `out` 同序：左←左、左←右、右←左、右←右 */
const ROUTES: readonly (readonly [0 | 1, 0 | 1])[] = [[0, 0], [1, 0], [0, 1], [1, 1]]

/**
 * 變動小於這個就不重排（約 −60 dB）。每幀都排的話主執行緒要多送好幾百個事件，
 * 而差這麼一點聽不出來。
 */
const PAN_EPSILON = 1e-3

export class PannedAudio extends Audio {
  private readonly mix: GainNode[] = []
  /** 上一次排下去的矩陣；NaN = 還沒排過 */
  private readonly last = new Float32Array(4).fill(Number.NaN)
  private readonly merge: ChannelMergerNode
  private readonly bus: AudioNode
  /** 出口有沒有接在 listener 上。見 `wake` */
  private awake = false

  constructor(listener: AudioListener) {
    super(listener)
    const ctx = this.context
    // 【拆左右一律兩路】單聲道進來時第二路是靜音（拆分節點固定 discrete），
    // 矩陣裡「←右」那兩格乘的是 0
    const split = ctx.createChannelSplitter(2)
    this.merge = ctx.createChannelMerger(2)
    this.bus = listener.getInput()
    this.gain.disconnect()
    this.gain.connect(split)
    for (const [from, to] of ROUTES) {
      const g = ctx.createGain()
      g.gain.value = 0
      split.connect(g, from)
      g.connect(this.merge, 0, to)
      this.mix.push(g)
    }
  }

  /** 【播之前一定先接上出口】拔掉的聲道直接播是整條斷的，沒有聲音也不報錯 */
  override play(delay = 0): this {
    this.wake()
    super.play(delay)
    return this
  }

  /**
   * 接上出口。`play` 會自己叫。
   *
   * 【沒在響的要拔掉】瀏覽器每一段都處理所有接到喇叭上的節點，不管有沒有
   * 聲音 —— 離線實測 84 條閒置聲道吃掉音訊執行緒 14～19%。拔掉的就不處理。
   */
  wake(): void {
    if (this.awake) return
    this.merge.connect(this.bus)
    this.awake = true
  }

  /** 拔掉出口。只在沒在播、也沒排著要播的時候叫 */
  sleep(): void {
    if (!this.awake) return
    this.merge.disconnect()
    this.awake = false
  }

  get isAwake(): boolean {
    return this.awake
  }

  /** 現在這個 buffer 是不是立體聲 —— 兩套 equal-power 公式不一樣 */
  get stereo(): boolean {
    return (this.buffer?.numberOfChannels ?? 1) >= 2
  }

  /**
   * 套用左右矩陣。`smooth` 是時間常數，s；0 = 立刻到位（起播用 ——
   * 平滑的話起音那一下會從上一個聲音的方向滑過來）。
   */
  setPan(m: Float32Array, now: number, smooth: number): void {
    for (let i = 0; i < 4; i++) {
      const v = m[i]!
      const p = this.mix[i]!.gain
      if (smooth <= 0) {
        p.cancelScheduledValues(now)
        p.setValueAtTime(v, now)
      } else {
        if (Math.abs(v - this.last[i]!) <= PAN_EPSILON) continue
        p.setTargetAtTime(v, now, smooth)
      }
      this.last[i] = v
    }
  }
}
