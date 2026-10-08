/**
 * 前機槍過熱的人工驗收 —— 按住射擊，十字準星依序變黃、變紅閃爍。截圖目視。
 * **不由 vitest 執行**（副檔名 `.e2e.ts`）。
 *
 * ```
 * npm run dev -- --port 5178 --strictPort       # 終端機一
 * npx vite-node test/e2e/gun-overheat.e2e.ts    # 終端機二
 * ```
 *
 * 規則（秒數、門檻、遲滯、閃爍）由單元測試釘死（`gun-heat*.test.ts`、`hud-reticle.test.ts`）；
 * 這一支看的是畫面上的十字。截圖的時機看物理時間（`__probe().t`）—— 無頭的物理時間每牆鐘秒只走約 0.1 s。
 *
 * 【不得使用 process / fs】專案沒有 `@types/node`。截圖交給 playwright 自己寫檔。
 */
import { chromium, type Page } from 'playwright'

const URL = 'http://localhost:5178/'
const SHOTS = '.shots/gun-overheat/'

interface Probe { t: number; firing: boolean }

async function probe(page: Page): Promise<Probe | null> {
  return page.evaluate(() => {
    const f = (window as unknown as Record<string, unknown>)['__probe']
    try {
      return typeof f === 'function' ? (f as () => Probe | null)() : null
    } catch {
      return null
    }
  })
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(URL)
    await page.click('[data-act="start"]')
    await page.click('[data-act="mission"]')
    await page.click('[data-campaign="allies"]')
    await page.click('[data-mission="allies-m3"]')
    await page.click('#brief-go')
    // 【教學卡會暫停戰鬥】從 DOM 點：無頭只有幾 FPS，卡片的進場動畫讓 playwright 判定按鈕不穩定
    let p: Probe | null = null
    for (let i = 0; i < 80; i++) {
      await page.waitForTimeout(500)
      await page.evaluate(() => {
        (document.querySelector('#tutorial [data-act="tutorialOk"]') as HTMLElement | null)?.click()
      })
      p = await probe(page)
      if (p !== null && p.t > 1) break
    }
    if (p === null || p.t <= 1) throw new Error('戰鬥沒有開始跑')

    // 【扳機要鎖住指標】點一下畫面取得指標鎖定，再按住左鍵
    await page.mouse.click(640, 360)
    await page.waitForTimeout(300)
    await page.mouse.down()
    const t0 = (await probe(page))!.t
    const shots: [number, string][] = [[0.5, '1-cool'], [2.2, '2-warn'], [3.2, '3-hot-a'], [3.32, '4-hot-b']]
    for (const [dt, name] of shots) {
      for (let i = 0; i < 600; i++) {
        p = await probe(page)
        if (p !== null && p.t - t0 >= dt) break
        await page.waitForTimeout(100)
      }
      await page.screenshot({ path: `${SHOTS}${name}.png`, clip: { x: 440, y: 160, width: 400, height: 400 } })
      console.log(`  t+${(p!.t - t0).toFixed(2)} s　扳機 ${p!.firing} → ${name}.png`)
    }
    await page.mouse.up()

    if (errors.length > 0) {
      console.log(`\n  ✗ 主控台有 ${errors.length} 則錯誤：`)
      for (const e of errors.slice(0, 8)) console.log(`     ${e}`)
      throw new Error('執行路徑有錯誤')
    }
    console.log(`\n  主控台乾淨。截圖在 ${SHOTS}`)
  } finally {
    await browser.close()
  }
}

void main()
