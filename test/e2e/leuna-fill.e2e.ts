/**
 * **洛伊納：填充率 vs CPU 的判定**。同一個場景只改後備緩衝的像素數，
 * 幀時間跟著掉 = GPU 填充率吃緊；幾乎不動 = CPU 吃緊。
 *
 * 同時讀 `core/perf.ts` 的 F3 疊層 —— 它量的是 **rAF 回呼裡的 CPU 工作**
 * （不含等 vsync、不含 GPU 實際繪製）。把它跟牆鐘幀時間相減，差額就是
 * 「CPU 已經做完、還在等 GPU」的那一段。
 *
 * ```
 * npx vite --port 5200 --strictPort         # 終端機一
 * npx vite-node test/e2e/leuna-fill.e2e.ts  # 終端機二
 * ```
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5200/'

const NO_THROTTLE = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]
const NO_VSYNC = ['--disable-gpu-vsync', '--disable-frame-rate-limit']

interface Wall {
  readonly p50: number
  readonly mean: number
  readonly longTasks: number
  readonly hitchesPerSecond: number
}

async function record(page: import('playwright').Page, seconds: number): Promise<Wall> {
  return page.evaluate((s: number) => new Promise<Wall>((resolve) => {
    const stamps: number[] = []
    let longTasks = 0
    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((l) => { longTasks += l.getEntries().length })
      observer.observe({ entryTypes: ['longtask'] })
    } catch { observer = null }
    const startedAt = performance.now()
    const tick = (time: number): void => {
      stamps.push(time)
      if (performance.now() - startedAt < s * 1000) { requestAnimationFrame(tick); return }
      observer?.disconnect()
      const frames: number[] = []
      for (let i = 2; i < stamps.length; i++) frames.push(stamps[i]! - stamps[i - 1]!)
      frames.sort((a, b) => a - b)
      const p50 = frames[Math.round(0.5 * (frames.length - 1))]!
      resolve({
        p50,
        mean: frames.reduce((a, b) => a + b, 0) / frames.length,
        longTasks,
        hitchesPerSecond: frames.filter((f) => f > p50 * 2).length / s,
      })
    }
    requestAnimationFrame(tick)
  }), seconds)
}

/**
 * 讀 F3 疊層的六行文字。**它預設是開的**（`createPerfOverlay` 的 `visible`
 * 初值為 true），所以不必按鍵。
 */
async function overlay(page: import('playwright').Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {}
    for (const el of Array.from(document.querySelectorAll('div'))) {
      const t = el.textContent ?? ''
      if (!t.startsWith('FPS')) continue
      for (const line of t.split('\n')) {
        const m = /^(\S+(?: \S+)?)\s\s+(.+)$/.exec(line.trim())
        if (m !== null) out[m[1]!] = m[2]!
      }
      break
    }
    return out
  })
}

async function enterLeuna(page: import('playwright').Page): Promise<void> {
  await page.click('[data-act="mission"]')
  const step = async (sel: string): Promise<void> => {
    await page.waitForSelector(sel, { state: 'visible' })
    await page.waitForTimeout(400)
    await page.click(sel)
  }
  await step('#campaign-cards button[data-campaign="allies"]')
  await step('#route .stop[data-mission="allies-m2"]')
  await step('#brief-go')
}

async function pass(dpr: number): Promise<void> {
  const browser = await chromium.launch({ headless: false, args: [...NO_THROTTLE, ...NO_VSYNC] })
  try {
    const page = await browser.newPage({
      viewport: { width: 1707, height: 960 },
      deviceScaleFactor: dpr,
    })
    await page.goto(URL)
    await page.click('[data-act="start"]')
    await enterLeuna(page)
    await page.keyboard.press('KeyI')
    await page.waitForTimeout(10000)          // 暖機
    const w = await record(page, 18)
    const o = await overlay(page)
    const buf = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('canvas:not(#hud)')
      return c === null ? '?' : `${c.width}x${c.height}`
    })
    const px = (() => {
      const m = /^(\d+)x(\d+)$/.exec(buf)
      return m === null ? Number.NaN : (Number(m[1]) * Number(m[2])) / 1e6
    })()
    console.log(`\n-- DPR ${dpr.toFixed(1)}　後備 ${buf}（${px.toFixed(2)} MPix）--`)
    console.log(`  牆鐘 p50   ${w.p50.toFixed(2)} ms   ${(1000 / w.p50).toFixed(1)} FPS`)
    console.log(`  牆鐘平均   ${w.mean.toFixed(2)} ms`)
    console.log(`  CPU 幀     ${o['frame'] ?? '?'}   (疊層量的 rAF 回呼工作)`)
    console.log(`  物理       ${o['physics'] ?? '?'}   每步 ${o['per step'] ?? '?'}`)
    console.log(`  draw call  ${o['draw call'] ?? '?'}`)
    console.log(`  三角形     ${o['triangles'] ?? '?'}`)
    console.log(`  長工作     ${w.longTasks} 次 > 50 ms / 18 s　頓挫 ${w.hitchesPerSecond.toFixed(2)}/s`)
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  console.log('==== 洛伊納填充率消融（解鎖 vsync，視窗恆為 1707x960）====')
  for (const dpr of [1.5, 1.0, 0.5]) await pass(dpr)
}

main().catch((e: unknown) => { console.error(e); throw e })
