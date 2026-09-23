/**
 * # 音訊錶的資料
 *
 * 畫面上那一塊「現在壓了幾 dB」的疊圖，資料從這裡來。**這一份全是純函數與
 * 一個環狀緩衝**，畫圖在 `hud/audioMeter.ts`。
 *
 * 【為什麼需要它】限幅與 HDR 都是聽感的東西，而「聽起來怪」指不出是哪一層。
 * 有錶就看得到：輸出有沒有頂到天花板、限幅器壓了多少、窗口在哪裡。
 */

/** 錶上的一格 */
export interface MeterSample {
  /** 這一格的輸出峰值，dBFS */
  peakDb: number
  /** 限幅器壓了幾 dB（0 或負數） */
  reductionDb: number
  /** HDR 的當下最響值，dB */
  loudestDb: number
  /** 同時發聲的一次性聲道數 */
  voices: number
  /**
   * 累計幾次把**還在響的**聲音直接切掉（搶聲道、循環音換檔）。
   * 波形從中間斷掉就是一聲「啪」，而峰值不會因此變高 —— 輸出錶看不到。
   */
  cuts: number
  /**
   * 音訊時鐘落後牆上時鐘累計幾毫秒。**持續往上長就是音訊執行緒算不完** ——
   * 少算的那幾毫秒瀏覽器塞靜音補上，聽起來是劈啪聲，峰值卻完全不變。
   * 幾毫秒內上下跳是正常的（音訊時鐘以一整塊緩衝為單位前進）。
   */
  lagMs: number
}

/**
 * 音訊時鐘相對牆上時鐘落後了多少，秒。兩個時鐘都從 `anchor` 那一刻起算。
 * 負值（音訊時鐘剛好跳了一塊）夾成 0。
 */
export function audioLag(wallNow: number, ctxNow: number, wallAnchor: number, ctxAnchor: number): number {
  const lag = (wallNow - wallAnchor) - (ctxNow - ctxAnchor)
  return lag > 0 ? lag : 0
}

/** 錶上保留幾格。60 格約 6 秒（每 100 ms 一格） */
export const METER_SLOTS = 60
/** 幾秒取一格 */
export const METER_STEP = 0.1
/** 錶的下緣，dBFS。比這個小的都畫在底 */
export const METER_FLOOR_DB = -60

/** 線性增益 → dBFS，0 以下夾在 `METER_FLOOR_DB` */
export function toDb(gain: number): number {
  if (!(gain > 0)) return METER_FLOOR_DB
  return Math.max(METER_FLOOR_DB, 20 * Math.log10(gain))
}

/** dB → 0（底）…1（頂）的比例，給畫圖用 */
export function meterFraction(db: number, top = 0): number {
  const v = (db - METER_FLOOR_DB) / (top - METER_FLOOR_DB)
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * 環狀緩衝：一直往前推，讀的時候從最舊的開始。**不配置** —— 每幀都會讀。
 */
export class MeterHistory {
  readonly peak = new Float32Array(METER_SLOTS)
  readonly reduction = new Float32Array(METER_SLOTS)
  private cursor = 0
  private filled = 0

  constructor() {
    this.peak.fill(METER_FLOOR_DB)
  }

  push(peakDb: number, reductionDb: number): void {
    this.peak[this.cursor] = peakDb
    this.reduction[this.cursor] = reductionDb
    this.cursor = (this.cursor + 1) % METER_SLOTS
    if (this.filled < METER_SLOTS) this.filled++
  }

  /** 第 `i` 格（0 = 最舊）在陣列裡的位置。`i` 超過已填的格數時回 −1 */
  indexOf(i: number): number {
    if (i < 0 || i >= this.filled) return -1
    const start = (this.cursor - this.filled + METER_SLOTS) % METER_SLOTS
    return (start + i) % METER_SLOTS
  }

  get count(): number {
    return this.filled
  }

  clear(): void {
    this.peak.fill(METER_FLOOR_DB)
    this.reduction.fill(0)
    this.cursor = 0
    this.filled = 0
  }
}
