/**
 * 雷伊泰每一個池的**真正峰值**。不是測試。
 *
 * ```
 * node node_modules/vite-node/vite-node.mjs test/tools/leyte-peak.probe.ts
 * ```
 *
 * 鏡頭放在每一座山脈的圓心、往四個方向各推半徑的一半與一倍，再加一張 2 km 的
 * 場地網格。容量（`LEYTE_CAPACITY`）照這裡的峰值定 —— 溢位是靜靜丟掉的。
 */
import { createLeyte } from '../../src/world/leyte'
import { createLeyteFlora } from '../../src/render/leyteFlora'
import { createVegetation } from '../../src/render/vegetation'
import { ISLAND_MAX_PER_TILE, LEYTE_CAPACITY, POOL_NAMES } from '../../src/render/vegetationPolicy'
import { type PoolName } from '../../src/render/floraShapes'

const SENTINEL = Object.fromEntries(POOL_NAMES.map((n) => [n, 400000])) as Record<PoolName, number>

const { field, hills } = createLeyte()
const v = createVegetation(
  [createLeyteFlora(field)], (x, z) => field.sample(x, z),
  { capacity: SENTINEL, maxPerTile: ISLAND_MAX_PER_TILE },
)

const spots: Array<[number, number]> = []
for (const h of hills) {
  spots.push([h.cx, h.cz])
  for (const r of [h.radius * 0.5, h.radius]) {
    for (const a of [0, 1, 2, 3]) {
      spots.push([h.cx + Math.cos((a * Math.PI) / 2) * r, h.cz + Math.sin((a * Math.PI) / 2) * r])
    }
  }
}
const half = ((field.size - 1) * field.cell) / 2
for (let x = -half; x <= half; x += 2000) {
  for (let z = -half; z <= half; z += 2000) spots.push([x, z])
}

const max: Record<string, number> = {}
let overflow = 0
for (const [x, z] of spots) {
  v.update(x, z)
  v.settle(true)
  for (const [name, n] of Object.entries(v.counts)) max[name] = Math.max(max[name] ?? 0, n)
  overflow += v.stats.overflow
}

console.log(`  ${hills.length} 座山脈、${spots.length} 個鏡頭位置、溢位 ${overflow} 筆`)
for (const name of POOL_NAMES) {
  const peak = max[name] ?? 0
  if (peak === 0) continue
  const cap = LEYTE_CAPACITY[name]
  console.log(
    `  ${name.padEnd(10)} 峰值 ${String(peak).padStart(7)}`
    + `   ×1.5 → ${String(Math.ceil(peak * 1.5)).padStart(7)}`
    + `   現在 ${String(cap).padStart(7)}${cap < peak ? '   ← 溢位' : ''}`,
  )
}
v.dispose()
