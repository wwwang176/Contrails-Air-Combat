/**
 * **島嶼外觀與海岸浪花的截圖**。凍結姿態，所以改動前後的像素可比。
 *
 * ```
 * node node_modules/vite/bin/vite.js --port 5178                            # 終端機一
 * node node_modules/vite-node/vite-node.mjs test/e2e/island-shot.e2e.ts     # 終端機二
 * ```
 *
 * 【與 ocean-shot 同一套理由】`__still` 把鏡頭姿態、世界時間、海浪相位釘死；
 * 一定要有頭（無頭 chromium 走 SwiftShader 軟體算圖）；飛機與粒子關掉。
 *
 * 【鏡頭只能擺在原點】`__still` 把相機放在 (0, altitude, 0)，所以取景靠偏航。
 * 兩座錨島寫死在 (±2500, ∓950)，離原點 2,674 m —— 底下的偏航角是解出來的，
 * 不是試出來的：yaw = atan2(−dx, −dz) 換成度。
 *
 * 【輸出目錄用參數帶】改動前後各跑一次，落在不同的資料夾才比得了。
 * `node ... island-shot.e2e.ts before`
 */
import { chromium, type Page } from 'playwright'

const URL = 'http://localhost:5178/'
const ROOT = 'C:/Users/weiwe/AppData/Local/Temp/claude/C--projects-grok-aircraft2/'
  + 'a396768a-75a8-4daf-b583-9ba32d4ff88e/scratchpad'
const TAG = process.argv[2] ?? 'now'

/** 鏡頭姿態。偏航、俯仰（度）、高度（m） */
const VIEWS = [
  { name: 'anchor-a', yaw: -69, pitch: -14, alt: 1400, desc: '錨島 A，2.7 km 外俯視' },
  { name: 'anchor-b', yaw: 111, pitch: -14, alt: 1400, desc: '錨島 B，另一側的相位' },
  { name: 'shore', yaw: -69, pitch: -6, alt: 300, desc: '貼海看錨島 A 的海岸線 —— 浪花' },
  { name: 'small', yaw: 40, pitch: -20, alt: 2500, desc: '小島群 —— 7～13 格的那一批' },
  { name: 'wide', yaw: 0, pitch: -38, alt: 9000, desc: '高空俯瞰整片群島' },
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
    await page.click('#terrain-pick button >> nth=0')   // 群島（預設，明著點一次）
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
      await page.screenshot({ path: `${ROOT}/${TAG}-${v.name}.png` })
      console.log(`  ${v.name.padEnd(10)} ${v.desc}`)
    }

    console.log(`\n  console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('    ' + e)
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => { console.error(e); throw e })
