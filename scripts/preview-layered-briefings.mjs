/** Screenshots for review only: never writes production artwork or bakes layers. */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  await page.route('**/@vite/client', r => r.fulfill({ contentType: 'application/javascript', body: '' }))
  await page.route('**/src/main.ts*', r => r.fulfill({ contentType: 'application/javascript', body: '' }))
  await page.goto('http://127.0.0.1:5199/', {waitUntil:'domcontentloaded'})
  const charts = await page.evaluate(async () => {
    const { renderMissionLayers } = await import('/src/ui/missionLayers.ts')
    const { missionArtwork } = await import('/src/ui/missionArtwork.ts')
    const { MISSIONS } = await import('/src/battle/missions/index.ts')
    const { t } = await import('/src/i18n/index.ts')
    return Object.values(MISSIONS).flat().filter(c=>c.battle).map(c=>({id:c.id,title:t(c.titleKey),svg:renderMissionLayers(c.id,missionArtwork(c.id),t(c.titleKey))}))
  })
  const ready = () => page.evaluate(async()=>{
    await Promise.all([...document.querySelectorAll('svg image')].map(async node=>{const i=new Image();i.src=node.getAttribute('href');await i.decode()}))
  })
  for (const c of charts) {
    await mkdir(`.shots/briefing-reference/${c.id}`,{recursive:true})
    await page.evaluate(svg=>{document.body.innerHTML=`<style>body{margin:0}svg.layered-art{display:block;width:1200px;height:800px}</style>${svg}`},c.svg)
    await ready()
    await page.screenshot({path:`.shots/briefing-reference/${c.id}/layer-review-full.png`})
  }
  await page.setViewportSize({width:1560,height:1600})
  await page.evaluate(charts=>{document.body.innerHTML=`<style>body{margin:0;padding:20px;background:#22231f;color:#e1d2b1;font:16px sans-serif;overflow:auto}main{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}figure{margin:0;padding:10px;background:#36362c}figcaption{margin:0 0 10px}svg.layered-art{display:block;width:100%;height:auto;aspect-ratio:1.5}</style><main>${charts.map(c=>`<figure><figcaption>${c.title}</figcaption>${c.svg}</figure>`).join('')}</main>`},charts)
  await ready()
  await page.screenshot({path:'.shots/briefing-reference/layer-review-overview.png',fullPage:true})
  console.log('Saved ten layered previews; production raster artwork unchanged.')
} finally { await browser.close() }
