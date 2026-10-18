/**
 * **地面光照（`matteGround.ts`）在真的 GPU 上量。**
 *
 * ```
 * node node_modules/vite/bin/vite.js --port 5190                         # 終端機一
 * node node_modules/vite-node/vite-node.mjs test/e2e/ground-matte.e2e.ts # 終端機二
 * ```
 *
 * 一片水平的地面、正午的燈，由迎光、背光兩個方向低角度看：
 *
 * - σ = 0、鏡面 1 時與沒改過的標準材質相同（掛上去不會動到別的東西）
 * - Oren-Nayar：鏡面關掉單看漫射，背光比迎光亮（Lambert 兩者相同）
 * - 鏡面乘倍率：倍率 0 比倍率 1 暗（迎光時鏡面最亮）
 *
 * 【變異驗證】拿掉 Oren-Nayar 那一段，或鏡面不乘倍率，必紅。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5190/'
/** 正午太陽在 (−0.4, 0.8, 0.45)：眼睛在方位 139° 是迎著太陽看、−41° 是背著 */
const INTO = 139
const AWAY = -41
const PITCH = -12
const ROUGH = 0.2

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false })
  let allPass = true
  const ok = (name: string, pass: boolean, detail: string): void => {
    console.log(`  ${pass ? '通過' : '失敗'}  ${name.padEnd(30)} ${detail}`)
    if (!pass) allPass = false
  }
  try {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL)
    await page.addScriptTag({ type: 'module', url: '/test/e2e/fixtures/ground-probe.ts' })
    await page.waitForFunction(() => '__groundShot' in window)
    const shot = (az: number, matte: boolean, rough: number, spec: number): Promise<number> =>
      page.evaluate((q: readonly [number, number, boolean, number, number]) =>
        (window as unknown as Record<string, (...a: unknown[]) => number>)['__groundShot']!(...q),
      [az, PITCH, matte, rough, spec] as const)

    for (const az of [INTO, AWAY]) {
      const plain = await shot(az, false, 0, 1)
      const same = await shot(az, true, 0, 1)
      ok(`σ = 0、鏡面 1 與標準材質相同（方位 ${az}°）`, Math.abs(same - plain) <= plain * 0.01,
        `${same.toFixed(4)} 對 ${plain.toFixed(4)}`)
    }
    const into = await shot(INTO, true, ROUGH, 0)
    const away = await shot(AWAY, true, ROUGH, 0)
    ok('Oren-Nayar：只看漫射，背光比迎光亮', away > into * 1.02, `背光 ${away.toFixed(4)}，迎光 ${into.toFixed(4)}`)
    const spec1 = await shot(INTO, true, ROUGH, 1)
    ok('鏡面乘倍率：倍率 0 比 1 暗', spec1 > into * 1.05, `${spec1.toFixed(4)} 對 ${into.toFixed(4)}`)
    console.log(`\n  console 錯誤 ${errors.length} 則`)
    if (errors.length > 0) allPass = false
  } finally {
    await browser.close()
  }
  console.log(allPass ? '\n  全部通過' : '\n  有項目失敗')
  if (!allPass) process.exitCode = 1
}

main().catch((e: unknown) => { console.error(e); process.exitCode = 1 })
