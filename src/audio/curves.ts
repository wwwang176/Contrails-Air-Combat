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

/** 【晃動是背景】它在超速、重傷期間一直在響，蓋過引擎與開火就太吵 */
export function shakeGainDb(k: number): number {
  return -24 + 12 * clamp(k, 0, 1)
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

/**
 * 機身受創的輕重 → 音量。`severity` 0 = 擦到一點、1 = 重擊。
 *
 * 【為什麼要分輕重】高射砲的爆風從邊緣到正中央差很多倍，一律同一個音量的話，
 * 玩家分不出「被掃到一下」與「正中一發」。
 */
export function damageGainDb(severity: number): number {
  return -10 + 16 * clamp(severity, 0, 1)
}

export const SPEED_OF_SOUND = 343

/**
 * 從發聲到現在過了 `sinceEmit` 秒，音波傳到 `distance` 公尺外的耳朵了沒 ——
 * 遠處的爆炸先看到火光才聽到。
 *
 * 【每一幀用當下的距離重問】音波是從發聲點往外擴的球面，迎上去就早一點穿過它 ——
 * 延遲從 `d / c` 變成 `d / (c + 接近速度)`。起播時算好一個固定的延遲再排進
 * `start()` 的話，玩家朝爆炸點俯衝也要等滿原本的秒數：3 km 外以 168 m/s
 * （P-51D 的海平面極速）衝過去是 5.9 s 而不是 8.7 s，差了將近三秒。
 */
export function soundArrived(sinceEmit: number, distance: number): boolean {
  return SPEED_OF_SOUND * sinceEmit >= Math.max(0, distance)
}

/**
 * 空氣吸收：**高頻先消失**，低通的截止頻率隨距離下降。
 * 100 m 約 3.9 kHz、1 km 約 1.9 kHz、3 km 約 1.1 kHz、8 km 約 690 Hz。
 *
 * 【為什麼是 1/√距離】真實的吸收量（dB）與距離成正比、與頻率平方成正比
 * （ISO 9613-1），所以「掉 3 dB 的那個頻率」隨距離以 1/√距離 下降。
 * 這條曲線配上兩級二階低通與 `absorptionDb`，在 250 Hz–8 kHz、0.2–8 km
 * 之間與標準值的平均誤差約 4 dB。
 */
export function distanceCutoffHz(distance: number): number {
  return 8000 / Math.sqrt(1 + Math.max(0, distance) / 60)
}

/**
 * 這個聲音到耳朵大概多響，dB。**搶聲道用**。
 *
 * 【為什麼不是只看距離】一波投彈同時有幾十顆炸彈的呼嘯與爆炸，只比距離的話，
 * 遠處一聲不重要的呼嘯會卡住近處的爆炸。這裡把類別的音量、距離衰減
 * （three 的 inverse 模型）與空氣吸收一起算進來。
 */
export function voiceLoudnessDb(gainDb: number, ref: number, distance: number): number {
  const d = Math.max(0, distance)
  const spread = ref > 0 ? 20 * Math.log10(ref / (ref + Math.max(0, d - ref))) : 0
  return gainDb + spread + absorptionDb(d)
}

/** 空氣吸收在中頻的那一份：整體再小這麼多 dB（20 °C、70% 濕度下 500 Hz 的值） */
const ABSORPTION_DB_PER_KM = 2.8

export function absorptionDb(distance: number): number {
  return -ABSORPTION_DB_PER_KM * Math.max(0, distance) / 1000
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
