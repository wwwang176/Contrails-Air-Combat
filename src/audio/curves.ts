const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)

/** 引擎的播放速度。油門 0 時 0.85、全油門 1.10，戰爭緊急功率（1.1）再高一點 */
export function engineRate(throttle: number): number {
  return 0.85 + 0.25 * clamp(throttle, 0, 1.1)
}

/**
 * 風切：空速 ÷ 極速 → 低通截止頻率（指數，250 Hz → 7 kHz）與音量（−24 → 0 dB）。
 * 寫進 out —— 每幀呼叫，不配置。
 */
export function windParams(vneRatio: number, out: { cutoffHz: number; gainDb: number }): void {
  const s = clamp(vneRatio, 0, 1)
  out.cutoffHz = 250 * Math.pow(28, s)
  out.gainDb = -24 + 24 * s
}

/** 機身晃動的強度 0–1：超速（0–1）與受損取大者。HP 一半以上不算受損 */
export function shakeStrength(overspeed: number, hpFraction: number): number {
  const damage = clamp((0.5 - hpFraction) / 0.5, 0, 1)
  return Math.max(clamp(overspeed, 0, 1), damage)
}

/** 下一陣晃動在幾秒後。越強越密；±25% 隨機，免得聽出固定節拍 */
export function shakeInterval(k: number, rand: () => number): number {
  return (1.6 - 1.2 * clamp(k, 0, 1)) * (0.75 + 0.5 * rand())
}

export function shakeGainDb(k: number): number {
  return -12 + 10 * clamp(k, 0, 1)
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

export const SPEED_OF_SOUND = 343

/** 聲音從 distance 公尺外傳過來要幾秒 —— 遠處的爆炸先看到火光才聽到 */
export function soundDelay(distance: number): number {
  return Math.max(0, distance) / SPEED_OF_SOUND
}

/** 空氣先吸收高頻：距離越遠、低通截止越低（100 m 約 14.7 kHz，8 km 約 540 Hz） */
export function distanceCutoffHz(distance: number): number {
  return 22000 / (1 + Math.max(0, distance) / 200)
}

/** 打中敵機的回饋在這個距離內不衰減，m */
const HIT_REF = 200

/**
 * 打中敵機：依打的那架有多遠，給一點衰減與變悶。**相對值，疊在類別的音量之上。**
 *
 * 【為什麼不照真實距離衰減】它是「打中了」的回饋，與畫面上的 X 標記同一件事。
 * 照實衰減的話，800 m 外的命中幾乎聽不到，回饋就沒了。取真實衰減的一半：
 * 遠的目標小聲而悶，近的清脆，但兩者都聽得見。
 */
export function hitFeedback(distance: number, out: { gainDb: number; cutoffHz: number }): void {
  const d = Math.max(0, distance)
  const full = 20 * Math.log10(HIT_REF / (HIT_REF + Math.max(0, d - HIT_REF)))
  out.gainDb = 0.5 * full
  out.cutoffHz = distanceCutoffHz(d * 0.5)
}
