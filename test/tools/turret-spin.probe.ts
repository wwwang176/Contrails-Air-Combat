/**
 * 機庫自動旋轉時，槍管有沒有跟著機身轉。
 *
 *   npx tsx test/tools/turret-spin.probe.ts     # 需要 npm run dev 開在 5178
 *
 * 【為什麼要一支探針而不是用眼睛看】這個缺陷**在截圖上不存在** ——
 * `__hangarCam` 會把 `rotation.y` 歸零並停掉自動旋轉，所以逐座近照那一輪
 * 剛好落在「兩者都是 0」的情況上。只有讓它轉起來再讀兩個角度才看得到。
 *
 * 判準兩條，缺一不可：轉盤**真的在動**（機身角度有變，否則這支探針自己
 * 壞了、量什麼都會過），而且槍管的角度與機身**相同**。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5178/hangar.html'

interface Angles { model: number; barrels: number; barrelCount: number }

void (async (): Promise<void> => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
  page.on('pageerror', (e) => console.log('  [pageerror] ' + String(e)))
  await page.goto(URL)
  await page.evaluate((x) => (window as unknown as {
    __hangarSpec: (s: string) => boolean }).__hangarSpec(x), 'b17g')
  await page.waitForTimeout(1500)

  const rows: Angles[] = []
  for (let k = 0; k < 5; k++) {
    await page.waitForTimeout(700)
    rows.push(await page.evaluate(() => (window as unknown as {
      __hangarSpin: () => Angles }).__hangarSpin()))
  }
  await browser.close()

  console.log('     機身 rad   槍管 rad        差    槍管根數')
  let worst = 0
  for (const r of rows) {
    const d = Math.abs(r.model - r.barrels)
    worst = Math.max(worst, d)
    console.log(`  ${r.model.toFixed(4).padStart(10)}${r.barrels.toFixed(4).padStart(11)}`
      + `${d.toFixed(6).padStart(10)}${String(r.barrelCount).padStart(12)}`)
  }
  const span = Math.abs(rows[rows.length - 1]!.model - rows[0]!.model)
  console.log('')
  console.log(`  轉盤走了 ${span.toFixed(3)} rad（必須 > 0，否則這支探針自己壞了）`)
  console.log(`  最大角度差 ${worst.toFixed(6)} rad（必須是 0）`)
  console.log(worst === 0 && span > 0 ? '  ✓ 槍管跟著轉' : '  ✗ 槍管沒跟著轉')
})()
