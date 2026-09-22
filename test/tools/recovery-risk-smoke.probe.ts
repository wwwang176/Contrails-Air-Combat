/**
 * 德軍第三個可玩關卡（資料 id `germany-m3`）的人工長時間試飛 probe。
 * 它留下 Worker 風險／射擊／硬接管摘要，但不屬於 E2E 或自動合併門檻；相同算法
 * 的必要契約由 recovery-worker、recovery-rollout 與 ground-strafe 小型測試負責。
 *
 * `$env:URL='http://127.0.0.1:5187/'; npx vite-node test/tools/recovery-risk-smoke.probe.ts`
 */
import { chromium } from 'playwright'

const env = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> }
}).process?.env ?? {}
const URL = env['URL'] ?? 'http://127.0.0.1:5173/'
const PHYSICAL_SECONDS = Number(env['SECONDS'] ?? 75)

interface Probe {
  t: number
  ai: boolean
  alive: boolean
  y: number
  ga: number
  cmd: number
  ru: number
  capture: boolean
  firing: boolean
  safety: string
  phase: string
  override: string
  tr: number
  gt: string
  gr: number
  gta: boolean
  gsp: 'approach' | 'egress'
  grr: number
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: env['HEADLESS'] !== '0',
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  })
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) {
        errors.push(m.text())
      }
    })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.click('[data-act="start"]')
    await page.click('[data-act="mission"]')
    await page.waitForTimeout(300)
    await page.click('#campaign-cards button[data-campaign="germany"]')
    await page.waitForTimeout(150)
    const launched = await page.evaluate(() => {
      const stop = document.querySelector<HTMLButtonElement>(
        '#route .stop[data-mission="germany-m3"]',
      )
      if (stop === null) return false
      stop.click()
      const go = document.querySelector<HTMLButtonElement>('#brief-go')
      if (go === null) return false
      go.click()
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI' }))
      return true
    })
    if (!launched) throw new Error('找不到或無法啟動 germany-m3')
    await page.waitForFunction(
      () => (window as unknown as { __probe?: () => unknown }).__probe?.() != null,
      undefined, { timeout: 60_000 },
    )
    await page.setViewportSize({ width: 480, height: 270 })

    const events: Probe[] = []
    let last: Probe | null = null
    let maxUrgency = 0
    let firingSamples = 0
    let firingRiskSamples = 0
    let riskSamples = 0
    let hardSamples = 0
    let captureSamples = 0
    let levelCaptureSamples = 0
    let farCommandJumps = 0
    let groundPrioritySamples = 0
    let groundPriorityWithAirTargetSamples = 0
    let groundFireSamples = 0
    let egressSamples = 0
    let maxEgressRange = 0
    let reentryRange = -1
    let releaseTransitions = 0
    let downwardAfterReleaseSamples = 0
    let releaseObservedAt = -Infinity
    let minAltitude = Infinity
    const phases = new Set<string>()
    const overrides = new Set<string>()
    const wallLimit = Date.now() + 180_000
    while (Date.now() < wallLimit) {
      // 無頭 Chromium 偶爾會自行失去 pointer lock，正式遊戲依設計因此暫停。
      // 量測腳本要按「繼續」，否則牆鐘一直走、物理時鐘卻停住，最後會把
      // 「根本還沒飛到低空」誤報成 Worker 沒有運作。
      const pause = page.locator('#pause')
      if (await pause.isVisible()) {
        await pause.locator('[data-act="resume"]').click()
      }
      const sample = await page.evaluate(
        () => (window as unknown as { __probe: () => Probe | null }).__probe(),
      )
      if (sample === null) break
      if (!sample.alive) {
        last = sample
        break
      }
      phases.add(sample.phase)
      overrides.add(sample.override)
      const reachedEnd = sample.t >= PHYSICAL_SECONDS
      if (sample.ru > maxUrgency) maxUrgency = sample.ru
      if (sample.ru > 0) riskSamples++
      if (sample.firing) {
        firingSamples++
        if (sample.ru > 0) firingRiskSamples++
      }
      if (sample.safety === 'ground' || sample.safety === 'terrain') hardSamples++
      if (sample.gt === 'parkedP51' || sample.gta) {
        groundPrioritySamples++
        if (sample.tr >= 0) groundPriorityWithAirTargetSamples++
        if (sample.firing) groundFireSamples++
      }
      const attackRange = sample.gta ? sample.tr : sample.gr
      if (sample.gsp === 'egress') {
        egressSamples++
        if (attackRange > maxEgressRange) maxEgressRange = attackRange
      } else if (last?.gsp === 'egress' && attackRange >= 0) {
        reentryRange = attackRange
      }
      if (sample.capture) {
        captureSamples++
        if (Math.abs(sample.cmd) < 0.1) levelCaptureSamples++
      }
      if (last?.capture === true && !sample.capture && sample.gta
        && sample.gsp === 'approach') {
        releaseTransitions++
        releaseObservedAt = sample.t
      }
      if (sample.t - releaseObservedAt <= 15 && sample.gta && sample.cmd < -0.5) {
        downwardAfterReleaseSamples++
      }
      if (last !== null && sample.tr > 2500 && Math.abs(sample.cmd - last.cmd) >= 6) {
        farCommandJumps++
      }
      if (sample.y < minAltitude) minAltitude = sample.y
      if (last === null || sample.firing !== last.firing || sample.safety !== last.safety
        || sample.capture !== last.capture
        || Math.abs(sample.ru - last.ru) >= 0.2) events.push(sample)
      last = sample
      if (reachedEnd) break
      await page.waitForTimeout(100)
    }

    const worker = await page.evaluate(() => {
      const debug = (window as unknown as {
        __recoveryWorker?: { stats: Record<string, number | boolean> }
      }).__recoveryWorker
      return debug?.stats ?? null
    })
    console.log(JSON.stringify({
      last, minAltitude, maxUrgency, firingSamples, firingRiskSamples, riskSamples, hardSamples,
      captureSamples, levelCaptureSamples, farCommandJumps,
      groundPrioritySamples, groundPriorityWithAirTargetSamples, groundFireSamples,
      egressSamples, maxEgressRange, reentryRange, releaseTransitions, downwardAfterReleaseSamples,
      phases: [...phases], overrides: [...overrides], worker, events: events.slice(-30), errors,
    }, null, 2))
    if (last?.ai !== true) throw new Error('玩家座位沒有交給 AI')
    if (!last.alive) throw new Error('玩家座機在觀察期間墜毀或被擊落')
    if (last.t < PHYSICAL_SECONDS) {
      throw new Error(`觀察逾時：只完成 ${last.t.toFixed(1)} / ${PHYSICAL_SECONDS} 秒物理時間`)
    }
    if (worker === null || Number(worker['completed']) <= 0) throw new Error('Worker 沒有完成預演')
    if (Number(worker['failures']) !== 0) throw new Error('Worker 預演發生錯誤')
    if (!(maxUrgency > 0)) throw new Error('Worker 結果沒有發布預演風險')
    if (!(firingRiskSamples > 0)) throw new Error('沒有觀察到風險存在時仍保留射擊解')
    if (!(levelCaptureSamples > 0)) throw new Error('硬改出後沒有進入水平捕獲')
    if (!(releaseTransitions > 0)) throw new Error('Worker 安全確認後沒有解除對地捕獲')
    if (!(downwardAfterReleaseSamples > 0)) {
      throw new Error('解除對地捕獲後沒有交還低頭瞄準命令')
    }
    if (!(groundPrioritySamples > 0)) throw new Error('沒有觀察到 AI 鎖定地面 P-51')
    if (!(groundPriorityWithAirTargetSamples > 0)) {
      throw new Error('有空中敵機時沒有保持地面 P-51 優先')
    }
    if (!(egressSamples > 0)) throw new Error('沒有觀察到飛越後鎖存的掃射離場段')
    if (!phases.has('對地進場') || !phases.has('對地離場')) {
      throw new Error(`HUD 沒有發布完整對地航次：${[...phases].join('、')}`)
    }
    if (![...overrides].some((override) => override.startsWith('防墜'))) {
      throw new Error(`HUD 沒有發布防墜介入：${[...overrides].join('、')}`)
    }
    if (!(maxEgressRange > 1000)) {
      throw new Error(`離場未拉開到可重新進場的距離：${maxEgressRange.toFixed(0)} m`)
    }
    // `firing` 是 0.3 秒延遲後的輸出，而 gta 是當格的原始目標；兩者不能用
    // 同一格做硬斷言。真實命中由 asch-strafe.probe 的地面擊毀數判讀。
    if (farCommandJumps > 6) throw new Error(`遠距命令仍反覆跳變：${farCommandJumps} 次`)
    if (errors.length > 0) throw new Error(`頁面錯誤：${errors.join(' | ')}`)
  } finally {
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  throw error
})
