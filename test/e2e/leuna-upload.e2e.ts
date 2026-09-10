/**
 * **每幀 `bufferSubData` 的歸因**。把 WebGL2 的 `bufferSubData` 包一層，記每一次
 * 的位元組數與**它自己花掉的時間**，按大小分組。洛伊納與遭遇戰各跑一次。
 *
 * ```
 * npx vite --port 5200 --strictPort           # 終端機一
 * npx vite-node test/e2e/leuna-upload.e2e.ts  # 終端機二
 * ```
 *
 * 【為什麼用上傳大小當指紋，不用呼叫堆疊】three 的屬性上傳全部經過同一條
 * 內部路徑（`WebGLAttributes.update`），堆疊裡沒有任何一格指得出是哪一顆
 * 網格。而每個粒子池的容量都不同，`容量 x 每格位元組` 就是唯一的識別 ——
 * `InstancedMesh` 每格是矩陣 64 B、顏色 12 B，自訂的 `aAlpha` 是 4 B。
 *
 * 【為什麼要有遭遇戰那一輪】要分得出「這一筆是洛伊納才有的」還是「兩張圖
 * 都在付」。只量一張圖的話，看到的每一筆都像是這張圖的問題。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5200/'

const NO_THROTTLE = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]
const NO_VSYNC = ['--disable-gpu-vsync', '--disable-frame-rate-limit']

async function enterLeuna(page: import('playwright').Page): Promise<void> {
  await page.click('[data-act="mission"]')
  const step = async (sel: string): Promise<void> => {
    await page.waitForSelector(sel, { state: 'visible' })
    await page.waitForTimeout(400)
    await page.click(sel)
  }
  await step('#campaign-cards button[data-campaign="allies"]')
  await step('#route .stop[data-mission="allies-m2"]')
  await step('#brief-go')
}

interface Upload {
  readonly frames: number
  readonly seconds: number
  readonly calls: number
  readonly bytes: number
  /** 依「每幀花的毫秒」排序。`size` 是單次上傳的位元組數 */
  readonly rows: {
    readonly size: number
    readonly calls: number
    readonly bytes: number
    readonly ms: number
  }[]
}

async function pass(scene: 'leuna' | 'skirmish'): Promise<void> {
  const browser = await chromium.launch({ headless: false, args: [...NO_THROTTLE, ...NO_VSYNC] })
  try {
    const page = await browser.newPage({
      viewport: { width: 1707, height: 960 },
      deviceScaleFactor: 1.5,
    })
    await page.goto(URL)
    await page.click('[data-act="start"]')
    if (scene === 'leuna') {
      await enterLeuna(page)
    } else {
      await page.click('[data-act="skirmish"]')
      await page.click('#skirmish [data-act="fight"]')
    }
    await page.keyboard.press('KeyI')
    await page.waitForTimeout(10000)

    const r = await page.evaluate((seconds: number) => new Promise<Upload>((resolve) => {
      const proto = WebGL2RenderingContext.prototype as unknown as
        Record<string, (...a: unknown[]) => unknown>
      const original = proto['bufferSubData']!
      let calls = 0
      let bytes = 0
      let frames = 0
      const rows = new Map<number, { calls: number; bytes: number; ms: number }>()

      proto['bufferSubData'] = function (this: unknown, ...args: unknown[]) {
        calls++
        /*
         * 簽章有兩種：`(target, offset, srcData)` 與
         * `(target, offset, srcData, srcOffset, length)`。
         *
         * 【一定要看第五個參數】只讀 `srcData.byteLength` 的話，量到的永遠是
         * **整條陣列**，而三參數版才是整條傳；five-arg 版只傳 `length` 個
         * 元素。`addUpdateRange` 走的正是後者 —— 讀錯的症狀是「範圍改好了，
         * 位元組數卻紋風不動」，看起來像沒生效。
         */
        const d = args[2] as { byteLength?: number; BYTES_PER_ELEMENT?: number } | undefined
        const len = args[4]
        const n = typeof len === 'number' && typeof d?.BYTES_PER_ELEMENT === 'number'
          ? len * d.BYTES_PER_ELEMENT
          : (typeof d?.byteLength === 'number' ? d.byteLength : 0)
        bytes += n
        const t0 = performance.now()
        const out = original.apply(this, args)
        const e = rows.get(n) ?? { calls: 0, bytes: 0, ms: 0 }
        e.calls++
        e.bytes += n
        e.ms += performance.now() - t0
        rows.set(n, e)
        return out
      } as unknown as typeof original

      const startedAt = performance.now()
      const tick = (): void => {
        frames++
        if (performance.now() - startedAt < seconds * 1000) { requestAnimationFrame(tick); return }
        proto['bufferSubData'] = original
        resolve({
          frames,
          seconds: (performance.now() - startedAt) / 1000,
          calls,
          bytes,
          rows: [...rows.entries()]
            .map(([size, v]) => ({ size, calls: v.calls, bytes: v.bytes, ms: v.ms }))
            .sort((a, b) => b.ms - a.ms),
        })
      }
      requestAnimationFrame(tick)
    }), 12)

    const totalMs = r.rows.reduce((a, b) => a + b.ms, 0)
    console.log(`\n==== ${scene} ====`)
    console.log(`  ${r.frames} 幀 / ${r.seconds.toFixed(1)} s`
      + `　每幀 ${(r.calls / r.frames).toFixed(1)} 次、${(r.bytes / r.frames / 1024).toFixed(0)} KiB`)
    console.log(`  bufferSubData 本身每幀 ${(totalMs / r.frames).toFixed(2)} ms`)
    console.log('    ms/幀    次/幀     單次大小     64B格   12B格    4B格')
    for (const row of r.rows.slice(0, 16)) {
      if (row.ms / r.frames < 0.01) break
      const per = (n: number) => (row.size % n === 0 ? String(row.size / n) : '-')
      console.log(`  ${(row.ms / r.frames).toFixed(2).padStart(7)}`
        + `  ${(row.calls / r.frames).toFixed(2).padStart(7)}`
        + `  ${(row.size / 1024).toFixed(1).padStart(9)} KiB`
        + `  ${per(64).padStart(7)} ${per(12).padStart(7)} ${per(4).padStart(7)}`)
    }
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  console.log('==== bufferSubData 歸因（12 s，1707x960 @ DPR 1.5，解鎖 vsync）====')
  await pass('leuna')
  await pass('skirmish')
}

main().catch((e: unknown) => { console.error(e); throw e })
