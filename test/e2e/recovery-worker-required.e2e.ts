/** 真瀏覽器護欄：必要的防墜 Worker 一旦停用，遊戲必須立即阻擋。 */
import { chromium } from 'playwright'

const env = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> }
}).process?.env ?? {}
const URL = env['URL'] ?? 'http://127.0.0.1:5173/'

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForFunction(() => (
      (window as unknown as { __recoveryWorker?: unknown, __seats?: unknown })
        .__recoveryWorker !== undefined
      && (window as unknown as { __seats?: unknown }).__seats !== undefined
    ))
    const initiallyBlocked = await page.locator('#recovery-worker-blocker').count()
    if (initiallyBlocked !== 0) throw new Error('可用 Worker 卻在啟動時被阻擋')

    await page.evaluate(() => {
      const debug = (window as unknown as {
        __recoveryWorker?: { setEnabled(enabled: boolean): void }
      }).__recoveryWorker
      if (debug === undefined) throw new Error('找不到 Worker 狀態')
      debug.setEnabled(false)
    })
    const blocker = page.locator('#recovery-worker-blocker')
    await blocker.waitFor({ state: 'visible', timeout: 5_000 })
    const text = await blocker.textContent()
    if (!text?.includes('遊戲已停止')) throw new Error(`阻擋訊息不完整：${text ?? ''}`)
  } finally {
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  throw error
})
