/**
 * **逐個 draw call 的 GPU 時間**。用 `EXT_disjoint_timer_query_webgl2` 把每一次
 * 繪製包起來，再依「是哪一支著色器畫的」彙總。
 *
 * ```
 * npx vite --port 5200 --strictPort         # 終端機一
 * npx vite-node test/e2e/leuna-gpu.e2e.ts   # 終端機二
 * ```
 *
 * 【為什麼非這一支不可】CPU 取樣分析器只看得到「主執行緒卡在哪個 GL 呼叫」，
 * 而那個呼叫只是剛好排到的那一個 —— 實測 `bufferSubData` 的 13.4 ms 修掉之後
 * 整包時間原封不動搬到 `uniformMatrix4fv`。要知道 GPU 在忙什麼，只能問 GPU。
 *
 * 【一次只能有一個 TIME_ELAPSED 查詢】規格要求，所以繪製要一次包一個、
 * 依序來。繪製本來就不巢狀，照原順序包就對了。
 *
 * 【結果是非同步的】`getQueryParameter` 要等 `QUERY_RESULT_AVAILABLE`，
 * 而且要檢查 `GPU_DISJOINT_EXT` —— 期間若發生 disjoint（驅動重設、頻率跳動），
 * 那一輪的數字全部作廢，不能拿來報。
 *
 * 【認人靠著色器原始碼】`getAttachedShaders` + `getShaderSource` 讀得回那一支
 * program 的 GLSL。專案自己注入的字串（`ROADS[`、`flora-point` 等）就是指紋，
 * 比 draw call 的序號可靠 —— 序號每幀都會變。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5200/'

const NO_THROTTLE = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]
const NO_VSYNC = ['--disable-gpu-vsync', '--disable-frame-rate-limit']

interface Row {
  readonly name: string
  readonly calls: number
  readonly ms: number
  readonly tris: number
}

interface Result {
  readonly ok: boolean
  readonly why: string
  readonly frames: number
  readonly totalMs: number
  readonly rows: Row[]
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false, args: [...NO_THROTTLE, ...NO_VSYNC] })
  try {
    const page = await browser.newPage({
      viewport: { width: 1707, height: 960 },
      deviceScaleFactor: 1.5,
    })
    await page.goto(URL)
    await page.click('[data-act="start"]')
    await page.click('[data-act="mission"]')
    const step = async (sel: string): Promise<void> => {
      await page.waitForSelector(sel, { state: 'visible' })
      await page.waitForTimeout(400)
      await page.click(sel)
    }
    await step('#campaign-cards button[data-campaign="allies"]')
    await step('#route .stop[data-mission="allies-m2"]')
    await step('#brief-go')
    // 【停在編隊裡】要量飛機的 GPU 時間就得讓飛機在畫面裡。按 G 的那一刻
    // 鏡頭停在玩家的位置，而玩家就在十二架 B-17 的中間排
    await page.waitForTimeout(3000)
    await page.keyboard.press('KeyG')
    await page.waitForTimeout(2000)
    await page.keyboard.down('KeyS')
    await page.waitForTimeout(2500)          // 往後退一點，整個編隊才進得了視野
    await page.keyboard.up('KeyS')
    await page.waitForTimeout(3000)
    await page.screenshot({ path: '.shots/gpu-formation.png' })

    const run = async (hideAircraft: boolean): Promise<Result> => {
      await page.evaluate((hide: boolean) =>
        (window as unknown as Record<string, (p: Record<string, boolean>) => unknown>)['__gfx']!(
          { aircraft: !hide }), hideAircraft)
      await page.waitForTimeout(1200)
      return measureGpu()
    }

    const measureGpu = (): Promise<Result> => page.evaluate((frameCount: number) => new Promise<Result>((resolve) => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas:not(#hud)')
      const gl = canvas?.getContext('webgl2') as WebGL2RenderingContext | null
      if (gl === null) {
        resolve({ ok: false, why: '拿不到 webgl2 context', frames: 0, totalMs: 0, rows: [] })
        return
      }
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
      if (ext === null) {
        resolve({ ok: false, why: '沒有 EXT_disjoint_timer_query_webgl2', frames: 0, totalMs: 0, rows: [] })
        return
      }
      const TIME_ELAPSED = (ext as { TIME_ELAPSED_EXT: number }).TIME_ELAPSED_EXT
      const GPU_DISJOINT = (ext as { GPU_DISJOINT_EXT: number }).GPU_DISJOINT_EXT

      /** 那一支 program 在畫什麼。讀它的 GLSL 找專案自己注入的字串 */
      const named = new Map<WebGLProgram, string>()
      function nameOf(p: WebGLProgram | null): string {
        if (p === null) return '(沒有 program)'
        const hit = named.get(p)
        if (hit !== undefined) return hit
        let frag = ''
        let vert = ''
        for (const sh of gl!.getAttachedShaders(p) ?? []) {
          const src = gl!.getShaderSource(sh) ?? ''
          if (src.includes('gl_FragColor') || src.includes('pc_fragColor')) frag = src
          else vert = src
        }
        // 【次序有意義】專案自己注入的字串先判，three 內建的特徵最後判 ——
        // 反過來的話田地那兩支也含 roughnessFactor，會全部落進「標準材質」
        const has = (s: string) => frag.includes(s) || vert.includes(s)
        let n = '(其他)'
        if (has('ROADS[')) n = '田地著色器＋廠區（細節地形）'
        else if (has('fieldColorAt') || has('vFarmWorld')) n = '田地著色器（遠景環）'
        else if (has('aSpin')) n = '粒子（billboard）'
        else if (has('gl_PointSize')) n = '植被 · 點池'
        // 【要抓 `#define USE_INSTANCING`，不能抓 `instanceMatrix`】後者在
        // three 的 `common` 頂點區塊裡是 `#ifdef` 包著的宣告，**每一支頂點
        // 著色器的原始碼都有這個字串** —— 拿它當條件會把所有網格都判成
        // instanced，而且不會報錯，只是表格全歸到同一列
        else if (has('#define USE_INSTANCING') && has('aAlpha')) n = '粒子（instanced）'
        else if (has('#define USE_INSTANCING')) n = '植被／碎片（instanced）'
        else if (has('#define FLAT_SHADED')) n = '飛機／佈景（平面著色）'
        else if (has('roughnessFactor')) n = '飛機／佈景（標準材質）'
        else if (has('#define TOON') || has('vColor')) n = '頂點色（其他）'
        named.set(p, n)
        return n
      }

      const POOL = 512
      const queries: WebGLQuery[] = []
      for (let i = 0; i < POOL; i++) queries.push(gl.createQuery()!)
      const qName: string[] = new Array<string>(POOL).fill('')
      const qTris: number[] = new Array<number>(POOL).fill(0)
      let used = 0

      const raw = {
        drawElements: gl.drawElements.bind(gl),
        drawArrays: gl.drawArrays.bind(gl),
        drawElementsInstanced: gl.drawElementsInstanced.bind(gl),
        drawArraysInstanced: gl.drawArraysInstanced.bind(gl),
      }
      let recording = false

      /** 三角形數：TRIANGLES 是 count/3，其餘型別不換算（點池就是點數） */
      const wrap = <A extends unknown[]>(
        fn: (...a: A) => void, tris: (a: A) => number,
      ) => (...a: A): void => {
        if (!recording || used >= POOL) { fn(...a); return }
        const i = used++
        qName[i] = nameOf(gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null)
        qTris[i] = tris(a)
        gl.beginQuery(TIME_ELAPSED, queries[i]!)
        fn(...a)
        gl.endQuery(TIME_ELAPSED)
      }

      gl.drawElements = wrap(raw.drawElements, (a) => (a[1] as number) / 3) as typeof gl.drawElements
      gl.drawArrays = wrap(raw.drawArrays, (a) => (a[2] as number) / 3) as typeof gl.drawArrays
      gl.drawElementsInstanced = wrap(raw.drawElementsInstanced,
        (a) => ((a[1] as number) / 3) * (a[4] as number)) as typeof gl.drawElementsInstanced
      gl.drawArraysInstanced = wrap(raw.drawArraysInstanced,
        (a) => ((a[2] as number) / 3) * (a[3] as number)) as typeof gl.drawArraysInstanced

      let frames = 0
      const startRecord = (): void => { recording = true }
      const tick = (): void => {
        frames++
        if (frames >= frameCount || used >= POOL) {
          recording = false
          gl.drawElements = raw.drawElements
          gl.drawArrays = raw.drawArrays
          gl.drawElementsInstanced = raw.drawElementsInstanced
          gl.drawArraysInstanced = raw.drawArraysInstanced
          // 【等結果】查詢是非同步的，而且要等 GPU 真的跑完那幾幀。
          // 【一定要重試而不是等一個固定時間】結果什麼時候回來由驅動決定；
          // 等固定時間的症狀是「全部沒回來」，看起來像擴充功能壞了
          let tries = 0
          const poll = (): void => {
            const last = queries[used - 1]!
            if (gl!.getQueryParameter(last, gl!.QUERY_RESULT_AVAILABLE) === true || ++tries > 60) {
              collect(tries > 60)
              return
            }
            setTimeout(poll, 50)
          }
          poll()
          return
        }
        requestAnimationFrame(tick)
      }

      function collect(timedOut: boolean): void {
        if (gl!.getParameter(GPU_DISJOINT) === true) {
          resolve({ ok: false, why: '期間發生 GPU_DISJOINT，這一輪作廢', frames, totalMs: 0, rows: [] })
          return
        }
        void timedOut
        const agg = new Map<string, { calls: number; ns: number; tris: number }>()
        let missing = 0
        for (let i = 0; i < used; i++) {
          const q = queries[i]!
          if (gl!.getQueryParameter(q, gl!.QUERY_RESULT_AVAILABLE) !== true) { missing++; continue }
          const ns = gl!.getQueryParameter(q, gl!.QUERY_RESULT) as number
          const e = agg.get(qName[i]!) ?? { calls: 0, ns: 0, tris: 0 }
          e.calls++
          e.ns += ns
          e.tris += qTris[i]!
          agg.set(qName[i]!, e)
        }
        for (const q of queries) gl!.deleteQuery(q)
        let total = 0
        for (const v of agg.values()) total += v.ns
        resolve({
          ok: true,
          why: missing === 0 ? '' : `${missing} 筆查詢還沒回來，未計入`,
          frames,
          totalMs: total / 1e6,
          rows: [...agg.entries()]
            .map(([name, v]) => ({ name, calls: v.calls, ms: v.ns / 1e6, tris: v.tris }))
            .sort((a, b) => b.ms - a.ms),
        })
      }

      startRecord()
      requestAnimationFrame(tick)
    }), 3)

    const r = await run(false)

    const show = (title: string, r: Result): void => {
      console.log(`\n==== ${title} ====`)
      if (!r.ok) { console.log(`  量不到：${r.why}`); return }
      console.log(`  ${r.frames} 幀　GPU 合計 ${r.totalMs.toFixed(2)} ms`
        + `　每幀 ${(r.totalMs / r.frames).toFixed(2)} ms`)
      if (r.why !== '') console.log(`  注意：${r.why}`)
      console.log('    ms/幀    次/幀    三角形/幀   每次 draw   每個三角形   誰畫的')
      for (const row of r.rows) {
        const perCall = (row.ms * 1000) / row.calls
        const perTri = row.tris > 0 ? (row.ms * 1e6) / row.tris : 0
        console.log(`  ${(row.ms / r.frames).toFixed(2).padStart(7)}`
          + `  ${(row.calls / r.frames).toFixed(1).padStart(6)}`
          + `  ${Math.round(row.tris / r.frames).toLocaleString().padStart(11)}`
          + `  ${perCall.toFixed(1).padStart(8)} us`
          + `  ${perTri.toFixed(1).padStart(8)} ns`
          + `   ${row.name}`)
      }
    }

    show('有飛機', r)
    show('關掉飛機（差額就是飛機）', await run(true))
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => { console.error(e); throw e })
