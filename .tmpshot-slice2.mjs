import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
await page.goto('http://localhost:5174/hangar.html?ref=/ref/p51d.glb|/ref/bf109e4.glb&refflip=1|1&refpitch=-9.5|0')
await page.waitForTimeout(1000)
await page.locator('#specRow button').nth(1).click()
await page.waitForTimeout(8000)
const fus = await page.evaluate(() => window.__hangarSlice('radial', 'z',
  { from: -2.30, to: 6.16, count: 44, angles: 72, axisV: 0.24, maxRadius: 0.95 }))
writeFileSync('.tmpshot/fus-bf109.json', JSON.stringify(fus))
console.log('stations', fus.planes.length)
await browser.close()
