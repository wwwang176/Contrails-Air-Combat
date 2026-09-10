/**
 * **德 M2（波爾塔瓦之夜）：彈幕值多少幀時間**。兩輪走**完全相同的時間軸**，
 * 差別只有其中一輪持續投彈。
 *
 * ```
 * npx vite --port 5200 --strictPort              # 終端機一
 * npx vite-node test/e2e/poltava-smoke.e2e.ts    # 終端機二
 * ```
 *
 * 【為什麼不能在同一輪裡前後比】這一關的場景會隨任務時鐘變：探照燈開合、
 * 照明彈在 80 秒才投下、飛機進出視野。實測同一輪的「前」與「後」draw call
 * 從 96 掉到 38 —— 那個差不是煙造成的，而拿它相減會得到負的成本。
 *
 * 【量測視窗裡不截圖】`page.screenshot` 會讓那一幀同步等待，疊層的移動平均
 * 因此被拉高。截圖排在量測之外。
 *
 * 【疊層的 FPS 與牆鐘的都要印】疊層量的是 rAF 回呼裡的 CPU 工作，不含等
 * vsync 與 GPU 繪製。玩家看到的是疊層那一個。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5200/'
const SHOTS = '.shots/poltava/'

const NO_THROTTLE = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]
const NO_VSYNC = ['--disable-gpu-vsync', '--disable-frame-rate-limit']

/** 機場中心，世界座標（`world/poltava.ts` 的 `FIELD_CENTER`） */
const FIELD = { x: 0, z: -7000 }
/** 八架 He 111，一架八枚 */
const BOMBS = 64
/** 鏡頭：低空穿越機場，那是玩家投完彈拉起來時看到的 */
const CAM = { x: FIELD.x, y: 200, z: FIELD.z + 500, yaw: 0, pitch: -6 }

interface Shot {
  readonly meanMs: number
  readonly p95: number
  readonly cpu: number
  readonly calls: number
  readonly tris: number
}

async function measure(page: import('playwright').Page, seconds: number): Promise<Shot> {
  return page.evaluate((sec: number) => new Promise<Shot>((resolve) => {
    const stamps: number[] = []
    const startedAt = performance.now()
    const tick = (t: number): void => {
      stamps.push(t)
      const dt = performance.now() - startedAt
      if (dt < sec * 1000) { requestAnimationFrame(tick); return }
      const f: number[] = []
      for (let i = 2; i < stamps.length; i++) f.push(stamps[i]! - stamps[i - 1]!)
      f.sort((a, b) => a - b)
      const el = Array.from(document.querySelectorAll('div'))
        .find((d) => (d.textContent ?? '').startsWith('FPS'))
      const lines = (el?.textContent ?? '').split('\n')
      const num = (prefix: string): number => {
        const l = lines.find((x) => x.startsWith(prefix))
        return l === undefined ? Number.NaN : parseFloat(l.slice(prefix.length).trim())
      }
      resolve({
        meanMs: dt / f.length,
        p95: f[Math.round(0.95 * (f.length - 1))]!,
        cpu: num('frame'),
        calls: num('draw call'),
        tris: num('triangles'),
      })
    }
    requestAnimationFrame(tick)
  }), seconds)
}

/**
 * `clean` 什麼都不做、`bombs` 只投彈、`full` 投彈並點燃每一個地面目標。
 *
 * 【為什麼要分出 `full`】只投彈的話畫面上是**有火沒有升起的煙**：`LAND_BLAST`
 * 每顆彈生 31 團煙，每 400 ms 投 64 顆就是每秒 4,960 團，而 `blastSmoke` 池
 * 只有 2048 —— 煙還沒升起就被下一輪蓋掉。真正會長成柱子的煙來自目標被炸毀
 * 時點燃的地面火（`shipFireSmoke`，容量 16384、燒 60 秒），而那要目標真的死掉。
 */
type Mode = 'clean' | 'bombs' | 'full'

