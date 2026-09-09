/**
 * **手擺丘陵 vs 實測高程的並排比較**，走展示區（`daylight.html`）。
 *
 * ```
 * node node_modules/vite/bin/vite.js --port 5190                             # 終端機一
 * node node_modules/vite-node/vite-node.mjs test/e2e/leuna-relief.e2e.ts     # 終端機二
 * ```
 *
 * 【兩張圖的鏡頭一樣】展示區的 `placeCamera` 對兩種洛伊納給同一個機位，所以
 * 兩張截圖逐像素可比 —— 差的只有地形。
 *
 * 【一定要有頭】無頭 chromium 走 SwiftShader 軟體算圖，不是玩家機器上的編譯器。
 */
import { chromium, type Page } from 'playwright'

const URL = 'http://localhost:5190/daylight.html'
const ROOT = 'C:/Users/weiwe/AppData/Local/Temp/claude/'
  + 'C--Users-weiwe-orca-workspaces-grok-aircraft2-lenua-build/'
  + '151d84f5-5f66-4442-a023-415b01783c86/scratchpad'

/** 分頁的 id 是 `k-` 加地形名（`daylight.ts` 的 `selectTerrain`） */
const SHOTS: readonly { kind: string; name: string }[] = [
  { kind: 'leuna', name: '手擺丘陵（遊戲現況）' },
  { kind: 'leuna-real', name: '實測高程 EU-DEM' },
]

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false })
  try {
    const page: Page = await browser.newPage({
      viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1,
    })
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(URL)
    // 【等 GLB 與 DEM 載完】兩者都是頂層 await，分頁在那之後才生出來
    await page.waitForSelector('#k-leuna-real', { state: 'visible', timeout: 60_000 })

    for (const s of SHOTS) {
      await page.click('#k-' + s.kind)
      await page.waitForTimeout(3000)
      await page.screenshot({ path: `${ROOT}/relief-${s.kind}.png` })
      console.log(`  ${s.kind.padEnd(11)} ${s.name}`)
    }

    console.log(`\n  console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('    ' + e)
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => { console.error(e); throw e })
