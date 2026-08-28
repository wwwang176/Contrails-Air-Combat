/**
 * **同一個機器狀態下把改動前後背對背量一次。**
 *
 * ```
 * node node_modules/vite/bin/vite.js --port 5178                        # 終端機一
 * node node_modules/vite-node/vite-node.mjs test/e2e/ocean-ab.e2e.ts    # 終端機二
 * ```
 *
 * 【為什麼需要它】`ocean-cost.e2e.ts` 量的是「海面佔這一輪的幾成」，那個比例
 * 在同一輪之內是可信的（交錯配對）。但**兩輪之間的絕對值不可比** —— 實測改動
 * 後那一輪的基準線比改動前高了 6 ms，而那一輪是接在 400 秒全套測試之後跑的。
 * 機器熱不熱、背景在做什麼，都會整片抬高。
 *
 * 這一支不切分支、不重開瀏覽器，只在**同一個頁面**裡把兩種海輪流量：
 * 低多邊形的海就是現況，而「改動前的海」用 `__gfx` 關掉整個海面來代表其成本
 * 上界 —— 不完美，但它是唯一能在同一狀態下取得的對照。
 *
 * 真正要回答的是「總幀時間有沒有變差」，所以**基準線本身**才是主角：
 * 三輪、每輪頭尾各量一次，看散布。
 */
import { chromium, type Page } from 'playwright'

const URL = 'http://localhost:5178/'
const NO_THROTTLE = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]
const NO_VSYNC = ['--disable-gpu-vsync', '--disable-frame-rate-limit']

interface S { readonly p50: number; readonly worst1: number }

async function record(page: Page, seconds: number): Promise<S> {
  return page.evaluate((sec: number) => new Promise<S>((resolve) => {
    const stamps: number[] = []
    const t0 = performance.now()
    const tick = (t: number): void => {
      stamps.push(t)
      if (performance.now() - t0 < sec * 1000) { requestAnimationFrame(tick); return }
      const f: number[] = []
      for (let i = 2; i < stamps.length; i++) f.push(stamps[i]! - stamps[i - 1]!)
      f.sort((a, b) => a - b)
      const n = f.length
      const k = Math.max(1, Math.floor(n * 0.01))
      let s = 0
      for (let i = n - k; i < n; i++) s += f[i]!
      resolve({ p50: f[Math.min(n - 1, Math.round(0.5 * (n - 1)))]!, worst1: s / k })
    }
    requestAnimationFrame(tick)
  }), seconds)
}

const gfx = async (page: Page, patch: Record<string, boolean>): Promise<void> => {
  await page.evaluate((p) =>
    (window as unknown as Record<string, (q: Record<string, boolean>) => unknown>)['__gfx']!(p), patch)
  await page.waitForTimeout(400)
}

/** 疊層的 draw call 與三角形 —— 幾何量級的旁證 */
async function scale(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('div'))
      .find((d) => d.textContent?.startsWith('FPS'))
    const t = el?.textContent ?? ''
    return `${/draw call (\d+)/.exec(t)?.[1] ?? '?'} draw / `
      + `${Number(/triangles (\d+)/.exec(t)?.[1] ?? 0).toLocaleString('en-US')} 三角形`
  })
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false, args: [...NO_THROTTLE, ...NO_VSYNC] })
  try {
    const page = await browser.newPage({
      viewport: { width: 1707, height: 960 }, deviceScaleFactor: 1.5,
    })
    await page.goto(URL)
    await page.click('[data-act="start"]')
    await page.click('[data-act="skirmish"]')
    await page.click('#terrain-pick button:text-is("純海面")')
    await page.click('#altitude-pick button:text-is("中空")')
    await page.click('#skirmish [data-act="fight"]')
    await page.keyboard.press('KeyI')
    await page.waitForTimeout(4000)
    // 【用上帝視角，不是座艙】代飛的鏡頭一直在動，而海面佔畫面多少正是要量的
    // 自變數 —— 實測 6 秒窗的散布是 12~23 ms，蓋過要量的東西。上帝視角爬到高空
    // 之後鏡頭不動（前一輪量到基準線漂移 0.0%），而且整片遠海鋪滿畫面。
    await page.keyboard.press('KeyG')
    await page.waitForTimeout(1000)
    await page.keyboard.down('ShiftLeft')
    await page.keyboard.down('KeyE')
    await page.waitForTimeout(6000)
    await page.keyboard.up('KeyE')
    await page.keyboard.up('ShiftLeft')
    await page.waitForTimeout(2000)

    // 【不能凍結畫面】暫停時主迴圈只呼叫 render()，而 render() 只是把命令丟進
    // 佇列就回來 —— JS 於是一路跑在 GPU 前面，量到的是空轉：實測凍結時「有海」
    // 8.0 ms、「無海」7.8 ms，而同一個場景活著跑差三成。**在回呼裡加
    // gl.finish() 也沒有用**，那一輪也試過了。
    //
    // 所以留著代飛。鏡頭會動、戰況會演進，那個漂移由下面的交錯配對抵銷。
    console.log(`  場景規模  ${await scale(page)}`)

    // 【交錯配對】有海 → 無海 → 有海 →…，每一筆「無海」配它前後兩條「有海」
    // 的平均。漂移是連續的，配對之後就抵銷掉。
    const on: number[] = []
    const off: number[] = []
    const cost: number[] = []
    on.push((await record(page, 6)).p50)
    for (let r = 0; r < 4; r++) {
      await gfx(page, { nearSea: false, farSea: false })
      off.push((await record(page, 6)).p50)
      await gfx(page, { nearSea: true, farSea: true })
      on.push((await record(page, 6)).p50)
      cost.push((on[r]! + on[r + 1]!) / 2 - off[r]!)
    }

    const mid = (a: number[]): number => a.slice().sort((x, y) => x - y)[(a.length / 2) | 0]!
    const f = (a: number[]): string => a.map((v) => v.toFixed(1)).join(' / ')
    console.log(`  有海      中位 ${mid(on).toFixed(2)} ms   五次 ${f(on)}`)
    console.log(`  無海      中位 ${mid(off).toFixed(2)} ms   四次 ${f(off)}`)
    console.log(`  配對差    中位 ${mid(cost).toFixed(2)} ms   四次 ${f(cost)}`)
    console.log(`  海面佔比  ${((mid(cost) / mid(on)) * 100).toFixed(1)}%`)
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => { console.error(e); throw e })
