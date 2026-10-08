/**
 * 小地圖上的主要目標 —— 頭上標距離的船與地面目標畫成小圓點。人工驗收，截圖目視。
 * **不由 vitest 執行**（副檔名 `.e2e.ts`）。
 *
 * ```
 * npm run dev -- --port 5178 --strictPort            # 終端機一
 * npx vite-node test/e2e/minimap-objectives.e2e.ts   # 終端機二
 * ```
 *
 * 倫內爾島（日 M3）截一張全畫面、一張放大的小地圖：八艘船都是主要目標，警戒前是黃色；
 * 開場艦隊在 4 km 外，圓點貼在小地圖上緣、半透明。
 *
 * 位置、顏色、貼邊的規則由單元測試釘死（`hud-arena.test.ts`）；這一支看的是畫面。
 *
 * 【不得使用 process / fs】專案沒有 `@types/node`。截圖交給 playwright 自己寫檔。
 */
import { chromium, type Page } from 'playwright'

const URL = 'http://localhost:5178/'
const SHOTS = '.shots/minimap-objectives/'

/** 物理時間；還沒進戰鬥（或場景正在換、玩家還沒建好）時回 −1 */
async function battleTime(page: Page): Promise<number> {
  return page.evaluate(() => {
    const f = (window as unknown as Record<string, unknown>)['__probe']
    try {
      const p = typeof f === 'function' ? (f as () => { t: number } | null)() : null
      return p === null ? -1 : p.t
    } catch {
      return -1
    }
  })
}

async function enter(page: Page, campaign: string, mission: string): Promise<void> {
  await page.goto(URL)
  await page.click('[data-act="start"]')
  await page.click('[data-act="mission"]')
  await page.click(`[data-campaign="${campaign}"]`)
  await page.click(`[data-mission="${mission}"]`)
  await page.click('#brief-go')
  // 【教學卡會暫停戰鬥】載入完才出現；按掉、等物理時間開始走
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(500)
    if (await page.isVisible('#tutorial')) {
      // 【從 DOM 點】無頭只有幾 FPS，卡片的進場動畫讓 playwright 一直判定按鈕「不穩定」
      await page.evaluate(() => {
        (document.querySelector('#tutorial [data-act="tutorialOk"]') as HTMLElement | null)?.click()
      })
    }
    if (await battleTime(page) > 1) return
  }
  await page.screenshot({ path: `${SHOTS}${mission}-stuck.png` })
  throw new Error(`${mission} 的戰鬥沒有開始跑`)
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    const errors: string[] = []
    // 【每一關開一個新分頁】同一頁從戰鬥裡回主選單，按鈕一直不穩、點不到
    for (const [campaign, mission] of [['japan', 'japan-m3']] as const) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
      page.on('pageerror', (e) => errors.push(String(e)))
      await enter(page, campaign, mission)
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${SHOTS}${mission}.png` })
      // 小地圖在左下：邊長是短邊的 0.19，左緣 30 px、下緣留 42 px（`minimap.ts`）
      const size = 720 * 0.19
      await page.screenshot({
        path: `${SHOTS}${mission}-map.png`,
        clip: { x: 10, y: 720 - size - 62, width: size + 40, height: size + 62 },
      })
      console.log(`  ${mission} → ${mission}.png、${mission}-map.png`)
      await page.close()
    }

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
