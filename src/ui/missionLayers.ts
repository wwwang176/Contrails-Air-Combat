import layouts from '../../public/ui/maps/reference/review-layouts.json'
import manifest from '../../public/ui/maps/model-silhouettes/manifest.json'
import { assetUrl } from '../core/asset'
import { escapeHtml } from './menuOptions'

type Side = 'blue' | 'red'
type Item = { model: string; x: number; y: number; width: number; flip?: boolean; opacity?: number }
type Box = { x: number; y: number; width: number; height: number; team: string; shape?: string; label?: string }
type Layout = {
  id: string; crop?: number[]; snow?: boolean; shade?: number; clouds: number[][]; targets: Box[]
  groups: { id: string; team: string; instances: Item[]; label?: {text: string; x: number; y: number} | null }[]
  air: {x: number; y: number; team: string; label: string; model: string; flip?: boolean}[]
  routes: {team: string; path: number[]}[]
}
const charts = layouts as Layout[]
const dimensions = new Map(manifest.map(m => [m.id, m.height / m.width]))

/** Live SVG layers: only the terrain and reusable model masks are raster assets.
 * Review positions never overwrite the approved baked plates. */
export function renderMissionLayers(id: string, terrain: string, title: string): string {
  const chart = charts.find(c => c.id === id)
  const key = `brief-${id}`
  const color = (side: string) => side === 'red' ? '#cf716b' : chart?.snow ? '#386d88' : '#a5bbc0'
  const exclusion: Box[] = chart ? [
    ...chart.groups.flatMap(g => g.instances.map(i => ({...i, height: i.width * (dimensions.get(i.model) ?? .3), team: g.team}))),
    ...chart.air.map(a => ({...a, width: 220, height: 105, y: a.y - 16})), ...chart.targets,
  ] : []
  // Reuse the game's 4 x 4 transparent cloud atlas, with unit exclusion masks.
  const clouds = chart?.clouds ?? [[70,70,85,27],[1100,745,85,26]]
  let svg = `<svg class="map-drawing tactical-art layered-art" viewBox="0 0 1200 800" role="img" aria-label="${escapeHtml(title)}" xmlns="http://www.w3.org/2000/svg"><defs>`
  for (const side of ['blue','red'] as Side[]) {
    svg += `<filter id="${key}-${side}" x="-20%" y="-30%" width="140%" height="160%">`
    if (chart?.snow) {
      svg += `<feMorphology in="SourceAlpha" operator="dilate" radius="1.8" result="outline"/><feFlood flood-color="#090b0c"/><feComposite in2="outline" operator="in" result="stroke"/>`
    }
    svg += `<feFlood flood-color="${color(side)}"/><feComposite in2="SourceAlpha" operator="in" result="unit"/>`
    if (chart?.snow) svg += `<feMerge><feMergeNode in="stroke"/><feMergeNode in="unit"/></feMerge>`
    svg += '</filter>'
    svg += `<marker id="${key}-${side}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 10 5 0 10Z" fill="${color(side)}"/></marker>`
  }
  svg += `<mask id="${key}-clear" maskUnits="userSpaceOnUse" x="0" y="0" width="1200" height="800"><rect width="1200" height="800" fill="white"/>${exclusion.map(b=>`<rect x="${b.x-b.width/2-20}" y="${b.y-b.height/2-20}" width="${b.width+40}" height="${b.height+40}" rx="18" fill="black"/>`).join('')}</mask></defs>`
  const crop = chart?.crop ?? [0,0,1200,800]
  svg += `<g data-layer="terrain"><svg width="1200" height="800" viewBox="${crop.join(' ')}" preserveAspectRatio="none"><image href="${escapeHtml(assetUrl(terrain))}" width="1200" height="800" preserveAspectRatio="none"/></svg>`
  if (chart) svg += `<rect width="1200" height="800" fill="#131a17" opacity="${chart.shade ?? .3}"/>`
  svg += '</g>'
  svg += `<g data-layer="clouds" mask="url(#${key}-clear)" opacity=".3">${clouds.map(([x=0,y=0,w=100],i)=>{const tile=[4,10,6][i%3]??4;return `<svg x="${x-w}" y="${y-w*.65}" width="${w*2}" height="${w*1.3}" viewBox="${tile%4*256} ${Math.floor(tile/4)*256} 256 256" preserveAspectRatio="none" overflow="hidden"><image href="${assetUrl('/textures/cloud-puffs.png')}" width="1024" height="1024"/></svg>`}).join('')}</g>`
  if (!chart) return svg + '</svg>'
  const label = (text:string,x:number,y:number,side:string) => `<text x="${x}" y="${y}" text-anchor="middle" fill="${color(side)}" font-family="Arial,sans-serif" font-size="21">${escapeHtml(text)}</text>`
  svg += `<g data-layer="routes">${chart.routes.map(r=>{const [x,y,cx,cy,ex,ey]=r.path;return `<path d="M${x} ${y}Q${cx} ${cy} ${ex} ${ey}" fill="none" stroke="${color(r.team)}" stroke-width="2.5" ${r.team==='blue'?'stroke-dasharray="12 8"':''} marker-end="url(#${key}-${r.team}-arrow)"/>`}).join('')}</g>`
  svg += `<g data-layer="units">${chart.groups.map(g=>`<g data-group="${g.id}" data-team="${g.team}">${g.instances.map((i,index)=>{const h=i.width*(dimensions.get(i.model)??.3);return `<image data-unit="${g.id}-${index}" href="${escapeHtml(assetUrl(`/ui/maps/model-silhouettes/${i.model}.png`))}" x="${-i.width/2}" y="${-h/2}" width="${i.width}" height="${h}" transform="translate(${i.x} ${i.y}) scale(${i.flip?-1:1} 1)" filter="url(#${key}-${g.team})" opacity="${i.opacity??1}"/>`}).join('')}${g.label?label(g.label.text,g.label.x,g.label.y,g.team):''}</g>`).join('')}</g>`
  svg += `<g data-layer="objectives">${chart.targets.map(b=>{const x=b.x-b.width/2,y=b.y-b.height/2,w=b.width,h=b.height,k=Math.min(18,h/3);const shape=b.shape==='circle'?`<circle cx="${b.x}" cy="${b.y}" r="${w/2}" fill="none" stroke="${color(b.team)}" stroke-width="2"/>`:`<path d="M${x+k} ${y}H${x}V${y+k}M${x+w-k} ${y}H${x+w}V${y+k}M${x} ${y+h-k}V${y+h}H${x+k}M${x+w-k} ${y+h}H${x+w}V${y+h-k}" fill="none" stroke="${color(b.team)}" stroke-width="2"/>`;return shape+(b.label?label(b.label,b.x,y-14,b.team):'')}).join('')}</g>`
  svg += `<g data-layer="air">${chart.air.map(a=>`<image data-aircraft="${a.model}" href="${assetUrl(`/ui/sil/${a.model}.png`)}" x="-62" y="-24" width="124" height="48" transform="translate(${a.x} ${a.y}) scale(${a.flip?-1:1} 1)" filter="url(#${key}-${a.team})"/>${label(a.label,a.x,a.y-35,a.team)}`).join('')}</g></svg>`
  return svg
}
