/**
 * **飛行中的 B-17 換低模值多少幀時間**。兩輪走完全相同的流程與機位，
 * 差別只有 `__FLYING_LOD` 開或關。
 *
 * ```
 * npx vite --port 5200 --strictPort                 # 終端機一
 * npx vite-node test/e2e/b17-flight-lod.e2e.ts      # 終端機二
 * ```
 *
 * 【要挑有飛行中 B-17 的關】德 M2 的 B-17 全部停在地上，量出來兩輪的三角形
 * 一模一樣。德 M1 是攔截，玩家開 Bf 109、對面一整隊 B-17 在飛。
 *
 * 【要對著轟炸機編隊量】上帝鏡頭放在編隊形心後上方約 400 m —— 那個距離全隊
 * 都在門檻（200 m）之外，換得到；貼到 100 m 的話整隊跳回正式模型，量到的是零。
 *
 * 【地面單位一起關掉】`__hideGround` 把地面那批拿掉，不然它們的三角形會蓋過
 * 飛行那批的差。
 *
 * 【頭尾各一次正式模型】驅動與熱度會漂。沒有第二條基準就分不出「省下來的」
 * 與「這一輪剛好比較快」。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5200/'
const SHOTS = '.shots/flightlod/'

const NO_THROTTLE = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]
const NO_VSYNC = ['--disable-gpu-vsync', '--disable-frame-rate-limit']

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
        (globalThis as Record<string, unknown>)['__FLYING_LOD'] = false
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
    await step('#route .stop[data-mission="germany-m1"]')
    await step('#brief-go')
    await page.waitForTimeout(4000)
    await page.keyboard.press('KeyG')
    await page.waitForTimeout(1500)
    await page.evaluate(() =>
      (window as unknown as Record<string, () => unknown>)['__hideGround']!())

    // 【鏡頭跟著編隊走】轟炸機一路往目標飛，寫死座標的話量到一半它們就飛出
    // 畫面。取隊上第一架轟炸機的位置，退到它後上方
    const place = async (): Promise<{ n: number; x: number; z: number } | null> =>
      page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>
        const seats = w['__seats'] as
          (() => { id: string; alive: boolean; x: number; y: number; z: number }[]) | undefined
        const cam = w['__godcam'] as ((...v: number[]) => unknown) | undefined
        if (seats === undefined || cam === undefined) return null
        const bombers = seats().filter((s) => s.id === 'b17g' && s.alive)
        if (bombers.length === 0) return null
        const mid = bombers.reduce((a, s) => ({ x: a.x + s.x / bombers.length,
          y: a.y + s.y / bombers.length, z: a.z + s.z / bombers.length }),
        { x: 0, y: 0, z: 0 })
        // 【由正上方俯瞰】斜著擺要猜偏航角的方向，猜錯就是對著空海量 ——
        // 症狀是兩輪的三角形一模一樣。垂直往下看，偏航角怎麼設都對得到，
        // 而 400 m 也在門檻（200 m）之外
        cam(mid.x, mid.y + 400, mid.z, 0, -85)
        return { n: bombers.length, x: mid.x, z: mid.z }
      })
    const at = await place()
    await page.waitForTimeout(1200)
    await place()
    await page.waitForTimeout(800)

    const s: Shot = await page.evaluate((sec: number) => new Promise<Shot>((resolve) => {
      const w = window as unknown as Record<string, unknown>
      const seats = w['__seats'] as
        (() => { id: string; alive: boolean; x: number; y: number; z: number }[])
      const cam = w['__godcam'] as (...v: number[]) => unknown
      // 【逐幀重新對準】轟炸機以 110 m/s 飛行，鏡頭釘死的話 10 秒的量測窗裡
      // 它們早就飛出畫面 —— 症狀是兩輪的三角形一模一樣（沒進視錐就不計）
      const aim = (): void => {
        const bs = seats().filter((x) => x.id === 'b17g' && x.alive)
        if (bs.length === 0) return
        let mx = 0
        let my = 0
        let mz = 0
        for (const b of bs) { mx += b.x / bs.length; my += b.y / bs.length; mz += b.z / bs.length }
        cam(mx, my + 300, mz, 0, -85)
      }
      let frames = 0
      const startedAt = performance.now()
      const tick = (): void => {
        frames++
        aim()
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
    }), 10)
    const state = await page.evaluate(() =>
      (window as unknown as Record<string, () => unknown>)['__lod']!())
    await page.screenshot({ path: `${SHOTS}${label}.png` })
    if (at === null) console.log('    場上沒有活著的 B-17，鏡頭沒有擺對')
    else console.log(`    ${label}：對著 ${at.n} 架轟炸機　LOD ${JSON.stringify(state)}`)
    if (errors.length > 0) console.log(`    錯誤：${errors[0]!.slice(0, 200)}`)
    return s
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  console.log('==== 飛行中的 B-17 換低模（德 M1 攔截，編隊正上方 300 m，1280x720）====')
  const a = await pass(false, '正式-前')
  const b = await pass(true, '低模')
  const c = await pass(false, '正式-後')
  const base = (a.meanMs + c.meanMs) / 2
  const row = (n: string, s: Shot): void =>
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
