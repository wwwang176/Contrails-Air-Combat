/**
 * 單一防墜 Worker 的 20 對 20 正式遊戲量測。dev server 預設在 5173：
 * `$env:URL='http://127.0.0.1:5187/'; npx vite-node test/e2e/recovery-worker-perf.e2e.ts`
 */
import { chromium, type Page } from 'playwright'

const env = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> }
}).process?.env ?? {}
const URL = env['URL'] ?? 'http://127.0.0.1:5173/'
const WARMUP_SECONDS = 10
const SAMPLE_SECONDS = 25

interface FrameSample {
  count: number
  mean: number
  p50: number
  p99: number
  worst1: number
  max: number
  longTasks: number
}

interface WorkerStats {
  enabled: boolean
  available: boolean
  dispatched: number
  completed: number
  failures: number
  queued: number
  inFlight: number
  computeTotalMs: number
  computeMaxMs: number
  roundTripTotalMs: number
  roundTripMaxMs: number
  takeovers: number
  staleResults: number
  substepHz: number
  requestHz: number
}

async function record(page: Page, seconds: number): Promise<FrameSample> {
  return page.evaluate((duration) => new Promise<FrameSample>((resolve) => {
    const stamps: number[] = []
    let longTasks = 0
    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => { longTasks += list.getEntries().length })
      observer.observe({ entryTypes: ['longtask'] })
    } catch { observer = null }
    const start = performance.now()
    const tick = (time: number): void => {
      stamps.push(time)
      if (performance.now() - start < duration * 1000) {
        requestAnimationFrame(tick)
        return
      }
      observer?.disconnect()
      const frames: number[] = []
      for (let i = 2; i < stamps.length; i++) frames.push(stamps[i]! - stamps[i - 1]!)
      frames.sort((a, b) => a - b)
      const n = frames.length
      const at = (q: number) => frames[Math.min(n - 1, Math.round(q * (n - 1)))]!
      const tail = Math.max(1, Math.floor(n * 0.01))
      let tailSum = 0
      for (let i = n - tail; i < n; i++) tailSum += frames[i]!
      resolve({
        count: n,
        mean: frames.reduce((sum, value) => sum + value, 0) / n,
        p50: at(0.5),
        p99: at(0.99),
        worst1: tailSum / tail,
        max: frames[n - 1]!,
        longTasks,
      })
    }
    requestAnimationFrame(tick)
  }), seconds)
}

async function run(page: Page): Promise<{
  frames: FrameSample, stats: WorkerStats, seats: number, errors: string[],
}> {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (text.startsWith('Failed to load resource:')) return
    errors.push(text)
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(URL)
  await page.waitForFunction(() => '__recoveryWorker' in window)
  await page.click('[data-act="start"]')
  await page.click('[data-act="skirmish"]')
  // DEFAULT_SKIRMISH 已是每側 20 架；甲板高度讓預演在量測窗內有實際工作。
  await page.click('#sk-alt button:first-child')
  await page.click('#skirmish [data-act="fight"]')
  await page.keyboard.press('KeyI')
  await page.waitForTimeout(WARMUP_SECONDS * 1000)
  const seats = await page.evaluate(() =>
    (window as unknown as { __seats(): unknown[] }).__seats().length)
  const frames = await record(page, SAMPLE_SECONDS)
  const stats = await page.evaluate(() => {
    const value = (window as unknown as { __recoveryWorker: { stats: WorkerStats } })
      .__recoveryWorker.stats
    return { ...value }
  })
  return { frames, stats, seats, errors }
}

function print(label: string, result: Awaited<ReturnType<typeof run>>): void {
  const fps = (ms: number) => (1000 / ms).toFixed(1)
  const s = result.stats
  const compute = s.completed > 0 ? s.computeTotalMs / s.completed : 0
  const roundTrip = s.completed > 0 ? s.roundTripTotalMs / s.completed : 0
  console.log(`\n${label}：${result.seats} 架，${result.frames.count} 幀`)
  console.log(`  平均 ${fps(result.frames.mean)} FPS；1% low ${fps(result.frames.worst1)} FPS`)
  console.log(`  p50 ${result.frames.p50.toFixed(2)} ms；p99 ${result.frames.p99.toFixed(2)} ms；最大 ${result.frames.max.toFixed(2)} ms`)
  console.log(`  long task ${result.frames.longTasks}；console error ${result.errors.length}`)
  console.log(`  Worker ${s.completed}/${s.dispatched} 完成，失敗 ${s.failures}，接管 ${s.takeovers}，過期 ${s.staleResults}`)
  console.log(`  計算平均 ${compute.toFixed(2)} ms／最大 ${s.computeMaxMs.toFixed(2)} ms`)
  console.log(`  往返平均 ${roundTrip.toFixed(2)} ms／最大 ${s.roundTripMaxMs.toFixed(2)} ms；結尾排隊 ${s.queued}+${s.inFlight}`)
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  })
  try {
    const context = async (): Promise<Page> => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
      await page.addInitScript(() => {
        let seed = 0x6d2b79f5
        Math.random = (): number => {
          seed = (seed + 0x6d2b79f5) | 0
          let t = seed
          t = Math.imul(t ^ (t >>> 15), t | 1)
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
      })
      return page
    }
    const workerPage = await context()
    const withWorker = await run(workerPage)
    await workerPage.close()
    print('Worker 開啟', withWorker)
    if (withWorker.seats !== 40) throw new Error('量測不是 20 對 20')
    if (!withWorker.stats.available || withWorker.stats.completed === 0) {
      throw new Error('防墜 Worker 沒有完成任何預演')
    }
    if (withWorker.stats.failures > 0 || withWorker.errors.length > 0) {
      throw new Error('防墜 Worker 或頁面出現錯誤')
    }
  } finally {
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  throw error
})
