/**
 * **在真的遊戲裡跑攔截關（germany-m1），一進戰鬥就按代飛，量玩家座位的軌跡。**
 *
 * 【2026-09-04 量的東西變了】舊版跑的是「護送 He 111」那張卡，12 關改版
 * （2026-09-03）後那張卡沒了。現在指名 `germany-m1`：玩家在**攔截方**，
 * 對面是 P-51 護航的 B-17 流 —— 下面的數字是攔截 AI 的實戰，不再是護航 AI 的。
 * 不由 vitest 執行（副檔名 `.e2e.ts`）。跑法（兩個終端機）：
 *
 * ```
 * npm run dev                                     # 終端機一
 * npx vite-node test/e2e/escort-live.e2e.ts       # 終端機二
 * ```
 *
 * 【為什麼不能只靠 `escort-trace.probe.ts`】那一支直接呼叫 `stepBattle`，
 * 中間跳過了 `main.ts` 的整條接線：什麼時候換控制器、指揮層每幀做什麼、
 * 固定步長迴圈撞到 `maxSubsteps` 會丟時間。專案負責人回報的是**遊戲裡**
 * 按代飛看到的行為，那條路徑只有這一支走得到。
 *
 * 【為什麼「馬上按代飛」】離線探針是從 t=0 就 AI 代飛。要讓兩邊可以逐條
 * 對照，這裡就得盡早按下 `I`；晚按等於換了初始條件（見 probe 的 `HANDOFF`）。
 *
 * 【資料從哪來】`main.ts` 尾巴的 `window.__probe()`。它回的是純數字，
 * 不是 `battle` 本身 —— 跨 CDP 傳一整棵物件圖既慢又會踩到循環參考。
 *
 * ── 哪些是斷言、哪些是給人看的 ──
 *
 * **是斷言**（會 throw）：進得了戰鬥、代飛真的接管、取樣拿得到、console
 * 沒有錯誤。
 *
 * **給人看的**：軌跡摘要與 JSON。這一支的用途是**量**，不是守 —— 判準
 * 是「玩起來合不合理」，那要人看（`judge-by-feel-not-efficiency`）。
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const URL = process.env['URL'] ?? 'http://localhost:5173/'
/** 要跑幾秒**物理時間**。交會大約在 25 s，之後留 65 s 看它怎麼收拾 */
const SECONDS = Number(process.env['SECONDS'] ?? 90)
/** 牆鐘上限。無頭 WebGL 會慢動作，沒有這道閘門會等到天荒地老 */
const WALL_CAP_MS = Number(process.env['WALL'] ?? 420_000)
const OUT = process.env['OUT'] ?? 'live-trace.json'

/** `__probe()` 回的一個取樣點。欄位語意見 `main.ts` 的那個出口 */
interface Sample {
  t: number
  ai: boolean
  alive: boolean
  x: number, y: number, z: number
  v: number
  ga: number
  bk: number
  cmd: number
  intent: string
  mode: string
  tpb: number
  asp: number
  by: number
  tr: number
  sub: number
  rd: number
}

function fail(msg: string): never {
  throw new Error(msg)
}

