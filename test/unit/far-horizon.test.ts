import { describe, it, expect } from 'vitest'
import { MeshStandardMaterial, type BufferAttribute } from 'three'
import { createFarHorizon, FAR_GROUND_REACH } from '../../src/render/farHorizon'
import { applyFields } from '../../src/render/farmGround'
import { LEUNA_SITE } from '../../src/render/terrain'
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

/**
 * 遠景環要不要帶廠區那一層。
 *
 * 【為什麼可以不帶】廠區那一層的 GLSL（墊面、鋪面、鐵路、道路）是**每個
 * 像素都跑**的，而道路那一段還刻意留在外接矩形判斷之外 —— 連外道路要一路
 * 畫到圖邊。但環的中央挖掉的洞就是細節地形那 30 km 見方：只要廠區與所有
 * 連外線段都落在洞裡，環上就一個像素都畫不到它們，那一整段是純白工。
 *
 * 【所以這兩條要一起看】下面那一條是前提，上面那一條是結論。前提破了
 * （有人把連外道路拉出 ±15 km）而結論還留著的話，環上會少畫一截路 ——
 * 而且不報錯。
 */
describe('遠景環不帶廠區那一層', () => {
  function fragmentOf(mat: MeshStandardMaterial): string {
    const shader = {
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>',
      uniforms: {},
    }
    mat.onBeforeCompile(shader as never, null as never)
    return shader.fragmentShader
  }

  it('環的著色器裡沒有道路與鐵路的線段表', () => {
    const ring = createFarHorizon('summer')
    const src = fragmentOf(ring.mesh.material as MeshStandardMaterial)
    expect(src).not.toContain('ROADS[')
    expect(src).not.toContain('RAILS[')
    ring.dispose()
  })

  it('細節地形那一份仍然有 —— 這一層是它在畫的', () => {
    const mat = new MeshStandardMaterial()
    applyFields(mat, 'summer', LEUNA_SITE)
    const src = fragmentOf(mat)
    expect(src).toContain('ROADS[')
    expect(src).toContain('RAILS[')
  })

  it('廠區與所有連外線段都落在環的洞裡', () => {
    const half = FARM_EXTENT / 2
    const worst = (lines: readonly (readonly { x: number; z: number }[])[]): number => {
      let w = 0
      for (const line of lines) {
        for (const p of line) w = Math.max(w, Math.abs(p.x), Math.abs(p.z))
      }
      return w
    }
    expect(worst(LEUNA_SITE.roads)).toBeLessThan(half)
    expect(worst(LEUNA_SITE.rails ?? [])).toBeLessThan(half)
    const pivot = LEUNA_SITE.pivot ?? { x: 0, z: 0 }
    const pad = LEUNA_SITE.pad
    const reach = Math.hypot(pivot.x, pivot.z)
      + Math.max(Math.abs(pad.x0), Math.abs(pad.x1), Math.abs(pad.z0), Math.abs(pad.z1))
    expect(reach).toBeLessThan(half)
  })
})
