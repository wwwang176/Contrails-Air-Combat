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

/**
 * 分頁的 id 是 `k-` 加地形名（`daylight.ts` 的 `selectTerrain`）。
 * `cam` 給了就用 `__cam` 定格，沒給就用分頁自己的預設機位。
 */
const SHOTS: readonly {
  kind: string; name: string; tag?: string; cam?: readonly number[]
}[] = [
  { kind: 'leuna', name: '手擺丘陵（遊戲現況）' },
  { kind: 'leuna-real', name: '實測高程 EU-DEM' },
  // 廠區東邊 2.9 km 的薩勒河谷。低空、逆光，起伏與水面才看得出來
  {
    kind: 'leuna', tag: 'river-hand', name: '河谷位置（手擺 —— 那裡是平的）',
    cam: [2900, 900, -3600, 2900, 40, -7000],
  },
  {
    kind: 'leuna-real', tag: 'river-real', name: '薩勒河谷（實測＋挖槽＋水面）',
    cam: [2900, 900, -3600, 2900, 40, -7000],
  },
  // 【不要用正上方】OrbitControls 的極點是奇異的，鏡頭會翻掉，拍到的不是
  // 你以為的方向。35° 斜俯是安全的
  {
    kind: 'leuna-real', tag: 'river-top', name: '薩勒河斜俯 35°',
    cam: [2860, 1100, -5500, 2860, 36, -7100],
  },
  {
    kind: 'leuna-real', tag: 'river-low', name: '薩勒河 400 m 斜看',
    cam: [3600, 400, -6200, 2860, 36, -7300],
  },
  {
    kind: 'leuna-real', tag: 'west-hills', name: '西側蓋澤爾谷的坑',
    cam: [-4000, 1400, -2000, -8000, 60, -7000],
  },
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
      await page.waitForTimeout(2500)
      if (s.cam !== undefined) {
        await page.evaluate((c: readonly number[]) =>
          (window as unknown as Record<string, (...a: number[]) => void>)['__cam']!(...c), s.cam)
        await page.waitForTimeout(1200)
      }
      const tag = s.tag ?? s.kind
      await page.screenshot({ path: `${ROOT}/relief-${tag}.png` })
      console.log(`  ${tag.padEnd(12)} ${s.name}`)
    }

    console.log(`\n  console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('    ' + e)
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => { console.error(e); throw e })
