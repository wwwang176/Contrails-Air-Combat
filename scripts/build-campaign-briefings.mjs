/** Build the nine campaign charts from reviewed relative layouts and captures.
 * Terrain is imagegen artwork; symbols/routes remain editable SVG components.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { briefingSilhouette } from './briefing-silhouettes.mjs'

const root = 'public/ui/maps'
const charts = JSON.parse(await readFile(`${root}/reference/campaign-layouts.json`, 'utf8'))
const colors = { blue: '#89bde8', red: '#e48067' }
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
for (const chart of charts) {
  const source = JSON.parse(await readFile(`${root}/reference/${chart.id}-opening.json`, 'utf8'))
  const background = await readFile(`${root}/tactical/${chart.id}-terrain.webp`)
  const nodes = chart.nodes.map(node => {
    let units = source[node.source].filter(unit => unit.team === node.team)
    if (node.source !== 'aircraft') units = units.filter(unit => unit.alive && !unit.dormant)
    if (node.units) units = units.filter(unit => node.units.includes(unit.aircraft ?? unit.cls ?? unit.id))
    if (node.indices) units = units.filter(unit => node.indices.includes(unit.index))
    if (!units.length) throw new Error(`${chart.id}/${node.id}: no captured units`)
    return { ...node, count: units.length }
  })
  const byId = Object.fromEntries(nodes.map(node => [node.id, node]))
  let drawing = ''
  for (const route of chart.routes) {
    const from = byId[route.from], to = route.toPoint
      ? { x: route.toPoint[0], y: route.toPoint[1] } : byId[route.to]
    if (!from || !to) throw new Error(`${chart.id}: invalid route`)
    if (from.posture === 'defend') throw new Error(`${chart.id}: defensive units should not have attack/movement arrows`)
    if (!['attack', 'movement'].includes(route.purpose)) throw new Error(`${chart.id}: route needs an explicit purpose`)
    const dx = to.x - from.x, dy = to.y - from.y
    const length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length
    const x1 = from.x + ux * (from.icon ? 80 : 58), y1 = from.y + uy * (from.icon ? 80 : 58)
    const endGap = to.area ? Math.max(to.area.width, to.area.height) / 2 + 18 : to.icon ? 100 : 70
    const x2 = to.x - ux * endGap, y2 = to.y - uy * endGap
    const bend = route.bend ?? 0
    const cx = (x1 + x2) / 2 - uy * bend, cy = (y1 + y2) / 2 + ux * bend
    drawing += `<path data-route="${escape(route.from)}:${escape(route.to ?? 'destination')}" d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" fill="none" stroke="${colors[from.team]}" stroke-width="3" ${from.team === 'blue' ? 'stroke-dasharray="12 8"' : ''} marker-end="url(#${from.team}-arrow)"/>`
  }
  for (const node of nodes) {
    const color = colors[node.team]
    const label = `${node.label}${node.showCount === false ? '' : ` × ${node.count}`}`
    if (node.area) {
      const w = node.area.width / 2, h = node.area.height / 2, corner = 24
      drawing += `<g data-objective-area="${escape(node.id)}" transform="translate(${node.x} ${node.y})" fill="none" stroke="${color}" stroke-width="2"><path d="M${-w+corner} ${-h}H${-w}V${-h+corner}M${w-corner} ${-h}H${w}V${-h+corner}M${-w} ${h-corner}V${h}H${-w+corner}M${w} ${h-corner}V${h}H${w-corner}"/></g><text x="${node.x}" y="${node.y-h-14}" text-anchor="middle" fill="${color}">${escape(label)}</text>`
      continue
    }
    const symbol = node.icon ? `<g transform="scale(${node.facing === 'left' ? -1 : 1} 1)">${briefingSilhouette(node.icon)}</g>` : '<rect x="-37" y="-21" width="74" height="42"/><path d="M-37-21 37 21M-37 21 37-21" fill="none"/>'
    const silhouetteInk = node.team === 'blue' ? '#9cb6bd' : '#c79883'
    drawing += `<g data-formation="${escape(node.id)}" data-symbol="${node.icon ?? 'air-formation'}" transform="translate(${node.x} ${node.y})" color="${silhouetteInk}" stroke="${node.icon ? '#292b24' : color}" stroke-width="3" fill="${node.icon ? silhouetteInk : '#292b24'}">${symbol}</g>
    <text x="${node.x}" y="${node.y-36}" text-anchor="middle" fill="${color}">${escape(label)}</text>`
  }
  const markers = Object.entries(colors).map(([side, color]) => `<marker id="${side}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 10 5 0 10Z" fill="${color}"/></marker>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" role="img" aria-label="${escape(chart.title)}"><defs>${markers}</defs><image width="1200" height="800" href="data:image/webp;base64,${background.toString('base64')}"/><g font-family="Georgia,serif" font-size="25" font-weight="600" style="paint-order:stroke;stroke:#292a23;stroke-width:4;stroke-linejoin:round">${drawing}</g></svg>`
  await writeFile(`${root}/tactical/${chart.id}-runtime.svg`, svg)
  console.log(chart.id, nodes.length, 'formation symbols')
}
