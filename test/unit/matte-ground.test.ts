import { describe, expect, it } from 'vitest'
import { MeshStandardMaterial, ShaderLib } from 'three'
import { GROUND_ROUGH, GROUND_SPECULAR, MATTE_GROUND_GLSL, matteGround } from '../../src/render/matteGround'

/** 跑一次材質的 onBeforeCompile，回傳改過的著色器 */
function compiled(m: MeshStandardMaterial): { frag: string; uniforms: Record<string, { value: unknown }> } {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  }
  m.onBeforeCompile(shader as never, undefined as never)
  return { frag: shader.fragmentShader, uniforms: shader.uniforms }
}

describe('地面的光照（matteGround）', () => {
  it('接在光照之後，共用同一組 uniform', () => {
    const m = new MeshStandardMaterial()
    matteGround(m)
    const { frag, uniforms } = compiled(m)
    expect(frag).toContain(`#include <lights_fragment_end>${MATTE_GROUND_GLSL}`)
    expect(uniforms['uGroundSpecular']).toBe(GROUND_SPECULAR)
    expect(uniforms['uGroundRough']).toBe(GROUND_ROUGH)
  })

  /** 【先跑材質自己的掛鉤】地面的田色、樹冠圖都在那裡注入；蓋掉的話地面只剩頂點色 */
  it('材質原本的掛鉤照跑，快取鍵延伸', () => {
    const m = new MeshStandardMaterial()
    m.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n// mine') }
    m.customProgramCacheKey = () => 'mine'
    matteGround(m)
    expect(compiled(m).frag).toContain('// mine')
    expect(m.customProgramCacheKey()).toBe('mine:matte')
  })

  /** 【只改太陽那一份漫射】乘在整個 directDiffuse 上的話，爆炸的點光源也跟著被調 */
  it('Oren-Nayar 的係數只乘在第一盞平行光的漫射上', () => {
    expect(MATTE_GROUND_GLSL).toContain('directionalLights[0].color * BRDF_Lambert(material.diffuseColor)')
    expect(MATTE_GROUND_GLSL).toContain('reflectedLight.directDiffuse += (onA + onB * cphi * st - 1.0) * sunDiffuse;')
    expect(MATTE_GROUND_GLSL).not.toContain('reflectedLight.directDiffuse *=')
  })
})
