import { describe, expect, it } from 'vitest'
import { MeshBasicMaterial, ShaderLib, type WebGLRenderer } from 'three'
import { createTexturedFireChunks, FIRE_SURFACE } from '../../src/render/fireSurface'

function compile(pool: ReturnType<typeof createTexturedFireChunks>) {
  const material = pool.object.material as MeshBasicMaterial
  const shader = {
    uniforms: {}, vertexShader: ShaderLib.basic.vertexShader,
    fragmentShader: ShaderLib.basic.fragmentShader,
  } as Parameters<MeshBasicMaterial['onBeforeCompile']>[0]
  material.onBeforeCompile(shader, {} as WebGLRenderer)
  return { shader, material }
}

describe('爆炸表面紋理整合', () => {
  it('使用遊戲選定的參數，同時保留原本的深度、雜點淡出與面明暗', () => {
    const pool = createTexturedFireChunks(0.6, undefined)
    try {
      const { shader, material } = compile(pool)
      expect(shader.uniforms.uBurnStrength!.value).toBe(0.65)
      expect(shader.uniforms.uBurnDensity!.value).toBe(0.5)
      expect(material.depthWrite).toBe(true)
      expect(material.alphaHash).toBe(true)
      expect(shader.fragmentShader).toContain('diffuseColor.a *= vAlpha')
      expect(shader.fragmentShader).toContain('vFacetN.y')
      expect(shader.vertexShader).toContain('vBurnPosition = position')
      expect(shader.fragmentShader).toContain('5.5 * uBurnDensity')
    } finally { pool.dispose() }
  })

  it('展示區的即時調整不會修改遊戲預設或其他池', () => {
    const strength = { value: 0.65 }, density = { value: 0.5 }
    const preview = createTexturedFireChunks(0.6, undefined, strength, density)
    const game = createTexturedFireChunks(0.6, undefined)
    try {
      const a = compile(preview).shader, b = compile(game).shader
      strength.value = 0
      density.value = 3
      expect(a.uniforms.uBurnStrength!.value).toBe(0)
      expect(a.uniforms.uBurnDensity!.value).toBe(3)
      expect(b.uniforms.uBurnStrength!.value).toBe(FIRE_SURFACE.strength)
      expect(b.uniforms.uBurnDensity!.value).toBe(FIRE_SURFACE.density)
    } finally { preview.dispose(); game.dispose() }
  })

  it('紋理時間跟隨模擬步進，重開戰鬥會重設', () => {
    const pool = createTexturedFireChunks(0.6, undefined)
    try {
      const { shader } = compile(pool)
      pool.step(0.1)
      pool.step(0)
      expect(shader.uniforms.uBurnTime!.value).toBeCloseTo(0.1)
      pool.reset()
      expect(shader.uniforms.uBurnTime!.value).toBe(0)
    } finally { pool.dispose() }
  })
})
