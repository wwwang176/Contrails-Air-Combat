/**
 * 任務框架的人工驗收。**不由 vitest 執行** —— 副檔名是 `.e2e.ts`。
 *
 * 跑法（兩個終端機）：
 *
 * ```
 * npm run dev                                  # 終端機一
 * npx vite-node test/e2e/mission.e2e.ts        # 終端機二
 * ```
 *
 * 【`URL` 的埠要對】vite 在 5173 被佔用時會往上找（5174、5175…），
 * 開跑前先看終端機一印的那一行。
 *
 * 【為什麼要有它】這一份的接線有一半在 `main.ts` 與 DOM 裡：卡片可不可點、
 * 進不進得了戰鬥、目標列畫不畫、圓環出不出現、結算的出口回哪裡。單元與
 * 整合測試守得到判定，守不到「點下去有沒有反應」。
 *
 * ── 哪些是斷言、哪些是給人看的 ──
 *
 * **是斷言**（會 throw）：卡片的可點狀態、畫面轉移、目標列的像素、結算
 * 兩顆按鈕的顯示、console 錯誤。
 *
 * **給人看的**：截圖。
 *
 * 【圓環暫時無從驗起】撤離卡 2026-08-16 由專案負責人裁定關閉，而它是唯一
 * 會產生撤離點的卡 —— 下面第 3 段因此留空待命。判準的推導留在那裡沒刪。
 *
 * 【為什麼圓環驗得到而準星那一套驗不到】圓環畫在 **WebGL** 那一張畫布上，
 * `getImageData` 讀不回來（未設 `preserveDrawingBuffer`）。所以圓環走的是
 * **`page.screenshot()` 的 PNG**，由 playwright 自己合成 —— 那條路徑讀得到
 * WebGL。判準是「畫面上緣（天空區）有沒有出現圓環的綠」。
 *
 * 【為什麼取上緣而不是中央】撤離點在正前方、與自機同高，所以它落在畫面
 * 垂直中央附近 —— 而那裡也是準星、目標框、敵機的所在。取一條**水平長條**
 * 但排除中央的正方形，綠色的來源就只剩圓環與遠處的 HUD 元件；再用
 * 「有沒有撤離點」做開關對照（殲滅任務同一區必須沒有），那條就可證偽。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5176/'
const SHOTS = '.shots/'

/**
 * 目標列的取樣區：**右上角**。`objective.ts` 靠右對齊在
 * `x = width − 30·scale`、`y = 18·scale`。
 *
 * 【為什麼不是左上角】那裡是效能面板（`core/perf.ts`，預設開著）。
 * 這一版之前放在左上，Playwright 的截圖照出兩者疊在一起。
 */
const OBJECTIVE_BOX = { x: 0.62, y: 0.01, w: 0.37, h: 0.06 }

