import { describe, it, expect } from 'vitest'
import { Mesh, type BufferAttribute } from 'three'
import { createFarmGround, FARM_CHUNKS } from '../../src/render/farmGround'
import { createFarmland, FARM_CELL, FARM_EXTENT } from '../../src/world/farmland'

const farm = createFarmland()
const ground = createFarmGround(farm.field)
const meshes = ground.object.children.filter((c): c is Mesh => c instanceof Mesh)

describe('農地的切塊 mesh', () => {
  it('切成 FARM_CHUNKS² 塊', () => {
    expect(meshes.length).toBe(FARM_CHUNKS * FARM_CHUNKS)
  })

  /**
   * 【這是 `render/terrain.ts` 那條鐵律】畫出來的頂點與撞地判定查到的
   * 必須是同一個數字。
   */
  it('每一個頂點的高度就是 field.data 裡的那一個', () => {
    let worst = 0
    for (const m of meshes) {
      const pos = m.geometry.getAttribute('position') as BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        worst = Math.max(worst,
          Math.abs(pos.getY(i) - farm.field.sample(pos.getX(i), pos.getZ(i))))
      }
    }
    expect(worst).toBe(0)
  })

  /**
   * 【只比頂點守不住鐵律】對角線畫反、甚至格內改用雙線性內插，**頂點都完全
   * 相同**，上一條照樣全綠 —— 那正是上一輪漏掉 16 m 低估的那個型態。
   *
   * 真正的判準是：`field.sample` 在格子內部走的是哪一個三角形，畫面上那一格
   * 就得是同一個。所以要在**三角形內部**取樣，拿三角形所在平面的高度與
   * `field.sample` 比。
   *
   * 【要挑不共面的格】四個角共面時兩種對角線給出同一個平面，測不出差別。
   */
  it('格子內部：三角形所在的平面與 field.sample 逐點相等', () => {
    const { size, cell, data } = farm.field
    const half = (size - 1) / 2
    let best = 0
    let bc = 0
    let br = 0
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const skew = Math.abs(data[r * size + c]! + data[(r + 1) * size + c + 1]!
          - data[r * size + c + 1]! - data[(r + 1) * size + c]!)
        if (skew > best) { best = skew; bc = c; br = r }
      }
    }
    console.log(JSON.stringify({ 落差: best.toFixed(2) + ' m', col: bc, row: br }))
    expect(best).toBeGreaterThan(1)   // 真的有一格測得出差別

    const x0 = (bc - half) * cell
    const z0 = (br - half) * cell
    let worst = 0
    for (let tz = 0.05; tz < 1; tz += 0.05) {
      for (let tx = 0.05; tx < 1; tx += 0.05) {
        const x = x0 + tx * cell
        const z = z0 + tz * cell
        worst = Math.max(worst,
          Math.abs(meshHeightAt(meshes, x, z) - farm.field.sample(x, z)))
      }
    }
    console.log(JSON.stringify({ 格內最大差: worst.toExponential(2) }))
    expect(worst).toBeLessThan(1e-4)
  })

  it('塊與塊的接縫上也相等', () => {
    const seam = ((farm.field.size - 1) / FARM_CHUNKS) * FARM_CELL - FARM_EXTENT / 2
    let worst = 0
    for (let z = -14000; z <= 14000; z += 137) {
      worst = Math.max(worst,
        Math.abs(meshHeightAt(meshes, seam, z) - farm.field.sample(seam, z)))
    }
    expect(worst).toBeLessThan(1e-4)
  })

  it('不帶頂點色 —— 顏色全部由片段著色器算', () => {
    for (const m of meshes) expect(m.geometry.getAttribute('color')).toBeUndefined()
  })

  it('每一塊都有自己的包圍球，可以被視錐剔除', () => {
    for (const m of meshes) {
      expect(m.geometry.boundingSphere).not.toBeNull()
      expect(m.frustumCulled).toBe(true)
    }
  })

  it('三角形總數是 375² × 2', () => {
    let tris = 0
    for (const m of meshes) tris += m.geometry.getIndex()!.count / 3
    expect(tris).toBe(375 * 375 * 2)
  })

  it('材質是平面著色，而且注入了田的 GLSL', () => {
    const m = meshes[0]!
    const mat = (Array.isArray(m.material) ? m.material[0]! : m.material) as unknown as {
      flatShading: boolean
      onBeforeCompile: (s: { vertexShader: string; fragmentShader: string }) => void
    }
    expect(mat.flatShading).toBe(true)
    // onBeforeCompile 在 headless 不會被呼叫 —— 手動餵一個假 shader 物件
    const shader = {
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>',
    }
    mat.onBeforeCompile(shader)
    expect(shader.fragmentShader).toContain('fieldColorAt')
    expect(shader.vertexShader).toContain('vFarmWorld')
    // 【世界座標，不是 local】遠景環共用這支材質，取樣點必須釘在世界上
    expect(shader.vertexShader).toContain('modelMatrix')
  })

  /**
   * 【為什麼掛事件而不是看屬性】`BufferGeometry.dispose()` 只發一個事件，
   * 屬性仍然留在物件上 —— 用 `attributes.position` 判斷會恆為綠。
   */
  it('dispose 真的釋放每一塊的 geometry 與那份共用的材質', () => {
    const g = createFarmGround(farm.field)
    const pending = new Set<object>()
    for (const c of g.object.children) {
      if (!(c instanceof Mesh)) continue
      pending.add(c.geometry)
      c.geometry.addEventListener('dispose', () => { pending.delete(c.geometry) })
      const mat = Array.isArray(c.material) ? c.material[0]! : c.material
      if (!pending.has(mat)) {
        pending.add(mat)
        mat.addEventListener('dispose', () => { pending.delete(mat) })
      }
    }
    // 25 塊 geometry 加一份共用的材質
    expect(pending.size).toBe(FARM_CHUNKS * FARM_CHUNKS + 1)
    g.dispose()
    expect(pending.size).toBe(0)
  })
})

/**
 * 在 mesh 上找 (x, z) 落在哪一個三角形，回傳那個平面的高度。
 *
 * 【為什麼要自己走三角形】這正是那兩條測試的重點：不能用 `field.sample`
 * 算「畫面上是多少」，那樣兩邊會是同一份程式碼，測不到任何東西。
 */
function meshHeightAt(meshes: readonly Mesh[], x: number, z: number): number {
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position') as BufferAttribute
    const idx = m.geometry.getIndex()!
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t)
      const b = idx.getX(t + 1)
      const c = idx.getX(t + 2)
      const ax = pos.getX(a); const az = pos.getZ(a)
      const bx = pos.getX(b); const bz = pos.getZ(b)
      const cx = pos.getX(c); const cz = pos.getZ(c)
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
      if (Math.abs(d) < 1e-9) continue
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
      const w = 1 - u - v
      if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue
      return u * pos.getY(a) + v * pos.getY(b) + w * pos.getY(c)
    }
  }
  throw new Error('mesh 上找不到那一點')
}
