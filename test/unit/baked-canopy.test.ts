import { describe, expect, it } from 'vitest'
import { RGFormat, ShaderLib, type Texture, type WebGLRenderer } from 'three'
import { canopyGapDensity, createFieldClipmap } from '../../src/render/fieldClipmap'
import { fieldGlsl, fieldGlslWithSite } from '../../src/render/fieldShaders'
import { createViewShade } from '../../src/render/viewShade'
import { ASCH_SITE } from '../../src/render/terrainSites'
import {
  FIELD_CLIP_BACKDROP, FIELD_CLIP_FAR, FIELD_CLIP_HORIZON, FIELD_CLIP_MID, FIELD_CLIP_NEAR,
} from '../../src/render/terrain'
import { createDrawnTiles } from '../../src/render/drawnTiles'

/** 建構時只問非等向的上限；烘圖要到 `update` 才碰 GL */
const RENDERER = { capabilities: { getMaxAnisotropy: () => 1 } } as unknown as WebGLRenderer

/** 地面材質的片段著色器與 uniform（跑一次它的 onBeforeCompile） */
function compiled(tree: boolean): { frag: string, uniforms: Record<string, { value: unknown }> } {
  const shade = createViewShade('lateAutumn')
  const drawnTiles = createDrawnTiles()
  const clip = createFieldClipmap(RENDERER, {
    season: 'lateAutumn', site: ASCH_SITE, open: true,
    near: FIELD_CLIP_NEAR, far: FIELD_CLIP_FAR, horizon: FIELD_CLIP_HORIZON, backdrop: FIELD_CLIP_BACKDROP,
    mid: FIELD_CLIP_MID, drawnTiles,
    ...(tree ? { viewShade: shade } : {}),
  })
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  }
  clip.material.onBeforeCompile(shader as never, undefined as never)
  clip.dispose()
  shade.dispose()
  drawnTiles.dispose()
  return { frag: shader.fragmentShader, uniforms: shader.uniforms }
}

describe('田色的樹冠份量（fieldTree）', () => {
  it('不要份量時字串與不帶參數時逐字相同 —— 其他用到田色算式的地方不受影響', () => {
    for (const season of ['summer', 'lateAutumn'] as const) {
      for (const open of [false, true]) {
        expect(fieldGlsl(season, true, open, false)).toBe(fieldGlsl(season, true, open))
      }
      expect(fieldGlslWithSite(season, ASCH_SITE, true, true, false)).toBe(fieldGlslWithSite(season, ASCH_SITE, true, true))
    }
  })

  it('要份量時：樹林田、空地的林子、樹點、樹籬寫入，凹路與廠區的路照覆蓋率衰減', () => {
    const g = fieldGlslWithSite('lateAutumn', ASCH_SITE, true, true, true)
    expect(g).toContain('vec2 fieldTree = vec2(0.0);')
    expect(g).toContain('fieldTree = wood ? fieldFar * (woodCone ? vec2(0.0, 1.0) : vec2(1.0, 0.0)) : vec2(0.0);')
    expect(g).toContain('fieldTree = fieldFar * openWoodCover(world) * vec2(0.700, 0.300);')
    expect(g).toContain('fieldTree = mix(fieldTree, cone ? vec2(0.0, 1.0) : vec2(1.0, 0.0), cov);')
    expect(g).toContain('fieldTree = mix(fieldTree, vec2(fieldFar * HEDGE_TREE_SHARE, 0.0), hedgeCover);')
    expect(g).toContain('fieldTree *= 1.0 - trackCover;')
    expect(g).toContain('fieldTree *= 1.0 - roadCover;')
  })

  it('草原沒有樹冠色：份量恆為 0', () => {
    const g = fieldGlsl('winterSteppe', true, false, true)
    expect(g).toContain('const float HEDGE_TREE_SHARE = 0.0;')
    expect(g).toContain('fieldTree = vec2(0.0);')
  })
})

