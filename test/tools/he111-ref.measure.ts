/**
 * He 111 H-6 參考模型的切片量測。**不由 vitest 執行**。
 *
 * 跑法（兩個終端機）：
 *
 * ```
 * npm run dev                                              # 終端機一
 * npx vite-node test/tools/he111-ref.measure.ts -- align   # 終端機二
 * ```
 *
 * 【`URL` 的埠要對】vite 在 5173 被佔用時會往上找，開跑前看終端機一那一行。
 *
 * ── 這支腳本在整條產線的哪一格 ──────────────────────────────
 *
 * `.claude/skills/aircraft-from-reference` 第 2 步。**坑 16 是這裡最貴的一條**：
 * 機身、機翼、尾翼、座艙、進氣口必須**在同一次切片、同一個座標系**量出來，
 * 最後才整體平移一次。分批量的代價是「每個零件自己都對，彼此的關係錯
 * 0.85 m，而且側視疊圖看不出來」。
 *
 * 所以這支腳本一次跑完全部的量測階段，共用同一組對齊參數。
 *
 * ── 對齊參數 ────────────────────────────────────────────────
 *
 * 與 `src/tools/hangar.ts` 的 `REFS.he111` **同一組**，量法見那裡的註解。
 * 寫在這裡而不是 import：機庫是瀏覽器端的模組，這支是 node 端的驅動腳本，
 * 為了三個數字把 three 整包拉進 node 不划算。**兩邊不一致會被 `align`
 * 階段抓到** —— 它會驗「機首在 −Z、翼展在 X、機翼是平的」。
 */
import { chromium, type Page } from 'playwright'

/**
 * 【為什麼要自己宣告 `process`】專案的 `tsconfig` 沒有把 `node` 放進 `types`，
 * 所以 `process` 沒有型別 —— 而 `tsc --noEmit` 會掃到 `test/` 底下。
 *
 * 為了一支開發腳本的一個欄位把 `@types/node` 拉進整個專案，代價是全專案的
 * 型別環境多一整組 node 的全域名稱（`Buffer`、`__dirname`、`require`…），
 * 而那些在瀏覽器端的程式裡出現時**應該要紅**。宣告用到的那一個欄位就好。
 */
declare const process: { argv: readonly string[] }

const URL = 'http://localhost:5177/hangar.html'
const GLB = '/ref/he_111-h6.glb'
const SHOTS = '.shots/'

/**
 * He 111 H-6 的史實值。**坑 21：每個量到的數字都要先問有沒有史實值可以對。**
 *
 * 有史實值而且對得上 → 採量測值；對不上 → 史實優先，量測值只拿來定位置。
 */
const REAL = {
  span: 22.60,
  length: 16.40,
  /** 停放高度（尾輪著地），飛行姿態量不到這個數字 */
  heightOnGround: 4.00,
  wingArea: 86.5,
  /** 水平尾翼翼展 */
  tailSpan: 7.60,
}

/**
 * 對齊。**yaw 的正負由 `align` 階段實證，不要憑算的。**
 *
 * yaw −90：這台模型機首朝 −X、翼展在 Z。繞 Y 轉 −90° 之後機首朝 −Z、
 *          翼展落到 X —— 與專案的機體座標一致（機首 −Z、右翼 +X）。
 * pitch 2.4：機首朝下 2.4°，往上轉回來。
 * scale：22.60 / 3.7646（切片量到的翼展）。
 */
const ALIGN = { yaw: -90, pitch: 2.4, scale: 6.003285 }

interface Probe {
  tris: number
  meshes: number
  min: number[]
  max: number[]
  size: number[]
  parts: { name: string; tris: number; min: number[]; max: number[]; size: number[] }[]
}
interface Extent {
  planes: number[]
  uMin: number[]; uMax: number[]; vMin: number[]; vMax: number[]
  count: number[]
}

declare global {
  interface Window {
    __hangarProbe: (u: string, a?: typeof ALIGN) => Promise<Probe>
    __hangarSlice: (k: string, a: string, o: Record<string, unknown>) => Promise<unknown>
    __hangarShow: (mine: boolean, ref: boolean) => void
    __hangarCam: (x: number, y: number, z: number) => void
    __hangarOrtho: (v: string | null) => void
  }
}

const n = (v: number, w = 7, d = 3): string =>
  (Number.isFinite(v) ? v.toFixed(d) : '—').padStart(w)

