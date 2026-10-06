import { describe, expect, it, vi } from 'vitest'
import { FloatType, GLSL3, LessDepth, Mesh, ShaderLib, ShaderMaterial, type MeshStandardMaterial } from 'three'
import { createOceanMaterials } from '../../src/render/oceanMaterials'
import { FACE_TABLE_HEIGHT, FACE_TABLE_WIDTH } from '../../src/render/oceanShaders'
import { DAY_PALETTES } from '../../src/render/timeOfDay'

function compile(material: MeshStandardMaterial) {
  const shader = { uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader }
  ;(material.onBeforeCompile as (s: typeof shader, renderer: unknown) => void)(shader, null)
  return shader
}

describe('ocean material resources', () => {
  it.each([false, true])('shares live uniforms between near/far and height users; table=%s', useTable => {
    const surface = createOceanMaterials(null, useTable)
    try {
      const near = compile(surface.material), far = compile(surface.farMaterial)
      for (const [name, uniform] of Object.entries(surface.heightUniforms)) {
        expect(near.uniforms[name]).toBe(uniform)
        expect(far.uniforms[name]).toBe(uniform)
      }
      for (const name of Object.keys(surface.sparkle)) expect(near.uniforms[name]).toBe(far.uniforms[name])
      surface.uTime.value = 17
      surface.uOrigin.value.set(120, -240)
      expect(near.uniforms['uTime']!.value).toBe(17)
      expect(far.uniforms['uOrigin']!.value).toBe(surface.uOrigin.value)
      expect(surface.farMaterial.depthFunc).toBe(LessDepth)
      expect(surface.material.fog && surface.farMaterial.fog).toBe(true)
      expect(surface.material.customProgramCacheKey()).toBe(useTable ? 'ocean-near-waves-table' : 'ocean-near-waves')
      expect(surface.farMaterial.customProgramCacheKey()).toBe('ocean-far-flat')
      expect(near.vertexShader).toContain('attribute float oceanCell;')
      expect(far.vertexShader).not.toContain('attribute float oceanCell;')
      expect(far.uniforms['uFaceTable']).toBeUndefined()
      if (useTable) {
        expect(near.uniforms['uFaceTable']!.value).toBe(surface.tableTarget!.texture)
        const quad = surface.tableScene.children[0] as Mesh
        const table = quad.material as ShaderMaterial
        for (const [name, uniform] of Object.entries(near.uniforms)) {
          if (name !== 'uFaceTable') expect(table.uniforms[name]).toBe(uniform)
        }
        expect(table.glslVersion).toBe(GLSL3)
        expect(table.depthTest || table.depthWrite).toBe(false)
        expect(surface.tableTarget!.texture.type).toBe(FloatType)
        expect([surface.tableTarget!.width, surface.tableTarget!.height]).toEqual([FACE_TABLE_WIDTH, FACE_TABLE_HEIGHT])
      } else {
        expect(near.uniforms['uFaceTable']).toBeUndefined()
        expect(surface.tableTarget).toBeNull()
        expect(surface.tableScene.children).toHaveLength(0)
      }
    } finally { surface.dispose() }
  })

  it('changes both materials and the shared palette without modifying another ocean', () => {
    const a = createOceanMaterials(null, true), b = createOceanMaterials(null, true)
    try {
      const original = b.material.color.getHex()
      const horizon = a.paletteUniforms.uSkyHorizon
      a.setPalette(DAY_PALETTES.dusk)
      expect(a.material.color.getHex()).toBe(DAY_PALETTES.dusk.seaColor)
      expect(a.farMaterial.color.getHex()).toBe(DAY_PALETTES.dusk.seaColor)
      expect(a.paletteUniforms.uSkyHorizon).toBe(horizon)
      expect(horizon.value.getHex()).toBe(DAY_PALETTES.dusk.skyHorizon)
      expect(b.material.color.getHex()).toBe(original)
      expect(a.tableTarget).not.toBe(b.tableTarget)
      expect(a.sparkle.uShoreMap.value).not.toBe(b.sparkle.uShoreMap.value)
    } finally { a.dispose(); b.dispose() }
  })

  it.each([false, true])('releases every owned material, texture and table resource; table=%s', useTable => {
    const a = createOceanMaterials(null, useTable), b = createOceanMaterials(null, useTable)
    const disposed = vi.fn(), otherDisposed = vi.fn()
    const resources = [a.material, a.farMaterial, a.sparkle.uShoreMap.value]
    for (const r of resources) r.addEventListener('dispose', disposed)
    for (const r of [b.material, b.farMaterial, b.sparkle.uShoreMap.value]) r.addEventListener('dispose', otherDisposed)
    if (a.tableTarget !== null) {
      a.tableTarget.addEventListener('dispose', disposed)
      const quad = a.tableScene.children[0] as Mesh
      quad.geometry.addEventListener('dispose', disposed)
      ;(quad.material as ShaderMaterial).addEventListener('dispose', disposed)
    }
    a.dispose()
    expect(disposed).toHaveBeenCalledTimes(useTable ? 6 : 3)
    expect(otherDisposed).not.toHaveBeenCalled()
    b.dispose()
  })
})
