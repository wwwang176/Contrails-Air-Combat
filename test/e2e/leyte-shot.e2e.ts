/**
 * **日 M2 雷伊泰前線的驗收**：進得了戰鬥、車隊真的在沿公路走、畫面上看得到
 * 海岸線與公路、沒有 console 錯誤（公路是注入地面材質的 GLSL，編譯失敗只會
 * 出現在 console）。**不由 vitest 執行。**
 *
 * ```
 * npx vite --port 5178 --strictPort                                   # 終端機一
 * node node_modules/vite-node/vite-node.mjs test/e2e/leyte-shot.e2e.ts # 終端機二
 * ```
 *
 * 【一定要有頭】無頭 chromium 走 SwiftShader 軟體算圖，不是玩家機器上的編譯器，
 * 而且模擬只有牆鐘四成速度 —— 車隊走的距離會對不上等待的秒數。
 *
 * 截圖寫到 `.shots/`，是給人看的；斷言只有車有沒有動與 console 錯誤。
 */
import { chromium, type Page } from 'playwright'

const URL = 'http://localhost:5178/'
const SHOTS = '.shots/'

interface GroundRow {
  id: string
  alive: boolean
  arrived: boolean
  speed: number
  x: number
  y: number
  z: number
}

function fail(msg: string): never {
  throw new Error(msg)
}

async function ground(page: Page): Promise<GroundRow[]> {
  return page.evaluate(() =>
    (window as unknown as Record<string, () => GroundRow[]>)['__ground']!())
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false })
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
    const errors: string[] = []
    // 【favicon 不算】dev server 沒有這個檔，每一頁都會 404 一次
    page.on('console', (m) => {
      const at = m.location().url
      if (m.type() === 'error' && !at.endsWith('/favicon.ico')) errors.push(`${m.text()} @ ${at}`)
    })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(URL)
    await page.click('[data-act="start"]')
    await page.click('[data-act="mission"]')
    await page.waitForTimeout(200)
    await page.click('#campaign-cards button[data-campaign="japan"]')
    await page.waitForTimeout(200)
    await page.click('#route .stop[data-mission="japan-m2"]')
    await page.waitForTimeout(200)
    await page.screenshot({ path: SHOTS + 'leyte-0-brief.png' })
    await page.click('#brief-go')
    await page.waitForTimeout(1500)
    // 【教學卡會暫停模擬】新的瀏覽器設定檔沒有看過任何一張，一張一張按掉
    for (let i = 0; i < 6 && await page.isVisible('#tutorial'); i++) {
      await page.click('[data-act="tutorialOk"]')
      await page.waitForTimeout(300)
    }
    await page.waitForTimeout(3000)
    await page.screenshot({ path: SHOTS + 'leyte-1-open.png' })

    const clock = (): Promise<number> => page.evaluate(() =>
      ((window as unknown as Record<string, () => { t: number } | null>)['__probe']!()?.t ?? -1))
    const t0 = await clock()
    const g0 = await ground(page)
    const trucks0 = g0.filter((g) => g.id === 'truck')
    console.log(`[雷伊泰] 地面目標 ${g0.length} 台，卡車 ${trucks0.length} 輛`)
    if (trucks0.length !== 9) fail(`卡車應該有 9 輛，實得 ${trucks0.length}`)

    await page.waitForTimeout(15000)
    const g1 = await ground(page)
    const t1 = await clock()
    console.log(`[雷伊泰] 模擬時鐘 ${t0} → ${t1} 秒`)
    let moved = 0
    let still = 0
    for (let i = 0; i < g0.length; i++) {
      const d = Math.hypot(g1[i]!.x - g0[i]!.x, g1[i]!.z - g0[i]!.z)
      if (d > 20) moved++
      else still++
    }
    console.log(`[雷伊泰] 15 秒後：${moved} 台移動、${still} 台停著（第二、三批還沒出發）`)
    for (const r of g1.slice(0, 5)) {
      console.log(`  ${r.id.padEnd(9)} (${r.x}, ${r.y}, ${r.z}) speed=${r.speed}`)
    }
    if (moved < 5) fail(`第一批 5 輛應該已經出發，只有 ${moved} 台在動`)
    if (still < 10) fail(`第二、三批應該還停在灘頭，只有 ${still} 台停著`)

    // ── 定格取景：灘頭與車隊、公路的轉角、整片海岸 ──────────
    const lead = g1[0]!
    await page.evaluate(([x, z]) => {
      (window as unknown as Record<string, (...a: number[]) => unknown>)['__still']!(0, -40, 500, 20, x, z)
    }, [lead.x, lead.z + 700])
    await page.waitForTimeout(800)
    await page.screenshot({ path: SHOTS + 'leyte-2-convoy.png' })

    // 正上方往下看第一批：車要壓在路面上、車頭沿著路
    await page.evaluate(([x, z]) => {
      (window as unknown as Record<string, (...a: number[]) => unknown>)['__still']!(0, -89.9, 160, 20, x, z)
    }, [(g1[0]!.x + g1[4]!.x) / 2, (g1[0]!.z + g1[4]!.z) / 2])
    await page.waitForTimeout(800)
    await page.screenshot({ path: SHOTS + 'leyte-2b-topdown.png' })

    await page.evaluate(() => {
      (window as unknown as Record<string, (...a: number[]) => unknown>)['__still']!(0, -45, 2500, 20, 1500, 1500)
    })
    await page.waitForTimeout(800)
    await page.screenshot({ path: SHOTS + 'leyte-3-road.png' })

    await page.evaluate(() => {
      (window as unknown as Record<string, (...a: number[]) => unknown>)['__still']!(0, -35, 6000, 20, 0, 6000)
    })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: SHOTS + 'leyte-4-coast.png' })

    if (errors.length > 0) fail(`console 錯誤：\n${errors.join('\n')}`)
    console.log('[雷伊泰] 通過')
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
