/**
 * 抓洛伊納一帶的河道中心線，存成 `public/data/leuna-rivers.json`。
 *
 * ```
 *   node tools/dem/fetch-leuna-rivers.mjs
 * ```
 *
 * 【只給展示區用】與 `fetch-leuna-dem.mjs` 同一個座標對應：北 = 遊戲的 −Z、
 * 東 = +X，廠區中心 (0, −7000) 對到真實的 (51.32, 12.00)。
 *
 * 【資料來源與出處】OpenStreetMap contributors，ODbL。
 *
 * 【為什麼要自己接鏈】OSM 把一條河切成很多段 way，直接鋪帶狀網格會在接縫
 * 處重疊、而且順序是亂的。這裡照名字分組再依端點接起來。
 *
 * 【只收 `waterway=river`】溪流是 `stream`，抓進來會多出幾十條在畫面上看
 * 不見的細線。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const PLANT_LAT = 51.32
const PLANT_LON = 12.0
const PLANT_Z = -7000
const HALF_M = ((376 - 1) / 2) * 80
const M_PER_DEG_LAT = 111320
const M_PER_DEG_LON = 111320 * Math.cos((PLANT_LAT * Math.PI) / 180)

/** 真實經緯度 → 遊戲座標 */
function toGame(lat, lon) {
  return [(lon - PLANT_LON) * M_PER_DEG_LON, PLANT_Z - (lat - PLANT_LAT) * M_PER_DEG_LAT]
}

const south = PLANT_LAT - (HALF_M + PLANT_Z * -1) / M_PER_DEG_LAT
const north = PLANT_LAT + (HALF_M + PLANT_Z) / M_PER_DEG_LAT
const west = PLANT_LON - HALF_M / M_PER_DEG_LON
const east = PLANT_LON + HALF_M / M_PER_DEG_LON
const bbox = `${south.toFixed(4)},${west.toFixed(4)},${north.toFixed(4)},${east.toFixed(4)}`
console.log(`範圍 ${bbox}`)

// 【用 GET 而且要帶 User-Agent】POST 會被回一頁 HTML；沒有 User-Agent 回 406
const query = `[out:json][timeout:90];way["waterway"="river"](${bbox});out geom;`
const res = await fetch(
  `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
  { headers: { 'User-Agent': 'grok-aircraft2/leuna-terrain (offline tooling)', Accept: 'application/json' } },
)
if (!res.ok) throw new Error(`overpass HTTP ${res.status}`)
const json = await res.json()
console.log(`OSM 回了 ${json.elements.length} 段 way`)

/** 依名字分組，再依端點接成連續的鏈 */
const byName = new Map()
for (const w of json.elements) {
  if (!w.geometry || w.geometry.length < 2) continue
  const name = w.tags?.name ?? '（無名）'
  if (!byName.has(name)) byName.set(name, [])
  byName.get(name).push(w.geometry.map((g) => toGame(g.lat, g.lon)))
}

const key = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`

function chain(parts) {
  const left = parts.slice()
  const out = []
  while (left.length > 0) {
    const line = left.shift()
    let grew = true
    while (grew) {
      grew = false
      for (let i = 0; i < left.length; i++) {
        const c = left[i]
        if (key(c[0]) === key(line[line.length - 1])) { line.push(...c.slice(1)); left.splice(i, 1); grew = true; break }
        if (key(c[c.length - 1]) === key(line[line.length - 1])) { line.push(...c.slice(0, -1).reverse()); left.splice(i, 1); grew = true; break }
        if (key(c[c.length - 1]) === key(line[0])) { line.unshift(...c.slice(0, -1)); left.splice(i, 1); grew = true; break }
        if (key(c[0]) === key(line[0])) { line.unshift(...c.slice(1).reverse()); left.splice(i, 1); grew = true; break }
      }
    }
    out.push(line)
  }
  return out
}

const length = (l) => l.reduce((a, p, i) => i === 0 ? 0 : a + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]), 0)

/**
 * 裁進高度場的範圍，出界的地方斷開。
 *
 * 【一定要裁】Overpass 的 bbox 是「與框相交的 way 整條回來」，所以節點會伸到
 * 框外。高度場的 `sample` 在場外回 −Infinity，一個出界的點會把整條河的水面
 * 縱剖面污染成 −Infinity —— 而畫面上是那條河整條不見。
 */
function clip(line) {
  const runs = []
  let cur = []
  // 【留 200 m 餘裕】重新取樣與挖槽會往外探幾十公尺，貼著邊界會再度出界
  const edge = HALF_M - 200
  for (const p of line) {
    if (Math.abs(p[0]) <= edge && Math.abs(p[1]) <= edge) cur.push(p)
    else if (cur.length > 0) { runs.push(cur); cur = [] }
  }
  if (cur.length > 0) runs.push(cur)
  return runs.filter((r) => r.length >= 2)
}

/** 折線抽稀：連續三點幾乎共線就丟中間那一點 */
function simplify(line, tol) {
  const out = [line[0]]
  for (let i = 1; i + 1 < line.length; i++) {
    const a = out[out.length - 1]
    const b = line[i]
    const c = line[i + 1]
    const ax = c[0] - a[0]
    const az = c[1] - a[1]
    const len = Math.hypot(ax, az)
    const d = len < 1e-6 ? 0 : Math.abs((b[0] - a[0]) * az - (b[1] - a[1]) * ax) / len
    if (d > tol) out.push(b)
  }
  out.push(line[line.length - 1])
  return out
}

/** 只留夠長的：短的支流在投彈高度看不見，只會讓帶狀網格變碎 */
const MIN_LENGTH = 3000
const rivers = []
for (const [name, parts] of byName) {
  for (const whole of chain(parts)) {
    for (const line of clip(whole)) {
      const l = length(line)
      if (l < MIN_LENGTH) continue
      const s = simplify(line, 12).map((p) => [Math.round(p[0]), Math.round(p[1])])
      rivers.push({ name, metres: Math.round(l), points: s })
    }
  }
}
rivers.sort((a, b) => b.metres - a.metres)
for (const r of rivers) console.log(`  ${r.name.padEnd(18)} ${(r.metres / 1000).toFixed(1)} km，${r.points.length} 點`)

const path = 'public/data/leuna-rivers.json'
mkdirSync(dirname(path), { recursive: true })
writeFileSync(path, JSON.stringify({
  source: '© OpenStreetMap contributors，ODbL',
  plant: { lat: PLANT_LAT, lon: PLANT_LON, z: PLANT_Z },
  north: '-Z',
  rivers,
}))
console.log(`寫入 ${path}：${rivers.length} 條`)
