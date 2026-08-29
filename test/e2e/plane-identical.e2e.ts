/**
 * **飛機的逐像素回歸**：靜態零件合併前後，96 張截圖必須逐 byte 相同。
 *
 * ```
 * node node_modules/vite/bin/vite.js --port 5190                            # 終端機一
 * node node_modules/vite-node/vite-node.mjs test/e2e/plane-identical.e2e.ts # 終端機二
 * ```
 *
 * 改動前跑一次（`PREFIX = 'before'`）、改動後跑一次（`'after'`），比**合計雜湊**。
 *
 * 【判準是雜湊，不是截圖】`locator.screenshot()` 走瀏覽器的合成路徑，同一份
 * 程式跑兩次有 0.087% 的像素在跳（最大差 230/255，2026-08-30 實測）。
 * `readPixels` 讀的是 GL 的後備緩衝，同一份程式跑兩次**逐 byte 相同**。
 * 截圖留著只為了在雜湊不同時看差在哪。
 *
 * 【它守的是頂點指紋看不見的那一半】`test/unit/aircraft-merge.test.ts` 釘住了
 * 世界座標與法線一個 bit 都沒動。剩下的風險是**提交次序**：併起來之後同材質
 * 的三角形換了順序，共面的地方深度平手誰贏可能翻轉。那只有畫出來才看得到。
 *
 * ```
 *    四個機種 × 六個方位（0/60/120/180/240/300°）
 *             × 兩個俯角（0／−30°）× 兩種槳狀態 = 96 張
 * ```
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5190/'
const IDS = ['p51d', 'bf109k4', 'he111', 'b17g'] as const
const AZIMUTHS = [0, 60, 120, 180, 240, 300]
const PITCHES = [0, -30]
const BLURRED = [false, true]

interface PlaneShot { pixels: number, hash: number }

/**
 * 這一批截圖的前綴。**改動前跑一次存 `before`，改動後改成 `after` 再跑一次。**
 * 比對 `.shots/plane/` 底下同名的兩批 PNG。
 */
const PREFIX = 'after'
const SHOTS = '.shots/plane/'

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false })
  try {
    // 【視窗要裝得下 512 的畫布】locator 截圖只截元素可見的部分，視窗比它小
    // 的話截到的是被裁掉的一角
    const page = await browser.newPage({ viewport: { width: 640, height: 640 } })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL)
    // 【用 addScriptTag 不用 evaluate 裡的 import()】vite-node 會把 evaluate
    // 裡的動態 import 改寫成 SSR 版本，在瀏覽器裡不存在
    await page.addScriptTag({ type: 'module', url: '/test/e2e/fixtures/plane-probe.ts' })
    await page.waitForFunction(() => '__planeShot' in window)

    let n = 0
    let combined = 2166136261 >>> 0
    for (const id of IDS) {
      for (const az of AZIMUTHS) {
        for (const pitch of PITCHES) {
          for (const blurred of BLURRED) {
            const shot: PlaneShot = await page.evaluate(
              (q: readonly [string, number, number, boolean]) =>
                (window as unknown as Record<string,
                  (a: string, b: number, c: number, d: boolean) => PlaneShot>)
                  ['__planeShot']!(q[0], q[1], q[2], q[3]),
              [id, az, pitch, blurred] as const,
            )
            n++
            const tag = `${id}-a${az}-p${pitch}-${blurred ? 'disc' : 'blade'}`
            await page.locator('#plane-probe').screenshot({ path: `${SHOTS}${PREFIX}-${tag}.png` })
            console.log(`  ${id.padEnd(8)} 方位 ${String(az).padStart(3)}°`
              + ` 俯角 ${String(pitch).padStart(3)}°`
              + ` ${blurred ? '圓盤' : '槳葉'}`
              + `   像素 ${String(shot.pixels).padStart(6)}`
              + `   雜湊 ${shot.hash.toString(16).padStart(8, '0')}`)
            combined ^= shot.hash & 0xff
            for (let k = 0; k < 4; k++) {
              combined ^= (shot.hash >>> (k * 8)) & 0xff
              combined = Math.imul(combined, 16777619) >>> 0
            }
          }
        }
      }
    }
    console.log(`\n  ${n} 張寫到 ${SHOTS}${PREFIX}-*.png`)
    console.log(`  合計雜湊 ${(combined >>> 0).toString(16).padStart(8, '0')}`
      + '   ← 逐 byte 的判準。截圖只用來看差多少')
    console.log(`  console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('    ' + e)
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => { console.error(e); throw e })
