import { describe, it, expect } from 'vitest'
import { MeshStandardMaterial, type BufferAttribute } from 'three'
import { createFarHorizon, FAR_GROUND_REACH } from '../../src/render/farHorizon'
import { FARM_EXTENT } from '../../src/world/farmland'

describe('遠景環', () => {
  const h = createFarHorizon()
  const pos = h.mesh.geometry.getAttribute('position') as BufferAttribute

  it('固定不動 —— 沒有 update 這回事', () => {
    expect(h.mesh.position.x).toBe(0)
    expect(h.mesh.position.y).toBe(0)
    expect(h.mesh.position.z).toBe(0)
    expect('update' in h).toBe(false)
  })

  /**
   * 【為什麼一定要挖洞】環與細節地形都是地面，兩者若重疊就會 z-fighting ——
   * 而相機遠平面 5,000 km，深度量化 `Δz ≈ z²/2²⁴` 在細節地形的角落
   * （離中心 21 km）已經是 26 m。挖洞之後兩者只共用一條邊，沒有重疊面積。
   */
  it('中央 30 km 見方是空的', () => {
    const half = FARM_EXTENT / 2
    const idx = h.mesh.geometry.getIndex()!
    let inside = 0
    for (let t = 0; t < idx.count; t += 3) {
      let allIn = true
      for (let k = 0; k < 3; k++) {
        const v = idx.getX(t + k)
        if (Math.abs(pos.getX(v)) > half + 1 || Math.abs(pos.getZ(v)) > half + 1) {
          allIn = false
          break
        }
      }
      if (allIn) inside++
    }
    expect(inside).toBe(0)
  })

  it('內緣恰好貼著細節地形的外緣', () => {
    const half = FARM_EXTENT / 2
    let minAbsX = Infinity
    for (let i = 0; i < pos.count; i++) minAbsX = Math.min(minAbsX, Math.abs(pos.getX(i)))
    expect(minAbsX).toBe(half)
  })

  /**
   * 【為什麼不能用「不寫深度、先畫」】那樣它不遮任何東西：殘骸落到地表下
   * 25 m 才回收（`wrecks.ts`）、火花吃重力且沒有地面碰撞（`sparks.ts`）、
   * 上帝視角飛得出細節區。全部會穿幫。
   */
  it('正常寫深度', () => {
    const mat = h.mesh.material as MeshStandardMaterial
    expect(mat.depthWrite).toBe(true)
    expect(h.mesh.renderOrder).toBe(0)
  })

  it('與基準平原共面', () => {
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBe(0)
  })

  it('法線一律朝上', () => {
    const nrm = h.mesh.geometry.getAttribute('normal') as BufferAttribute
    for (let i = 0; i < nrm.count; i++) {
      expect(nrm.getX(i)).toBe(0)
      expect(nrm.getY(i)).toBe(1)
      expect(nrm.getZ(i)).toBe(0)
    }
  })

  it('鋪得夠遠 —— 霧在 100 km 吃掉 86%', () => {
    expect(FAR_GROUND_REACH).toBeGreaterThanOrEqual(1_000_000)
  })

  it('不做視錐剔除 —— 它永遠有一部分在畫面上', () => {
    expect(h.mesh.frustumCulled).toBe(false)
  })

  it('與細節地形用同一支田的著色器', () => {
    const mat = h.mesh.material as unknown as {
      onBeforeCompile: (s: { vertexShader: string; fragmentShader: string }) => void
    }
    const shader = {
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>',
    }
    mat.onBeforeCompile(shader)
    expect(shader.fragmentShader).toContain('fieldColorAt')
    expect(shader.vertexShader).toContain('modelMatrix')
  })

  it('dispose 真的釋放 geometry 與材質', () => {
    const g = createFarHorizon()
    const geo = g.mesh.geometry
    const mat = g.mesh.material as MeshStandardMaterial
    const pending = new Set<object>([geo, mat])
    geo.addEventListener('dispose', () => { pending.delete(geo) })
    mat.addEventListener('dispose', () => { pending.delete(mat) })
    g.dispose()
    expect(pending.size).toBe(0)
  })
})