async function main(): Promise<void> {
  // 【跑法】`npx vite-node test/tools/he111-ref.measure.ts -- <階段>`
  // 【`?? ''`】`noUncheckedIndexedAccess` 下索引出來是 `string | undefined`
  const stage = process.argv[process.argv.length - 1] ?? ''
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    page.on('pageerror', (e) => console.log('  [pageerror] ' + String(e)))
    await page.goto(URL)
    await page.waitForFunction(() => '__hangarProbe' in window, null, { timeout: 30000 })

    const probe = await page.evaluate(
      ([u, a]) => window.__hangarProbe(u as string, a as typeof ALIGN),
      [GLB, ALIGN] as const,
    )
    console.log(`載入 ${probe.tris.toLocaleString()} 三角形、${probe.meshes} 個 mesh，已套對齊`)
    console.log(`對齊參數  yaw ${ALIGN.yaw}°  pitch ${ALIGN.pitch}°  scale ${ALIGN.scale}\n`)

    const slice = (kind: 'radial' | 'extent', axis: string, o: Record<string, unknown>) =>
      page.evaluate(
        ([k, a, opt]) => window.__hangarSlice(k as string, a as string, opt as never),
        [kind, axis, o] as const,
      )

    // 【不認識的名字退回 align】它最便宜，也是後面每一格的前提
    await (stages[stage] ?? stages['align']!)(page, probe, slice)
  } finally {
    await browser.close()
  }
}

type Slicer = (k: 'radial' | 'extent', a: string, o: Record<string, unknown>) => Promise<unknown>
type Stage = (page: Page, probe: Probe, slice: Slicer) => Promise<void>

const stages: Record<string, Stage> = {
  /**
   * 【第一關：對齊對了沒】後面每一格都建立在這上面，所以它自己要可證偽。
   *
   * 三條判準：
   *   機首在 −Z    幾何的 Z 下界要遠離 0，而且細（機首尖端）
   *   翼展在 X     X 幅度要等於 22.60 ± 小量
   *   機翼是平的   沿弦向的中厚線斜率要接近 0（那正是 pitch 的定義）
   */
  align: async (page, probe, slice) => {
    console.log('── 對齊後的整體包圍盒（公尺）─────────────────')
    for (let i = 0; i < 3; i++) {
      console.log(`   ${'XYZ'[i]}  ${n(probe.min[i]!)} .. ${n(probe.max[i]!)}`
        + `   幅度 ${n(probe.size[i]!)}`)
    }
    console.log(`\n  翼展（X）${n(probe.size[0]!)} m   真機 ${REAL.span}`
      + `   誤差 ${((probe.size[0]! / REAL.span - 1) * 100).toFixed(2)}%`)

    // 沿 Z 切，看幾何沿機身軸的分佈：u = X（翼展）、v = Y（高）
    //
    // 【窗口要蓋滿】第一版只開到 Z=9，而機身到 16.8 —— 後半段整個沒量到，
    // 而且輸出看起來完全正常（只是「全長 9.5 m」）。窗口不足不會報錯。
    const ez = await slice('extent', 'z', { from: -1.5, to: 17.5, count: 39 }) as Extent
    console.log('\n── 沿 Z（機身軸）的分佈 ──────────────────────')
    console.log('      Z      X幅度     Y下      Y上   線段數')
    for (let i = 0; i < ez.planes.length; i++) {
      const xw = ez.uMax[i]! - ez.uMin[i]!
      console.log(`  ${n(ez.planes[i]!, 6, 2)}  ${n(xw)}  ${n(ez.vMin[i]!)}`
        + `  ${n(ez.vMax[i]!)}  ${String(ez.count[i]).padStart(6)}`)
    }
    const live = ez.planes.filter((_, i) => ez.count[i]! > 0)
    console.log(`\n  有幾何的 Z 範圍 ${n(live[0]!)} .. ${n(live[live.length - 1]!)}`
      + `   全長 ${n(live[live.length - 1]! - live[0]!)} m   真機 ${REAL.length}`)

    // 【用正交而不是自己擺相機】`frameOrtho` 會把參考模型的包圍盒也框進去；
    // 自己擺的話要先知道模型在哪，而它現在不以原點為中心（平移是最後一步）
    await page.evaluate(() => window.__hangarShow(false, true))
    for (const v of ['side', 'top']) {
      await page.evaluate((x) => window.__hangarOrtho(x), v)
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${SHOTS}he111-align-${v}.png` })
      console.log(`  截圖 ${v} → ${SHOTS}he111-align-${v}.png`)
    }
  },
}

void main()
