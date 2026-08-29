/**
 * 群島把半徑推到 12 km 之後，冷啟動要幾秒。不是測試。
 *
 * ```
 * node node_modules/vite-node/vite-node.mjs test/tools/island-coldstart.probe.ts
 * ```
 *
 * 【量的是整個 `update()` 的牆鐘】不是「每格幾次 hypot」—— 挑格、生成、
 * evict、relevel 四段都在裡面，而它們的成本結構完全不同。
 */
import { createArchipelago } from '../../src/world/archipelago'
import { createIslandFlora } from '../../src/render/flora'
import { createVegetation, ISLAND_CAPACITY, ISLAND_MAX_PER_TILE } from '../../src/render/vegetation'

const arch = createArchipelago()
const heightAt = (x: number, z: number): number => arch.field.sample(x, z)

for (const [radius, perFrame] of [
  [6000, 16], [12000, 16], [12000, 32], [12000, 61], [12000, 96],
] as const) {
  const v = createVegetation(
    [createIslandFlora(arch.field, arch.islands)], heightAt,
    { capacity: ISLAND_CAPACITY, maxPerTile: ISLAND_MAX_PER_TILE, radius, tilesPerFrame: perFrame },
  )
  // 鏡頭放在最密的島心
  const t0 = performance.now()
  let frames = 0
  let last = -1
  while (frames < 4000) {
    v.update(-2750, 750)
    frames++
    if (v.stats.tiles === last) break
    last = v.stats.tiles
  }
  const total = performance.now() - t0
  // 補滿之後再量十幀的穩態
  const t1 = performance.now()
  for (let k = 0; k < 10; k++) v.update(-2750 + k, 750 + k)
  const warm = (performance.now() - t1) / 10
  console.log(
    `  半徑 ${String(radius).padStart(5)} m  每幀 ${String(perFrame).padStart(3)} 格`
    + `   補滿要 ${String(frames).padStart(4)} 幀（${(frames / 60).toFixed(1)} s）`
    + `   總計 ${total.toFixed(0).padStart(5)} ms`
    + `   平均 ${(total / frames).toFixed(2).padStart(5)} ms/幀`
    + `   穩態 ${warm.toFixed(2).padStart(5)} ms/幀`
    + `   格數 ${String(v.stats.tiles).padStart(5)}`,
  )
  v.dispose()
}
