import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
await page.goto('http://localhost:5174/hangar.html')
await page.waitForTimeout(1500)
await page.locator('#specRow button').nth(1).click()
await page.waitForTimeout(600)
for (const [n, p] of [['a', [-3.2, 2.6, -4.2]], ['b', [-4.5, 1.4, 1.2]], ['c', [-2.0, 5.0, -1.0]]]) {
  await page.evaluate((v) => window.__hangarCam(v[0], v[1], v[2]), p)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `cp-${n}.png` })
}
await browser.close()
