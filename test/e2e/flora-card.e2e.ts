/**
 * **公告板的朝向，用畫出來的像素驗。**
 *
 * ```
 * node node_modules/vite/bin/vite.js --port 5190                       # 終端機一
 * node node_modules/vite-node/vite-node.mjs test/e2e/flora-card.e2e.ts # 終端機二
 * ```
 *
 * 【為什麼一定要渲染】朝向是頂點著色器算的。`glsl-compile.e2e.ts` 只編譯
 * 不執行 —— world/local 座標空間混用、朝向寫死成 X 軸、hook 掛錯材質，
 * 三種都編得過而且單元測試全綠。
 *
 * 【為什麼不用 headless】無頭 chromium 走 SwiftShader 的軟體實作。這一條
 * 量的是輪廓不是顏色，軟體實作其實夠用，但與其他 e2e 維持同一個口徑。
 *
 * 【變異驗證】把 `CARD_VERTEX` 的 `cardRight` 改成固定 `vec3(1,0,0)`，
 * 「三個方位寬度一致」必紅；把 up 改成跟著鏡頭俯仰，「俯衝時仍然站著」必紅。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5190/'
const DIST = 4000

interface Shot {
  pixels: number
  width: number
  height: number
}

function ok(name: string, pass: boolean, detail: string): boolean {
  console.log(`  ${pass ? '通過' : '失敗'}  ${name.padEnd(28)} ${detail}`)
  return pass
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false })
  let allPass = true
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL)
    // 【用 addScriptTag 不用 page.evaluate 裡的 import()】vite-node 會把
    // evaluate 裡的動態 import 改寫成 SSR 版本，在瀏覽器裡不存在
    await page.addScriptTag({ type: 'module', url: '/test/e2e/fixtures/card-probe.ts' })
    await page.waitForFunction(() => '__cardShot' in window)

    const shot = async (az: number, pitch: number): Promise<Shot> =>
      page.evaluate(
        (q: readonly number[]) =>
          (window as unknown as Record<string, (a: number, b: number, c: number) => Shot>)
            ['__cardShot']!(q[0]!, q[1]!, q[2]!),
        [az, pitch, DIST],
      )

    // ── 三個等距方位 ──────────────────────────────────
    const azimuths = [0, 90, 180, 270]
    const wide: number[] = []
    for (const az of azimuths) {
      const s = await shot(az, 0)
      wide.push(s.width)
      console.log(`    方位 ${String(az).padStart(3)}°   ${s.width} × ${s.height} px、${s.pixels} 個像素`)
    }
    const lo = Math.min(...wide)
    const hi = Math.max(...wide)
    allPass = ok('四個方位都看得到', lo > 0, `最窄 ${lo} px`) && allPass
    // 【寬度一致才叫面向鏡頭】朝向寫死成 X 軸的話，0°/180° 會是滿寬、
    // 90°/270° 會塌成一條線
    allPass = ok('四個方位的寬度一致', hi - lo <= 1, `${lo}–${hi} px`) && allPass

    // ── 俯衝 ──────────────────────────────────────────
    const level = await shot(45, 0)
    const dive = await shot(45, -60)
    console.log(`    平視 ${level.width} × ${level.height}　俯角 −60° ${dive.width} × ${dive.height}`)
    // 【站著的東西俯視會變矮，但不會變寬】完全面向鏡頭的話高寬比會維持不變
    allPass = ok('俯衝時仍然站著', dive.height < level.height * 0.8 && dive.width <= level.width + 1,
      `高 ${level.height} → ${dive.height} px`) && allPass
    allPass = ok('俯衝時沒有消失', dive.pixels > 0, `${dive.pixels} 個像素`) && allPass

    console.log(`\n  console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('    ' + e)
    if (errors.length > 0) allPass = false
  } finally {
    await browser.close()
  }
  console.log(allPass ? '\n  全部通過\n' : '\n  有項目失敗\n')
  // 【不用 process】專案不引 @types/node
  if (!allPass) throw new Error('公告板的朝向沒有通過')
}

main().catch((e: unknown) => { console.error(e); throw e })
