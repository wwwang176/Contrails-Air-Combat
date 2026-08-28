/**
 * **海面佔多少幀時間**：消融 `nearSea` / `farSea`，量在真實遊玩的迴圈上。
 *
 * ```
 * node node_modules/vite/bin/vite.js --port 5178                          # 終端機一
 * node node_modules/vite-node/vite-node.mjs test/e2e/ocean-cost.e2e.ts    # 終端機二
 * ```
 *
 * ── 【兩條走不通的路，留著免得下一個人再走一次】────────────────
 *
 * **一、不能用 `__still` 凍結畫面。** 暫停時主迴圈只呼叫 `render()`，而
 * `render()` 只是把命令丟進佇列就回來 —— JS 於是一路跑在 GPU 前面，量到
 * 0.6 ms（1,667 FPS），而同一個場景在戰鬥中是 21 ms（48 FPS）。
 * **在回呼裡加 `gl.finish()` 也沒有用**，實測數字不動。要在凍結的畫面上量
 * GPU 得用 `EXT_disjoint_timer_query_webgl2`，而 Chrome 預設不給。
 *
 * **二、不能一層量一次就走。** 戰鬥會演進、鏡頭在動，而海面佔畫面的比例
 * 正是要量的自變數。第一版量到基準線在一輪之內漂 **44%**（21.0 → 11.7 ms），
 * 比要量的效應還大 —— `關 farSea` 甚至量到負的 −11%。
 *
 * ── 【所以用交錯配對】────────────────────────────────────
 *
 * 基準 → 關 → 基準 → 關 …，每一筆「關」配它**前後兩條基準線的平均**。
 * 漂移是連續的，配對之後就抵銷掉；重複三輪再取中位數，單一輪的意外也擋掉。
 *
 * **朝天那一組是對照組** —— 海幾乎不在畫面裡，省下的錢必須接近零。
 * 不是的話就是這支探針在量別的東西。
 *
 * 【一定要有頭】無頭 chromium 走 SwiftShader 軟體算圖，量到的是 CPU 模擬
 * GPU 的速度，與填充率沒有關係。
 *
 * 【一定要解鎖 vsync】鎖著的話幀間隔恆為刷新週期的整數倍，省下的幾毫秒會被
 * 吸進同一格，讀起來像「這一層不花錢」。
 */
import { chromium, type Browser, type Page } from 'playwright'

const URL = 'http://localhost:5178/'
const NO_THROTTLE = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]
const NO_VSYNC = ['--disable-gpu-vsync', '--disable-frame-rate-limit']

interface S { readonly p50: number; readonly worst1: number; readonly n: number }

async function record(page: Page, seconds: number): Promise<S> {
  return page.evaluate((sec: number) => new Promise<S>((resolve) => {
    const stamps: number[] = []
    const t0 = performance.now()
    const tick = (t: number): void => {
      stamps.push(t)
      if (performance.now() - t0 < sec * 1000) { requestAnimationFrame(tick); return }
      const f: number[] = []
      // 【第一筆丟掉】第一個間隔是「安裝探針的那一刻」到「下一幀」
      for (let i = 2; i < stamps.length; i++) f.push(stamps[i]! - stamps[i - 1]!)
      f.sort((a, b) => a - b)
      const n = f.length
      const k = Math.max(1, Math.floor(n * 0.01))
      let s = 0
      for (let i = n - k; i < n; i++) s += f[i]!
      resolve({ p50: f[Math.min(n - 1, Math.round(0.5 * (n - 1)))]!, worst1: s / k, n })
    }
    requestAnimationFrame(tick)
  }), seconds)
}

const gfx = async (page: Page, patch: Record<string, boolean>): Promise<void> => {
  await page.evaluate((p) =>
    (window as unknown as Record<string, (q: Record<string, boolean>) => unknown>)['__gfx']!(p), patch)
  await page.waitForTimeout(400)
}

