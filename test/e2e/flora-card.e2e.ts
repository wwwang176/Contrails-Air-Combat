/**
 * **遠處那三個點池，用畫出來的像素驗。**
 *
 * ```
 * node node_modules/vite/bin/vite.js --port 5190                       # 終端機一
 * node node_modules/vite-node/vite-node.mjs test/e2e/flora-card.e2e.ts # 終端機二
 * ```
 *
 * 【為什麼一定要渲染】點的大小是 `gl_PointSize` 算的，而那條式子有四個因子
 * （`aSize`、`projectionMatrix[1][1]`、`size`、`scale / -mvPosition.z`）。
 * 拿掉任何一個，比值都還是對的 —— 錯的是絕對值。`glsl-compile.e2e.ts` 只
 * 編譯不執行，這幾種錯全部編得過。
 *
 * 【為什麼不用 headless】無頭 chromium 走 SwiftShader 的軟體實作。這一條量
 * 的是像素數與亮度，軟體實作其實夠用，但與其他 e2e 維持同一個口徑。
 *
 * 【變異驗證】把 `gl_PointSize` 的 `projectionMatrix[1][1]` 或 `* size`
 * 拿掉，「絕對像素數」必紅而「兩個距離的比值」照樣過。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5190/'
/** 與 fixture 的 `PROBE_FOV_DEG` 一致 */
const FOV_DEG = 10
const CANVAS = 512
/** `broadCard` 的點邊長，m —— `floraShapes.ts` 的 `CARD_POINT_SIZE` */
const BROAD_POINT_M = Math.sqrt(10 * (30 - 10))

interface Shot {
  pixels: number
  width: number
  height: number
  r: number
  g: number
  b: number
}

function ok(name: string, pass: boolean, detail: string): boolean {
  console.log(`  ${pass ? '通過' : '失敗'}  ${name.padEnd(30)} ${detail}`)
  return pass
}

/** 世界長度 `m` 在距離 `d` 處占幾個像素 */
function expectPx(m: number, d: number): number {
  const invTan = 1 / Math.tan((FOV_DEG * Math.PI) / 360)
  return (m * invTan * (CANVAS / 2)) / d
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

    const shot = async (
      az: number, pitch: number, dist: number, dpr: number = 1,
    ): Promise<Shot> =>
      page.evaluate(
        (q: readonly number[]) =>
          (window as unknown as
            Record<string, (a: number, b: number, c: number, d: number) => Shot>)
            ['__cardShot']!(q[0]!, q[1]!, q[2]!, q[3]!),
        [az, pitch, dist, dpr],
      )

    // ── 絕對像素數 ────────────────────────────────────
    for (const d of [4000, 8000]) {
      const s = await shot(30, 0, d)
      const want = expectPx(BROAD_POINT_M, d)
      console.log(`    ${d} m   ${s.width} × ${s.height} px（算出來是 ${want.toFixed(1)}）`)
      // 【±2 px】點是整數像素的方塊，而 gl_PointSize 會被實作取整
      allPass = ok(`${d} m 的點大小對得上公式`, Math.abs(s.width - want) <= 2,
        `${s.width} 對 ${want.toFixed(1)} px`) && allPass
      allPass = ok(`${d} m 的點是方的`, Math.abs(s.width - s.height) <= 1,
        `${s.width} × ${s.height}`) && allPass
    }

    // ── DPR ───────────────────────────────────────────
    // 【three 把 DPR 乘在 `size` uniform 上】把 `gl_PointSize = size;` 整條
    // 換掉會漏掉它 —— DPR = 2 的螢幕上點只有一半大，而 DPR = 1 的機器上
    // 完全正常。只量 DPR 1 的話這個錯抓不到
    const one = await shot(30, 0, 4000, 1)
    const two = await shot(30, 0, 4000, 2)
    console.log(`    DPR 1 ${one.width} px　DPR 2 ${two.width} px`)
    allPass = ok('DPR 2 的點是 DPR 1 的兩倍大', Math.abs(two.width - one.width * 2) <= 2,
      `${two.width} 對 ${one.width * 2}`) && allPass

    // ── 俯視 ──────────────────────────────────────────
    // 【公告板在這個角度會消失】它只繞 Y 轉，俯角 −85° 時是側面朝上
    const level = await shot(45, 0, 5000)
    const down = await shot(45, -85, 5000)
    console.log(`    平視 ${level.pixels} 個像素　俯角 −85° ${down.pixels} 個像素`)
    allPass = ok('俯視時點沒有消失', down.pixels > level.pixels * 0.7,
      `${down.pixels} 對 ${level.pixels}`) && allPass

    // ── 跨門檻的亮度 ──────────────────────────────────
    // 【CARD_NEAR = 3000，但 LOD 是按格心算的】格心離樹最遠 177 m，所以
    // 3,100 m 那一發其實還在中級 —— 兩邊都取樹冠的話這一條是空操作
    const mid = await shot(30, -10, 2500)
    const pt = await shot(30, -10, 3600)
    const lum = (s: Shot): number => 0.2126 * s.r + 0.7152 * s.g + 0.0722 * s.b
    const lm = lum(mid)
    const lp = lum(pt)
    console.log(`    中級樹冠 RGB(${mid.r.toFixed(0)}, ${mid.g.toFixed(0)}, ${mid.b.toFixed(0)})`
      + ` 亮度 ${lm.toFixed(1)}`)
    console.log(`    點       RGB(${pt.r.toFixed(0)}, ${pt.g.toFixed(0)}, ${pt.b.toFixed(0)})`
      + ` 亮度 ${lp.toFixed(1)}`)
    console.log(`    POINT_LIGHT 要乘的倍率：${(lm / lp).toFixed(3)}`)
    allPass = ok('過門檻時亮度接得上', Math.abs(lp - lm) < lm * 0.08,
      `差 ${(((lp - lm) / lm) * 100).toFixed(1)}%`) && allPass

    console.log(`\n  console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('    ' + e)
    if (errors.length > 0) allPass = false
  } finally {
    await browser.close()
  }
  console.log(allPass ? '\n  全部通過\n' : '\n  有項目失敗\n')
  // 【不用 process】專案不引 @types/node
  if (!allPass) throw new Error('點池沒有通過')
}

main().catch((e: unknown) => { console.error(e); throw e })
