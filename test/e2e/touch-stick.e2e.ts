/**
 * 觸控搖桿的驗收（SPEC `2026-10-22-mouse-joystick-design.md` §10.5）。**不由 vitest 執行**
 * （副檔名 `.e2e.ts`）。
 *
 * ```
 * npm run dev                                    # 終端機一，開在 5173
 * npx vite-node test/e2e/touch-stick.e2e.ts      # 終端機二
 * ```
 *
 * 換算、放開、歸零、上帝視角、多根手指由單元測試釘死；這一支驗的是瀏覽器裡的接線：手機視窗
 * 真的顯示觸控層、真的觸控事件推得動搖桿、搖桿真的在飛這架飛機、方框出現在按下點。
 *
 * 觸控事件走 CDP 的 `Input.dispatchTouchEvent`：playwright 的 `touchscreen` 只有點一下，沒有拖曳。
 *
 * 【只量方向不量時間】無頭的物理時間每牆鐘秒只走約 0.1 s，等待一律看 `__probe().t`。
 *
 * 【不得使用 process / fs】專案沒有 `@types/node`。截圖交給 playwright 自己寫檔。
 */
import { chromium, type CDPSession, type Page } from 'playwright'

const URL = 'http://localhost:5173/'
const SHOTS = '.shots/'
/** 手機橫放 */
const VIEW = { width: 844, height: 390 }
/** 滿桿位移，px（`TOUCH_STICK_RADIUS` × 視窗高度） */
const R = 0.12 * VIEW.height

interface Probe { t: number; ai: boolean; bk: number; ga: number }
interface Stick { mode: string; active: boolean; x: number; y: number; manual: boolean; roll: number; pitch: number }

async function probe(page: Page): Promise<Probe | null> {
  return page.evaluate(() => {
    const f = (window as unknown as Record<string, unknown>)['__probe']
    try {
      return typeof f === 'function' ? (f as () => Probe | null)() : null
    } catch {
      return null
    }
  })
}

async function stick(page: Page): Promise<Stick> {
  return page.evaluate(() => ((window as unknown as Record<string, unknown>)['__stick'] as () => Stick)())
}

async function dismissCards(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const ok = document.querySelector('#tutorial [data-act="tutorialOk"]') as HTMLElement | null
    const tut = document.querySelector<HTMLElement>('#tutorial')
    if (ok === null || tut === null || tut.hidden || tut.offsetParent === null) return false
    ok.click()
    return true
  })
}

/**
 * 等物理時間走過 `seconds` 秒，順手按掉晚彈出的教學卡。牆鐘 20 秒不動就停下來，印出開著的覆蓋層
 */
async function waitPhys(page: Page, seconds: number): Promise<Probe> {
  const t0 = (await probe(page))!.t
  let last = t0
  let lastMoved = Date.now()
  for (;;) {
    await dismissCards(page)
    const p = await probe(page)
    if (p !== null && p.t - t0 >= seconds) return p
    if (p !== null && p.t !== last) {
      last = p.t
      lastMoved = Date.now()
    }
    if (Date.now() - lastMoved > 20000) {
      const open = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[id]'))
        .filter((e) => !e.hidden && e.offsetParent !== null && /pause|tutorial|ask|confirm|settings|rotate/.test(e.id))
        .map((e) => e.id))
      throw new Error(`物理時間停在 ${last} s（等 ${seconds} s）；開著的覆蓋層 ${JSON.stringify(open)}`)
    }
    await page.waitForTimeout(100)
  }
}

