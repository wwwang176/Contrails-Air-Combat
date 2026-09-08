/**
 * **幀時間分佈的量測**：平均 FPS、1% low、0.1% low、掉幀次數。
 * **不由 vitest 執行**（副檔名 `.e2e.ts`，`vite.config.ts` 只收 `*.test.ts`）。
 *
 * ```
 * npm run dev                                      # 終端機一，開在 5173
 * npx vite-node test/e2e/frame-time.e2e.ts         # 終端機二
 * ```
 *
 * ── 【為什麼需要這一支：既有的 `core/perf.ts` 量的不是幀時間】──
 *
 * 那個疊層量的是 `perf.begin()` 到 `perf.endFrame()` 之間，也就是
 * **rAF 回呼裡的 CPU 工作**。它不含三件事，而掉幀幾乎都出在那三件：
 *
 *   等 vsync           —— 回呼早就跑完了，畫面還沒換
 *   GPU 的實際繪製     —— `renderer.render()` 只是把命令丟進佇列就回來
 *   合成與 GC          —— 完全在回呼之外
 *
 * 所以它印的「FPS」是「假如 CPU 是唯一瓶頸能跑多快」，恆遠高於畫面上的
 * 真實幀率。而且它取 60 幀**平均** —— 平均正是專門用來抹掉卡頓的統計量：
 * 60 幀裡有一幀花 100 ms，平均只從 16.7 抬到 18.1 ms，讀起來還是 55 FPS，
 * 而玩家那一下明確看得到一次頓挫。
 *
 * 【1% low 的定義】本檔採用玩家社群的通行定義：把所有幀時間由大到小排，
 * **取最慢的 1% 求平均**，再倒數換成 FPS。另一種定義是「第 99 百分位那一幀」
 * 的倒數，兩者都印出來（`p99`），因為它們差很多時本身就是情報 —— 代表
 * 尾巴很長（少數幾幀特別慘），而不是整體偏慢。
 *
 * 【一定要有頭】`chromium.launch()` 預設無頭，而無頭的 chromium 走
 * SwiftShader 軟體算圖，量出來的是 CPU 模擬 GPU 的速度，與玩家實際看到的
 * 沒有關係。這支用 `headless: false` 開真視窗、走真顯示卡。代價是會在
 * 桌面上跳出一個瀏覽器視窗，那是預期的。
 *
 * 【幀時間的來源是 rAF 的 `time` 參數，不是 `performance.now()`】前者是
 * 瀏覽器給這一幀的時間戳，同一幀裡所有回呼拿到的是同一個值；後者是回呼
 * 執行到那一行的時刻，會把「這個探針自己排在第幾個」混進量測裡。
 *
 * 【不得使用 process / fs】專案沒有 `@types/node`，判斷全部走
 * `page.evaluate`，輸出全部走 `console.log`。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5173/'

/** 一段量測的結果。時間單位一律 ms。 */
interface Sample {
  readonly count: number
  readonly seconds: number
  readonly mean: number
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly worst1: number
  readonly worst01: number
  readonly max: number
  /** 超過 p50 兩倍的幀數 —— 讀得出來的頓挫 */
  readonly hitches: number
  /** 主執行緒被連續佔住 > 50 ms 的次數（PerformanceObserver longtask） */
  readonly longTasks: number
}

/**
 * 在頁面裡收 `duration` 秒的 rAF 時間戳，回統計量。
 *
 * 【為什麼統計在頁面裡算完才回傳】一場 20 秒的量測有一千多筆，跨 CDP 傳
 * 陣列本身就是負擔，而負擔會落在被量的那個執行緒上。
 *
 * 【第一筆一定要丟掉】第一個間隔是「安裝探針的那一刻」到「下一幀」，
 * 不是一個完整的幀間隔。
 */
async function record(page: import('playwright').Page, duration: number): Promise<Sample> {
  return page.evaluate((seconds: number) => new Promise<Sample>((resolve) => {
    const stamps: number[] = []
    let longTasks = 0
    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => { longTasks += list.getEntries().length })
      observer.observe({ entryTypes: ['longtask'] })
    } catch { observer = null }

    const startedAt = performance.now()
    const tick = (time: number): void => {
      stamps.push(time)
      if (performance.now() - startedAt < seconds * 1000) {
        requestAnimationFrame(tick)
        return
      }
      observer?.disconnect()

      const frames: number[] = []
      for (let i = 2; i < stamps.length; i++) frames.push(stamps[i]! - stamps[i - 1]!)
      frames.sort((a, b) => a - b)
      const n = frames.length
      const at = (q: number) => frames[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))]!
      // 最慢的那一段求平均。至少取一幀，否則短量測會除以零
      const tailMean = (fraction: number) => {
        const k = Math.max(1, Math.floor(n * fraction))
        let sum = 0
        for (let i = n - k; i < n; i++) sum += frames[i]!
        return sum / k
      }
      const p50 = at(0.5)
      resolve({
        count: n,
        seconds: (stamps[stamps.length - 1]! - stamps[1]!) / 1000,
        mean: frames.reduce((a, b) => a + b, 0) / n,
        p50,
        p95: at(0.95),
        p99: at(0.99),
        worst1: tailMean(0.01),
        worst01: tailMean(0.001),
        max: frames[n - 1]!,
        hitches: frames.filter((f) => f > p50 * 2).length,
        longTasks,
      })
    }
    requestAnimationFrame(tick)
  }), duration)
}