describe('烘進地面的林子照點的算式畫', () => {
  it('給了植被的表：遠圖、最外層、遠景層各多一張兩通道的份量', () => {
    const { uniforms } = compiled(true)
    for (const k of ['uFarS', 'uHorS', 'uBackS']) {
      expect((uniforms[k]!.value as Texture).format).toBe(RGFormat)
    }
    // 近圖、中圖是近處的樣子，沒有份量
    expect(uniforms['uNearS']).toBeUndefined()
    expect(uniforms['uMidS']).toBeUndefined()
    expect(uniforms['uViewShade']).toBeDefined()
    expect(uniforms['uCanopyBroad']).toBeDefined()
  })

  it('沒給表：著色器沒有樹冠那一段', () => {
    const { frag, uniforms } = compiled(false)
    expect(frag).not.toContain('canopyLight')
    expect(uniforms['uFarS']).toBeUndefined()
  })

  /** 【份量照顏色的權重混】少跟一步的話，那一層的交界會出現接縫 */
  it('份量與顏色同一套權重：中圖、近圖、最外層、內圈的算式都跟著混', () => {
    const { frag } = compiled(true)
    expect(frag).toContain('ts *= 1.0 - drawn;')
    expect(frag).toContain('ts *= tN;')
    expect(frag).toContain('ts = mix(ts, hs, tF);')
    expect(frag).toContain('hs = mix(hS, bs, f);')
    expect(frag).toContain('bs = mix(textureGrad(uBackS, fract(qB), dBx, dBy).rg, avgS, tA);')
    expect(frag).toContain('s = proc ? mix(s, ts, tIn) : ts;')
    expect(frag).toContain('if (proc) { c = fieldColorAt(w); s = fieldTree * 0.500; }')
  })

  it('表預設在頂點查；可以切到像素查，切換時程式的鍵跟著換', () => {
    const shade = createViewShade('lateAutumn')
    const clip = createFieldClipmap(RENDERER, {
      season: 'lateAutumn', near: FIELD_CLIP_NEAR, far: FIELD_CLIP_FAR, viewShade: shade,
    })
    const run = (): { vert: string, frag: string } => {
      const shader = {
        uniforms: {} as Record<string, { value: unknown }>,
        vertexShader: ShaderLib.standard.vertexShader,
        fragmentShader: ShaderLib.standard.fragmentShader,
      }
      clip.material.onBeforeCompile(shader as never, undefined as never)
      return { vert: shader.vertexShader, frag: shader.fragmentShader }
    }
    expect(clip.canopyLookup()).toBe(false)
    const vx = run()
    expect(vx.vert).toContain('vCanopyKB = viewShade(0.0, toCam);')
    expect(vx.frag).toContain('uCanopyBroad * vCanopyKB')
    const keyVx = clip.material.customProgramCacheKey()
    expect(clip.canopyLookup(true)).toBe(true)
    const px = run()
    expect(px.vert).not.toContain('vCanopyKB')
    expect(px.frag).toContain('uCanopyBroad * viewShade(0.0, toCam)')
    expect(clip.material.customProgramCacheKey()).not.toBe(keyVx)
    clip.dispose()
    shade.dispose()
  })

  it('樹冠那一份換成點的光、不反光', () => {
    const { frag } = compiled(true)
    expect(frag).toContain('totalEmissiveRadiance += canopyLight;')
    expect(frag).toContain('reflectedLight.directSpecular *= 1.0 - canopyMatte;')
    expect(frag).toContain('reflectedLight.indirectSpecular *= 1.0 - canopyMatte;')
  })
})

describe('林間空隙', () => {
  /** 展示區 16 m 一格的闊葉林，點從正上方看蓋住 47% */
  it('樹林田的闊葉林：正上方看點蓋住 45%～49%', () => {
    const cover = 1 - Math.exp(-canopyGapDensity('broad'))
    expect(cover).toBeGreaterThan(0.45)
    expect(cover).toBeLessThan(0.49)
  })

  /** 德 M3 地形 2 km 外、仰角 8°～85° 林子裡點的覆蓋率反推 d 是 0.26～0.39 */
  it('空地的林子比樹林田稀：d 落在量到的 0.26～0.39', () => {
    const d = canopyGapDensity('open')
    expect(d).toBeGreaterThan(0.26)
    expect(d).toBeLessThan(0.39)
    expect(d).toBeLessThan(canopyGapDensity('broad'))
  })
})