/** 一根手指：按下、移動、放開 */
function finger(cdp: CDPSession) {
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
    })
  return {
    down: (x: number, y: number) => send('touchStart', x, y),
    /** 分幾步拖過去，像真的手指 */
    async moveTo(fromX: number, fromY: number, x: number, y: number): Promise<void> {
      for (let i = 1; i <= 5; i++) {
        await send('touchMove', fromX + ((x - fromX) * i) / 5, fromY + ((y - fromY) * i) / 5)
      }
    },
    up: () => send('touchEnd', 0, 0),
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: VIEW, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.addInitScript(() => {
      localStorage.setItem('input.controlMode', 'stick')
      localStorage.setItem('input.stickRecenter', 'fast')
    })
    const cdp = await context.newCDPSession(page)

    await page.goto(URL)
    await page.waitForSelector('#loading', { state: 'hidden', timeout: 180000 })
    for (const sel of ['[data-act="start"]', '[data-act="skirmish"]', '#skirmish [data-act="fight"]']) {
      await page.waitForSelector(sel, { state: 'visible', timeout: 60000 })
      await page.evaluate((s) => (document.querySelector(s) as HTMLElement).click(), sel)
      await page.waitForTimeout(500)
    }
    let p: Probe | null = null
    for (let i = 0; i < 80; i++) {
      await page.waitForTimeout(500)
      await dismissCards(page)
      p = await probe(page)
      if (p !== null && p.t > 1) break
    }
    if (p === null || p.t <= 1) throw new Error('戰鬥沒有開始跑')
    // 跳過開場導覽（觸控是點導覽層；鍵盤空白鍵一樣有效），之後按掉教學卡
    await page.keyboard.press('Space')
    // 【等到卡片不再彈出】卡片暫停戰鬥、觸控層收起來放掉所有手指 —— 量到一半彈出來桿量就歸零。
    // 物理時間連續走 3 s 沒有卡片才開始
    for (let i = 0; i < 20; i++) {
      const t0 = (await probe(page))!.t
      let card = false
      while ((await probe(page))!.t - t0 < 3) {
        if (await dismissCards(page)) { card = true; break }
        await page.waitForTimeout(200)
      }
      if (!card) break
    }

    const shown = await page.evaluate(() => !(document.getElementById('touch') as HTMLElement).hidden)
    const s0 = await stick(page)
    console.log(`[0] 觸控層顯示 ${shown}；模式 ${s0.mode}、這一幀用搖桿 ${s0.active}`)
    if (!shown) throw new Error('手機視窗沒有顯示觸控層')
    if (s0.mode !== 'stick' || !s0.active) throw new Error('觸控層顯示時搖桿沒有生效')

    // 1. 左半邊按下：方框出現在按下點、邊長 2R
    const f = finger(cdp)
    const X = 200
    const Y = 230
    await f.down(X, Y)
    await page.waitForTimeout(200)
    const box = await page.evaluate(() => {
      const b = document.querySelector<HTMLElement>('#touch .t-ring.stick')!
      const r = b.getBoundingClientRect()
      return { hidden: b.hidden, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width }
    })
    console.log(`[1] 方框 hidden ${box.hidden}，中心 (${box.cx.toFixed(1)}, ${box.cy.toFixed(1)})，邊長 ${box.w.toFixed(1)}（2R ${(2 * R).toFixed(1)}）`)
    if (box.hidden) throw new Error('按下之後方框沒有出現')
    if (Math.abs(box.cx - X) > 2 || Math.abs(box.cy - Y) > 2) throw new Error('方框不在按下點')
    if (Math.abs(box.w - 2 * R) > 2) throw new Error('方框邊長不是 2R')

    // 2. 往右拖 R → 滿桿右；坡度往右
    const level = await waitPhys(page, 0.1)
    await f.moveTo(X, Y, X + R, Y)
    const sr = await waitPhys(page, 0.1).then(() => stick(page))
    console.log(`[2] 往右拖 R：搖桿 (${sr.x}, ${sr.y})，指令 manual ${sr.manual}、滾轉 ${sr.roll}`)
    if (!(sr.x > 0.95) || Math.abs(sr.y) > 0.05) throw new Error('往右拖 R 不是滿桿右')
    if (!sr.manual || !(sr.roll > 0.9)) throw new Error('觸控的桿量沒有寫進指令')
    const rolled = await waitPhys(page, 0.8)
    console.log(`[2] 坡度 ${level.bk}° → ${rolled.bk}°`)
    if (!(rolled.bk > level.bk + 15)) throw new Error('右拖沒有往右滾')

    // 3. 手指不動（回中設「快」）：桿量不變
    await waitPhys(page, 1)
    const still = await stick(page)
    console.log(`[3] 手指不動 1 s（回中：快）：搖桿 x ${still.x}`)
    if (!(still.x > 0.95)) throw new Error('手指不動時桿量被回中吃掉')

    // 4. 往上拖 → 拉桿
    await f.moveTo(X + R, Y, X, Y - 0.8 * R)
    await waitPhys(page, 0.1)
    const su = await stick(page)
    console.log(`[4] 往上拖 0.8R：搖桿 (${su.x}, ${su.y})，俯仰 ${su.pitch}`)
    if (!(su.y > 0.7) || Math.abs(su.x) > 0.05) throw new Error('往上拖不是拉桿')
    if (!(su.pitch > 0)) throw new Error('拉桿沒有寫進指令')

    // 5. 截圖：方框在按下點、手指在框內
    await f.moveTo(X, Y - 0.8 * R, X + 0.5 * R, Y - 0.35 * R)
    await page.waitForTimeout(400)
    await page.screenshot({ path: SHOTS + 'touch-stick-1.png' })
    console.log(`[人工看] ${SHOTS}touch-stick-1.png —— 左邊按下點的方框、中央的搖桿指示`)

    // 6. 放開（回中「快」）→ 方框藏起來，照時間常數 0.12 s 滑回中間
    await f.up()
    await waitPhys(page, 0.5)
    const sz = await stick(page)
    const hidden = await page.evaluate(() => document.querySelector<HTMLElement>('#touch .t-ring.stick')!.hidden)
    console.log(`[6] 放開 0.5 s：搖桿 (${sz.x}, ${sz.y})，方框 hidden ${hidden}`)
    if (Math.abs(sz.x) > 0.05 || Math.abs(sz.y) > 0.05) throw new Error('放開之後沒有回中')
    if (!hidden) throw new Error('放開之後方框還在')

    console.log(`[7] console 錯誤 ${errors.length} 則`)
    for (const e of errors.slice(0, 8)) console.log('  ' + e)
    if (errors.length > 0) throw new Error('有 console 錯誤')
    console.log('全部通過')
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => {
  console.error(e)
  throw e
})
