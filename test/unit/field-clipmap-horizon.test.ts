import { describe, expect, it } from 'vitest'
import { ShaderLib, type WebGLRenderer } from 'three'
import { createFieldClipmap } from '../../src/render/fieldClipmap'
import { FIELD_CLIP_FAR, FIELD_CLIP_HORIZON, FIELD_CLIP_NEAR } from '../../src/render/terrain'

/** 建構時只問非等向的上限；烘圖要到 `update` 才碰 GL */
const RENDERER = { capabilities: { getMaxAnisotropy: () => 1 } } as unknown as WebGLRenderer

/** 地面材質的片段著色器與 uniform（跑一次它的 onBeforeCompile） */
function compiled(horizon: boolean): { frag: string, uniforms: Record<string, { value: unknown }> } {
  const clip = createFieldClipmap(RENDERER, {
    season: 'summer', near: FIELD_CLIP_NEAR, far: FIELD_CLIP_FAR,
    ...(horizon ? { horizon: FIELD_CLIP_HORIZON } : {}),
  })
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  }
  clip.material.onBeforeCompile(shader as never, undefined as never)
  clip.dispose()
  return { frag: shader.fragmentShader, uniforms: shader.uniforms }
}

describe('田色 clipmap 的遠處', () => {
  /**
   * 【有最外層就不走算式】遠圖窗外逐像素算的田格沒有過濾，15 km 外是閃爍的鋸齒，
   * 而且那一圈是地面最貴的一段。算式只剩旁路與內圈
   */
  it('有最外層：遠圖窗外讀最外層的貼圖，再外面是它的平均色', () => {
    const { frag, uniforms } = compiled(true)
    expect(frag).toContain('bool proc = uBypass > 0.5 || tIn < 1.0;')
    expect(frag).toContain('bool tex = uBypass < 0.5 && tIn > 0.0;')
    expect(frag).toContain('horizonColourAt(qH, dHx, dHy, eH)')
    // 平均色讀最小一級 mipmap：2048² 是第 11 級
    expect(frag).toContain('textureLod(uHor, vec2(0.5), uHorTop)')
    expect(uniforms['uHorTop']!.value).toBe(Math.log2(FIELD_CLIP_HORIZON.size))
  })

  it('沒有最外層：遠圖窗外照舊走算式', () => {
    const { frag } = compiled(false)
    expect(frag).toContain('bool proc = uBypass > 0.5 || tIn < 1.0 || eF >= 1.0;')
    expect(frag).toContain('bool tex = uBypass < 0.5 && tIn > 0.0 && eF < 1.0;')
    expect(frag).not.toContain('horizonColourAt')
  })
})
