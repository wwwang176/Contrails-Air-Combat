import { describe, expect, it } from 'vitest'
import {
  createFloraBuffer, farmHedgeFlora, farmWoodFlora, FLORA_FAST_PATHS, FLORA_STRIDE, openHedgeFlora, openWoodFlora,
  type FloraSource,
} from '../../src/render/flora'
import { TILE_SIZE } from '../../src/render/vegetation'
import { villageDistance } from '../../src/render/fields'

/**
 * # 補格的整格判斷只省時間，不改結果
 *
 * 植被補格先整格判斷（這一格有沒有樹林田、是不是整格都是空地），能跳的整格跳過、
 * 能省的逐點判斷省掉。判斷錯了的話會整格少樹或多樹 —— 沒有錯誤訊息，只是某些
 * 格子的林子不見了。這裡拿整格判斷開、關兩條路徑的輸出逐株比對。
 */

function run(src: FloraSource, x0: number, z0: number, size = TILE_SIZE): string[] {
  const buf = createFloraBuffer(size === TILE_SIZE ? 8192 : 400_000)
  src(x0, z0, x0 + size, z0 + size, () => 0, buf)
  const out: string[] = []
  for (let i = 0; i < buf.count; i++) {
    const o = i * FLORA_STRIDE
    out.push(`${buf.data[o]},${buf.data[o + 2]},${buf.data[o + 3]},${buf.data[o + 4]},${buf.kind[i]}`)
  }
  return out.sort()
}

/** 散在 ±20 km 的 600 格：荒野、村旁、交界都抽得到 */
const TILES: [number, number][] = []
for (let k = 0; k < 600; k++) {
  TILES.push([((k * 7919) % 160 - 80) * TILE_SIZE, ((k * 104729) % 160 - 80) * TILE_SIZE])
}

/**
 * 【專挑田圈邊緣的格】整格判斷的餘量（地塊中心可能在格外）只在「格心離村剛好在
 * 田的範圍邊上」的格才有差別，隨機抽很少抽到。這裡挑格心離村 1.8～2.9 km（田最遠
 * 伸到 2.34 km）與 0.3～1.4 km（田最近的邊 0.84 km）的格
 */
const EDGE_TILES: [number, number][] = []
for (let i = -100; i < 100 && EDGE_TILES.length < 900; i++) {
  for (let j = -100; j < 100 && EDGE_TILES.length < 900; j++) {
    const x = i * TILE_SIZE
    const z = j * TILE_SIZE
    const d = villageDistance(x + TILE_SIZE / 2, z + TILE_SIZE / 2)
    if ((d > 1800 && d < 2900) || (d > 300 && d < 1400)) {
      if (((i * 31 + j * 17) & 7) === 0) EDGE_TILES.push([x, z])
    }
  }
}

describe('整格判斷開、關的輸出逐株相同', () => {
  for (const [name, src] of [
    ['田裡的樹林', farmWoodFlora], ['田圍著村的樹林', openWoodFlora],
    ['樹籬', farmHedgeFlora], ['田圍著村的樹籬', openHedgeFlora],
  ] as const) {
    it(name, () => {
      let total = 0
      let skippedTiles = 0
      for (const [x, z] of [...TILES, ...EDGE_TILES]) {
        FLORA_FAST_PATHS.on = true
        const fast = run(src, x, z)
        FLORA_FAST_PATHS.on = false
        const slow = run(src, x, z)
        expect(fast, `(${x},${z})`).toEqual(slow)
        total += slow.length
        if (slow.length === 0) skippedTiles++
      }
      FLORA_FAST_PATHS.on = true
      expect(total).toBeGreaterThan(500)
      // 量尺本身要有事可做：有空格也有長東西的格
      expect(skippedTiles).toBeGreaterThan(0)
    }, 120_000)

    /**
     * 【不只一格大的框】來源是對任意方框定義的（測試、`excluding` 都會傳大框），整格
     * 判斷的餘量要跟著框的大小走，不能寫死一格的半對角線
     */
    it(`${name}：大框`, () => {
      for (const [x, z, size] of [[-3000, -3000, 6000], [1200, -4700, 2600], [-8000, 5000, 1100]] as const) {
        FLORA_FAST_PATHS.on = true
        const fast = run(src, x, z, size)
        FLORA_FAST_PATHS.on = false
        const slow = run(src, x, z, size)
        FLORA_FAST_PATHS.on = true
        expect(fast.length, `(${x},${z}) ${size}`).toBe(slow.length)
        expect(fast).toEqual(slow)
      }
    }, 120_000)
  }
})
