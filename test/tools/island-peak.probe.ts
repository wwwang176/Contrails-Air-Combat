/**
 * 群島每一個池的**真正峰值**。不是測試。
 *
 * ```
 * node node_modules/vite-node/vite-node.mjs test/tools/island-peak.probe.ts
 * ```
 *
 * 【為什麼不能用一條航線】上一版沿一條直線取 24 個點，那條線大半在水上 ——
 * 近級的峰值因此只量到 220，而實際是 8,799。容量照那個數字定，飛過島心時
 * 近處的樹會整片被 `stats.overflow` 丟掉。
 *
 * 這一支把鏡頭放在**每一座島的島心**，再往四個方向各推半徑的一半與一倍。
 * 單格最密與 tile 的丟棄也一起量。
 */
import { createArchipelago } from '../../src/world/archipelago'
import { createIslandFlora } from '../../src/render/flora'
import {
  createVegetation, ISLAND_CAPACITY, ISLAND_MAX_PER_TILE, type PoolName,
} from '../../src/render/vegetation'

const POOLS: readonly PoolName[] = [
  'broadNear', 'coneNear', 'broadMid', 'coneMid',
  'broadCard', 'coneCard', 'bushNear', 'bushCard', 'house', 'barn', 'church',
]
const SENTINEL = Object.fromEntries(POOLS.map((n) => [n, 400000])) as Record<PoolName, number>

const arch = createArchipelago()
const v = createVegetation(
  [createIslandFlora(arch.field, arch.islands)], (x, z) => arch.field.sample(x, z),
  SENTINEL, 4096,
)

const max: Record<string, number> = {}
let dropped = 0
let shots = 0
for (const isl of arch.islands) {
  const offs: Array<[number, number]> = [[0, 0]]
  for (const r of [isl.radius * 0.5, isl.radius]) {
    for (const a of [0, 1, 2, 3]) {
      offs.push([Math.cos((a * Math.PI) / 2) * r, Math.sin((a * Math.PI) / 2) * r])
    }
  }
  for (const [dx, dz] of offs) {
    v.update(isl.cx + dx, isl.cz + dz)
    v.settle(true)
    shots++
    for (const [name, n] of Object.entries(v.counts)) {
      max[name] = Math.max(max[name] ?? 0, n)
    }
    dropped += v.stats.dropped
  }
}

console.log(`  ${arch.islands.length} 座島、${shots} 個鏡頭位置、tile 丟棄 ${dropped} 筆`)
console.log(`  單格上限現在是 ${ISLAND_MAX_PER_TILE}`)
for (const name of POOLS) {
  const peak = max[name] ?? 0
  if (peak === 0) continue
  const cap = ISLAND_CAPACITY[name]
  console.log(
    `  ${name.padEnd(10)} 峰值 ${String(peak).padStart(7)}`
    + `   ×1.35 → ${String(Math.ceil(peak * 1.35)).padStart(7)}`
    + `   現在 ${String(cap).padStart(7)}${cap < peak ? '   ← 溢位' : ''}`,
  )
}

// ── 單格最密 ──────────────────────────────────────────────
import { createFloraBuffer, ISLAND_GRID } from '../../src/render/flora'
import { TILE_SIZE } from '../../src/render/vegetation'

const source = createIslandFlora(arch.field, arch.islands)
const heightAt = (x: number, z: number): number => {
  const h = arch.field.sample(x, z)
  return h > 0 ? h : 0
}
const buf = createFloraBuffer(8192)
let worst = 0
let worstAt = ''
let total = 0
let tilesWithTrees = 0
const HALF = 12000
const lo = Math.floor(-HALF / TILE_SIZE)
const hi = Math.floor(HALF / TILE_SIZE)
for (let j = lo; j <= hi; j++) {
  for (let i = lo; i <= hi; i++) {
    buf.count = 0
    buf.dropped = 0
    const x0 = i * TILE_SIZE
    const z0 = j * TILE_SIZE
    source(x0, z0, x0 + TILE_SIZE, z0 + TILE_SIZE, heightAt, buf)
    total += buf.count
    if (buf.count > 0) tilesWithTrees++
    if (buf.count > worst) { worst = buf.count; worstAt = `(${x0}, ${z0})` }
  }
}
const areaKm2 = (tilesWithTrees * TILE_SIZE * TILE_SIZE) / 1e6
console.log(
  `  全圖 ${total} 株、有植被的地 ${areaKm2.toFixed(1)} km²`
  + `、實際 ${Math.round(total / areaKm2)} 株/km²（網格上限 ${Math.round(1e6 / (ISLAND_GRID * ISLAND_GRID))}）`,
)
console.log(`  單格最多 ${worst} 株，在 ${worstAt}`)
