/**
 * **低多邊形海面的外觀截圖**。凍結姿態，所以兩次執行的像素可比。
 *
 * ```
 * node node_modules/vite/bin/vite.js --port 5178                          # 終端機一
 * node node_modules/vite-node/vite-node.mjs test/e2e/ocean-shot.e2e.ts    # 終端機二
 * ```
 *
 * 【為什麼用 `__still` 而不是實際飛】飛機在哪、浪走到哪、參照物撒在哪，每一次
 * 都不同 —— 那個差異足以蓋過要看的東西。`__still` 把鏡頭姿態、世界時間、海浪
 * 相位全部釘死。
 *
 * 【一定要有頭】無頭 chromium 走 SwiftShader 軟體算圖。這一輪要看的是實際
 * 顯示卡上的樣子。
 *
 * 【飛機與粒子關掉】它們每一場都不一樣，而這一輪要看的只有海。
 */
import { chromium, type Page } from 'playwright'

const URL = 'http://localhost:5178/'
const OUT = 'C:/Users/weiwe/AppData/Local/Temp/claude/C--projects-grok-aircraft2/'
  + 'a396768a-75a8-4daf-b583-9ba32d4ff88e/scratchpad'

/** 鏡頭姿態。偏航、俯仰（度）、高度（m） */
const VIEWS = [
  { name: 'sea-deck', yaw: 0, pitch: -3, alt: 200, desc: '貼海 200 m，微俯' },
  { name: 'sea-cruise', yaw: 25, pitch: -12, alt: 4000, desc: '座艙 4,000 m，俯 12°' },
  { name: 'sea-high', yaw: 0, pitch: -55, alt: 12000, desc: '高空 12,000 m，俯 55°' },
  { name: 'sea-sun', yaw: 200, pitch: -6, alt: 600, desc: '朝太陽側 600 m —— 看白點' },
] as const

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
    await page.click('[data-act="start"]')
    await page.click('[data-act="skirmish"]')
    await page.click('#terrain-pick button:text-is("純海面")')
    await page.click('#altitude-pick button:text-is("中空")')
    await page.click('#skirmish [data-act="fight"]')
    await page.waitForTimeout(9000)   // 著色器編譯、材質上傳

    await page.evaluate(() =>
      (window as unknown as Record<string, (p: Record<string, boolean>) => unknown>)['__gfx']!(
        { aircraft: false, particles: false, tracers: false, propDisc: false, vortex: false }))

    for (const v of VIEWS) {
      await page.evaluate((q: readonly number[]) =>
        (window as unknown as Record<string, (...r: number[]) => unknown>)['__still']!(...q),
      [v.yaw, v.pitch, v.alt, 12])
      await page.waitForTimeout(900)
      await page.screenshot({ path: `${OUT}/${v.name}.png` })
      console.log(`  ${v.name.padEnd(12)} ${v.desc}`)
    }

    console.log(`\n  console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('    ' + e)
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => { console.error(e); throw e })