function fail(msg: string): never {
  throw new Error(msg)
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))

    /**
     * HUD 畫布上某一塊矩形裡有多少個**綠色**像素。
     *
     * 【為什麼只數綠】HUD 的主色是 `HUD_COLORS.primary` #7dfba8，而目標列
     * 用的就是它（倒數 < 30 s 時轉紅，那時這個判準會失效 —— 所以驗收要在
     * 開局做，那時倒數還有兩分多鐘）。
     *
     * 【`a >= 128` 這道下限】理由與 `god-view.e2e.ts` 相同：`getImageData`
     * 回的是未預乘 RGB，低 alpha 下捨入誤差會把色相整個換掉。
     */
    const hudGreen = (r: typeof OBJECTIVE_BOX): Promise<number> =>
      page.evaluate((box) => {
        const c = document.querySelector<HTMLCanvasElement>('#hud')
        if (c === null) return -1
        const ctx = c.getContext('2d')
        if (ctx === null) return -1
        const d = ctx.getImageData(
          Math.round(c.width * box.x), Math.round(c.height * box.y),
          Math.round(c.width * box.w), Math.round(c.height * box.h),
        ).data
        let n = 0
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3]! >= 128 && d[i + 1]! > d[i]! && d[i + 1]! > d[i + 2]!) n++
        }
        return n
      }, r)

    const hidden = (sel: string): Promise<boolean | null> =>
      page.evaluate((s) => {
        const el = document.querySelector<HTMLElement>(s)
        return el === null ? null : el.hidden
      }, sel)

    await page.goto(URL)

    // ── 1. 任務列表：同盟國五張，一張可點、四張未開放 ──────
    await page.click('[data-act="start"]')
    await page.click('[data-act="mission"]')
    await page.waitForTimeout(300)

    const cards = await page.evaluate(() => {
      // 【`Array.from` 而不是展開】專案的 `tsconfig` 沒有開 `downlevelIteration`，
      // `NodeListOf` 在那個設定下不算 iterable
      const list = document.querySelectorAll<HTMLButtonElement>('#mission-list .card')
      return Array.from(list).map((b) => ({
        title: b.querySelector('.card-title')?.textContent ?? '',
        disabled: b.disabled,
        locked: b.querySelector('.locked') !== null,
      }))
    })
    console.log('[任務] 同盟國卡片：')
    for (const c of cards) {
      console.log(`  ${c.disabled ? '✗' : '✓'} ${c.title}${c.locked ? '（未開放）' : ''}`)
    }
    // 【為什麼不斷言可點的張數】那個數字是專案負責人裁定的（2026-08-16 關掉
    // 撤離就是一次），每開關一張卡就要改一次腳本 —— 那是雜訊不是護欄。
    // 「有沒有卡可點」與「可不可點標對了沒」才是這一段真正要問的
    const playable = cards.filter((c) => !c.disabled)
    if (playable.length === 0) fail('一張可點的卡都沒有，下面的驗收無從跑起')
    // 【未開放的卡必須看得出來】看起來可點卻沒反應才是真的壞掉
    for (const c of cards) {
      if (c.disabled !== c.locked) fail(`「${c.title}」的 disabled 與「未開放」標記不一致`)
    }

    // ── 2. 點殲滅卡進得了戰鬥，目標列出現 ──────────────────
    await page.click('#mission-list .card:not([disabled])')
    await page.waitForTimeout(3000)

    const inBattle = await page.evaluate(
      () => document.querySelector<HTMLElement>('#ui')?.querySelectorAll('.screen:not([hidden])').length,
    )
    if (inBattle !== 0) fail(`進入戰鬥後不該有任何 .screen 可見，實得 ${inBattle}`)

    const objectiveInk = await hudGreen(OBJECTIVE_BOX)
    console.log(`[任務] 殲滅：目標列區的綠色像素 ${objectiveInk}`)
    if (objectiveInk <= 0) fail('殲滅任務的目標列沒有畫出來')
    await page.screenshot({ path: SHOTS + 'mission-1-kill.png' })

    // ── 3. 圓環：**撤離關掉之後這一段沒有東西可驗** ─────────
    //
    // 【為什麼是留空而不是刪掉】圓環的程式（`render/objectiveRing.ts`）與
    // `main.ts` 的建置／釋放都還在，只是現在沒有任何一張可點的卡會讓
    // `mission.hasTarget` 變 true。撤離翻回來的那一天，這一段要跟著回來：
    // 判準是「畫面上緣（天空區）出現圓環的綠」，而反證是殲滅任務同一區必須
    // 沒有 —— 檔頭第五段有完整推導。
    console.log('[任務] 圓環：撤離關閉中，這一段暫時沒有東西可驗')

    // ── 4. 結算的出口：任務模式顯示「回任務列表」 ──────────
    //
    // 【這一條驗的是「模式分流」，不是結算流程】戰鬥還沒結束，所以
    // `#board-actions` 整塊是藏的 —— 下面兩條讀的是那兩顆子按鈕的 `hidden`，
    // 而 `main.ts` 每一幀都會依 `mode` 重設它們，與結算板出不出來無關
    // （Codex 審查 2026-08-16）。**結算流程本身沒有 e2e 覆蓋**，因為要把一場
    // 4v16 打完；記在 `docs/backlog.md`。
    const actionsHidden = await hidden('#board-actions')
    if (actionsHidden !== true) fail('戰鬥進行中 #board-actions 應該是藏的')
    const toSetupHidden = await hidden('[data-act="toSetup"]')
    const toMissionHidden = await hidden('[data-act="toMission"]')
    console.log(`[任務] 結算出口：回設定頁 hidden=${toSetupHidden}、回任務列表 hidden=${toMissionHidden}`)
    if (toSetupHidden !== true) fail('任務模式下「回設定頁」應該藏起來')
    if (toMissionHidden !== false) fail('任務模式下「回任務列表」應該顯示')

    // ── 5. 反證：遭遇戰不顯示目標列，出口換回設定頁 ─────────
    // 【這一條讓「目標列真的分流」可證偽】少了它，一個恆真的目標列
    // （例如 `objectiveActive` 寫死 true）也會讓第 2 條全綠
    //
    // 【為什麼重新載入而不是按 ESC 回主選單】暫停是由 `pointerLockLost`
    // 觸發的（`main.ts` 的 `frame`），而這支腳本刻意不取得指標鎖定 ——
    // 無頭 chromium 下鎖定生效那一刻會把瞄準方向甩到天上
    // （`god-view.e2e.ts` 檔頭有完整推導）。所以 ESC 在這裡不會開暫停選單。
    //
    // 重新載入順帶多驗一件事：`mode` 的初值真的是遭遇戰。
    await page.goto(URL)
    await page.click('[data-act="start"]')
    await page.click('[data-act="skirmish"]')
    await page.click('#skirmish [data-act="fight"]')
    await page.waitForTimeout(3000)

    const skirmishInk = await hudGreen(OBJECTIVE_BOX)
    console.log(`[任務] 遭遇戰：目標列區的綠色像素 ${skirmishInk}`)
    if (skirmishInk !== 0) fail(`遭遇戰不該畫目標列，實得 ${skirmishInk} 個綠色像素`)
    await page.screenshot({ path: SHOTS + 'mission-2-skirmish.png' })

    const toSetup2 = await hidden('[data-act="toSetup"]')
    const toMission2 = await hidden('[data-act="toMission"]')
    if (toSetup2 !== false) fail('遭遇戰下「回設定頁」應該顯示')
    if (toMission2 !== true) fail('遭遇戰下「回任務列表」應該藏起來')

    // ── 6. 沒有 console 錯誤 ────────────────────────────────
    if (errors.length > 0) fail(`console 有 ${errors.length} 筆錯誤：\n${errors.join('\n')}`)

    console.log('\n[任務] 全部驗收通過')
  } finally {
    await browser.close()
  }
}

void main()
