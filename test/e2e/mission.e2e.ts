/**
 * 任務線的人工驗收：主選單 → 陣營 → 簡報 → 出擊（選單重做）。
 * **不由 vitest 執行** —— 副檔名是 `.e2e.ts`。
 *
 * 跑法（兩個終端機）：
 *
 * ```
 * npx vite --port 5178 --strictPort            # 終端機一
 * npx tsx test/e2e/mission.e2e.ts              # 終端機二
 * ```
 *
 * 【為什麼要有它】這一份的接線有一半在 `main.ts` 與 DOM 裡：陣營卡點得動、
 * 路線圖的站有沒有反應、簡報右欄有沒有畫出編制、出擊進不進得了戰鬥、
 * 目標列畫不畫、圓環出不出現、結算的出口回哪裡。單元測試守得到
 * `briefingOf` 與狀態機，守不到「點下去有沒有反應」。
 *
 * ── 哪些是斷言、哪些是給人看的 ──
 *
 * **是斷言**（會 throw）：三張陣營卡、每條線三站、準備中的站沒有出擊鈕、
 * 可玩的站右欄有目標與編制、九關都進得了戰鬥、目標列的像素、圓環的
 * 場景歸屬、結算兩顆出口的顯示、console 錯誤、遭遇戰的反證。
 *
 * **給人看的**：截圖。
 *
 * 【圓環問的是場景歸屬，不是像素】它畫在 WebGL 那一張畫布上，而
 * `preserveDrawingBuffer` 是關的，`getImageData` 讀不回來。`__probe().ring`
 * 回的是「環在不在場景裡」。
 *
 * 【目標列那一側才數像素】它畫在 2D 畫布上（`#hud`）。取樣區是右上角 ——
 * 左上角是效能面板。
 *
 * 【用 id 選關，不用標題】標題會改（改過一輪），id 不會。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5178/'
const SHOTS = '.shots/'

const OBJECTIVE_BOX = { x: 0.62, y: 0.01, w: 0.37, h: 0.06 }

function fail(msg: string): never {
  throw new Error(msg)
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const errors: string[] = []
    const logs: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
      else logs.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(String(e)))

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

    const visibleScreens = () => page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('#ui .screen'))
        .filter((s) => !s.hidden).map((s) => s.id))

    /** 從頭走到某一條線的簡報頁 */
    const toCampaign = async (campaign: string) => {
      await page.goto(URL)
      await page.click('[data-act="start"]')
      await page.click('[data-act="mission"]')
      await page.waitForTimeout(200)
      await page.click(`#campaign-cards button[data-campaign="${campaign}"]`)
      await page.waitForTimeout(200)
    }

    // ── 1. 主選單 → 陣營頁：三張卡，各自寫著可出擊幾關 ──────
    await page.goto(URL)
    await page.click('[data-act="start"]')
    let screens = await visibleScreens()
    if (screens.join() !== 'menu') fail(`按開始之後應該只看到 menu，實得 ${screens.join('/')}`)
    await page.click('[data-act="mission"]')
    await page.waitForTimeout(200)
    screens = await visibleScreens()
    if (screens.join() !== 'campaign') fail(`任務模式應該先到陣營頁，實得 ${screens.join('/')}`)
    const campaigns = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('#campaign-cards button'))
        .map((b) => ({ id: b.dataset['campaign'] ?? '', meta: b.querySelector('.m')?.textContent ?? '' })))
    console.log(`[任務] 陣營：${campaigns.map((c) => `${c.id}（${c.meta.replace(/\s+/g, ' ')}）`).join('／')}`)
    if (campaigns.length !== 3) fail(`陣營頁應該有三張卡，實得 ${campaigns.length}`)
    for (const c of campaigns) {
      if (!/可出擊 \d+/.test(c.meta)) fail(`${c.id} 的卡上沒有「可出擊 n」`)
    }
    await page.screenshot({ path: SHOTS + 'mission-0-campaign.png' })

    // ── 2. 每條線三站；準備中的站點得動但沒有出擊鈕 ────────
    const ready: { campaign: string; id: string; title: string }[] = []
    for (const c of campaigns) {
      await toCampaign(c.id)
      screens = await visibleScreens()
      if (screens.join() !== 'mission') fail(`點陣營卡應該進簡報頁，實得 ${screens.join('/')}`)
      const stops = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLButtonElement>('#route .stop'))
          .map((b) => ({
            id: b.dataset['mission'] ?? '', title: b.querySelector('.n')?.textContent ?? '',
            soon: b.classList.contains('soon'),
          })))
      console.log(`[任務] ${c.id}：`)
      if (stops.length !== 3) fail(`${c.id} 應該有三站，實得 ${stops.length}`)
      for (const s of stops) {
        await page.click(`#route .stop[data-mission="${s.id}"]`)
        await page.waitForTimeout(80)
        const pane = await page.evaluate(() => ({
          go: document.querySelector('#brief-go') !== null,
          soon: document.querySelector('#brief .soonbox') !== null,
          obj: document.querySelector('#brief .obj')?.textContent ?? '',
          units: document.querySelectorAll('#brief .unit').length,
          facts: document.querySelectorAll('#brief .fact').length,
        }))
        console.log(`  ${s.soon ? '✗' : '✓'} ${s.title}${s.soon ? '（準備中）' : `　${pane.obj}　編制 ${pane.units} 列`}`)
        if (s.soon) {
          if (pane.go) fail(`「${s.title}」準備中卻有出擊鈕`)
          if (!pane.soon) fail(`「${s.title}」準備中卻沒有說明`)
        } else {
          if (!pane.go) fail(`「${s.title}」可玩卻沒有出擊鈕`)
          if (pane.obj === '') fail(`「${s.title}」右欄沒有目標`)
          // 【至少一列】沒有敵機的關只有我方那一列
          if (pane.units < 1) fail(`「${s.title}」右欄的編制一列都沒有`)
          // 【恰好兩列】簡報只留空域與時期，時限／增援／
          // 中途變更／撤離點都拿掉了（出擊前不會知道的事不寫在簡報上）
          if (pane.facts !== 2) fail(`「${s.title}」右欄應該恰好兩列（空域、時期），實得 ${pane.facts}`)
          ready.push({ campaign: c.id, id: s.id, title: s.title })
        }
      }
    }
    console.log(`[任務] 打得起來的：${ready.length} 關`)
    if (ready.length !== 9) fail(`應該有九關打得起來，實得 ${ready.length}`)
    await page.screenshot({ path: SHOTS + 'mission-1-brief.png' })

    // ── 3. 每一關都真的進得了戰鬥，而且目標列出現 ──────────
    const launch = async (r: { campaign: string; id: string }) => {
      await toCampaign(r.campaign)
      await page.click(`#route .stop[data-mission="${r.id}"]`)
      await page.waitForTimeout(100)
      await page.click('#brief-go')
      await page.waitForTimeout(2500)
    }
    for (const r of ready) {
      await launch(r)
      screens = await visibleScreens()
      if (screens.length !== 0) fail(`「${r.title}」進入戰鬥後不該有 .screen 可見，實得 ${screens.join('/')}`)
      const ink = await hudGreen(OBJECTIVE_BOX)
      const line = logs.find((t) => t.includes('×')) ?? '(沒有印出編制)'
      console.log(`  ✓ ${r.title}　目標列 ${ink} px　${line.replace('[戰鬥] ', '')}`)
      if (ink <= 0) fail(`「${r.title}」的目標列沒有畫出來`)
      if (errors.length > 0) fail(`「${r.title}」有 console 錯誤：${errors.join(' / ')}`)
      logs.length = 0
    }
    await page.screenshot({ path: SHOTS + 'mission-2-battle.png' })

    // ── 4. 圓環：護送卡有、殲滅卡沒有（對照組） ─────────────
    const ringOf = async (r: { campaign: string; id: string }) => {
      await launch(r)
      return page.evaluate(() => {
        const p = (window as unknown as Record<string, () => unknown>)['__probe']!()
        return p as { ring: boolean; tgtOn: boolean } | null
      })
    }
    const convoy = await ringOf({ campaign: 'allies', id: 'allies-m1' })
    const kill = await ringOf({ campaign: 'japan', id: 'japan-m3' })
    console.log(`[任務] 圓環：護送 ring=${convoy?.ring}/target=${convoy?.tgtOn}`
      + `、殲滅 ring=${kill?.ring}/target=${kill?.tgtOn}`)
    if (convoy === null || kill === null) fail('__probe 回了 null —— 不在戰鬥裡？')
    if (!convoy.tgtOn) fail('護送任務應該有終點')
    if (!convoy.ring) fail('護送任務有終點，圓環卻不在場景裡')
    if (kill.tgtOn) fail('殲滅任務不該有終點')
    if (kill.ring) fail('殲滅任務不該把圓環加進場景')

    // ── 5. 結算的出口：任務模式顯示「回任務列表」 ──────────
    const actionsHidden = await hidden('#board-actions')
    if (actionsHidden !== true) fail('戰鬥進行中 #board-actions 應該是藏的')
    const toSetupHidden = await hidden('[data-act="toSetup"]')
    const toMissionHidden = await hidden('[data-act="toMission"]')
    console.log(`[任務] 結算出口：回設定頁 hidden=${toSetupHidden}、回任務列表 hidden=${toMissionHidden}`)
    if (toSetupHidden !== true) fail('任務模式下「回設定頁」應該藏起來')
    if (toMissionHidden !== false) fail('任務模式下「回任務列表」應該顯示')

    // ── 6. 返回鈕：簡報 → 陣營 → 主選單 ─────────────────────
    await toCampaign('germany')
    await page.click('#mission .back')
    await page.waitForTimeout(100)
    screens = await visibleScreens()
    if (screens.join() !== 'campaign') fail(`簡報的返回應該回陣營頁，實得 ${screens.join('/')}`)
    await page.click('#campaign .back')
    await page.waitForTimeout(100)
    screens = await visibleScreens()
    if (screens.join() !== 'menu') fail(`陣營的返回應該回主選單，實得 ${screens.join('/')}`)

    // ── 7. 反證：遭遇戰不顯示目標列，出口換回設定頁 ─────────
    // 【這一條讓「目標列真的分流」可證偽】少了它，一個恆真的目標列
    // （例如 `objectiveActive` 寫死 true）也會讓第 3 條全綠
    await page.click('[data-act="skirmish"]')
    await page.waitForTimeout(150)
    await page.click('#skirmish [data-act="fight"]')
    await page.waitForTimeout(2500)
    const inkSkirmish = await hudGreen(OBJECTIVE_BOX)
    console.log(`[遭遇戰] 目標列 ${inkSkirmish} px、回設定頁 hidden=${await hidden('[data-act="toSetup"]')}`)
    if (inkSkirmish > 0) fail('遭遇戰不該畫目標列')
    if (await hidden('[data-act="toSetup"]') !== false) fail('遭遇戰下「回設定頁」應該顯示')
    if (await hidden('[data-act="toMission"]') !== true) fail('遭遇戰下「回任務列表」應該藏起來')
    if (errors.length > 0) fail(`遭遇戰有 console 錯誤：${errors.join(' / ')}`)

    console.log('\n任務線：全部通過')
  } finally {
    await browser.close()
  }
}

void main()