async function pass(dpr: number, mode: Mode): Promise<Shot> {
  const browser = await chromium.launch({ headless: false, args: [...NO_THROTTLE, ...NO_VSYNC] })
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: dpr,
    })
    await page.goto(URL)
    await page.click('[data-act="start"]')
    await page.click('[data-act="mission"]')
    const step = async (sel: string): Promise<void> => {
      await page.waitForSelector(sel, { state: 'visible' })
      await page.waitForTimeout(400)
      await page.click(sel)
    }
    await step('#campaign-cards button[data-campaign="germany"]')
    await step('#route .stop[data-mission="germany-m2"]')
    await step('#brief-go')
    await page.waitForTimeout(3000)
    await page.keyboard.press('KeyG')
    await page.waitForTimeout(2000)
    // 【飛機關掉】八架 He 111 自己就貢獻上百個 draw call，那是另一件事
    await page.evaluate(() =>
      (window as unknown as Record<string, (p: Record<string, boolean>) => unknown>)['__gfx']!(
        { aircraft: false }))
    await page.evaluate(([x, y, z, yaw, pitch]) =>
      (window as unknown as Record<string, (...v: number[]) => unknown>)['__godcam']!(
        x!, y!, z!, yaw!, pitch!), [CAM.x, CAM.y, CAM.z, CAM.yaw, CAM.pitch])
    await page.waitForTimeout(3000)

    if (mode === 'full') {
      // 【火先點】柱子要十幾秒才爬得起來，等一下投彈的時候才是「一堆火加
      // 一堆煙」的狀態
      await page.evaluate(() =>
        (window as unknown as Record<string, (n: number, s: number, f: boolean) => unknown>)
          ['__bombs']!(0, 250, true))
    }
    if (mode !== 'clean') {
      await page.evaluate(([n, s, everyMs]) => {
        const w = window as unknown as Record<string, unknown>
        w['__wallTimer'] = setInterval(() => {
          (w['__bombs'] as (b: number, sp: number) => unknown)(n!, s!)
        }, everyMs!)
      }, [BOMBS, 250, 400])
    }
    // 【三種模式的時間軸要逐秒相同】這一關的場景隨任務時鐘變（探照燈開合、
    // 照明彈在 80 秒投下），差幾秒就不是同一個場景
    await page.waitForTimeout(16000)

    // 【量測之前一定要重新套一次座標】上帝鏡頭帶慣性，等十幾秒之後它已經飄
    // 走了 —— 症狀是截圖只有天空，而幀時間看起來仍然「合理」，因為遠景環與
    // 幾個 `frustumCulled = false` 的池照畫不誤
    await page.evaluate(([x, y, z, yaw, pitch]) =>
      (window as unknown as Record<string, (...v: number[]) => unknown>)['__godcam']!(
        x!, y!, z!, yaw!, pitch!), [CAM.x, CAM.y, CAM.z, CAM.yaw, CAM.pitch])
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${SHOTS}dpr${dpr}-${mode}-aim.png` })

    const s = await measure(page, 12)
    await page.screenshot({ path: `${SHOTS}dpr${dpr}-${mode}.png` })
    return s
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  console.log('==== 德 M2 波爾塔瓦之夜：彈幕的成本（1280x720，兩輪同一條時間軸）====')
  for (const dpr of [1, 0.5]) {
    const clean = await pass(dpr, 'clean')
    const bombs = await pass(dpr, 'bombs')
    const full = await pass(dpr, 'full')
    console.log(`\n  ── DPR ${dpr} ──`)
    const row = (n: string, s: Shot) =>
      console.log(`  ${n.padEnd(10)} 牆鐘 ${s.meanMs.toFixed(2).padStart(6)} ms`
        + `（${(1000 / s.meanMs).toFixed(0).padStart(3)} FPS）`
        + `　p95 ${s.p95.toFixed(2).padStart(6)} ms`
        + `　疊層 ${s.cpu.toFixed(2).padStart(6)} ms`
        + `　差 ${(s.meanMs - clean.meanMs).toFixed(2).padStart(6)} ms`)
    row('沒事發生', clean)
    row('只投彈', bombs)
    row('投彈＋整場燒', full)
  }
  console.log(`\n  截圖在 ${SHOTS}`)
}

main().catch((e: unknown) => { console.error(e); throw e })
