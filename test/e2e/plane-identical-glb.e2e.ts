/**
 * `plane-identical.e2e.ts` 的縮減版：只拍 He 111 與 B-17G，前綴由環境變數
 * `SHOT_PREFIX` 給。改 GLB 前後各跑一次，逐張比雜湊。用法與判準見原檔。
 *
 * ```
 * node node_modules/vite/bin/vite.js --port 5190
 * SHOT_PREFIX=before node node_modules/vite-node/vite-node.mjs test/e2e/plane-identical-glb.e2e.ts
 * ```
 */
import { chromium } from 'playwright'

declare const process: { env: Record<string, string | undefined> }

const URL = 'http://localhost:5190/'
const IDS = ['he111', 'b17g'] as const
const AZIMUTHS = [0, 60, 120, 180, 240, 300]
const PITCHES = [0, -30]
const BLURRED = [false, true]

interface PlaneShot { pixels: number, hash: number }

const PREFIX = process.env['SHOT_PREFIX'] ?? 'after'
const SHOTS = '.shots/plane/'

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false })
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 640 } })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL)
    await page.addScriptTag({ type: 'module', url: '/test/e2e/fixtures/plane-probe.ts' })
    await page.waitForFunction(() => '__planeShot' in window)

    let n = 0
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
          }
        }
      }
    }
    console.log(`\n  ${n} 張寫到 ${SHOTS}${PREFIX}-*.png`)
    console.log(`  console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('    ' + e)
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => { console.error(e); throw e })
