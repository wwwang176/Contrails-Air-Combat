/**
 * 抓洛伊納一帶的 A9 高速公路、聚落與蓋澤爾谷的礦坑，存成
 * `public/data/leuna-features.json`。
 *
 * ```
 *   node tools/dem/fetch-leuna-features.mjs
 * ```
 *
 * 座標對應與 `fetch-leuna-rivers.mjs` 相同：北 = 遊戲的 −Z、東 = +X，廠區中心
 * (0, −7000) 對到真實的 (51.3085, 12.0048)。**錨點必須一樣**，否則村子會相對
 * 河與廠區整片平移。
 *
 * 【資料來源與出處】OpenStreetMap contributors，ODbL。
 *
 * 【範圍比細節地形大一圈】±22 km：鏡頭在地圖邊緣時植被最遠畫到邊緣外 6 km，
 * 那裡也要有村子。A9 整條 way 回來，會伸得更遠。
 *
 * 【1944 年】
 * - A9（當時的 Reichsautobahn Berlin–München）1936–38 年通車，照畫。A38 是
 *   2000 年後的，不抓。
 * - 聚落是幾百年的老村鎮，照畫。
 * - 蓋澤爾谷的湖是礦坑在 2000 年後灌水而成；1944 年是正在開採的露天褐煤礦。
 *   這裡抓湖的輪廓當作礦坑的範圍 —— 當年開採中的範圍與最後的坑不完全一樣。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const PLANT_LAT = 51.3085
const PLANT_LON = 12.0048
const PLANT_Z = -7000
const M_PER_DEG_LAT = 111320
const M_PER_DEG_LON = 111320 * Math.cos((PLANT_LAT * Math.PI) / 180)
/** 抓的範圍：遊戲原點 (0, 0) 往四邊各幾公尺 */
const REACH = 22000

/** 真實經緯度 → 遊戲座標，四捨五入到公尺 */
function toGame(lat, lon) {
  return [
    Math.round((lon - PLANT_LON) * M_PER_DEG_LON),
    Math.round(PLANT_Z - (lat - PLANT_LAT) * M_PER_DEG_LAT),
  ]
}

// 遊戲的 z = PLANT_Z − (lat − PLANT_LAT) × M：z = +REACH 是南界、z = −REACH 是北界
const south = PLANT_LAT - (REACH - PLANT_Z) / M_PER_DEG_LAT
const north = PLANT_LAT + (REACH + PLANT_Z) / M_PER_DEG_LAT
const west = PLANT_LON - REACH / M_PER_DEG_LON
const east = PLANT_LON + REACH / M_PER_DEG_LON
const bbox = `${south.toFixed(4)},${west.toFixed(4)},${north.toFixed(4)},${east.toFixed(4)}`
console.log(`範圍 ${bbox}`)

/**
 * 【輪流試幾個伺服器】主站常回 504（忙碌）。用 GET、帶 User-Agent：POST 會被
 * 回一頁 HTML，沒有 User-Agent 回 406
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
async function overpass(query) {
  for (let k = 0; k < 9; k++) {
    const ep = ENDPOINTS[k % ENDPOINTS.length]
    try {
      const res = await fetch(`${ep}?data=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': 'grok-aircraft2/leuna-terrain (offline tooling)', Accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).elements
    } catch (e) {
      console.log(`  ${ep}：${String(e).slice(0, 60)}，重試`)
      await new Promise((r) => setTimeout(r, 4000))
    }
  }
  throw new Error('overpass 全部失敗')
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

const length = (l) => l.reduce((a, p, i) => (i === 0 ? 0 : a + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1])), 0)
const key = (p) => `${p[0]},${p[1]}`

/**
 * 依端點把 way 接成連續的鏈。**只接同一個方向的** —— 高速公路上下行是兩條
 * 單行道，各自的 way 首尾相連；不看方向的話，交流道兩端會把上下行接成一圈。
 */
