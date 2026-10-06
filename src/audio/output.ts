import { assetUrl } from '../core/asset'
import { fadeInCurve } from './curves'
import { toDb, type MeterSample } from './meter'

/** 淡入曲線的點數；曲線點之間由 Web Audio 線性內插。 */
const FADE_POINTS = 32

/** 世界音訊的最後一段；管理淡入、限幅與輸出讀數，不管理聲道。 */
export function createAudioOutput(ctx: BaseAudioContext, input: GainNode) {
  const fade = ctx.createGain()
  input.disconnect()
  input.connect(fade)
  fade.connect(ctx.destination)
  let limGain = 1
  let limPeak = 0
  // 載入中或載入失敗時維持直通；processorerror 後也必須恢復直通。
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
      fade.disconnect()
      node.disconnect()
      fade.connect(ctx.destination)
    }
    fade.disconnect()
    fade.connect(node)
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
    fade.disconnect()
    limiter.disconnect()
    fade.connect(ctx.destination)
    limiter = null
  }

  function readMeter(out: Pick<MeterSample, 'peakDb' | 'reductionDb'>): void {
    out.peakDb = toDb(limPeak * limGain)
    out.reductionDb = limiter === null ? 0 : toDb(limGain)
  }

  return {
    fadeIn, resetLimiter, bypassLimiter, readMeter,
    get limiterEnabled() { return limiter !== null },
  }
}
