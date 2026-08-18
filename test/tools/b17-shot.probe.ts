/**
 * B-17G 的實體算圖 —— 六個方向。**不由 vitest 執行**。
 *
 * skill 第 6 步：形狀對了不等於算圖對了。疊圖與切片抓的是輪廓，抓不到
 * 「從機首看穿到機尾」「支架從背面是透明的」「凹槽變成一張黑貼紙」這一類
 * 缺陷 —— 它們在剪影上完全不存在。He 111 的十五條缺陷裡有九條是這樣抓到的。
 *
 * 跑法：`npx vite-node test/tools/b17-shot.probe.ts`
 */
import { chromium } from 'playwright'
import type {} from './hangar-hooks'

const URL = 'http://localhost:5178/hangar.html'
const SHOTS = '.shots/'

/** 六個方向。相機位置 + 看向點固定在機身中段 */
const VIEWS: readonly [string, number, number, number][] = [
  ['side', 36, 2, 3],
  ['top', 0, 34, 3],
  ['front', 0, 3, -34],
  ['under', 0, -22, 16],
  ['fwd-low', 16, -6, -26],
  ['aft-low', -16, -6, 26],
]

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    page.on('pageerror', (e) => console.log('  [pageerror] ' + String(e)))
    await page.goto(URL)
    await page.waitForFunction(() => '__hangarSpec' in window, null, { timeout: 30000 })
    await page.evaluate(() => window.__hangarSpec('b17g'))
    await page.evaluate(() => window.__hangarShow(true, false))
    // 機腹在暗的那一檔幾乎全黑，截圖交出去看不出東西
    await page.evaluate(() => window.__hangarLit(true))
    await page.waitForTimeout(800)
    for (const [name, x, y, z] of VIEWS) {
      await page.evaluate(
        ([a, b, c]) => window.__hangarCam(a!, b!, c!, 0, 0, 3), [x, y, z] as const)
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${SHOTS}b17-${name}.png` })
      console.log('  ' + name)
    }
    console.log(await page.evaluate(() => document.getElementById('info')?.textContent ?? ''))
  } finally {
    await browser.close()
  }
}

await main()
