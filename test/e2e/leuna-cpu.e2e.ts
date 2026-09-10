/**
 * **洛伊納那 16 ms CPU 地板的歸因**。用 CDP 的取樣分析器收一段 JS profile，
 * 按自身時間彙總到函式，再讀 `renderer.info` 的 draw call 與三角形數。
 *
 * ```
 * npx vite --port 5200 --strictPort        # 終端機一
 * npx vite-node test/e2e/leuna-cpu.e2e.ts  # 終端機二
 * ```
 *
 * 【為什麼要取樣分析器而不是自己插樁】插樁只量得到自己插的那幾點，而問題
 * 正是「不知道時間花在哪」。取樣分析器連 three 內部與 GC 都算得到。
 *
 * 【自身時間，不是總時間】總時間會讓最外層的 rAF 回呼吃下 100%，讀不出東西。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5200/'

const NO_THROTTLE = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]
const NO_VSYNC = ['--disable-gpu-vsync', '--disable-frame-rate-limit']

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

interface Node {
  readonly id: number
  readonly callFrame: {
    readonly functionName: string
    readonly url: string
    readonly lineNumber: number
  }
  readonly children?: number[]
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false, args: [...NO_THROTTLE, ...NO_VSYNC] })
  try {
    const page = await browser.newPage({
      viewport: { width: 1707, height: 960 },
      deviceScaleFactor: 1.5,
    })
    await page.goto(URL)
    await page.click('[data-act="start"]')
    await enterLeuna(page)
    await page.keyboard.press('KeyI')
    await page.waitForTimeout(10000)

    // 【場景普查先做】分析器一開，什麼都變慢，數出來的量還是一樣但省事
    const census = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('div'))
        .find((d) => (d.textContent ?? '').startsWith('FPS'))
      const lines = (el?.textContent ?? '').split('\n')
      const grab = (prefix: string): string => {
        const l = lines.find((x) => x.startsWith(prefix))
        return l === undefined ? '?' : l.slice(prefix.length).trim()
      }
      return {
        fps: grab('FPS'),
        frame: grab('frame'),
        physics: grab('physics'),
        calls: grab('draw call'),
        triangles: grab('triangles'),
      }
    })
    console.log('==== 場景規模 ====')
    console.log(`  FPS ${census.fps}　frame ${census.frame}　physics ${census.physics}`)
    console.log(`  draw call ${census.calls}　三角形 ${census.triangles}`)

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 })   // 微秒
    await cdp.send('Profiler.start')
    await page.waitForTimeout(15000)
    const { profile } = await cdp.send('Profiler.stop') as unknown as {
      profile: {
        nodes: Node[]
        startTime: number
        endTime: number
        samples: number[]
        timeDeltas: number[]
      }
    }

    // 自身時間：每一個取樣點把 timeDelta 記在它落到的那個節點上
    const selfUs = new Map<number, number>()
    for (let i = 0; i < profile.samples.length; i++) {
      const id = profile.samples[i]!
      selfUs.set(id, (selfUs.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0))
    }
    const byId = new Map<number, Node>()
    for (const n of profile.nodes) byId.set(n.id, n)

    // 同名同檔的節點合併 —— 呼叫樹裡同一個函式會出現在很多分支
    const merged = new Map<string, number>()
    for (const [id, us] of selfUs) {
      const n = byId.get(id)
      if (n === undefined) continue
      const f = n.callFrame
      const file = f.url === '' ? '' : f.url.replace(/^.*\//, '').replace(/\?.*$/, '')
      const name = f.functionName === '' ? '(匿名)' : f.functionName
      const key = file === '' ? name : `${name}  ${file}:${f.lineNumber + 1}`
      merged.set(key, (merged.get(key) ?? 0) + us)
    }

    const total = [...merged.values()].reduce((a, b) => a + b, 0)
    const wall = (profile.endTime - profile.startTime)
    const rows = [...merged.entries()].sort((a, b) => b[1] - a[1])
    console.log(`\n==== JS 自身時間（15 s，取樣 200 us）====`)
    console.log(`  取樣總計 ${(total / 1000).toFixed(0)} ms / 牆鐘 ${(wall / 1000).toFixed(0)} ms`
      + `　＝ 主執行緒忙 ${((total / wall) * 100).toFixed(0)}%`)
    console.log(`  （(idle) 與 (program) 也在表裡：前者是等 vsync／沒事做，`
      + `後者是 V8 之外 —— 主要是 GPU 驅動的 GL 呼叫）\n`)
    for (const [k, us] of rows.slice(0, 30)) {
      const share = (us / total) * 100
      if (share < 0.4) break
      console.log(`  ${(us / 1000).toFixed(1).padStart(7)} ms  ${share.toFixed(1).padStart(5)}%  ${k}`)
    }
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => { console.error(e); throw e })
