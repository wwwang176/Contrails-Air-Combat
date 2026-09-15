import { describe, expect, it } from 'vitest'
import { ShaderLib } from 'three'
import { injectBillboard } from '../../src/render/particles'
import { injectSmokeLighting } from '../../src/render/smokeLighting'

describe('煙霧 billboard 的方向光與假自遮蔽', () => {
  function shader(): {
    vertexShader: string
    fragmentShader: string
    uniforms: Record<string, { value: unknown }>
  } {
    const out = {
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
      uniforms: {},
    }
    injectBillboard(out, false)
    return out
  }

  it('由世界太陽方向產生視圖空間的假煙球法線光照', () => {
    const s = shader()
    injectSmokeLighting(s)
    expect(s.vertexShader).toContain('uSmokeSunDirection')
    expect(s.vertexShader).toContain('mat3(viewMatrix)')
    expect(s.fragmentShader).toContain('smokeNormal')
    expect(s.fragmentShader).toContain('sunFacing')
  })

  it('重用 alphaMap 濃度計算核心遮蔽，不增加第二次貼圖取樣', () => {
    const s = shader()
    injectSmokeLighting(s)
    expect(s.fragmentShader).toContain('float smokeDensity = texture2D')
    expect(s.fragmentShader).toContain('coreDensity')
    expect(s.fragmentShader.match(/texture2D\( alphaMap, vSpunUv \)/g)).toHaveLength(1)
  })

  it('光照可用 uniform 即時切換', () => {
    const s = shader()
    injectSmokeLighting(s)
    expect(s.fragmentShader).toContain('uSmokeLightingEnabled')
  })
})
