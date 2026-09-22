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

/**
 * 下一陣晃動在幾秒後。越強越密；±25% 隨機，免得聽出固定節拍。
 *
 * 【只有超速會晃】血量過半之後的持續抖動拿掉了 —— 受創那一下已經有
 * `damageGainDb` 的結構悶響，之後一直抖只是噪音。
 */
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
 * 淡入的增益曲線，`n` 個點、0 → 1，給 `setValueCurveAtTime` 用。
 *
 * 【平方而不是線性】線性的增益走到一半已經是 −6 dB，聽起來是一開頭就衝上來；
 * 平方一半時是 −12 dB，大聲的部分留到後段。
 */
export function fadeInCurve(n: number): Float32Array {
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) c[i] = (i / (n - 1)) ** 2
  return c
}

/**
 * 機身受創的輕重 → 音量。`severity` 0 = 擦到一點、1 = 重擊。
 *
 * 【為什麼要分輕重】高射砲的爆風從邊緣到正中央差很多倍，一律同一個音量的話，
 * 玩家分不出「被掃到一下」與「正中一發」。
 */
export function damageGainDb(severity: number): number {
  return -7.7 + 16 * clamp(severity, 0, 1)
}

/**
 * 爆炸的當量 → 音量，dB。`scale` 是殺傷半徑的倍率（`weapons/bomb.ts` 的
 * `blastScaleOf`），當量正比於它的立方。
 *
 * 【為什麼是 20·log10(scale)】固定距離下爆震的壓力正比於當量的立方根，
 * 也就是正比於 scale。遊戲裡零戰的 60 kg 彈是 0.11、魚雷是 1.67，
 * 照實算差 23 dB —— 夾住免得小彈整個聽不見。
 */
export function blastGainDb(scale: number): number {
  return clamp(20 * Math.log10(Math.max(1e-3, scale)), -12, 6)
}

/**
 * 爆炸的當量 → 播放速度。**大的低沉而拖得長，小的是一聲脆響。**
 *
 * 【為什麼不照實】爆震的持續時間也正比於當量的立方根，照實算 60 kg 彈要快
 * 2.2 倍（高一個八度多），聽起來像鞭炮。取 0.35 次方再夾在 0.8–1.4。
 */
export function blastRate(scale: number): number {
  return clamp(Math.pow(Math.max(1e-3, scale), -0.35), 0.8, 1.4)
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

/** 只讀座標的最小介面 —— 這一支不相依 three */
interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * 多普勒係數：沿著連線互相接近就升調，遠離就降調。乘在播放速度上。
 *
 * 【為什麼要自己算】Web Audio 早就把 Doppler 從 `PannerNode` 拿掉了 ——
 * `setVelocity`、`dopplerFactor`、`speedOfSound` 在現在的瀏覽器與 three 裡都不存在。
 *
 * 【夾制只是防線，不是調味】範圍寬到二戰螺旋槳機飛得出來的情況全部落在
 * 裡面，所以聽到的就是物理值。
 */
/**
 * 夾制。**不縮放、不誇張 —— 夾制之內就是物理值。**
 *
 * ```
 *   兩架 150 m/s 正面對進          2.58
 *   單機 150 m/s 接近              1.78
 *   單機 150 m/s 遠離              0.69
 *   交會後兩架往反方向飛開         0.39
 * ```
 *
 * 【聽者那一項不會讓分母趨近零】它加在分子上。分母只由音源的接近分量決定，
 * 所以要衝到好幾倍得有一架**自己**以近音速衝過來 —— 螺旋槳機做不到。
 *
 * 【夾制接的是什麼】鏡頭瞬移、換場、分母變號（音源超過音速）算出來的怪值。
 */
const DOPPLER_MIN = 0.35
const DOPPLER_MAX = 2.7

export function dopplerRate(sp: Vec3, sv: Vec3, lp: Vec3, lv: Vec3): number {
  let dx = lp.x - sp.x, dy = lp.y - sp.y, dz = lp.z - sp.z
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (d < 1e-3) return 1
  dx /= d; dy /= d; dz /= d
  // 沿著連線、朝對方的速度分量。正的是接近
  const toward = sv.x * dx + sv.y * dy + sv.z * dz
  const back = -(lv.x * dx + lv.y * dy + lv.z * dz)
  return clamp((SPEED_OF_SOUND + back) / (SPEED_OF_SOUND - toward), DOPPLER_MIN, DOPPLER_MAX)
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
export function voiceLoudnessDb(
  gainDb: number, ref: number, distance: number, rolloff = 1,
): number {
  const d = Math.max(0, distance)
  const spread = ref > 0 ? 20 * Math.log10(ref / (ref + rolloff * Math.max(0, d - ref))) : 0
  return gainDb + spread + absorptionDb(d)
}

/** 空氣吸收在中頻的那一份：整體再小這麼多 dB（20 °C、70% 濕度下 500 Hz 的值） */
const ABSORPTION_DB_PER_KM = 2.8

export function absorptionDb(distance: number): number {
  return -ABSORPTION_DB_PER_KM * Math.max(0, distance) / 1000
}

/** 被打中的基準：單發戰鬥機的量級，kg。這個質量、護甲 1.0 時倍率是 1 */
const HIT_REF_MASS = 4500
const HIT_MASS_EXP = 0.18
const HIT_ARMOUR_EXP = 0.4
const HIT_RATE_MIN = 0.7
const HIT_RATE_MAX = 1.2

/**
 * 被打中的播放速度倍率：**越大台、護甲越厚的部位越低沉**。
 * 慢下來的同時音高降低、尾音拉長，那就是「打在厚鐵皮上」的感覺。
 *
 * 【為什麼要分】不分的話 B-17 與零戰被打中一模一樣。遊戲裡質量差 8 倍
 * （2,733 kg 到 22,000 kg），護甲差兩倍（0.65 到 1.30）。
 *
 * 【夾在 0.7–1.2】也就是 −6.2 到 +3.2 個半音。照質量比例硬算的話大飛機會
 * 整台變成低音，聽不出是子彈。B-17 大約低 5 個半音、零戰高 1.5 個。
 */
export function hitRate(massKg: number, protection: number): number {
  const m = Math.max(1, massKg)
  const p = Math.max(0.05, protection)
  return clamp(
    Math.pow(HIT_REF_MASS / m, HIT_MASS_EXP) / Math.pow(p, HIT_ARMOUR_EXP),
    HIT_RATE_MIN, HIT_RATE_MAX,
  )
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
