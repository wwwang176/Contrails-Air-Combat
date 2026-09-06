/**
 * 集合點可視化的人工驗收。**不由 vitest 執行**（`.e2e.ts`）。
 *
 * 跑法（兩個終端機）：
 *
 * ```
 * npm run dev                                       # 終端機一，開在 5173
 * npx vite-node test/e2e/order-markers.e2e.ts       # 終端機二
 * ```
 *
 * 【為什麼要有它】`main.ts` 那一段接線沒有單元測試（模組本身有，見
 * `test/unit/order-markers.test.ts`），而接線正是會壞的地方：分隊索引配錯
 * 隊伍、`order.point` 拿到 `focus` 的原點、長機挑到屍體。這支只做**冒煙**：
 * 按下去不會炸、球會真的出現在畫面上。
 *
 * ── 這裡哪些是斷言、哪些是給人看的 ──
 *
 * **是斷言**：整段流程（進場 → `I` → `O` → `G` → `O`）跑完 console 沒有
 * 任何錯誤。這一條就守得住「接線寫爆了」—— three 的幾何／材質出錯、
 * 陣列寫出界、`order.point` 是 undefined，全都會在 console 出現。
 *
 * **給人看的**：四張截圖。球會不會出現**不斷言**，因為集合令要等某個分隊
 * 能量見底才發，高度依賴開局；寫成斷言只會變成一條隨機紅燈 —— 這正是
 * 這個現象在無頭裡重現不出來，所以才要做這個
 * 可視化。要看球，請自己 `npm run dev`、按 `I` 讓 AI 打、再按 `O`。
 *
 * 【為什麼等不到】集合令要某個分隊的能量累積見底才發，20v20 下第一張大約
 * 落在一到三分鐘的模擬時間，而且哪個分隊先見底完全看開局。冒煙腳本不該
 * 卡在那裡等一件不保證發生的事。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5173/'
const SHOTS = 'test-results/order-markers/'
/** 進場之後先跑多久再按 O */
const WARMUP_MS = 4000

async function main(): Promise<void> {
  const browser = await chromium.launch()
  const errors: string[] = []
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(URL)
    await page.click('[data-act="start"]')
    await page.click('[data-act="skirmish"]')
    await page.click('#skirmish [data-act="fight"]')
    await page.waitForTimeout(WARMUP_MS)

    // 自機交給 AI —— 與實際觀測時的操作一致（開場按 I）
    await page.keyboard.press('KeyI')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: SHOTS + '1-before.png' })

    await page.keyboard.press('KeyO')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: SHOTS + '2-markers-on.png' })

    await page.keyboard.press('KeyG')
    await page.waitForTimeout(1500)
    await page.screenshot({ path: SHOTS + '3-god-view.png' })

    await page.keyboard.press('KeyO')
    await page.waitForTimeout(800)
    await page.screenshot({ path: SHOTS + '4-markers-off.png' })

    if (errors.length > 0) {
      console.log('console 錯誤：')
      for (const e of errors) console.log('  ' + e)
      throw new Error(`console 有 ${errors.length} 個錯誤`)
    }
    console.log('冒煙通過：O 鍵在飛行視角與上帝視角都不炸，console 0 錯誤。')
    console.log(`截圖在 ${SHOTS}`)
  } finally {
    await browser.close()
  }
}

await main()
