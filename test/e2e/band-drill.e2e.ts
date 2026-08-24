/**
 * **空層鎖的有頭實戰驗收** —— 在真實遊戲裡跑 1v1 打不死靶機。
 * 不是測試套件的一部分。跑法（dev server 要先開著）：
 *   npx vite-node test/e2e/band-drill.e2e.ts
 *   SECONDS=60 ALT=5000 npx vite-node test/e2e/band-drill.e2e.ts
 *
 * 【場景由專案負責人指定】「用 PLAYWRIGHT 有頭實際測試，情境可以設定一台
 * 打不死的靶機（永遠直飛）跟我機面對面 1v1。」場景組裝在 `main.ts` 的
 * `__drill`：Bf 109（玩家座位、開戰即代飛）對 P-51 靶機，5000 m 對頭 3 km。
 *
 * 【與離線探針的分工】`band-drill.probe.ts` 快（幾秒一場）、逐拍、四個開局，
 * 日常量測用它。這一支走完整的遊戲接線（main.ts → createBattle → 代飛），
 * 守的是「離線量到的行為就是玩家看到的行為」—— profile 漏接那一課。
 *
 * 【預設有頭】無頭走軟體 WebGL，一幀兩百毫秒；有頭走真 GPU、1:1 即時。
 * `HEADLESS=1` 給沒有桌面的環境。
 */
import { chromium } from 'playwright'

const URL = process.env['URL'] ?? 'http://localhost:5173/'
const SECONDS = Number(process.env['SECONDS'] ?? 90)
const ALT = Number(process.env['ALT'] ?? 5000)
const WALL_CAP_MS = Number(process.env['WALL'] ?? 300_000)

interface Sample {
  t: number
  ai: boolean
  alive: boolean
  y: number
  v: number
  ga: number
  bk: number
  cmd: number
  intent: string
  mode: string
  asp: number
  tr: number
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: process.env['HEADLESS'] === '1' })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(URL)
    await page.waitForFunction(() => '__drill' in window)

    // 【開戰與代飛在同一個 tick】enterBattle 會經 leaveGodView 把
    // input.playerAi 清掉，所以 KeyI 必須在 __drill 之後、下一幀之前送進去
    const info = await page.evaluate((alt) => {
      const w = window as unknown as {
        __drill: (a: number) => { seat: number, drone: number }
      }
      const out = w.__drill(alt)
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI' }))
      return out
    }, ALT)
    console.log(`[演練] 座位 #${info.seat}　靶機 #${info.drone}　${ALT} m 對頭`)

    const samples: Sample[] = []
    const t0 = Date.now()
    for (;;) {
      const s = await page.evaluate(() =>
        (window as unknown as { __probe: () => Sample | null }).__probe())
      if (s !== null) {
        samples.push(s)
        if (s.t >= SECONDS) break
        if (!s.alive) { console.log(`[演練] ${s.t.toFixed(1)} s 自機墜毀`); break }
      }
      if (Date.now() - t0 > WALL_CAP_MS) { console.log('[演練] 牆鐘到頂'); break }
      await page.waitForTimeout(1000)
    }

    // ── 摘要 ────────────────────────────────────────────
    console.log('\n   t    高度   空速   航跡   指令   坡度   夾角   距離   意圖     模式')
    for (const s of samples) {
      if (Math.round(s.t) % 4 !== 0 && s.t < SECONDS) continue
      console.log(
        `  ${s.t.toFixed(0).padStart(3)} ${s.y.toFixed(0).padStart(6)}`
        + ` ${s.v.toFixed(0).padStart(5)} ${s.ga.toFixed(0).padStart(5)}°`
        + ` ${s.cmd.toFixed(0).padStart(5)}° ${s.bk.toFixed(0).padStart(5)}°`
        + ` ${s.asp.toFixed(0).padStart(5)}° ${s.tr.toFixed(0).padStart(6)}`
        + `  ${s.intent.padEnd(8)} ${s.mode}`,
      )
    }

    // 交會：距離的第一個極小值
    let merge = 0
    for (let i = 1; i < samples.length - 1; i++) {
      if (samples[i]!.tr > 0 && samples[i]!.tr <= samples[i - 1]!.tr
        && samples[i]!.tr < samples[i + 1]!.tr) { merge = i; break }
    }
    const after = samples.filter((s) => s.t >= samples[merge]!.t)
    const ys = after.map((s) => s.y)
    if (after.length > 1) {
      console.log(
        `\n[演練] 交會 ${samples[merge]!.t.toFixed(0)} s`
        + `　之後帶寬 ${(Math.max(...ys) - Math.min(...ys)).toFixed(0)} m`
        + `　最低 ${(Math.min(...ys) - ALT).toFixed(0)} m（相對 ${ALT}）`,
      )
    }
    if (errors.length > 0) {
      console.log(`\n[演練] 瀏覽器錯誤 ${errors.length} 條：`)
      for (const e of errors.slice(0, 5)) console.log('  ' + e)
    }
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
