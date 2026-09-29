import { describe, expect, it } from 'vitest'
import { ShaderLib, type WebGLRenderer } from 'three'
import { createFieldClipmap, outerFades, RECENTRE_FRACTION } from '../../src/render/fieldClipmap'
import {
  FIELD_CLIP_BACKDROP, FIELD_CLIP_FAR, FIELD_CLIP_HORIZON, FIELD_CLIP_NEAR,
} from '../../src/render/terrain'

/** 建構時只問非等向的上限；烘圖要到 `update` 才碰 GL */
const RENDERER = { capabilities: { getMaxAnisotropy: () => 1 } } as unknown as WebGLRenderer

/** 地面材質的片段著色器與 uniform（跑一次它的 onBeforeCompile） */
function compiled(horizon: boolean, backdrop = false): {
  frag: string, uniforms: Record<string, { value: unknown }>
} {
  const clip = createFieldClipmap(RENDERER, {
    season: 'summer', near: FIELD_CLIP_NEAR, far: FIELD_CLIP_FAR,
    ...(horizon ? { horizon: FIELD_CLIP_HORIZON } : {}),
    ...(backdrop ? { backdrop: FIELD_CLIP_BACKDROP } : {}),
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

  /**
   * 【窗緣只淡田色】疊圖（鎮的地面、河漫灘）在窗外由粗網格接手、一出窗就整塊出現；
   * 疊圖跟著淡掉的話，鎮會在窗緣先消失再跳出來
   */
  it('淡成平均色時，疊圖覆蓋的地方不淡', () => {
    const { frag } = compiled(true)
    expect(frag).toContain('float keep = clamp(h.a * 4.0, 0.0, 1.0);')
    expect(frag).toContain('smoothstep(1.0 - uEdgeBlend, 1.0, eH) * (1.0 - keep)')
  })

  /** 【context 還原後重烘】貼圖內容沒了，鏡頭沒跨挪窗門檻就不會再烘 —— 遠處一片黑 */
  it('context 還原之後下一次 update 每一層整張重烘', () => {
    const canvas = new EventTarget()
    const renderer = {
      capabilities: { getMaxAnisotropy: () => 1 },
      domElement: canvas,
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      render: () => {},
    } as unknown as WebGLRenderer
    const clip = createFieldClipmap(renderer, {
      season: 'summer', near: FIELD_CLIP_NEAR, far: FIELD_CLIP_FAR, horizon: FIELD_CLIP_HORIZON,
    })
    clip.update(0, 0)
    expect(clip.stats.recentres).toBe(3)
    clip.update(10, 10)
    expect(clip.stats.recentres).toBe(3)
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    clip.update(10, 10)
    expect(clip.stats.recentres).toBe(6)
    clip.dispose()
  })

  /**
   * 【圓環一定落在窗內】鏡頭離窗中心至多 span × RECENTRE_FRACTION；圓環伸出窗緣的話，
   * 那一段讀到的是環面上別處的內容 —— 地上憑空出現另一塊地的田
   */
  it('兩個漸變圓環都在各自的窗裡，而且由近到遠', () => {
    const hs = FIELD_CLIP_HORIZON.size * FIELD_CLIP_HORIZON.metersPerTexel
    const bs = FIELD_CLIP_BACKDROP.size * FIELD_CLIP_BACKDROP.metersPerTexel
    const f = outerFades(hs, bs)
    expect(f.horTo).toBeLessThanOrEqual(hs / 2 - hs * RECENTRE_FRACTION)
    expect(f.avgTo).toBeLessThanOrEqual(bs / 2 - bs * RECENTRE_FRACTION)
    expect(f.horFrom).toBeLessThan(f.horTo)
    expect(f.horTo).toBeLessThan(f.avgFrom)
    expect(f.avgFrom).toBeLessThan(f.avgTo)
    // 平均色要退到遠圖（30 km 窗）以外很遠 —— 飛高時那一片不該是平的
    const fs = FIELD_CLIP_FAR.size * FIELD_CLIP_FAR.metersPerTexel
    expect(f.avgFrom).toBeGreaterThan(fs * 2)
  })

  /** 【有遠景層】最外層外讀遠景層，平均色改取遠景層的，兩個交界以鏡頭為圓心 */
  it('有遠景層：最外層外讀遠景層，平均色取它的', () => {
    const { frag, uniforms } = compiled(true, true)
    expect(frag).toContain('if (eH >= 1.0) return backdropColourAt(qB, dBx, dBy, rCam);')
    expect(frag).toContain('textureLod(uBack, vec2(0.5), uBackTop)')
    expect(frag).toContain('smoothstep(uHorFade.x, uHorFade.y, rCam) * (1.0 - keep)')
    expect(frag).toContain('horizonColourAt(qH, dHx, dHy, eH, qB, dBx, dBy, rCam)')
    expect(uniforms['uBackTop']!.value).toBe(Math.log2(FIELD_CLIP_BACKDROP.size))
  })

  it('沒有最外層：遠圖窗外照舊走算式', () => {
    const { frag } = compiled(false)
    expect(frag).toContain('bool proc = uBypass > 0.5 || tIn < 1.0 || eF >= 1.0;')
    expect(frag).toContain('bool tex = uBypass < 0.5 && tIn > 0.0 && eF < 1.0;')
    expect(frag).not.toContain('horizonColourAt')
  })
})
