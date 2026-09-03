/**
 * **He 111 與 B-17G：GLB 路 vs 程式版，逐 byte 比對。**
 *
 * ```
 * node node_modules/vite/bin/vite.js --port 5190                          # 終端機一
 * node node_modules/vite-node/vite-node.mjs test/e2e/glb-vs-proc.e2e.ts   # 終端機二
 * ```
 *
 * 兩台 × 六個方位 × 兩個俯角 × 兩種槳狀態 = 48 張。每張回報差了幾個像素、
 * 最大差幾階；判準沿用 P-51D 搬 GLB 那次（2d9b1cd）：差的像素只該落在
 * 三角形邊緣（烘變換的 float32 尾數），色階差幾十以內、整片翻掉不可以。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5190/'
const IDS = ['he111', 'b17g'] as const
const AZIMUTHS = [0, 60, 120, 180, 240, 300]
const PITCHES = [0, -30]
const BLURRED = [false, true]

interface PlaneDiff { pixels: number, differing: number, maxDelta: number }

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false })
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 640 } })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL)
    await page.addScriptTag({ type: 'module', url: '/test/e2e/fixtures/glb-vs-proc-probe.ts' })
    await page.waitForFunction(() => '__planeDiff' in window)

    let worstPixels = 0, worstDelta = 0
    for (const id of IDS) {
      let idPixels = 0, idDelta = 0
      for (const az of AZIMUTHS) {
        for (const pitch of PITCHES) {
          for (const blurred of BLURRED) {
            const d: PlaneDiff = await page.evaluate(
              (q: readonly [string, number, number, boolean]) =>
                (window as unknown as Record<string,
                  (a: string, b: number, c: number, d: boolean) => PlaneDiff>)
                  ['__planeDiff']!(q[0], q[1], q[2], q[3]),
              [id, az, pitch, blurred] as const,
            )
            console.log(`  ${id.padEnd(6)} 方位 ${String(az).padStart(3)}° 俯角 ${String(pitch).padStart(3)}°`
              + ` ${blurred ? '圓盤' : '槳葉'}  像素 ${String(d.pixels).padStart(6)}`
              + `  差 ${String(d.differing).padStart(4)} 個  最大 ${String(d.maxDelta).padStart(3)} 階`)
            idPixels = Math.max(idPixels, d.differing)
            idDelta = Math.max(idDelta, d.maxDelta)
          }
        }
      }
      console.log(`  → ${id}: 單張最多 ${idPixels} 個像素不同、最大 ${idDelta} 階\n`)
      worstPixels = Math.max(worstPixels, idPixels)
      worstDelta = Math.max(worstDelta, idDelta)
    }
    console.log(`  合計：單張最多 ${worstPixels} 個像素不同、最大 ${worstDelta} 階`)
    console.log(`  console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('    ' + e)
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => { console.error(e); throw e })
