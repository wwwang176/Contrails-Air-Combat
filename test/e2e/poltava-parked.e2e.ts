/**
 * **波爾塔瓦機場上那 24 架停放的 B-17 值多少幀時間**。同一輪、同一個機位，
 * 只把那一種地面目標藏起來再顯示回來。
 *
 * ```
 * npx vite --port 5200 --strictPort               # 終端機一
 * npx vite-node test/e2e/poltava-parked.e2e.ts    # 終端機二
 * ```
 *
 * 【為什麼可以在同一輪裡前後比】藏／顯示是即時的，中間不必等任何東西長出來
 * ——所以場景的其他部分（探照燈、任務時鐘）在兩段之間幾乎沒變。這與煙那一題
 * 不同：那邊要等煙堆起來，時間一拉長場景就漂了，只好分成兩輪跑同一條時間軸。
 *
 * 【頭尾各一次「有飛機」】驅動與熱度會漂。沒有第二條基準就分不出「省下來的」
 * 與「這一段剛好比較快」。
 *
 * 【量測之前一定要重新套一次鏡頭座標】上帝鏡頭帶慣性，設完座標等十幾秒它就
 * 飄走了 —— 症狀是截圖只有天空，而幀時間看起來仍然「合理」，因為遠景環與
 * 幾個 `frustumCulled = false` 的池照畫不誤。踩過兩次。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5200/'
const SHOTS = '.shots/parked/'

const NO_THROTTLE = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]
const NO_VSYNC = ['--disable-gpu-vsync', '--disable-frame-rate-limit']

/** 機場中心（`world/poltava.ts` 的 `FIELD_CENTER`） */
const FIELD = { x: 0, z: -7000 }

interface Cam {
  readonly name: string
  readonly x: number
  readonly y: number
  readonly z: number
  readonly yaw: number
  readonly pitch: number
}

/** 投彈高度是這一關的常態視角；低空是玩家拉起來時看到的 */
const CAMS: readonly Cam[] = [
  { name: '投彈高度', x: FIELD.x, y: 1500, z: FIELD.z + 1900, yaw: 0, pitch: -38 },
  { name: '低空進場', x: FIELD.x, y: 350, z: FIELD.z + 1400, yaw: 0, pitch: -14 },
]

interface Shot {
  readonly meanMs: number
  readonly calls: number
  readonly tris: number
}

async function measure(page: import('playwright').Page, seconds: number): Promise<Shot> {
  return page.evaluate((sec: number) => new Promise<Shot>((resolve) => {
    let frames = 0
    const startedAt = performance.now()
    const tick = (): void => {
      frames++
      const dt = performance.now() - startedAt
      if (dt < sec * 1000) { requestAnimationFrame(tick); return }
      const el = Array.from(document.querySelectorAll('div'))
        .find((d) => (d.textContent ?? '').startsWith('FPS'))
      const lines = (el?.textContent ?? '').split('\n')
      const num = (prefix: string): number => {
        const l = lines.find((x) => x.startsWith(prefix))
        return l === undefined ? Number.NaN : parseFloat(l.slice(prefix.length).trim())
      }
      resolve({ meanMs: dt / frames, calls: num('draw call'), tris: num('triangles') })
    }
    requestAnimationFrame(tick)
  }), seconds)
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false, args: [...NO_THROTTLE, ...NO_VSYNC] })
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
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
    // 【飛行中的飛機關掉】八架 He 111 自己就貢獻上百個 draw call，那是另一題
    await page.evaluate(() =>
      (window as unknown as Record<string, (p: Record<string, boolean>) => unknown>)['__gfx']!(
        { aircraft: false }))

    const kinds = await page.evaluate(() =>
      (window as unknown as Record<string, (id?: string) => { kinds: string[] }>)['__hideGround']!())
    console.log('==== 波爾塔瓦：停放的 B-17 值多少（1280x720 @ DPR 1）====')
    console.log(`  場上的地面目標種類：${kinds.kinds.join('、')}`)

    const aim = async (c: Cam): Promise<void> => {
      await page.evaluate(([x, y, z, yaw, pitch]) =>
        (window as unknown as Record<string, (...v: number[]) => unknown>)['__godcam']!(
          x!, y!, z!, yaw!, pitch!), [c.x, c.y, c.z, c.yaw, c.pitch])
      await page.waitForTimeout(1500)
    }
    const hide = async (id?: string): Promise<number> => {
      const r = await page.evaluate((k: string | null) =>
        (window as unknown as Record<string, (i?: string) => { hidden: number }>)['__hideGround']!(
          k === null ? undefined : k), id ?? null)
      await page.waitForTimeout(600)
      return r.hidden
    }

    for (const c of CAMS) {
      await aim(c)
      await hide()
      const on1 = await measure(page, 10)
      await page.screenshot({ path: `${SHOTS}${c.name}-有.png` })

      await aim(c)
      const n = await hide('parkedB17')
      await page.screenshot({ path: `${SHOTS}${c.name}-無.png` })
      const off = await measure(page, 10)

      await aim(c)
      await hide()
      const on2 = await measure(page, 10)

      const base = (on1.meanMs + on2.meanMs) / 2
      console.log(`\n  ── ${c.name}（高 ${c.y} m）──　藏了 ${n} 架`)
      console.log(`  有 B-17　${on1.meanMs.toFixed(2)} / ${on2.meanMs.toFixed(2)} ms`
        + `　基準 ${base.toFixed(2)} ms（${(1000 / base).toFixed(0)} FPS）`
        + `　draw call ${on1.calls.toFixed(0)}　三角形 ${on1.tris.toLocaleString()}`)
      console.log(`  沒 B-17　${off.meanMs.toFixed(2)} ms（${(1000 / off.meanMs).toFixed(0)} FPS）`
        + `　draw call ${off.calls.toFixed(0)}　三角形 ${off.tris.toLocaleString()}`)
      console.log(`  → 那 24 架值 ${(base - off.meanMs).toFixed(2)} ms`
        + `（${(((base - off.meanMs) / base) * 100).toFixed(0)}%）`
        + `　少 ${(on1.tris - off.tris).toLocaleString()} 個三角形`
        + `　基準漂 ${(((on2.meanMs - on1.meanMs) / on1.meanMs) * 100).toFixed(1)}%`)
    }
    console.log(`\n  截圖在 ${SHOTS} —— 先確認「有」那張真的看得到飛機`)
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => { console.error(e); throw e })
