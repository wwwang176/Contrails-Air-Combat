import { describe, expect, it } from 'vitest'
import { Color, MeshBasicMaterial, ShaderLib, Texture, Vector3 } from 'three'
import { injectBillboard } from '../../src/render/particles'
import { createShipFireSmoke } from '../../src/render/smoke'
import { addSmokeLighting, injectSmokeLighting } from '../../src/render/smokeLighting'

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

  it('時段強度與散射量各自是 uniform，不必重新編譯 shader', () => {
    const s = shader()
    injectSmokeLighting(s)
    expect(s.fragmentShader).toContain('uSmokeSunAmount')
    expect(s.fragmentShader).toContain('uSmokeScatterStrength')
  })

  it('換時段會更新方向、顏色與強度，但不重建材質', () => {
    const particles = createShipFireSmoke(8, new Texture())
    const material = particles.object.material as MeshBasicMaterial
    const control = addSmokeLighting(
      particles,
      new Vector3(0, 1, 0),
      new Color(1, 1, 1),
      2.2,
    )
    const s = {
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    }
    material.onBeforeCompile(s as never, {} as never)
    control.setLight(new Vector3(1, 0, 0), new Color(0.5, 0.25, 0.125), 1.1)

    expect(s.uniforms.uSmokeSunDirection!.value).toMatchObject({ x: 1, y: 0, z: 0 })
    expect(s.uniforms.uSmokeSunColor!.value).toMatchObject({ r: 0.55, g: 0.275, b: 0.1375 })
    expect(s.uniforms.uSmokeSunAmount!.value).toBeCloseTo(0.5)
    particles.dispose()
  })
})
