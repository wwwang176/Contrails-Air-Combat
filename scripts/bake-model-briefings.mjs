/** Composite model-rendered PNG masks over terrain, then bake a single WebP.
 * Layout positions are schematic; counts and model types come from captures.
 */
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
const folder = 'public/ui/maps'
const layouts = JSON.parse(await readFile(`${folder}/reference/model-layouts.json`, 'utf8'))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  await page.route('**/src/main.ts*', r => r.fulfill({ contentType: 'application/javascript', body: '' }))
  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'domcontentloaded' })
  for (const chart of layouts.filter(chart => !process.argv[2] || chart.id === process.argv[2])) {
    const snapshot = JSON.parse(await readFile(`${folder}/reference/${chart.id}-opening.json`, 'utf8'))
    for (const group of chart.groups) {
      const actual = snapshot[group.source].filter(u => u.alive && !u.dormant && u.team === group.team && group.units.includes(u.id ?? u.cls))
      if (actual.length !== group.instances.length) throw new Error(`${chart.id}/${group.id}: ${group.instances.length} drawings for ${actual.length} units`)
    }
    const result = await page.evaluate(async chart => {
      const load = async src => { const image = new Image(); image.src = src; await image.decode(); return image }
      const background = await load(`/ui/maps/tactical/${chart.id}-terrain.webp`)
      const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 1200
      const ctx = canvas.getContext('2d'); ctx.scale(1.5,1.5)
      const crop = chart.crop ?? [0,0,1200,800], sx = background.width/1200, sy=background.height/800
      ctx.drawImage(background, crop[0]*sx,crop[1]*sy,crop[2]*sx,crop[3]*sy,0,0,1200,800)
      const refined = chart.style === 'field-print'
      if (refined) {
        ctx.fillStyle='rgba(22,25,23,.28)';ctx.fillRect(0,0,1200,800)
        const shade=ctx.createRadialGradient(580,320,180,600,400,740)
        shade.addColorStop(0,'rgba(15,20,18,0)');shade.addColorStop(1,'rgba(10,15,13,.62)')
        ctx.fillStyle=shade;ctx.fillRect(0,0,1200,800)
        ctx.save();ctx.strokeStyle='rgba(200,190,155,.065)';ctx.lineWidth=.7
        for(let x=60;x<1200;x+=120){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,800);ctx.stroke()}
        for(let y=40;y<800;y+=120){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1200,y);ctx.stroke()}
        ctx.restore()
      }
      const colors = refined ? {blue:'#a0b7bc',red:'#d17e76'} : { blue:'#89bde8', red:'#db9b82' }
      const label = (text,x,y,team='red',size=22) => {
        ctx.save();ctx.font=refined ? `500 ${size-3}px Arial` : `600 ${size}px Georgia`;ctx.textAlign='center';ctx.lineJoin='round';ctx.strokeStyle='#292a23';ctx.lineWidth=refined?2:4;ctx.strokeText(text,x,y);ctx.fillStyle=colors[team];ctx.fillText(text,x,y);ctx.restore()
      }
      for (const route of chart.routes) {
        const [x,y,cx,cy,ex,ey] = route.path
        ctx.save();ctx.strokeStyle=colors[route.team];ctx.fillStyle=colors[route.team];ctx.lineWidth=2.5;ctx.setLineDash(route.team==='blue'?[12,8]:[])
        ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(cx,cy,ex,ey);ctx.stroke();ctx.setLineDash([])
        const angle=Math.atan2(ey-cy,ex-cx);ctx.translate(ex,ey);ctx.rotate(angle);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-12,-5);ctx.lineTo(-12,5);ctx.closePath();ctx.fill();ctx.restore()
      }
      for (const group of chart.groups) {
        for (const item of group.instances) {
          const raw=await load(`/ui/maps/model-silhouettes/${item.model}.png`)
          const mask=document.createElement('canvas');mask.width=raw.width;mask.height=raw.height
          const m=mask.getContext('2d');m.drawImage(raw,0,0);m.globalCompositeOperation='source-in';m.fillStyle=group.team==='red'?'#d17e76':(group.ink ?? '#a5bbc0');m.fillRect(0,0,mask.width,mask.height)
          if(refined){
            // Deterministic wear stays inside the original model alpha mask.
            m.globalCompositeOperation='destination-out';m.fillStyle='rgba(0,0,0,.15)'
            let seed=71
            for(let i=0;i<5500;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const x=seed%mask.width;seed=(Math.imul(seed,1664525)+1013904223)>>>0;m.fillRect(x,seed%mask.height,2,1)}
          }
          const height=item.width*raw.height/raw.width
          ctx.save();ctx.translate(item.x,item.y);if(item.flip)ctx.scale(-1,1);ctx.globalAlpha=item.opacity??1;ctx.shadowColor='#181c19';ctx.shadowBlur=refined?1:3;ctx.shadowOffsetY=1;ctx.drawImage(mask,-item.width/2,-height/2,item.width,height);ctx.restore()
        }
        if(group.label)label(group.label.text,group.label.x,group.label.y,group.team)
      }
      for(const air of chart.air) {
        ctx.save();ctx.translate(air.x,air.y);ctx.strokeStyle=colors[air.team];ctx.fillStyle='#292b24';ctx.lineWidth=2.5;ctx.fillRect(-37,-21,74,42);ctx.strokeRect(-37,-21,74,42);ctx.beginPath();ctx.moveTo(-37,-21);ctx.lineTo(37,21);ctx.moveTo(-37,21);ctx.lineTo(37,-21);ctx.stroke();ctx.restore();label(air.label,air.x,air.y-35,air.team,25)
      }
      return {webp:canvas.toDataURL('image/webp',.95).split(',')[1],png:canvas.toDataURL('image/png').split(',')[1]}
    }, chart)
    await writeFile(`${folder}/tactical/${chart.id}-models.webp`,Buffer.from(result.webp,'base64'))
    await mkdir(`.shots/briefing-reference/${chart.id}`,{recursive:true})
    await writeFile(`.shots/briefing-reference/${chart.id}/model-chart.png`,Buffer.from(result.png,'base64'))
    console.log(chart.id,'baked',chart.groups.reduce((n,g)=>n+g.instances.length,0),'model silhouettes')
  }
} finally { await browser.close() }
