/**
 * 滑鼠搖桿的驗收（SPEC `2026-10-22-mouse-joystick-design.md` §8）。**不由 vitest 執行**
 * （副檔名 `.e2e.ts`）。
 *
 * ```
 * npm run dev                                       # 終端機一，開在 5173
 * npx vite-node test/e2e/mouse-joystick.e2e.ts      # 終端機二
 * ```
 *
 * 控制律、曲線、回中、設定頁由單元測試釘死；這一支驗的是瀏覽器裡的接線：存檔讀進來、
 * 滑鼠事件推得動搖桿、搖桿真的在飛這架飛機、A／D、HUD 的搖桿指示、`I` 交還時歸零。
 *
 * 【只量方向不量時間】無頭的物理時間每牆鐘秒只走約 0.1 s，等待一律看 `__probe().t`。
 *
 * 【不得使用 process / fs】專案沒有 `@types/node`。截圖交給 playwright 自己寫檔。
 */
import { chromium, type Page } from 'playwright'

const URL = 'http://localhost:5173/'
const SHOTS = '.shots/'

interface Probe { t: number; ai: boolean; bk: number; ga: number }
interface Stick {
  mode: string; active: boolean; x: number; y: number
  manual: boolean; roll: number; pitch: number; yaw: number; camUp: number
}

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

/** 讀搖桿；給 `(x, y)` 時先放過去 */
async function stick(page: Page, x?: number, y?: number): Promise<Stick> {
  return page.evaluate(([sx, sy]) => {
    const f = (window as unknown as Record<string, unknown>)['__stick'] as (x?: number, y?: number) => Stick
    return sx === null || sy === null ? f() : f(sx, sy)
  }, [x ?? null, y ?? null] as const)
}

/**
 * 按掉教學卡。卡片會暫停戰鬥、放掉指標鎖，而且在開場導覽結束之後才彈出。從 DOM 點：
 * 無頭只有幾 FPS，卡片的進場動畫讓 playwright 判定按鈕不穩定
 */
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
 * 等物理時間走過 `seconds` 秒。牆鐘 20 秒內物理時間一動也不動就停下來，印出哪些覆蓋層開著 ——
 * 戰鬥被暫停（教學卡、暫停選單）時一直等下去只會卡到逾時
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
        .filter((e) => !e.hidden && e.offsetParent !== null && /pause|tutorial|ask|confirm|settings/.test(e.id))
        .map((e) => e.id))
      const lock = await page.evaluate(() => document.pointerLockElement?.id ?? null)
      throw new Error(`物理時間停在 ${last} s（等 ${seconds} s）；開著的覆蓋層 ${JSON.stringify(open)}，指標鎖 ${lock}`)
    }
    await page.waitForTimeout(100)
  }
}

/**
 * HUD 畫布中央左右兩條帶子裡、搖桿點那種顏色（不透明的 `HUD_COLORS.primary`）的像素數。
 *
 * 【帶子從中心外 20 px 開始】機首十字的橫臂在 720 高的畫面上伸到 12.8 px，圓環是半透明的
 * `dim`、被 alpha 門檻擋掉 —— 數到的只會是搖桿的點
 */
