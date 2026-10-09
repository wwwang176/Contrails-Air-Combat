/** Show readable relative formation positions on the captured terrain artwork.
 * Opening data informs the layout; symbols are deliberately spaced for clarity.
 * Run after capture/art review: node scripts/build-briefing-reference.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'

const source = JSON.parse(await readFile('public/ui/maps/reference/allies-m1-opening.json', 'utf8'))
if (source.imageRight !== '-Z' || source.imageUp !== '-X') throw new Error('Unsupported capture orientation')
const background = await readFile('public/ui/maps/tactical/berlin-runtime-terrain.webp')
const b = source.bounds
const project = p => [(b.south - p[2]) / (b.south - b.north) * 1200, (p[0] - b.west) / (b.east - b.west) * 800]
const fmt = v => Number(v.toFixed(2))
const BLUE = '#89bde8', RED = '#e48067'
const groups = new Map()
for (const a of source.aircraft) {
  const key = `${a.team}/${a.aircraft}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(a)
}
const center = units => units.reduce((p, a) => p.map((v, i) => v + a.position[i] / units.length), [0, 0, 0])
const formationPosition = units => {
  const [x, y] = project(center(units))
  const mine = units[0].team === 'blue'
  return [mine ? Math.max(200, x + 95) : x,
    y + (units[0].aircraft === 'b17g' ? 115 : -115)]
}
const bomberGroup = groups.get('blue/b17g')
if (!bomberGroup || !source.target) throw new Error('Expected a bomber escort mission')
const from = formationPosition(bomberGroup), exit = project(source.target.position)
const radius = source.target.radius / (b.south - b.north) * 1200
let drawing = `<path d="M${fmt(from[0] + 50)} ${fmt(from[1])} C${fmt(from[0] + 340)} ${fmt(from[1])} ${fmt(exit[0] - radius - 260)} ${fmt(exit[1])} ${fmt(exit[0] - radius - 10)} ${fmt(exit[1])}" fill="none" stroke="${BLUE}" stroke-width="3" stroke-dasharray="12 8" marker-end="url(#blue-arrow)"/>
<circle cx="${fmt(exit[0])}" cy="${fmt(exit[1])}" r="${fmt(radius)}" stroke="${BLUE}" stroke-width="2" fill="#89bde810"/>
<path d="M${fmt(exit[0]-12)} ${fmt(exit[1])}h24M${fmt(exit[0])} ${fmt(exit[1]-12)}v24" stroke="${BLUE}" stroke-width="2"/>
<text x="${fmt(exit[0])}" y="${fmt(exit[1]-radius-20)}" text-anchor="middle" fill="${BLUE}">ESCORT EXIT</text>`

for (const [key, units] of groups) {
  const mine = units[0].team === 'blue', color = mine ? BLUE : RED
  const [lx, ly] = formationPosition(units)
  const label = ({ p51d: 'P-51D', b17g: 'B-17G', bf109k4: 'Bf 109 K-4' })[units[0].aircraft]
  if (!label) throw new Error(`Unknown opening aircraft: ${key}`)
  // Each frame is the formation itself, not a callout to individual aircraft.
  drawing += `<g data-formation="${key}" transform="translate(${fmt(lx)} ${fmt(ly)})" stroke="${color}" stroke-width="3" fill="#292b24">
    <rect x="-37" y="-21" width="74" height="42"/>
    <path d="M-37-21 37 21M-37 21 37-21" fill="none"/>
  </g>
  <text x="${fmt(lx)}" y="${fmt(ly - 34)}" text-anchor="middle" fill="${color}">${label} &#215; ${units.length}</text>`
  if (!mine) drawing += `<path d="M${fmt(lx-50)} ${fmt(ly)}h-130" stroke="${RED}" stroke-width="3" marker-end="url(#red-arrow)"/>`
  else if (units[0].aircraft !== 'b17g') drawing += `<path d="M${fmt(lx+50)} ${fmt(ly)}h130" stroke="${BLUE}" stroke-width="3" stroke-dasharray="12 8" marker-end="url(#blue-arrow)"/>`
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" role="img" aria-label="Berlin mission opening deployment">
<defs><marker id="blue-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 10 5 0 10Z" fill="${BLUE}"/></marker><marker id="red-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 10 5 0 10Z" fill="${RED}"/></marker></defs>
<image width="1200" height="800" href="data:image/webp;base64,${background.toString('base64')}"/>
<g font-family="Georgia,serif" font-size="25" font-weight="600" style="paint-order:stroke;stroke:#292a23;stroke-width:4;stroke-linejoin:round">${drawing}</g>
</svg>`
await writeFile('public/ui/maps/tactical/berlin-runtime.svg', svg)
console.log('Built Berlin chart with', groups.size, 'relative formation symbols')
