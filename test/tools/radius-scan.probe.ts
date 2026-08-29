/**
 * 把 `FLORA_RADIUS` 推遠要付多少。不是測試。
 *
 * 分析式：逐格算一次株數並快取，再由每一個鏡頭位置按 tile 中心的距離分級。
 * 不跑引擎，所以掃得動 12 km 的圈。
 */
import { createArchipelago } from '../../src/world/archipelago'
import { createFloraBuffer, createIslandFlora } from '../../src/render/flora'
import { TILE_SIZE, POINT_NEAR, LOD_NEAR } from '../../src/render/vegetation'

const RADII = [6000, 9000, 12000, 16000]
const arch = createArchipelago()
const source = createIslandFlora(arch.field, arch.islands)
const heightAt = (x: number, z: number): number => {
  const h = arch.field.sample(x, z)
  return h > 0 ? h : 0
}
const buf = createFloraBuffer(8192)
const cache = new Map<number, number>()
function tileCount(i: number, j: number): number {
  const key = i * 65536 + j
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  buf.count = 0
  buf.dropped = 0
  const x0 = i * TILE_SIZE
  const z0 = j * TILE_SIZE
  source(x0, z0, x0 + TILE_SIZE, z0 + TILE_SIZE, heightAt, buf)
  cache.set(key, buf.count)
  return buf.count
}

console.log('  半徑      近級     中級     卡片      合計    圈內格數   快取需求')
for (const R of RADII) {
  let mNear = 0
  let mMid = 0
  let mCard = 0
  let mTiles = 0
  for (const isl of arch.islands) {
    let near = 0
    let mid = 0
    let card = 0
    let tiles = 0
    const i0 = Math.floor((isl.cx - R) / TILE_SIZE)
    const i1 = Math.floor((isl.cx + R) / TILE_SIZE)
    const j0 = Math.floor((isl.cz - R) / TILE_SIZE)
    const j1 = Math.floor((isl.cz + R) / TILE_SIZE)
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const tx = i * TILE_SIZE + TILE_SIZE / 2
        const tz = j * TILE_SIZE + TILE_SIZE / 2
        const d = Math.hypot(tx - isl.cx, tz - isl.cz)
        if (d > R) continue
        tiles++
        const n = tileCount(i, j)
        if (n === 0) continue
        if (d < LOD_NEAR) near += n
        else if (d < POINT_NEAR) mid += n
        else card += n
      }
    }
    if (near > mNear) mNear = near
    if (mid > mMid) mMid = mid
    if (card > mCard) mCard = card
    if (tiles > mTiles) mTiles = tiles
  }
  // 每格 512 株 × (6 float + 1 byte) = 12,800 byte
  const mb = (mTiles * 512 * 25) / 1e6
  console.log(
    `  ${String(R).padStart(6)}  ${String(mNear).padStart(7)}  ${String(mMid).padStart(7)}`
    + `  ${String(mCard).padStart(7)}  ${String(mNear + mMid + mCard).padStart(8)}`
    + `  ${String(mTiles).padStart(9)}  ${mb.toFixed(0).padStart(6)} MB`,
  )
}
