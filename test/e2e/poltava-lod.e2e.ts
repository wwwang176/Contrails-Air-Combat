/**
 * **停放的 B-17 換成低模值多少幀時間**。兩輪走完全相同的流程與機位，
 * 差別只有 `__PARKED_LOD` 開或關。
 *
 * ```
 * npx vite --port 5200 --strictPort              # 終端機一
 * npx vite-node test/e2e/poltava-lod.e2e.ts      # 終端機二
 * ```
 *
 * 【`__PARKED_LOD` 要在建地形之前設好】地面單位的幾何是進場時烘一次的，
 * 所以走 `addInitScript` 而不是 `evaluate`。
 *
 * 【頭尾各一次正式模型】驅動與熱度會漂。沒有第二條基準就分不出「省下來的」
 * 與「這一輪剛好比較快」。
 *
 * 【量測之前重新套一次鏡頭座標】上帝鏡頭帶慣性，設完座標等十幾秒它就飄走
 * —— 症狀是截圖只有天空，而幀時間看起來仍然「合理」。踩過兩次。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5200/'
const SHOTS = '.shots/lodrun/'

const NO_THROTTLE = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]
const NO_VSYNC = ['--disable-gpu-vsync', '--disable-frame-rate-limit']

/** 機場中心（`world/poltava.ts` 的 `FIELD_CENTER`） */
const FIELD = { x: 0, z: -7000 }
/** 與 `poltava-parked.e2e.ts` 的「投彈高度」逐字相同，數字才比得起來 */
const CAM = { x: FIELD.x, y: 1500, z: FIELD.z + 1900, yaw: 0, pitch: -38 }

interface Shot {
  readonly meanMs: number
  readonly calls: number
  readonly tris: number
}

async function pass(lod: boolean, label: string): Promise<Shot> {
  const browser = await chromium.launch({ headless: false, args: [...NO_THROTTLE, ...NO_VSYNC] })
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    if (!lod) {
      await page.addInitScript(() => {
        (globalThis as Record<string, unknown>)['__PARKED_LOD'] = false
      })
    }
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
    await page.evaluate(() =>
      (window as unknown as Record<string, (p: Record<string, boolean>) => unknown>)['__gfx']!(
        { aircraft: false }))
    await page.evaluate(([x, y, z, yaw, pitch]) =>
      (window as unknown as Record<string, (...v: number[]) => unknown>)['__godcam']!(
        x!, y!, z!, yaw!, pitch!), [CAM.x, CAM.y, CAM.z, CAM.yaw, CAM.pitch])
    await page.waitForTimeout(2500)

    const s: Shot = await page.evaluate((sec: number) => new Promise<Shot>((resolve) => {
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
    }), 12)
    await page.screenshot({ path: `${SHOTS}${label}.png` })
    if (errors.length > 0) console.log(`    錯誤：${errors[0]!.slice(0, 200)}`)
    return s
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  console.log('==== 停放的 B-17 換低模（德 M2，投彈高度 1500 m，1280x720）====')
  const a = await pass(false, '正式-前')
  const b = await pass(true, '低模')
  const c = await pass(false, '正式-後')
  const base = (a.meanMs + c.meanMs) / 2
  const row = (n: string, s: Shot) =>
    console.log(`  ${n.padEnd(8)} ${s.meanMs.toFixed(2).padStart(6)} ms`
      + `（${(1000 / s.meanMs).toFixed(0).padStart(3)} FPS）`
      + `　draw call ${s.calls.toFixed(0).padStart(3)}`
      + `　三角形 ${s.tris.toLocaleString().padStart(9)}`)
  row('正式-前', a)
  row('低模', b)
  row('正式-後', c)
  console.log(`\n  基準 ${base.toFixed(2)} ms（${(1000 / base).toFixed(0)} FPS）`
    + `　省 ${(base - b.meanMs).toFixed(2)} ms`
    + `（${(((base - b.meanMs) / base) * 100).toFixed(1)}%）`
    + `　少 ${(a.tris - b.tris).toLocaleString()} 個三角形`
    + `　基準漂 ${(((c.meanMs - a.meanMs) / a.meanMs) * 100).toFixed(1)}%`)
  console.log(`\n  截圖：${SHOTS}`)
}

main().catch((e: unknown) => { console.error(e); throw e })
