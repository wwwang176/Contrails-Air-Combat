import { assetUrl } from '../core/asset'
import { fadeInCurve } from './curves'
import { toDb, type MeterSample } from './meter'

/** 淡入曲線的點數；曲線點之間由 Web Audio 線性內插。 */
const FADE_POINTS = 32

/** 世界音訊的最後一段；管理淡入、限幅與輸出讀數，不管理聲道。 */
export function createAudioOutput(ctx: BaseAudioContext, input: GainNode) {
  const fade = ctx.createGain()
  /**
   * 選單音樂的匯流排：**接在共用淡入之後**、限幅器之前。共用淡入是進戰鬥與恢復用的，經過它的話
   * 第一次按「開始遊戲」時兩條淡入相乘。增益由引擎跟著主音量設
   */
  const musicInput = ctx.createGain()
  input.disconnect()
  input.connect(fade)
  fade.connect(ctx.destination)
  musicInput.connect(ctx.destination)

  /** 共用淡入與音樂匯流排一起改接到 `target` */
  function route(target: AudioNode): void {
    fade.disconnect()
    musicInput.disconnect()
    fade.connect(target)
    musicInput.connect(target)
  }
  let limGain = 1
  let limPeak = 0
  /**
   * 限幅器。**接上之前先直通** —— `addModule` 是非同步的，而且可能失敗。
   *
   * 【兩種失敗都要旁路】載入失敗不插節點；載好之後 `process()` 拋例外會觸發
   * `processorerror`，那個節點從此永遠輸出靜音，而它在最後一道 —— 症狀是
   * 整場突然全部沒聲音。
   */
  let limiter: AudioWorkletNode | null = null
  void ctx.audioWorklet?.addModule(assetUrl('/audio/limiter.js')).then(() => {
    const node = new AudioWorkletNode(ctx, 'limiter')
    node.port.onmessage = (e: MessageEvent) => {
      const d = e.data as { gain?: number; peak?: number }
      if (typeof d.gain === 'number') limGain = d.gain
      if (typeof d.peak === 'number') limPeak = d.peak
    }
    node.onprocessorerror = () => {
      limiter = null
      node.disconnect()
      route(ctx.destination)
    }
    route(node)
    node.connect(ctx.destination)
    limiter = node
  }).catch(() => { limiter = null })

  /** 清掉預看緩衝裡乘過舊淡入增益的樣本。 */
  function resetLimiter(): void {
    limiter?.port.postMessage('reset')
  }

  const fadeCurve = fadeInCurve(FADE_POINTS)
  function fadeIn(seconds: number): void {
    const g = fade.gain
    const now = ctx.currentTime
    // 曲線不可重疊；排程失敗時全開，避免整場無聲。
    g.cancelScheduledValues(now)
    try {
      g.setValueCurveAtTime(fadeCurve, now, seconds)
    } catch {
      g.value = 1
    }
  }

  function bypassLimiter(): void {
    if (limiter === null) return
    limiter.disconnect()
    route(ctx.destination)
    limiter = null
  }

  function readMeter(out: Pick<MeterSample, 'peakDb' | 'reductionDb'>): void {
    out.peakDb = toDb(limPeak * limGain)
    out.reductionDb = limiter === null ? 0 : toDb(limGain)
  }

  return {
    fadeIn, resetLimiter, bypassLimiter, readMeter, musicInput,
    get limiterEnabled() { return limiter !== null },
  }
}
