import { describe, expect, it } from 'vitest'
import { ShaderChunk } from 'three'
import { installLightSkip, skipDarkPointLights } from '../../src/render/lightSkip'

const CALL = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, '
  + 'geometryClearcoatNormal, material, reflectedLight );'

/** 點光源那一圈的原文：`getPointLightInfo` 到 `#pragma unroll_loop_end` */
function pointLoop(chunk: string): string {
  const at = chunk.indexOf('getPointLightInfo(')
  return chunk.slice(at, chunk.indexOf('#pragma unroll_loop_end', at))
}

describe('skipDarkPointLights', () => {
  const src = ShaderChunk.lights_fragment_begin

  it('點光源那一圈的 RE_Direct 前面加上 visible 守衛', () => {
    const out = pointLoop(skipDarkPointLights(src))
    expect(out).toContain(`if ( directLight.visible ) ${CALL}`)
  })

  /** 【只動點光源】平行光恆亮、聚光燈這個遊戲沒有 —— 其餘的 RE_Direct 原樣 */
  it('其餘的 RE_Direct 一個都不動', () => {
    const count = (s: string, sub: string) => s.split(sub).length - 1
    const out = skipDarkPointLights(src)
    expect(count(out, CALL)).toBe(count(src, CALL))
    expect(count(out, `if ( directLight.visible ) ${CALL}`)).toBe(1)
    // 平行光那一圈仍是原文
    const dir = out.slice(out.indexOf('getDirectionalLightInfo('))
    expect(dir).not.toContain('if ( directLight.visible )')
  })

  /** 【three 改了 chunk 要響】靜默失效的症狀是「FPS 沒變」，沒有任何東西會紅 */
  it('找不到點光源那一圈就丟', () => {
    expect(() => skipDarkPointLights('void main() {}')).toThrow()
    expect(() => skipDarkPointLights('getPointLightInfo( a, b, c );')).toThrow()
  })

  it('裝兩次與裝一次相同', () => {
    installLightSkip()
    const once = ShaderChunk.lights_fragment_begin
    installLightSkip()
    expect(ShaderChunk.lights_fragment_begin).toBe(once)
    expect(pointLoop(once)).toContain(`if ( directLight.visible ) ${CALL}`)
  })
})
