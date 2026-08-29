/**
 * 群島的樹要多密。不是測試。
 *
 * `ISLAND_GRID` 是常數，所以掃描的方式是**改常數再跑一次** ——
 * 用 `cp` 備份還原，不要用 git。
 *
 * ```
 * cp src/render/flora.ts /tmp/flora.bak
 * for G in 50 25 20 15 12; do
 *   sed -i "s/^export const ISLAND_GRID = [0-9]*$/export const ISLAND_GRID = $G/" src/render/flora.ts
 *   node node_modules/vite-node/vite-node.mjs test/tools/island-density.probe.ts
 * done
 * cp /tmp/flora.bak src/render/flora.ts
 * ```
 */
import { createArchipelago } from '../../src/world/archipelago'
import { createFloraBuffer, createIslandFlora, ISLAND_GRID } from '../../src/render/flora'
import { FLORA_RADIUS, MAX_PER_TILE, TILE_SIZE, lodFor, POINT_NEAR, LOD_NEAR } from '../../src/render/vegetation'

const SCAN_HALF = 12000
const BIG = 8192

const arch = createArchipelago()
const source = createIslandFlora(arch.field, arch.islands)
const heightAt = (x: number, z: number): number => {
  const h = arch.field.sample(x, z)
  return h > 0 ? h : 0
}

const buf = createFloraBuffer(BIG)

interface TileSum {
  n: number
  dropped: number
}

const cache = new Map<number, TileSum>()

function tileSum(i: number, j: number): TileSum {
  const key = i * 65536 + j
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  buf.count = 0
  buf.dropped = 0
  const x0 = i * TILE_SIZE
  const z0 = j * TILE_SIZE
  source(x0, z0, x0 + TILE_SIZE, z0 + TILE_SIZE, heightAt, buf)
  const t: TileSum = { n: buf.count, dropped: buf.dropped }
  cache.set(key, t)
  return t
}

// ── 全圖一次：總棵數與單格最密 ────────────────────────────
let total = 0
let worst = 0
let tilesWithTrees = 0
const lo = Math.floor(-SCAN_HALF / TILE_SIZE)
const hi = Math.floor(SCAN_HALF / TILE_SIZE)
for (let j = lo; j <= hi; j++) {
  for (let i = lo; i <= hi; i++) {
    const t = tileSum(i, j)
    total += t.n
    if (t.n > worst) worst = t.n
    if (t.n > 0) tilesWithTrees++
  }
}

// ── 一條穿過群島的航線：各級的最大同時實例數 ──────────────
let maxNear = 0
let maxMid = 0
let maxCard = 0
let maxTiles = 0
const N = 24
for (let k = 0; k < N; k++) {
  const t = k / (N - 1)
  const cx = -10000 + t * 20000
  const cz = -9000 + t * 18000
  let near = 0
  let mid = 0
  let card = 0
  let tiles = 0
  const i0 = Math.floor((cx - FLORA_RADIUS) / TILE_SIZE)
  const i1 = Math.floor((cx + FLORA_RADIUS) / TILE_SIZE)
  const j0 = Math.floor((cz - FLORA_RADIUS) / TILE_SIZE)
  const j1 = Math.floor((cz + FLORA_RADIUS) / TILE_SIZE)
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const tx = i * TILE_SIZE + TILE_SIZE / 2
      const tz = j * TILE_SIZE + TILE_SIZE / 2
      const d = Math.hypot(tx - cx, tz - cz)
      if (d > FLORA_RADIUS) continue
      tiles++
      const n = tileSum(i, j).n
      if (n === 0) continue
      const lod = lodFor(d, -1)
      if (lod === 0) near += n
      else if (lod === 1) mid += n
      else card += n
    }
  }
  if (near > maxNear) maxNear = near
  if (mid > maxMid) maxMid = mid
  if (card > maxCard) maxCard = card
  if (tiles > maxTiles) maxTiles = tiles
}

const areaKm2 = (tilesWithTrees * TILE_SIZE * TILE_SIZE) / 1e6
console.log(
  `  間距 ${String(ISLAND_GRID).padStart(3)} m`
  + `   上限 ${String(Math.round(1e6 / (ISLAND_GRID * ISLAND_GRID))).padStart(5)} 棵/km²`
  + `   全圖 ${String(total).padStart(7)} 棵`
  + `   有樹的地 ${areaKm2.toFixed(1).padStart(5)} km²`
  + `   實際 ${String(Math.round(total / areaKm2)).padStart(5)} 棵/km²`
  + `   單格最多 ${String(worst).padStart(4)}${worst > MAX_PER_TILE ? ' ← 超過 MAX_PER_TILE' : ''}`,
)
console.log(
  `            圈內最大同時：近（≤${LOD_NEAR}）${String(maxNear).padStart(6)}`
  + `   中（≤${POINT_NEAR}）${String(maxMid).padStart(6)}`
  + `   卡片 ${String(maxCard).padStart(6)}`
  + `   合計 ${String(maxNear + maxMid + maxCard).padStart(7)}`,
)