function report(title: string, s: Sample): void {
  const fps = (ms: number) => (1000 / Math.max(ms, 0.001)).toFixed(1)
  console.log(`\n── ${title} ──  ${s.count} 幀 / ${s.seconds.toFixed(1)} s`)
  console.log(`  平均      ${s.mean.toFixed(2)} ms   ${fps(s.mean)} FPS`)
  console.log(`  中位 p50  ${s.p50.toFixed(2)} ms   ${fps(s.p50)} FPS`)
  console.log(`  p95       ${s.p95.toFixed(2)} ms   ${fps(s.p95)} FPS`)
  console.log(`  p99       ${s.p99.toFixed(2)} ms   ${fps(s.p99)} FPS`)
  console.log(`  1% low    ${s.worst1.toFixed(2)} ms   ${fps(s.worst1)} FPS   ← 最慢 1% 的平均`)
  console.log(`  0.1% low  ${s.worst01.toFixed(2)} ms   ${fps(s.worst01)} FPS`)
  console.log(`  最慢一幀  ${s.max.toFixed(2)} ms   ${fps(s.max)} FPS`)
  console.log(`  頓挫      ${s.hitches} 幀 > p50×2（每秒 ${(s.hitches / s.seconds).toFixed(2)} 次）`)
  console.log(`  長工作    ${s.longTasks} 次主執行緒被佔住 > 50 ms`)
}

/**
 * 視窗失焦時 chromium 會把 rAF 降到 1 Hz 甚至停掉 —— 那會把量測變成一串
 * 1000 ms 的假頓挫。這三個旗標關掉背景節流。
 */
const NO_THROTTLE = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]

/**
 * 解鎖垂直同步。**兩個旗標缺一不可**：`--disable-gpu-vsync` 讓 GPU 行程
 * 不等掃描線，`--disable-frame-rate-limit` 拿掉合成器自己那一層上限。
 *
 * 【為什麼非量這一輪不可】鎖 vsync 時幀間隔恆為刷新週期的整數倍 ——
 * 這台是 164 Hz、6.1 ms 一格，所以量到的每一筆都是 6.1 / 12.2 / 18.3…
 * 一幀實際花 12.5 ms 或 18.0 ms，畫面上**都**呈現為 18.3。鎖著量得到
 * 「玩家看到幾 FPS」，量不到「離掉幀還有多少餘裕」，而後者才是「還能不能
 * 加雲」的判準。
 */
const NO_VSYNC = ['--disable-gpu-vsync', '--disable-frame-rate-limit']

/**
 * 跑一輪完整的三場景量測。
 *
 * 【解析度必須貼近真實遊玩，否則整輪都是假的】`render/scene.ts` 是
 * `setPixelRatio(min(devicePixelRatio, 2))` 且 `antialias: true`，所以
 * 填充率的成本正比於**視窗邏輯像素 × DPR²**。1280×720 @ DPR 1 是 0.92 MPix，
 * 這台桌面 1707×1067 @ DPR 1.5 是 3.9 MPix —— 差 4.2 倍，而這個場景是
 * 填充率吃重的（貼地平線的海面、半透明的螺旋槳圓盤）。
 */
