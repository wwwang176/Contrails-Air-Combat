const SAMPLE_WINDOW = 60

/** 背景分頁恢復時的長間隔不計入 FPS；CPU 取樣仍獨立保留。 */
const MAX_INTERVAL_MS = 1000

function average(values: Float64Array, count: number): number {
  if (count === 0) return 0
  let sum = 0
  for (let i = 0; i < count; i++) sum += values[i]!
  return sum / count
}

/** 固定容量的幀間隔與 CPU 統計；不讀時鐘、不操作 DOM，每幀不配置。 */
export function createPerfSamples() {
  const intervals = new Float64Array(SAMPLE_WINDOW)
  const frameTimes = new Float64Array(SAMPLE_WINDOW)
  const physicsTimes = new Float64Array(SAMPLE_WINDOW)
  let intervalCount = 0
  let intervalAt = 0
  let sampleCount = 0
  let sampleAt = 0
  let lastNow = -1

  function recordInterval(now: number): boolean {
    const interval = lastNow < 0 ? 0 : now - lastNow
    lastNow = now
    if (interval <= 0 || interval > MAX_INTERVAL_MS) return false
    intervals[intervalAt] = interval
    intervalAt = (intervalAt + 1) % SAMPLE_WINDOW
    if (intervalCount < SAMPLE_WINDOW) intervalCount++
    return true
  }

  function recordFrame(frameMs: number, physicsMs: number): void {
    frameTimes[sampleAt] = frameMs
    physicsTimes[sampleAt] = physicsMs
    sampleAt = (sampleAt + 1) % SAMPLE_WINDOW
    if (sampleCount < SAMPLE_WINDOW) sampleCount++
  }

  function intervalMs(): number { return average(intervals, intervalCount) }
  function frameMs(): number { return average(frameTimes, sampleCount) }
  function physicsMs(): number { return average(physicsTimes, sampleCount) }
  function fps(): number {
    const ms = intervalMs()
    return ms > 0 ? 1000 / ms : 0
  }

  return { recordInterval, recordFrame, intervalMs, frameMs, physicsMs, fps }
}
