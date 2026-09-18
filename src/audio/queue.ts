/**
 * 物理子步寫、每一幀讀的音效事件。
 *
 * 【子步裡不碰 Web Audio】240 Hz 的子步只在這裡寫四個數字（種類、x、y、z），
 * 每一幀再交給音訊層。滿了丟新的 —— 覆蓋舊的會讓先發生的聲音消失。
 */
export const CUE = {
  Explosion: 0,
  Splash: 1,
  /** 炸彈落水那一下的悶響：爆炸庫壓低 12 dB，墊在水花底下 */
  SplashBoom: 2,
  FlakBurst: 3,
  HitSelf: 4,
  Damage: 5,
} as const
export type Cue = typeof CUE[keyof typeof CUE]

export interface CueQueue {
  readonly data: Float32Array
  count: number
}

export function createCueQueue(capacity: number): CueQueue {
  return { data: new Float32Array(capacity * 4), count: 0 }
}

export function pushCue(q: CueQueue, cue: Cue, x: number, y: number, z: number): void {
  if (q.count * 4 >= q.data.length) return
  const o = q.count * 4
  q.data[o] = cue
  q.data[o + 1] = x
  q.data[o + 2] = y
  q.data[o + 3] = z
  q.count++
}

export function clearCues(q: CueQueue): void {
  q.count = 0
}
