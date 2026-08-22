/**
 * 列出參考模型的 mesh 名稱與包圍盒 —— 找砲塔的最短路徑。
 *
 *   npx tsx test/tools/ref-nodes.probe.ts        # 需要 npm run dev 開在 5178
 *
 * 【為什麼不是射線法】射線法適合量「連續的蒙皮輪廓」，不適合量「掛在機身上
 * 的小零件」。從機身裡往外打的射線會飛過砲塔打到對側機身或機翼，`max` 那一欄
 * 因此被遠處的幾何主導 —— 實測 B-17 的上部砲塔，maxRadius 0.9 量到 0.89、
 * 換成 1.4 就變成 1.34，兩者永遠不一致。
 *
 * 砲塔若在模型裡是獨立命名的節點，直接讀包圍盒就結束了。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5178/hangar.html'

interface Node { name: string; tris: number; box: number[] }

const n = (v: number, w = 8, d = 2): string => v.toFixed(d).padStart(w)

async function dump(id: string): Promise<void> {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', (e) => console.log('  [pageerror] ' + String(e)))
  await page.goto(URL)
  await page.evaluate((x) => (window as unknown as {
    __hangarSpec: (s: string) => boolean }).__hangarSpec(x), id)
  await page.evaluate(() => (window as unknown as {
    __hangarRef: (on: boolean, solid: boolean) => Promise<boolean> }).__hangarRef(true, true))
  await page.waitForFunction(() => (window as unknown as {
    __hangarRefNodes: () => unknown }).__hangarRefNodes() !== null,
  undefined, { timeout: 240_000 })

  const rows = await page.evaluate(() => (window as unknown as {
    __hangarRefNodes: () => Node[] }).__hangarRefNodes()) as Node[]

  console.log(`\n══ ${id} ══ ${rows.length} 個 mesh，依三角形數排序`)
  console.log('  三角形    x 從      x 到      y 從      y 到      z 從      z 到   名稱')
  for (const r of [...rows].sort((a, b) => b.tris - a.tris)) {
    const [x0, y0, z0, x1, y1, z1] = r.box as [number, number, number, number, number, number]
    console.log(`  ${String(r.tris).padStart(7)}${n(x0)}${n(x1)}${n(y0)}${n(y1)}`
      + `${n(z0)}${n(z1)}   ${r.name}`)
  }
  await browser.close()
}

void (async (): Promise<void> => {
  await dump('b17g')
  await dump('he111')
})()
