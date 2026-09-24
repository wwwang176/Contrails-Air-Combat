import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { InstancedMesh, Matrix4 } from 'three'
import { createFloraBuffer, pushFlora, FLORA_STRIDE, FloraKind, type FloraSource } from '../../src/render/flora'
import { excluding } from '../../src/render/floraExclude'
import { preloadPlantScenery } from '../../src/render/geometry/ground/plantScenery'
import { createTerrain } from '../../src/render/terrain'
import { preloadLeunaRivers } from '../../src/render/leunaRiver'
import type { RiverFile } from '../../src/world/river'
import { PLANT_CENTER, PLANT_PAD, PLANT_TREE_CLEAR, worldToPlant } from '../../src/world/leuna'

/** 一個每 10 m 放一株的假散佈器 */
const grid: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
  for (let x = x0; x < x1; x += 10) {
    for (let z = z0; z < z1; z += 10) {
      pushFlora(out, x, heightAt(x, z), z, 0, 1, 0, FloraKind.BroadTree)
    }
  }
}

function positions(out: ReturnType<typeof createFloraBuffer>): { x: number; z: number }[] {
  const list: { x: number; z: number }[] = []
  for (let i = 0; i < out.count; i++) {
    list.push({ x: out.data[i * FLORA_STRIDE]!, z: out.data[i * FLORA_STRIDE + 2]! })
  }
  return list
}

describe('excluding', () => {
  const rect = { x0: 20, z0: 20, x1: 60, z1: 60 }

  it('矩形內零株，矩形外的株與沒包時相同', () => {
    const plain = createFloraBuffer(1000)
    grid(0, 0, 100, 100, () => 0, plain)
    const wrapped = createFloraBuffer(1000)
    excluding(grid, rect)(0, 0, 100, 100, () => 0, wrapped)
    const inside = positions(wrapped).filter((p) => p.x >= 20 && p.x < 60 && p.z >= 20 && p.z < 60)
    expect(inside).toHaveLength(0)
    const expectedOutside = positions(plain).filter((p) => !(p.x >= 20 && p.x < 60 && p.z >= 20 && p.z < 60))
    expect(positions(wrapped)).toEqual(expectedOutside)
    expect(wrapped.dropped).toBe(0)
  })

  it('格子整個在矩形外時原樣透傳', () => {
    const plain = createFloraBuffer(1000)
    grid(200, 200, 300, 300, () => 0, plain)
    const wrapped = createFloraBuffer(1000)
    excluding(grid, rect)(200, 200, 300, 300, () => 0, wrapped)
    expect(positions(wrapped)).toEqual(positions(plain))
  })

  it('容量不足時照樣回報 dropped', () => {
    const wrapped = createFloraBuffer(5)
    excluding(grid, rect)(0, 0, 100, 100, () => 0, wrapped)
    expect(wrapped.count).toBe(5)
    expect(wrapped.dropped).toBeGreaterThan(0)
  })
})

/**
 * 【廠區的墊面一株都不能有】墊面轉了 `PLANT_HEADING`，而排除矩形是廠區
 * 局部座標 —— 少了那一次轉換，排除的是地圖中央的一塊空地，樹照長在廠房上。
 *
 * 【墊面外還要淨空一圈】廠界最深咬進 355 m，樹貼著墊面長的話，咬進來的
 * 缺口裡會站著一叢樹籬。
 */
describe('洛伊納的墊面不長樹', () => {
  beforeAll(async () => {
    await preloadPlantScenery((url) => {
      const buf = readFileSync('public' + url)
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
      return Promise.resolve(ab)
    })
    await preloadLeunaRivers((url) => Promise.resolve(
      JSON.parse(readFileSync('public' + url, 'utf8')) as RiverFile,
    ))
  })

  it('墊面外 PLANT_TREE_CLEAR 之內也零株', () => {
    const terrain = createTerrain('leuna')
    // 【要先把鏡頭放到廠區】散佈器只填鏡頭附近的格子；不 update 的話補的是
    // 地圖原點那一帶，而廠區在 z = −7,000
    terrain.update(0, PLANT_CENTER.x, PLANT_CENTER.z)
    terrain.settle?.()
    const found: { x: number; z: number }[] = []
    const q = { x: 0, z: 0 }
    terrain.object.traverse((o) => {
      const mesh = o as InstancedMesh
      if (!mesh.isInstancedMesh) return
      const m = new Matrix4()
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m)
        worldToPlant(m.elements[12]!, m.elements[14]!, q)
        if (Math.abs(q.x) < PLANT_PAD.halfX + PLANT_TREE_CLEAR
          && Math.abs(q.z) < PLANT_PAD.halfZ + PLANT_TREE_CLEAR) {
          found.push({ x: m.elements[12]!, z: m.elements[14]! })
        }
      }
    })
    expect(found.length,
      `淨空範圍內有 ${found.length} 株，例如 (${found[0]?.x.toFixed(0)}, `
      + `${found[0]?.z.toFixed(0)})`).toBe(0)
    terrain.dispose()
  })
})