function chainDirected(parts) {
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
        if (key(c[c.length - 1]) === key(line[0])) { line.unshift(...c.slice(0, -1)); left.splice(i, 1); grew = true; break }
      }
    }
    out.push(line)
  }
  return out
}

// ── A9 ──────────────────────────────────────────────
const a9Ways = await overpass(`[out:json][timeout:90];way["highway"="motorway"]["ref"="A 9"](${bbox});out geom;`)
console.log(`A9：${a9Ways.length} 段 way`)
const a9 = chainDirected(a9Ways.filter((w) => w.geometry?.length >= 2)
  .map((w) => w.geometry.map((g) => toGame(g.lat, g.lon))))
  .filter((l) => length(l) >= 3000)
  .map((l) => simplify(l, 4))
for (const l of a9) console.log(`  車道 ${(length(l) / 1000).toFixed(1)} km，${l.length} 點`)

// ── 聚落 ────────────────────────────────────────────
const placeNodes = await overpass(`[out:json][timeout:90];node["place"~"^(town|village|hamlet)$"](${bbox});out;`)
const places = placeNodes
  .filter((n) => n.tags?.name)
  .map((n) => {
    const [x, z] = toGame(n.lat, n.lon)
    const pop = Number(n.tags.population)
    return { name: n.tags.name, kind: n.tags.place, x, z, ...(Number.isFinite(pop) && pop > 0 ? { pop } : {}) }
  })
  .sort((a, b) => a.name.localeCompare(b.name))
const tally = {}
for (const p of places) tally[p.kind] = (tally[p.kind] ?? 0) + 1
console.log('聚落', tally)

// ── 蓋澤爾谷的礦坑 ──────────────────────────────────
const lakes = await overpass(`[out:json][timeout:90];(`
  + `way["natural"="water"]["name"~"^(Geiseltalsee|Runstedter See|Großkaynaer See|Hassesee)$"](${bbox});`
  + `relation["natural"="water"]["name"~"^(Geiseltalsee|Runstedter See|Großkaynaer See|Hassesee)$"](${bbox});`
  + `);out geom;`)

/** relation 的外圈：把 outer 成員依端點接成一個封閉環，取最長的那一個 */
function outerRing(el) {
  if (el.type === 'way') return el.geometry.map((g) => toGame(g.lat, g.lon))
  const parts = el.members.filter((m) => m.role === 'outer' && m.geometry)
    .map((m) => m.geometry.map((g) => toGame(g.lat, g.lon)))
  const left = parts.slice()
  const rings = []
  while (left.length > 0) {
    const ring = left.shift()
    let grew = true
    while (grew) {
      grew = false
      for (let i = 0; i < left.length; i++) {
        const c = left[i]
        const tail = key(ring[ring.length - 1])
        if (key(c[0]) === tail) { ring.push(...c.slice(1)); left.splice(i, 1); grew = true; break }
        if (key(c[c.length - 1]) === tail) { ring.push(...c.slice(0, -1).reverse()); left.splice(i, 1); grew = true; break }
      }
    }
    rings.push(ring)
  }
  return rings.reduce((a, b) => (length(b) > length(a) ? b : a))
}

const mines = lakes.map((el) => {
  const ring = simplify(outerRing(el), 12)
  // 環的最後一點與第一點相同時去掉 —— 使用端自己閉合
  if (key(ring[0]) === key(ring[ring.length - 1])) ring.pop()
  return { name: el.tags.name, ring }
})
for (const m of mines) console.log(`  礦坑 ${m.name}：${m.ring.length} 點`)

const path = 'public/data/leuna-features.json'
mkdirSync(dirname(path), { recursive: true })
writeFileSync(path, JSON.stringify({
  source: '© OpenStreetMap contributors，ODbL',
  plant: { lat: PLANT_LAT, lon: PLANT_LON, z: PLANT_Z },
  north: '-Z',
  a9,
  places,
  mines,
}))
console.log(`寫入 ${path}`)
