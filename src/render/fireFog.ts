/**
 * 火只吃一部分霧。
 *
 * 【為什麼】火是自己發光的，霧不該把它整個吃掉：夜裡的霧是深藍色，照 three 的
 * 預設，遠方的爆炸會暗下去、融進夜色裡。完全不吃霧又不自然 —— 雷雨那種濃霧天，
 * 十公里外的火照樣清清楚楚。取一部分：遠處仍然淡下去，但比煙慢。
 *
 * 【加法與一般混合要分開算】three 的霧是把顏色往霧色混。一般混合（不透明的火塊）
 * 這樣做是對的；加法混合的東西（光暈片、火球）往霧色混再加上去，等於在畫面上
 * 疊一團霧色的亮光。加法的要讓貢獻淡掉，也就是乘上 (1 − 霧量)。
 */

/** 火吃霧的比例。1 = 跟一般物件一樣，0 = 完全不吃。**起始值，由試看裁定** */
export const FIRE_FOG = 0.5

/**
 * 取代 `#include <fog_fragment>` 的片段。霧量的算法與 three 的 `fog_fragment`
 * 相同（EXP2 與線性兩種），只是乘上 `amount`。
 */
export function fireFogFragment(amount: number, additive: boolean): string {
  const k = amount.toFixed(3)
  return /* glsl */ `
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fireFog = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fireFog = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    fireFog *= ${k};
    ${additive
      ? 'gl_FragColor.rgb *= 1.0 - fireFog;'
      : 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fireFog );'}
  #endif
`
}

/** 把片段著色器的霧換成火的霧。找不到 `fog_fragment` 就丟 —— 那是 three 改了名 */
export function applyFireFog(
  shader: { fragmentShader: string }, amount: number, additive: boolean,
): void {
  if (!shader.fragmentShader.includes('#include <fog_fragment>')) {
    throw new Error('fireFog：片段著色器裡找不到 fog_fragment')
  }
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <fog_fragment>', fireFogFragment(amount, additive))
}
