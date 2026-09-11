/**
 * 射界錐的整機視角 —— 近照下 8 m 的錐會填滿畫面，讀不出來。
 *
 *   npx tsx test/tools/turret-arcs.probe.ts     # 需要 npm run dev 開在 5178
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5178/tools/hangar.html'
const SHOTS = '.shots/'

const VIEWS: readonly [string, number, number, number][] = [
  ['side', 1, 0.12, 0],
  ['rear-hi', 0, 0.55, 1],
  ['top', 0, 1, 0.02],
]

void (async (): Promise<void> => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on('pageerror', (e) => console.log('  [pageerror] ' + String(e)))
  await page.goto(URL)
  for (const [id, dist] of [['b17g', 46], ['he111', 34]] as const) {
    await page.evaluate((x) => (window as unknown as {
      __hangarSpec: (s: string) => boolean }).__hangarSpec(x), id)
    await page.waitForTimeout(1200)
    await page.evaluate(() => (window as unknown as {
      __hangarArcs: (on: boolean) => number }).__hangarArcs(true))
    for (const [name, x, y, z] of VIEWS) {
      await page.evaluate(([a, b, c]) => (window as unknown as {
        __hangarCam: (px: number, py: number, pz: number) => void
      }).__hangarCam(a!, b!, c!), [x * dist, y * dist, z * dist] as const)
      await page.waitForTimeout(350)
      await page.screenshot({ path: `${SHOTS}arcs-${id}-${name}.png` })
    }
    console.log(`  ${id}：${VIEWS.length} 張`)
  }
  await browser.close()
})()