async function main(): Promise<void> {
  /**
   * **預設開有頭。**
   *
   * 【為什麼不是無頭】無頭 chromium 走軟體 WebGL（SwiftShader），四十架
   * 飛機加海面一幀要兩百毫秒上下，物理迴圈整場撞在 `maxSubsteps` 的上限
   * ——70 秒物理時間要跑 482 秒牆鐘。有頭走真的 GPU，那一段整個省掉。
   *
   * 【天花板在哪】就算渲染免費也快不過 **2 倍速**：`rAF` 鎖 60 fps，
   * 每幀最多推進 8 × 1/240 = 33 ms 模擬時間。要更快只能離線跑探針。
   *
   * 【什麼時候該切回無頭】沒有桌面的環境（CI、遠端）。`HEADLESS=1`。
   */
  const browser = await chromium.launch({ headless: process.env['HEADLESS'] === '1' })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))
    // 【404 要知道是哪一個檔】console 只說「Failed to load resource」，
    // 光憑那一句分不出是缺了資源還是瀏覽器自己要 favicon
    page.on('response', (r) => {
      if (r.status() >= 400) console.log(`[實戰] HTTP ${r.status()}　${r.url()}`)
    })

    await page.goto(URL)

    /**
     * 消融：`DP` 是一段 JSON，逐欄蓋掉 `DEFAULT_DOCTRINE`。與離線探針的
     * 同名環境變數是同一套值，A/B 才對得起來。改動前的那一版是
     *
     *   DP='{"turnPlaneMaxPitch":0,"sweetSpotMaxPitch":0.17453292519943295}'
     *
     * 【要在開戰之前】見 `main.ts` 的 `__doctrine`
     */
    const dp = process.env['DP']
    if (dp !== undefined && dp !== '') {
      const applied = await page.evaluate(
        (p) => (window as unknown as {
          __doctrine: (x: unknown) => Record<string, number>
        }).__doctrine(JSON.parse(p)),
        dp,
      )
      console.log(
        `[實戰] 打法覆寫 ${dp}`
        + `　→ turnPlaneMaxPitch=${applied['turnPlaneMaxPitch']!.toFixed(4)}`
        + ` sweetSpotMaxPitch=${applied['sweetSpotMaxPitch']!.toFixed(4)}`,
      )
    }

    // ── 1. 進到德軍的攔截卡（germany-m1）──────────────────────
    await page.click('[data-act="start"]')
    await page.click('[data-act="mission"]')
    await page.waitForTimeout(300)

    /**
     * 點卡片，**同一個 tick 裡**就把代飛按下去。
     *
     * 【為什麼不能先按】`I` 切的是 `input.playerAi`，而開新戰鬥會走
     * `leaveGodView()`，那一支把它清成 `false`（`main.ts` 的註解寫著理由：
     * 不清的話新的一場開頭是 AI 在飛）。所以只能在戰鬥建好之後按。
     *
     * 【為什麼不能等 playwright 的 `keyboard.press`】那要一次 CDP 往返，
     * 實測遊戲已經跑了 0.17 s —— 那零點幾秒是玩家控制器在飛（沒有輸入
     * = 收油門），初始條件就與離線探針分家。空戰是混沌的，四十秒後兩條
     * 軌跡完全不同。卡片的 `click` 是同步的，戰鬥在它回來時已經建好，
     * 下一行的 `dispatchEvent` 仍在第一幀之前。
     */
    // 【2026-09-04 改用 id 選卡】舊版找標題含「He 111」的卡，那張卡在 12 關改版
    // （2026-09-03）時就沒了 —— 這支從那天起就是壞的。改指名 `germany-m1`
    // （攔截 B-17，德軍唯一還有 convoy 的卡）。**量的東西變了**：原本是護航 AI
    // 的實戰，現在是攔截方 —— 檔頭的說明要跟著讀。路線圖的站帶
    // `data-mission="<id>"`，標題會改、id 不會
    await page.click('#campaign-cards button[data-campaign="germany"]')
    await page.waitForTimeout(150)
    const picked = await page.evaluate(() => {
      const stop = document.querySelector<HTMLButtonElement>('#route .stop[data-mission="germany-m1"]')
      if (stop === null) return null
      stop.click()
      const go = document.querySelector<HTMLButtonElement>('#brief-go')
      if (go === null) return null
      go.click()
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI' }))
      return stop.querySelector('.n')?.textContent ?? 'germany-m1'
    })
    if (picked === null) fail('德軍那條線找不到可出擊的 germany-m1')
    console.log(`[實戰] 進入關卡：${picked}`)

    // ── 2. 確認一進戰鬥就是代飛 ─────────────────────────────
    await page.waitForFunction(
      () => (window as unknown as { __probe?: () => unknown }).__probe?.() != null,
      undefined, { timeout: 60_000 },
    )

    /**
     * 【進了戰鬥就把視窗縮到最小】無頭 chromium 走軟體 WebGL，1280×720
     * 下整場撞在 `maxSubsteps` 的上限，90 秒物理時間要跑十分鐘牆鐘。
     *
     * 【縮小不會改變軌跡】步長是固定的 1/240，掉幀只讓**時間流逝變慢**，
     * 每一步的 dt 一個字都沒變。選單那一段不能縮 —— 卡片會被推出視窗外，
     * playwright 就點不到了。
     */
    await page.setViewportSize({ width: 320, height: 180 })

    const first = await page.evaluate(
      () => (window as unknown as { __probe: () => Sample }).__probe(),
    ) as Sample
    if (!first.ai) fail('按了 I 之後代飛沒有生效')
    console.log(
      `[實戰] 代飛已接管 @ t=${first.t.toFixed(2)} s`
      + `　高度 ${first.y.toFixed(0)} m　空速 ${first.v.toFixed(0)} m/s`
      + `　反應延遲 ${first.rd.toFixed(3)} s`,
    )

    // ── 3. 逐拍取樣 ─────────────────────────────────────────
    const out: Sample[] = []
    const wall0 = Date.now()
    let last = -1
    while (true) {
      const s = await page.evaluate(
        () => (window as unknown as { __probe: () => Sample | null }).__probe(),
      ) as Sample | null
      if (s === null) break
      // 【同一個物理時刻不重複記】無頭下一次 evaluate 往返可能比一幀還快
      if (s.t > last) { out.push(s); last = s.t }
      if (s.t >= SECONDS) break
      if (!s.alive) { console.log(`[實戰] 玩家在 t=${s.t.toFixed(1)} s 陣亡`); break }
      if (Date.now() - wall0 > WALL_CAP_MS) {
        console.log(`[實戰] 牆鐘用完，只跑到 t=${s.t.toFixed(1)} s`)
        break
      }
      await page.waitForTimeout(100)
    }
    if (out.length < 10) fail(`只取到 ${out.length} 個取樣點，量不出任何東西`)

    const wall = (Date.now() - wall0) / 1000
    const subAvg = out.reduce((a, s) => a + s.sub, 0) / out.length
    console.log(
      `[實戰] ${out.length} 個取樣點　物理 ${last.toFixed(1)} s / 牆鐘 ${wall.toFixed(0)} s`
      + `　平均子步 ${subAvg.toFixed(1)}/幀`,
    )
    // 【子步撞頂 = 慢動作】撞頂時 `advance` 會丟時間，物理時鐘與牆鐘分家。
    // 軌跡本身仍然正確（步長是固定的），但要讓人知道這一場是慢動作跑的
    if (subAvg > 7.5) console.log('        （子步撞到 8 的上限，這一場是慢動作）')

    // ── 4. 主判準：與 `escort-trace.probe.ts` 同一套 ─────────
    //
    // 【錨點用交會而不是「掉到轟炸機下面」】後者正是這一輪要修掉的東西，
    // 拿它框窗的話**修好之後窗就框不出來、摘要變成空的** —— 成功反而讀
    // 不到數字。交會不論修得成不成功都會發生。
    const MERGE_RANGE = 600
    const LEAD_IN = 10
    const SPAN = 40
    /** 坡度低於這個值算「機翼接近水平」，見 probe 檔裡的推導 */
    const BANK_LEVEL = 10

    const mergeAt = out.findIndex((s) => s.tr > 0 && s.tr < MERGE_RANGE)
    if (mergeAt < 0) {
      console.log(`[實戰] 主判準：這一場沒有交會（目標距離從未進到 ${MERGE_RANGE} m）`)
    } else {
      const t0 = out[mergeAt]!.t
      const win = out.filter((s) => s.t >= t0 - LEAD_IN && s.t <= t0 + SPAN)
      let trough = win[0]!
      for (const s of win) if (s.y < trough.y) trough = s
      let peak = win[0]!
      for (const s of win) { if (s.t >= trough.t) break; if (s.y > peak.y) peak = s }
      let dive = 0
      for (const s of win) {
        if (s.t < peak.t) continue
        if (Math.abs(s.bk) > BANK_LEVEL) break
        if (s.cmd < dive) dive = s.cmd
      }
      const gap = Number.isFinite(trough.by) ? (trough.y - trough.by).toFixed(0) : 'n/a'
      console.log(
        `[實戰] 主判準  谷底對轟炸機 ${gap} m`
        + `  |  峰值→谷底 ${(peak.y - trough.y).toFixed(0)} m`
        + `  |  第一段指令 γ 極值 ${dive.toFixed(1)}°`
        + `  |  谷底 ${trough.y.toFixed(0)} m @ ${trough.t.toFixed(1)} s`
        + `  |  交會 @ ${t0.toFixed(1)} s`,
      )
    }

    // ── 5. 迴轉平面選了什麼 ─────────────────────────────────
    //
    // 這才是這一輪改動的**直接**產物：偏置為負 = 俯衝迴旋、正 = 拉高、
    // 0 = 水平（不是「不出手」—— 水平迴旋的俯仰偏置本來就是 0）
    const dive = out.filter((s) => s.tpb < -0.05).length
    const climb = out.filter((s) => s.tpb > 0.05).length
    const pct = (n: number): string => (100 * n / out.length).toFixed(1) + '%'
    console.log(
      `[實戰] 迴轉平面  俯衝 ${pct(dive)}　拉高 ${pct(climb)}`
      + `　水平 ${pct(out.length - dive - climb)}`,
    )
    // 最陡的一段實際航跡角 —— 「還有沒有在俯衝」的直接答案
    let steepest = out[0]!
    for (const s of out) if (s.ga < steepest.ga) steepest = s
    console.log(
      `[實戰] 最陡的一刻  航跡角 ${steepest.ga.toFixed(1)}° @ ${steepest.t.toFixed(1)} s`
      + `　高度 ${steepest.y.toFixed(0)} m　坡度 ${steepest.bk.toFixed(0)}°`
      + `　夾角 ${steepest.asp.toFixed(0)}°　${steepest.intent}/${steepest.mode}`,
    )

    writeFileSync(OUT, JSON.stringify({ url: URL, seconds: last, samples: out }))
    console.log(`[實戰] 軌跡寫到 ${OUT}`)

    if (errors.length > 0) fail(`console 有 ${errors.length} 筆錯誤：\n${errors.join('\n')}`)
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
