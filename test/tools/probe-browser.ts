/** 探針共用的瀏覽器生命週期；成功、失敗都由同一個擁有者關閉。 */
import { chromium, type Browser } from 'playwright'

export async function withProbeBrowser<T>(run: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch()
  try {
    return await run(browser)
  } finally {
    await browser.close()
  }
}
