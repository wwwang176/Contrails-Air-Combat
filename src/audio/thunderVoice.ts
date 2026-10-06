/**
 * 每一聲雷的隨機範圍，均勻抽。**全部是起始值，由試玩裁定。**
 *
 * ```
 *   播放速度  0.7～1.05   慢一點更低沉、更長，同一支素材聽起來像不同的雷
 *   低通      600～4000 Hz 悶雷到脆的霹靂；遠的另外被引擎依距離再壓
 *   音量      −6～+2 dB
 * ```
 */
export const THUNDER_RATE = [0.7, 1.05] as const
export const THUNDER_CUTOFF_HZ = [600, 4000] as const
export const THUNDER_DB = [-6, 2] as const

export interface ThunderVoice {
  rate: number
  cutoffHz: number
  extraDb: number
}

/** 模組層的暫存。閃電幾秒才一道，但每道都重用這一份 */
const VOICE: ThunderVoice = { rate: 1, cutoffHz: 4000, extraDb: 0 }

/** 抽一聲雷的播放速度、低通與音量。**回傳的是共用的暫存**，呼叫端當下用掉 */
export function rollThunder(rand: () => number): ThunderVoice {
  VOICE.rate = THUNDER_RATE[0] + rand() * (THUNDER_RATE[1] - THUNDER_RATE[0])
  VOICE.cutoffHz = THUNDER_CUTOFF_HZ[0] + rand() * (THUNDER_CUTOFF_HZ[1] - THUNDER_CUTOFF_HZ[0])
  VOICE.extraDb = THUNDER_DB[0] + rand() * (THUNDER_DB[1] - THUNDER_DB[0])
  return VOICE
}
