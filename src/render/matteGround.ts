import type { MeshStandardMaterial } from 'three'

/**
 * 地面的鏡面反射倍率，0 = 不算。**所有地面材質共用這一個 uniform**，除錯出口
 * （`__groundSpecular`）改它就能同頁對照。
 *
 * 【為什麼地面不要鏡面】土、草、作物、林冠從空中看幾乎沒有鏡面反光。標準材質把地面
 * 當成一片平滑的面：粗糙度開到 0.95，斜看時菲涅耳仍把反光放大 —— 正午迎著太陽 18°
 * 斜看，林子正中央的鏡面約是漫射的一半。烘進地面的林子因此又灰又亮，與 6 km 內的
 * 點、立體樹冠（沒有這片平地反光）接不上，看起來像被霧沖淡。
 */
export const GROUND_SPECULAR = { value: 0 }

/**
 * 把地面材質的鏡面反射乘上 `GROUND_SPECULAR`。**接在材質自己的 `onBeforeCompile` 之後**：
 * 先設好材質的掛鉤再呼叫這一支。快取鍵跟著延伸。
 */
export function matteGround(material: MeshStandardMaterial): void {
  const compile = material.onBeforeCompile
  const key = material.customProgramCacheKey()
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer)
    shader.uniforms['uGroundSpecular'] = GROUND_SPECULAR
    shader.fragmentShader = 'uniform float uGroundSpecular;\n' + shader.fragmentShader
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.directSpecular *= uGroundSpecular;
reflectedLight.indirectSpecular *= uGroundSpecular;`)
  }
  material.customProgramCacheKey = () => key + ':matte'
  material.needsUpdate = true
}