async function dotSides(page: Page): Promise<{ left: number; right: number }> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#hud')!
    const ctx = c.getContext('2d')!
    const cx = Math.round(c.width / 2)
    const cy = Math.round(c.height / 2)
    const count = (x: number, w: number): number => {
      const d = ctx.getImageData(x, cy - 5, w, 10).data
      let n = 0
      for (let i = 0; i < d.length; i += 4) {
        const near = (v: number, t: number): boolean => Math.abs(v - t) <= 24
        if (d[i + 3]! >= 200 && near(d[i]!, 0x7d) && near(d[i + 1]!, 0xfb) && near(d[i + 2]!, 0xa8)) n++
      }
      return n
    }
    return { left: count(cx - 48, 28), right: count(cx + 20, 28) }
  })
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))
    // 【開場前寫存檔】設定頁讀的是 localStorage，這一支驗的正是「存檔讀進來」
    await page.addInitScript(() => {
      localStorage.setItem('input.controlMode', 'stick')
      localStorage.setItem('input.stickRecenter', 'off')
    })

    await page.goto(URL)
    // 【載入畫面擋著點擊】冷啟動時素材載入可以超過 playwright 預設的 30 秒
    await page.waitForSelector('#loading', { state: 'hidden', timeout: 180000 })
    // 【選單從 DOM 點】主選單的背景短片在無頭下只有幾 FPS，playwright 的點擊會卡在
    // 「performing click action」等到逾時（實測過一次）
    for (const sel of ['[data-act="start"]', '[data-act="skirmish"]', '#skirmish [data-act="fight"]']) {
      await page.waitForSelector(sel, { state: 'visible', timeout: 60000 })
      await page.evaluate((s) => (document.querySelector(s) as HTMLElement).click(), sel)
      await page.waitForTimeout(500)
    }
    // 【教學卡會暫停戰鬥】從 DOM 點：無頭只有幾 FPS，卡片的進場動畫讓 playwright 判定按鈕不穩定
    let p: Probe | null = null
    for (let i = 0; i < 80; i++) {
      await page.waitForTimeout(500)
      await page.evaluate(() => {
        (document.querySelector('#tutorial [data-act="tutorialOk"]') as HTMLElement | null)?.click()
      })
      p = await probe(page)
      if (p !== null && p.t > 1) break
    }
    if (p === null || p.t <= 1) throw new Error('戰鬥沒有開始跑')
    // 【跳過開場導覽】導覽期間 `holdIntroInput` 每幀把搖桿放回中心。導覽一結束教學卡才彈出，
    // 按掉之後才拿指標鎖 —— 卡片會放掉鎖
    await page.keyboard.press('Space')
    for (let i = 0, quiet = 0; i < 60 && quiet < 6; i++) {
      await page.waitForTimeout(500)
      quiet = (await dismissCards(page)) ? 0 : quiet + 1
    }
    await waitPhys(page, 0.3)

    const s0 = await stick(page)
    console.log(`[1] 存檔讀進來：模式 ${s0.mode}、這一幀用搖桿 ${s0.active}`)
    if (s0.mode !== 'stick' || !s0.active) throw new Error('存檔的滑鼠搖桿沒有生效')

    // 2. 取得指標鎖。鎖住那一下會補送一個很大的位移，搖桿放回中心再量
    await page.mouse.click(640, 360)
    await page.waitForTimeout(500)
    const locked = await page.evaluate(() => document.pointerLockElement !== null)
    console.log(`[2] 指標鎖 ${locked}`)
    await stick(page, 0, 0)

    // 3. 滑鼠往右移 → 搖桿往右（bindings → aimDelta → stepStick 這一條）
    if (locked) {
      await page.evaluate(() => {
        const w = window as unknown as { __mv: number[] }
        w.__mv = []
        window.addEventListener('mousemove', (e) => w.__mv.push(e.movementX))
      })
      for (let i = 1; i <= 5; i++) {
        await page.mouse.move(640 + i * 8, 360)
        await page.waitForTimeout(60)
      }
      await page.waitForTimeout(300)
      const s = await stick(page)
      const mv = await page.evaluate(() => (window as unknown as { __mv: number[] }).__mv)
      const still = await page.evaluate(() => document.pointerLockElement?.id ?? String(document.pointerLockElement))
      console.log(`[3] 滑鼠右移 40 px 之後搖桿 x = ${s.x}（movementX ${JSON.stringify(mv)}，鎖在 ${still}）`)
      if (!(s.x > 0)) throw new Error('滑鼠右移沒有推動搖桿')
    } else {
      console.log('[3] 無頭拿不到指標鎖，滑鼠 → 搖桿這一段跳過（由 bindings／player-control 單元測試守）')
    }

    // 4. 拉桿 → 往上爬（從平飛開始量，坡度不會把拉桿變成轉彎）
    await stick(page, 0, 0)
    const before = await waitPhys(page, 0.5)
    await stick(page, 0, 0.8)
    const pulled = await waitPhys(page, 1.5)
    const sp = await stick(page)
    console.log(`[4] 拉桿：航跡角 ${before.ga}° → ${pulled.ga}°，指令 manual ${sp.manual}、俯仰 ${sp.pitch}`)
    if (!sp.manual || !(sp.pitch > 0)) throw new Error('拉桿沒有寫進指令')
    if (!(pulled.ga > before.ga + 3)) throw new Error('拉桿之後沒有往上爬')

    // 5. 右滾 → 坡度往右；放開 → 坡度保持
    await stick(page, 0, 0)
    const level = await waitPhys(page, 0.5)
    await stick(page, 0.8, 0)
    const rolled = await waitPhys(page, 0.8)
    console.log(`[5] 右滾：坡度 ${level.bk}° → ${rolled.bk}°`)
    if (!(rolled.bk > level.bk + 15)) throw new Error('右滾桿沒有往右滾')
    await stick(page, 0, 0)
    const settled = await waitPhys(page, 0.5)
    const held = await waitPhys(page, 2)
    console.log(`[5] 放開：坡度 ${settled.bk}° → 2 s 後 ${held.bk}°`)
    if (Math.abs(held.bk - settled.bk) > 10) throw new Error('放開之後坡度沒有保持')
    // 鏡頭跟著滾：帶著坡度時鏡頭上方的世界 y 分量 ≈ cos(坡度)，不跟的話是 1
    const cam = await stick(page)
    const want = Math.cos(held.bk * Math.PI / 180)
    console.log(`[5] 鏡頭跟著滾：鏡頭上方 y ${cam.camUp}（cos 坡度 ${want.toFixed(3)}）`)
    if (Math.abs(cam.camUp - want) > 0.2) throw new Error('鏡頭沒有跟著機體滾轉')
    await page.screenshot({ path: SHOTS + 'stick-0-rolled.png' })

    // 6. D → 方向舵
    await page.keyboard.down('KeyD')
    await waitPhys(page, 0.1)
    const sd = await stick(page)
    await page.keyboard.up('KeyD')
    console.log(`[6] 按住 D：方向舵 ${sd.yaw}`)
    if (sd.yaw !== 1) throw new Error('D 沒有寫進方向舵')

    // 7. 搖桿指示真的畫出來：點跟著搖桿左右換邊
    await stick(page, 0.8, 0)
    await page.waitForTimeout(400)
    const right = await dotSides(page)
    await stick(page, -0.8, 0)
    await page.waitForTimeout(400)
    const left = await dotSides(page)
    console.log(`[7] 搖桿指示的點：搖桿在右 左 ${right.left}／右 ${right.right}；搖桿在左 左 ${left.left}／右 ${left.right}`)
    if (!(right.right >= 10 && right.left <= 3)) throw new Error('搖桿在右時右邊沒有點')
    if (!(left.left >= 10 && left.right <= 3)) throw new Error('搖桿在左時左邊沒有點')
    await stick(page, 0.5, 0.35)
    await page.waitForTimeout(400)
    await page.screenshot({ path: SHOTS + 'stick-1-gauge.png' })
    await page.screenshot({ path: SHOTS + 'stick-2-gauge-centre.png', clip: { x: 540, y: 260, width: 200, height: 200 } })
    console.log(`[人工看] ${SHOTS}stick-1-gauge.png、stick-2-gauge-centre.png —— 中央的圓環與點、沒有滑鼠圓圈`)

    // 8. I 代飛再交還：搖桿歸零
    await stick(page, 0.6, 0.6)
    await page.keyboard.press('KeyI')
    await waitPhys(page, 0.2)
    const away = await probe(page)
    await page.keyboard.press('KeyI')
    await waitPhys(page, 0.2)
    const back = await stick(page)
    console.log(`[8] 代飛 ${away?.ai} → 交還之後搖桿 (${back.x}, ${back.y})`)
    if (away?.ai !== true) throw new Error('I 沒有進代飛')
    if (back.x !== 0 || back.y !== 0) throw new Error('交還之後搖桿沒有歸零')

    console.log(`[9] console 錯誤 ${errors.length} 則`)
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