async function open(browser: Browser, dpr: number, altitude: string): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width: 1707, height: 960 }, deviceScaleFactor: dpr,
  })
  await page.goto(URL)
  await page.click('[data-act="start"]')
  await page.click('[data-act="skirmish"]')
  await page.click('#terrain-pick button:text-is("純海面")')
  await page.click(`#altitude-pick button:text-is("${altitude}")`)
  await page.click('#skirmish [data-act="fight"]')
  await page.keyboard.press('KeyI')          // 代飛
  await page.waitForTimeout(12000)           // 暖機：著色器編譯、材質上傳、粒子池
  return page
}

const WINDOW = 5
const REPS = 3
const SEA: readonly (readonly string[])[] = [['nearSea'], ['farSea'], ['nearSea', 'farSea']]

/** 一個鏡頭情境跑完整套交錯配對 */
async function scene(page: Page, title: string): Promise<void> {
  console.log(`\n──── ${title} ────`)
  const saved = new Map<string, number[]>()
  const saved1 = new Map<string, number[]>()
  const bases: number[] = []
  for (let r = 0; r < REPS; r++) {
    for (const group of SEA) {
      const key = group.join('+')
      const before = await record(page, WINDOW)
      const off: Record<string, boolean> = {}
      for (const l of group) off[l] = false
      await gfx(page, off)
      const s = await record(page, WINDOW)
      const on: Record<string, boolean> = {}
      for (const l of group) on[l] = true
      await gfx(page, on)
      const after = await record(page, WINDOW)
      const base = (before.p50 + after.p50) / 2
      const base1 = (before.worst1 + after.worst1) / 2
      bases.push(base)
      if (!saved.has(key)) { saved.set(key, []); saved1.set(key, []) }
      saved.get(key)!.push(base - s.p50)
      saved1.get(key)!.push(base1 - s.worst1)
    }
  }
  const mid = (a: number[]): number => a.slice().sort((x, y) => x - y)[(a.length / 2) | 0]!
  const baseline = mid(bases)
  console.log(`  基準線中位 ${baseline.toFixed(2)} ms（${(1000 / baseline).toFixed(0)} FPS）`
    + `　全部配對的基準散布 ${Math.min(...bases).toFixed(2)}~${Math.max(...bases).toFixed(2)} ms`)
  for (const group of SEA) {
    const key = group.join('+')
    const d = saved.get(key)!
    const d1 = saved1.get(key)!
    console.log(`  關 ${key.padEnd(15)} 省 p50 ${mid(d).toFixed(2).padStart(6)} ms `
      + `(${((mid(d) / baseline) * 100).toFixed(1).padStart(5)}%)   `
      + `1% low ${mid(d1).toFixed(2).padStart(6)} ms   `
      + `三輪各 ${d.map((v) => v.toFixed(1)).join(' / ')}`)
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false, args: [...NO_THROTTLE, ...NO_VSYNC] })
  try {
    // 【一】座艙 · 中空 4,000 m（遭遇戰預設），DPR 1.5 —— 玩家真的看到的
    {
      const page = await open(browser, 1.5, '中空')
      await scene(page, '座艙 · 中空 4,000 m · DPR 1.5')
      await page.close()
    }
    // 【二】座艙 · 甲板 600 m —— 貼海飛，近海佔畫面最多
    {
      const page = await open(browser, 1.5, '甲板')
      await scene(page, '座艙 · 甲板 600 m · DPR 1.5')
      await page.close()
    }
    // 【三】上帝視角高空 —— 遠海鋪滿畫面，而且鏡頭不動（漂移最小的一組）
    {
      const page = await open(browser, 1.5, '中空')
      await page.keyboard.press('KeyG')
      await page.waitForTimeout(1000)
      await page.keyboard.down('ShiftLeft')
      await page.keyboard.down('KeyE')
      await page.waitForTimeout(6000)
      await page.keyboard.up('KeyE')
      await page.keyboard.up('ShiftLeft')
      await page.waitForTimeout(1500)
      await scene(page, '上帝視角高空 · DPR 1.5')
      await page.close()
    }
    // 【四】同一個場景砍成 1/9 像素。省下的錢若跟著等比縮小 = 純填充率
    {
      const page = await open(browser, 0.5, '中空')
      await scene(page, '座艙 · 中空 4,000 m · DPR 0.5（1/9 像素）')
      await page.close()
    }
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => { console.error(e); throw e })
