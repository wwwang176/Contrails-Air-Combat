/**
 * 魚雷投放 HUD 的人工驗收 —— 航跡線、投放閘門、可投高度弧。
 * **不由 vitest 執行**（副檔名 `.e2e.ts`）。
 *
 * ```
 * npm run dev -- --port 5178 --strictPort        # 終端機一
 * npx vite-node test/e2e/torpedo-hud.e2e.ts      # 終端機二
 * ```
 *
 * 【為什麼是截圖而不是斷言】WebGL 畫布沒開 `preserveDrawingBuffer`，HUD 的
 * canvas 讀不回來。三個顯示物的**規則**已經由單元測試釘死（`hud-torpedo-line`
 * ／`hud-release-gate`／`hud-altimeter-band`）；這一支驗的是**接線與版面**：
 * 東西真的畫出來了、落在該落的位置、而且沒有丟例外。
 *
 * ── 要看的四件事 ──────────────────────────────────────
 *
 * ```
 *   1  低空進場   航跡線從落點圈往前延伸，四個刻度＋末端的 2000 都在畫面裡
 *   2  同一幀      閘門三格在畫面下方，在包絡內時三格全綠
 *   3  同一幀      高度錶上有一段綠弧，而且在 12–2 點方向（3–5 點 = 90° 換算掉了）
 *   4  出界        線與圈轉紅，閘門只有出界的那一格轉紅
 * ```
 *
 * 【陸地那一條不在這裡】「落點是不是水」已經由 `torpedoEntersWater` 的單元
 * 測試釘死，而且 `stepAir` 與 HUD 共用同一支 —— 那比一張要飛到島上空才拍
 * 得到的截圖可靠得多。
 *
 * 【為什麼交給 AI 飛】包絡把可投高度壓在 20…200 m，而任務開場在 1,000 m。
 * `ai/torpedoRun.ts` 的雷擊剖面本來就會降到 150 m 附近 —— 讓它飛比用鍵盤
 * 湊高度可靠得多，而 HUD 讀的恆是玩家那一架，與誰在操縱無關。
 *
 * 【第 5 張走遭遇戰】倫內爾島那一關在海上，抓不到陸地那一條。遭遇戰可以
 * 選群島地形＋G4M，那是唯一拿得到「掛魚雷飛在島上空」的路徑。
 *
 * 【不得使用 process / fs】專案沒有 `@types/node`。截圖交給 playwright
 * 自己寫檔，判斷全部走 `page.evaluate`。
 */
import { chromium, type Page } from 'playwright'

const URL = 'http://localhost:5178/'
const SHOTS = '.shots/torpedo-hud/'

/**
 * `__probe` 回的那一份的一小部分。
 *
 * `y` 是海拔；魚雷都投在海上，那裡海拔就是離地（碰撞面 0）。`bk` 已經是度。
 */
interface Probe {
  y: number
  bk: number
}

async function probe(page: Page): Promise<Probe | null> {
  return page.evaluate(() => {
    const f = (window as unknown as Record<string, unknown>)['__probe']
    return typeof f === 'function' ? (f as () => Probe | null)() : null
  })
}

/** 進倫內爾島那一關（G4M 掛魚雷、海上、開場 1,000 m） */
async function enterTorpedoMission(page: Page): Promise<void> {
  await page.goto(URL)
  await page.click('[data-act="start"]')
  await page.click('[data-act="mission"]')
  await page.click('[data-campaign="japan"]')
  // 【用 id 選卡】標題會改，id 不會（`ui/menu.ts` 的 renderMission）
  await page.click('[data-mission="japan-m4"]')
  await page.click('#brief-go')
  await page.waitForTimeout(2500)
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))

    await enterTorpedoMission(page)

    // 【自己下高度，不交給 AI】實測交給 AI 會停在 855 m —— 它忙著跟八架
    // 野貓纏鬥，`ai/torpedoRun.ts` 的雷擊剖面在那個情境下輪不到。
    //
    // 【俯仰只有滑鼠】`W`／`S` 是油門。瞄準是**位移累加**的
    // （`bindings.ts` 讀 `movementY`），所以往下移一段就是一個持續的低頭
    // 指令，移回去就改平。**全程不點畫面** —— 鎖指標那一下會把瞄準甩到天上
    // （見 `god-view.e2e.ts` 的檔頭）。
    console.log('  低頭下降到可投高度（20…200 m）…')
    await page.mouse.move(640, 140)
    await page.mouse.move(640, 560)
    let p: Probe | null = null
    for (let s = 0; s < 200; s++) {
      await page.waitForTimeout(700)
      p = await probe(page)
      if (p === null) continue
      if (p.y <= 320) break
      if (s % 10 === 9) console.log(`    高度 ${p.y.toFixed(0)} m`)
    }
    if (p === null) throw new Error('__probe 讀不到 —— 沒進戰鬥？')
    // 改平：瞄準移回地平線稍上方，讓俯仰與坡度都收乾淨
    console.log(`    ${p.y.toFixed(0)} m 開始改平`)
    await page.mouse.move(640, 120)
    for (let s = 0; s < 40; s++) {
      await page.waitForTimeout(700)
      p = await probe(page)
      if (p === null) continue
      if (p.y >= 30 && p.y <= 190 && Math.abs(p.bk) <= 10) break
      if (s % 10 === 9) console.log(`    高度 ${p.y.toFixed(0)} m　坡度 ${p.bk.toFixed(0)}°`)
    }
    await page.waitForTimeout(1000)
    p = await probe(page)
    console.log(`  高度 ${p === null ? '?' : p.y.toFixed(0)} m　坡度 ${p === null ? '?' : p.bk.toFixed(0)}°`)
    if (p === null || p.y > 200 || p.y < 20) {
      console.log('  ⚠ 沒停在可投高度帶 —— 第 1 張的閘門與高度弧不會是綠的')
    }

    // ① ② ③：投彈模式的低空進場
    await page.keyboard.press('KeyB')
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${SHOTS}1-run-in.png` })
    console.log('  ① 低空進場（航跡線＋閘門＋高度弧）→ 1-run-in.png')

    // ④：帶坡度 —— 把瞄準往側邊移，指揮儀會壓坡度轉過去
    await page.mouse.move(980, 180)
    await page.waitForTimeout(1400)
    const rolled = await probe(page)
    await page.screenshot({ path: `${SHOTS}2-banked.png` })
    console.log(
      `  ② 帶坡度 ${rolled === null ? '?' : rolled.bk.toFixed(0)}°`
      + '（線與圈轉紅、只有坡度那一格紅）→ 2-banked.png',
    )


    if (errors.length > 0) {
      console.log(`\n  ✗ 主控台有 ${errors.length} 則錯誤：`)
      for (const e of errors.slice(0, 8)) console.log(`     ${e}`)
      throw new Error('執行路徑有錯誤')
    }
    console.log('\n  主控台乾淨。截圖在 .shots/torpedo-hud/，逐張目視。')
  } finally {
    await browser.close()
  }
}

void main()