async function pass(
  label: string,
  opts: {
    readonly unlockVsync: boolean
    readonly width: number
    readonly height: number
    readonly dpr: number
    /** 只跑座艙纏鬥那一場。填充率消融用 —— 要比的是同一個場景 */
    readonly dogfightOnly?: boolean
    /**
     * 打哪一場。預設是遭遇戰（群島）。
     *
     * 【為什麼要能選洛伊納】遭遇戰的地形是群島，**根本不會建廠區那顆網格**
     * —— 拿它量出來的數字裡沒有三十幾萬個三角形的佈景，而那正是要量的東西。
     */
    readonly scene?: 'skirmish' | 'leuna'
  },
): Promise<void> {
  console.log(`\n\n════ ${label} ════`)
  console.log(`  ${opts.width}×${opts.height} @ DPR ${opts.dpr}`
    + `（後備緩衝 ${Math.round(opts.width * opts.dpr)}×${Math.round(opts.height * opts.dpr)}）`
    + `　vsync ${opts.unlockVsync ? '解鎖' : '鎖定'}`)
  const browser = await chromium.launch({
    headless: false,
    args: [...NO_THROTTLE, ...(opts.unlockVsync ? NO_VSYNC : [])],
  })
  try {
    const page = await browser.newPage({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: opts.dpr,
    })
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(URL)
    await page.click('[data-act="start"]')
    if (opts.scene === 'leuna') {
      // 【等元素，不要等時間】任務頁是三層（陣營 → 航線 → 簡報），
      // 每一層的按鈕都是進了上一層才生出來的
      await page.click('[data-act="mission"]')
      // 【點完要等一下】畫面切換有過場，元素出現的那一刻點下去會落空 ——
      // 而落空的症狀是下一層的按鈕永遠等不到
      const step = async (sel: string): Promise<void> => {
        await page.waitForSelector(sel, { state: 'visible' })
        await page.waitForTimeout(400)
        await page.click(sel)
      }
      await step('#campaign-cards button[data-campaign="allies"]')
      await step('#route .stop[data-mission="allies-m2"]')
      await step('#brief-go')
    } else {
      await page.click('[data-act="skirmish"]')
      await page.click('#skirmish [data-act="fight"]')
    }

    // 【暖機一定要單獨量而不是丟掉】著色器編譯、材質上傳、第一批粒子的
    // 池子配置都在開頭幾秒，而玩家**也會經歷那幾秒**。把它算進穩態會污染
    // 統計，直接丟掉又等於假裝進場很順 —— 所以分開報。
    if (opts.dogfightOnly !== true) report('進場暖機（開戰後 0–6 s）', await record(page, 6))

    // 代飛。玩家那一架交給 AI，會真的纏鬥、真的開火 —— 曳光彈、火花、
    // 煙、命中閃光全部在這條路徑上。這是實際遊玩最重的常態負載
    await page.keyboard.press('KeyI')
    await page.waitForTimeout(opts.dogfightOnly === true ? 8000 : 2000)
    report('座艙纏鬥（代飛，25 s）', await record(page, 25))

    if (opts.dogfightOnly !== true) {
      // 上帝視角爬到高空：可見三角形最多的狀態（整片遠海 + 全部單位）
      await page.keyboard.press('KeyG')
      await page.waitForTimeout(1000)
      await page.keyboard.down('ShiftLeft')
      await page.keyboard.down('KeyE')
      await page.waitForTimeout(6000)
      await page.keyboard.up('KeyE')
      await page.keyboard.up('ShiftLeft')
      await page.waitForTimeout(1000)
      report('上帝視角高空（15 s）', await record(page, 15))
    }

    // 場景規模的旁證。1% low 難看時，先看是不是 draw call 爆掉
    const info = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('canvas:not(#hud)')
      const gl = c?.getContext('webgl2') ?? c?.getContext('webgl') ?? null
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info') ?? null
      return {
        renderer: dbg === null || gl === null
          ? '（讀不到）'
          : String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)),
        dpr: window.devicePixelRatio,
        buffer: c === null ? '（讀不到）' : `${c.width}×${c.height}`,
      }
    })
    console.log(`\n  顯示卡    ${info.renderer}`)
    console.log(`  實際 DPR  ${info.dpr.toFixed(2)}　canvas 後備 ${info.buffer}`)
    console.log(`  console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('    ' + e)
  } finally {
    await browser.close()
  }
}

/** 消融要逐一關掉的繪製層。名字對應 `main.ts` 的 `__gfx` 出口 */
const ABLATE = [
  'farSea', 'nearSea', 'sky', 'islands', 'propDisc', 'particles', 'tracers', 'vortex',
] as const

/**
 * **逐層消融**：關掉一層、量一段、開回來，看幀時間差多少。
 *
 * 【為什麼全部在同一場、同一個瀏覽器裡跑完】重開一場會換一批出生位置與
 * 一批新的亂數，那個差異足以蓋過要量的東西。同一場連續量，唯一變的就是
 * 那一層開或關。
 *
 * 【頭尾各量一次基準線，缺一不可】戰鬥會演進 —— 有人被打下來、有人冒煙、
 * 距離拉開。基準線若從頭到尾漂了一大截，中間那些比較全部不算數，而沒有
 * 第二次基準線就看不出漂了沒有。
 */
async function ablation(): Promise<void> {
  console.log('\n\n════ 逐層消融（解鎖 vsync，1707×960 @ DPR 1.5）════')
  const browser = await chromium.launch({ headless: false, args: [...NO_THROTTLE, ...NO_VSYNC] })
  try {
    const page = await browser.newPage({
      viewport: { width: 1707, height: 960 },
      deviceScaleFactor: 1.5,
    })
    await page.goto(URL)
    await page.click('[data-act="start"]')
    await page.click('[data-act="skirmish"]')
    await page.click('#skirmish [data-act="fight"]')
    await page.keyboard.press('KeyI')          // 代飛
    await page.waitForTimeout(8000)            // 暖機：著色器編譯與粒子池配置

    const known = await page.evaluate(() =>
      (window as unknown as Record<string, (p: Record<string, boolean>) => { known: string[] }>)
        ['__gfx']!({}).known)
    console.log(`  可關的層：${known.join(', ')}`)

    const WINDOW = 12
    const rows: { readonly name: string; readonly p50: number; readonly worst1: number }[] = []
    const measure = async (name: string) => {
      const s = await record(page, WINDOW)
      rows.push({ name, p50: s.p50, worst1: s.worst1 })
      console.log(`  ${name.padEnd(14)} p50 ${s.p50.toFixed(2).padStart(6)} ms`
        + `   1% low ${s.worst1.toFixed(2).padStart(6)} ms`
        + `   頓挫 ${(s.hitches / s.seconds).toFixed(2)}/s`)
    }
    const gfx = async (patch: Record<string, boolean>) => {
      await page.evaluate((p) =>
        (window as unknown as Record<string, (q: Record<string, boolean>) => unknown>)['__gfx']!(p),
        patch)
      await page.waitForTimeout(800)
    }

    await measure('基準線·前')
    for (const t of ABLATE) {
      await gfx({ [t]: false })
      await measure(`關 ${t}`)
      await gfx({ [t]: true })
    }
    await measure('基準線·後')

    // 【用兩條基準線的平均當比較基準】漂移是實際存在的，取平均比取任一條
    // 誠實；漂移量本身也印出來，讀者才判斷得出這一輪可不可信
    const first = rows[0]!
    const last = rows[rows.length - 1]!
    const base50 = (first.p50 + last.p50) / 2
    const base1 = (first.worst1 + last.worst1) / 2
    console.log(`\n  基準線漂移  p50 ${first.p50.toFixed(2)} → ${last.p50.toFixed(2)} ms`
      + `（${(((last.p50 - first.p50) / first.p50) * 100).toFixed(1)}%）`
      + `　1% low ${first.worst1.toFixed(2)} → ${last.worst1.toFixed(2)} ms`)
    console.log('\n  ── 關掉之後省下多少（正數 = 這一層在吃）──')
    for (const r of rows.slice(1, -1)) {
      const d50 = base50 - r.p50
      const d1 = base1 - r.worst1
      console.log(`  ${r.name.padEnd(14)} p50 −${d50.toFixed(2).padStart(6)} ms `
        + `(${((d50 / base50) * 100).toFixed(1).padStart(5)}%)`
        + `   1% low −${d1.toFixed(2).padStart(6)} ms `
        + `(${((d1 / base1) * 100).toFixed(1).padStart(5)}%)`)
    }
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  // 【一】玩家真的看到的。桌面 1707×1067 扣掉瀏覽器上緣，DPR 1.5
  await pass('玩家實境（鎖 vsync）', { unlockVsync: false, width: 1707, height: 960, dpr: 1.5 })
  // 【二】同一個場景解鎖 vsync：真實工作量與餘裕。鎖著量不出離掉幀還有多少餘裕
  await pass('解鎖 vsync（量餘裕）', { unlockVsync: true, width: 1707, height: 960, dpr: 1.5 })
  // 【三】填充率消融：同一場景只把像素數砍成 1/9。幀時間跟著掉 = GPU 吃緊，
  // 幾乎不動 = CPU 吃緊。實測的答案是前者（頓挫 5.64/s → 0.08/s）
  await pass('填充率消融 DPR 0.5（解鎖 vsync）',
    { unlockVsync: true, width: 1707, height: 960, dpr: 0.5, dogfightOnly: true })
  // 【三之二】洛伊納：三十幾萬個三角形的廠區佈景是這張圖獨有的負載，
  // 遭遇戰那三輪一個三角形都量不到
  await pass('洛伊納廠區上空（解鎖 vsync）',
    { unlockVsync: true, width: 1707, height: 960, dpr: 1.5, scene: 'leuna' })
  // 【四】填充率確定是瓶頸之後，逐層歸因到「是哪一層在畫」
  await ablation()
}

main().catch((e: unknown) => {
  console.error(e)
  throw e
})
