/**
 * 倫內爾島警戒的人工驗收 —— 開場的巡邏、飛高之後進入警戒的訊息。
 * **不由 vitest 執行**（副檔名 `.e2e.ts`）。
 *
 * ```
 * npm run dev -- --port 5178 --strictPort        # 終端機一
 * npx vite-node test/e2e/rennell-alert.e2e.ts    # 終端機二
 * ```
 *
 * ── 要看的三件事 ──────────────────────────────────────
 *
 * ```
 *   1  開場        陸攻貼海（< 500 m），艦隊沒有開火
 *   2  拉高之後    越過 500 m 的那一刻畫面中心出現「進入警戒狀態」
 *   3  全程        主控台沒有錯誤
 * ```
 *
 * 警戒的規則由單元測試釘死（`battle-alert*.test.ts`）；這一支驗的是接線與畫面。
 *
 * 【不得使用 process / fs】專案沒有 `@types/node`。截圖交給 playwright 自己寫檔。
 */
import { chromium, type Page } from 'playwright'

const URL = 'http://localhost:5178/'
const SHOTS = '.shots/rennell-alert/'

interface Probe { t: number; y: number }

async function probe(page: Page): Promise<Probe | null> {
  return page.evaluate(() => {
    const f = (window as unknown as Record<string, unknown>)['__probe']
    return typeof f === 'function' ? (f as () => Probe | null)() : null
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
    await page.click('[data-campaign="japan"]')
    await page.click('[data-mission="japan-m3"]')
    await page.click('#brief-go')
    // 【教學卡會暫停戰鬥】第一次進場跳出的投雷說明，載入完才出現；按掉、等物理時間開始走
    let start: Probe | null = null
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(500)
      if (await page.isVisible('#tutorial')) await page.click('[data-act="tutorialOk"]')
      start = await probe(page)
      if (start !== null && start.t > 0.5) break
    }
    if (start === null || start.t <= 0.5) throw new Error('戰鬥沒有開始跑')
    console.log(`  ① 開場高度 ${start.y.toFixed(0)} m`)
    if (start.y >= 500) throw new Error(`開場就在 500 m 以上：${start.y.toFixed(0)} m`)
    await page.screenshot({ path: `${SHOTS}1-start.png` })
    console.log('    → 1-start.png（畫面中心不該有警戒訊息）')

    // 【拉高】瞄準是位移累加的（`bindings.ts` 讀 `movementY`）：往上移一段就是持續抬頭。全程不點畫面
    // 【訊息畫在 HUD 的 canvas 上】讀不回來，越過 500 m 之後截圖目視
    await page.mouse.move(640, 560)
    await page.mouse.move(640, 160)
    let p: Probe | null = start
    // 【無頭的物理時間走得很慢】牆鐘一秒只推進約 0.1 秒，給足時間
    for (let s = 0; s < 800; s++) {
      await page.waitForTimeout(500)
      p = await probe(page)
      if (p !== null && p.y > 520) break
      if (s % 6 === 5 && p !== null) console.log(`    t ${p.t.toFixed(1)} s　高度 ${p.y.toFixed(0)} m`)
    }
    if (p === null || p.y <= 520) throw new Error(`沒拉過 500 m：${p?.y.toFixed(0)} m`)
    // 掃描是 10 Hz，訊息顯示 4 秒
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${SHOTS}2-alerted.png` })
    console.log(`  ② 拉到 ${p.y.toFixed(0)} m → 2-alerted.png（畫面中心要有「進入警戒狀態」）`)

    if (errors.length > 0) {
      console.log(`\n  ✗ 主控台有 ${errors.length} 則錯誤：`)
      for (const e of errors.slice(0, 8)) console.log(`     ${e}`)
      throw new Error('執行路徑有錯誤')
    }
    console.log('\n  主控台乾淨。截圖在 .shots/rennell-alert/。')
  } finally {
    await browser.close()
  }
}

void main()
