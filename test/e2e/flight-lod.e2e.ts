/**
 * **飛行中的機種換低模值多少幀時間**。每一種兩輪走完全相同的流程與機位，
 * 差別只有 `__FLYING_LOD` 開或關。
 *
 * ```
 * npx vite --port 5200 --strictPort            # 終端機一
 * npx vite-node test/e2e/flight-lod.e2e.ts     # 終端機二
 * ```
 *
 * 【要挑那個機種真的在飛的關】德 M2 的 B-17 全部停在地上，量出來兩輪的三角形
 * 一模一樣。B-17 要看德 M1（攔截），He 111 要看德 M2（玩家自己開）。
 *
 * 【逐幀重新對準】轟炸機以 110 m/s 飛行，鏡頭釘死的話 10 秒的量測窗裡它們早就
 * 飛出畫面 —— 症狀是兩輪的三角形一模一樣（沒進視錐就不計）。
 *
 * 【由正上方俯瞰】斜著擺要猜偏航角的方向，猜錯就是對著空海量。垂直往下看，
 * 偏航角怎麼設都對得到，而 300 m 也在門檻（200 m）之外。
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

interface Case {
  readonly label: string
  readonly campaign: string
  readonly mission: string
  /** 鏡頭對著這個機種的形心 */
  readonly id: string
}

const CASES: readonly Case[] = [
  { label: 'B-17G（德 M1 攔截）', campaign: 'germany', mission: 'germany-m1', id: 'b17g' },
  { label: 'He 111（德 M2 夜襲）', campaign: 'germany', mission: 'germany-m2', id: 'he111' },
]

interface Shot {
  readonly meanMs: number
  readonly calls: number
  readonly tris: number
  readonly n: number
}

async function pass(c: Case, lod: boolean, label: string): Promise<Shot> {
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
    await step(`#campaign-cards button[data-campaign="${c.campaign}"]`)
    await step(`#route .stop[data-mission="${c.mission}"]`)
    await step('#brief-go')
    await page.waitForTimeout(4000)
    await page.keyboard.press('KeyG')
    await page.waitForTimeout(1500)

    const s: Shot = await page.evaluate(([id, sec]) => new Promise<Shot>((resolve) => {
      const w = window as unknown as Record<string, unknown>
      const seats = w['__seats'] as
        (() => { id: string; alive: boolean; x: number; y: number; z: number }[])
      const cam = w['__godcam'] as (...v: number[]) => unknown
      let seen = 0
      const aim = (): void => {
        const bs = seats().filter((x) => x.id === id && x.alive)
        seen = bs.length
        if (bs.length === 0) return
        let mx = 0
        let my = 0
        let mz = 0
        for (const b of bs) { mx += b.x / bs.length; my += b.y / bs.length; mz += b.z / bs.length }
        cam(mx, my + 300, mz, 0, -85)
      }
      aim()
      let frames = 0
      let startedAt = performance.now()
      // 【前 1.5 秒不算】上帝鏡頭帶慣性，剛擺過去那幾幀還在飛過去的路上
      let warm = true
      const tick = (): void => {
        aim()
        const dt = performance.now() - startedAt
        if (warm) {
          if (dt < 1500) { requestAnimationFrame(tick); return }
          warm = false
          frames = 0
          startedAt = performance.now()
          requestAnimationFrame(tick)
          return
        }
        frames++
        if (dt < (sec as number) * 1000) { requestAnimationFrame(tick); return }
        const el = Array.from(document.querySelectorAll('div'))
          .find((d) => (d.textContent ?? '').startsWith('FPS'))
        const lines = (el?.textContent ?? '').split('\n')
        const num = (prefix: string): number => {
          const l = lines.find((x) => x.startsWith(prefix))
          return l === undefined ? Number.NaN : parseFloat(l.slice(prefix.length).trim())
        }
        resolve({
          meanMs: dt / frames, calls: num('draw call'), tris: num('triangles'), n: seen,
        })
      }
      requestAnimationFrame(tick)
    }), [c.id, 10] as [string, number])
    await page.screenshot({ path: `${SHOTS}${label}.png` })
    if (errors.length > 0) console.log(`    錯誤：${errors[0]!.slice(0, 200)}`)
    return s
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  console.log('==== 飛行中的機種換低模（編隊正上方 300 m，1280x720）====')
  for (const c of CASES) {
    console.log(`\n── ${c.label} ──`)
    const a = await pass(c, false, `${c.id}-正式-前`)
    const b = await pass(c, true, `${c.id}-低模`)
    const d = await pass(c, false, `${c.id}-正式-後`)
    const base = (a.meanMs + d.meanMs) / 2
    const row = (n: string, s: Shot): void =>
      console.log(`  ${n.padEnd(8)} ${s.meanMs.toFixed(2).padStart(6)} ms`
        + `（${(1000 / s.meanMs).toFixed(0).padStart(3)} FPS）`
        + `　draw call ${s.calls.toFixed(0).padStart(3)}`
        + `　三角形 ${s.tris.toLocaleString().padStart(9)}`
        + `　對著 ${s.n} 架`)
    row('正式-前', a)
    row('低模', b)
    row('正式-後', d)
    console.log(`  基準 ${base.toFixed(2)} ms（${(1000 / base).toFixed(0)} FPS）`
      + `　省 ${(base - b.meanMs).toFixed(2)} ms`
      + `（${(((base - b.meanMs) / base) * 100).toFixed(1)}%）`
      + `　少 ${(a.tris - b.tris).toLocaleString()} 個三角形`
      + `　draw call 少 ${a.calls - b.calls}`
      + `　基準漂 ${(((d.meanMs - a.meanMs) / a.meanMs) * 100).toFixed(1)}%`)
  }
  console.log(`\n  截圖：${SHOTS}`)
}

main().catch((e: unknown) => { console.error(e); throw e })
