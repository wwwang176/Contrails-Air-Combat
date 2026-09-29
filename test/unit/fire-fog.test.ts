import { describe, expect, it } from 'vitest'
import { AdditiveBlending, Color, MeshBasicMaterial, NormalBlending, ShaderLib } from 'three'
import { FIRE_FOG, applyFireFog, fireFogFragment } from '../../src/render/fireFog'
import { createParticles } from '../../src/render/particles'
import { createFireChunks } from '../../src/render/chunks'
import { createFireGlow } from '../../src/render/blast'
import { createFireball } from '../../src/render/fireball'
import { createTracers } from '../../src/render/tracers'
import { createMuzzles, createTurretMuzzles } from '../../src/render/muzzle'

/** 拿材質的 onBeforeCompile 跑一次 three 的 meshbasic 著色器，回傳改過的片段 */
function compiled(m: MeshBasicMaterial): string {
  const shader = {
    uniforms: {},
    vertexShader: ShaderLib.basic.vertexShader,
    fragmentShader: ShaderLib.basic.fragmentShader,
  }
  m.onBeforeCompile(shader as never, undefined as never)
  return shader.fragmentShader
}

describe('fireFogFragment', () => {
  /** 【加法的讓貢獻淡掉】往霧色混再加上去，等於疊一團霧色的亮光 */
  it('加法混合：乘上 1 − 霧量，不往霧色混', () => {
    const s = fireFogFragment(0.5, true)
    expect(s).toContain('gl_FragColor.rgb *= 1.0 - fireFog')
    expect(s).not.toContain('fogColor')
    expect(s).toContain('fireFog *= 0.500')
  })

  it('一般混合：往霧色混，霧量打折', () => {
    const s = fireFogFragment(0.5, false)
    expect(s).toContain('mix( gl_FragColor.rgb, fogColor, fireFog )')
  })

  it('找不到 fog_fragment 就丟', () => {
    expect(() => applyFireFog({ fragmentShader: 'void main() {}' }, FIRE_FOG, true)).toThrow()
  })
})

describe('火只吃一部分霧', () => {
  it('爆炸火塊（一般混合）換成火的霧', () => {
    const s = compiled(createFireChunks(4).object.material as MeshBasicMaterial)
    expect(s).toContain('fireFog')
    expect(s).toContain('mix( gl_FragColor.rgb, fogColor, fireFog )')
  })

  it('光暈片與擊墜火球（加法）換成火的霧', () => {
    for (const p of [createFireGlow(4), createFireball(4)]) {
      const s = compiled(p.object.material as MeshBasicMaterial)
      expect(s).toContain('gl_FragColor.rgb *= 1.0 - fireFog')
    }
  })

  /** 【煙照舊吃霧】粒子池是共用的；沒給比例的池子不能被換掉 */
  it('沒給霧比例的粒子池維持 three 的霧', () => {
    const smoke = createParticles({
      capacity: 4, blending: NormalBlending, life: 1, sizeFrom: 1, sizeTo: 1,
      gravity: 0, drag: 0, alphaFrom: 1, color: (_t: number, out: Color) => out.set(0x333333),
    })
    const s = compiled(smoke.object.material as MeshBasicMaterial)
    expect(s).toContain('#include <fog_fragment>')
    expect(s).not.toContain('fireFog')
  })

  /**
   * 【program 不能共用】three 用 customProgramCacheKey 決定能不能重用程式；
   * 火與煙的 onBeforeCompile 字串相同的話，後建的拿到前一個的程式 —— 煙變成吃半霧
   */
  it('火與煙的粒子池拿到不同的 program key', () => {
    const glow = createFireGlow(4).object.material as MeshBasicMaterial
    const smoke = createParticles({
      capacity: 4, blending: AdditiveBlending, life: 1, sizeFrom: 1, sizeTo: 1,
      gravity: 0, drag: 0, alphaFrom: 1, color: (_t: number, out: Color) => out.set(0xffffff),
    }).object.material as MeshBasicMaterial
    expect(glow.customProgramCacheKey()).not.toBe(smoke.customProgramCacheKey())
  })
})

describe('曳光彈與槍口焰', () => {
  /** 【自己發光的不吃霧】夜裡的霧是深藍色，吃了霧遠方的火線會融進夜色 */
  it('曳光彈不吃霧、加法混合', () => {
    const m = createTracers(4).object.material as MeshBasicMaterial
    expect(m.fog).toBe(false)
    expect(m.blending).toBe(AdditiveBlending)
  })

  it('槍口焰（機槍與砲塔）不吃霧', () => {
    for (const mz of [createMuzzles(1), createTurretMuzzles(1)]) {
      expect((mz.object.material as MeshBasicMaterial).fog).toBe(false)
    }
  })
})
