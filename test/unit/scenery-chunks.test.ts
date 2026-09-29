import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { BufferAttribute, BufferGeometry, Vector3 } from 'three'
import { SCENERY_CHUNK, SCENERY_MIN_TRIS, splitByGrid } from '../../src/render/sceneryChunks'
import { buildPlantScenery, preloadPlantScenery } from '../../src/render/geometry/ground/plantScenery'

/** 非索引的三角形湯：每個三角形一個顏色，座標由呼叫端給 */
function soup(tris: readonly (readonly [number, number, number])[][]): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  tris.forEach((t, k) => {
    for (const v of t) { pos.push(...v); col.push(k, k * 2, k * 3) }
  })
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  return g
}

describe('splitByGrid', () => {
  const tris = [
    [[10, 0, 10], [20, 0, 10], [10, 5, 20]],
    [[1010, 0, 10], [1020, 0, 10], [1010, 5, 20]],
    [[15, 0, 15], [25, 0, 15], [15, 9, 25]],
    [[-500, 0, -1500], [-490, 0, -1500], [-500, 3, -1490]],
  ] as const
  const chunks = splitByGrid(soup(tris.map((t) => t.map((v) => [...v] as [number, number, number]))), 1000)

  it('依三角形重心分格：同一格的進同一塊', () => {
    expect(chunks.map((c) => c.getAttribute('position').count / 3).sort()).toEqual([1, 1, 2])
  })

  /** 【每一個三角形原樣搬過去】屬性逐三角形整組搬，顏色跟著位置走 */
  it('三角形與屬性一個不少、一個不多、整組跟著走', () => {
    const seen: string[] = []
    for (const c of chunks) {
      const p = c.getAttribute('position')
      const q = c.getAttribute('color')
      for (let i = 0; i < p.count; i += 3) {
        seen.push(`${p.getX(i)},${p.getZ(i)}|${q.getX(i)}`)
      }
    }
    const want = tris.map((t, k) => `${t[0][0]},${t[0][2]}|${k}`)
    expect(seen.sort()).toEqual(want.sort())
  })

  /** 【包圍球是剔除的依據】少包一個頂點，那個三角形在畫面邊緣會提早消失 */
  it('每一塊的包圍球包住自己的每一個頂點', () => {
    const v = new Vector3()
    for (const c of chunks) {
      const s = c.boundingSphere!
      const p = c.getAttribute('position')
      for (let i = 0; i < p.count; i++) {
        expect(s.center.distanceTo(v.fromBufferAttribute(p, i))).toBeLessThanOrEqual(s.radius + 1e-3)
      }
    }
  })

  it('三角形太少的格併成第一塊', () => {
    const g = soup(tris.map((t) => t.map((v) => [...v] as [number, number, number])))
    const merged = splitByGrid(g, 1000, 2)
    // 兩個單獨的格（各 1 個）併成一塊、原點那一格（2 個）自成一塊
    expect(merged.map((c) => c.getAttribute('position').count / 3)).toEqual([2, 2])
    const rest = merged[0]!.getAttribute('position')
    expect([rest.getX(0), rest.getX(3)].sort((a, b) => a - b)).toEqual([-500, 1010])
  })

  it('有索引的幾何不收', () => {
    const g = soup([[[0, 0, 0], [1, 0, 0], [0, 0, 1]]])
    g.setIndex([0, 1, 2])
    expect(() => splitByGrid(g, 1000)).toThrow()
  })
})

describe('洛伊納廠區切塊', () => {
  beforeAll(async () => {
    await preloadPlantScenery((url) => {
      const buf = readFileSync('public' + url)
      return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    })
  })

  /**
   * 【塊數是 draw call】太少剔不掉東西，太多就把省下的吃回去。
   * 每一塊的包圍球都要比整顆小得多，剔除才會生效
   */
  it('切成十塊上下；零散那一塊便宜，其餘每一塊都比整顆小得多', () => {
    const whole = buildPlantScenery()
    const chunks = splitByGrid(whole, SCENERY_CHUNK, SCENERY_MIN_TRIS)
    expect(chunks.length).toBeGreaterThanOrEqual(6)
    expect(chunks.length).toBeLessThanOrEqual(20)
    const tris = (g: BufferGeometry) => g.getAttribute('position').count / 3
    const total = chunks.reduce((a, c) => a + tris(c), 0)
    expect(total).toBe(tris(whole))
    // 第一塊是零散的：包圍球大，但三角形只佔一小部分
    expect(tris(chunks[0]!)).toBeLessThan(total * 0.1)
    for (const c of chunks.slice(1)) {
      expect(c.boundingSphere!.radius).toBeLessThan(whole.boundingSphere!.radius * 0.2)
    }
  })
})
