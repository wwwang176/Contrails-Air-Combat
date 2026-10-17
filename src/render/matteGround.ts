import type { MeshStandardMaterial } from 'three'

/**
 * # 地面的光照：粗糙、幾乎不反光
 *
 * 標準材質把地面當成一片平滑的面。土、草、作物、林冠其實是無數小凸起，這裡改兩件事：
 *
 * 1. **鏡面只留一成**（`GROUND_SPECULAR`）。粗糙度開到 0.95，斜看時菲涅耳仍把反光
 *    放大 —— 正午迎著太陽 18° 斜看，林子正中央的鏡面約是漫射的一半，烘在地上的林子
 *    被沖得又灰又亮，與 6 km 內的點、立體樹冠接不上，看起來像被霧沖淡。
 * 2. **太陽的漫射走 Oren-Nayar**（`GROUND_ROUGH`）。小凸起順光看露出受光面、逆光看
 *    露出背光面與影子：地面背光時亮、迎光時暗，太陽越低差越多。遠處的林子
 *    （`viewShade.ts`）也是迎光暗、背光亮，兩者同一個方向。
 *
 * 【只改太陽那一份】天空光與環境光照舊是 Lambert；爆炸的點光源不受影響 —— 係數只乘在
 * 第一盞平行光（場上唯一的一盞，`lighting.ts` 的太陽）的漫射上。
 */

/**
 * 地面的鏡面反射倍率，1 = 標準材質原本的。**所有地面材質共用這一個 uniform**，除錯出口
 * （`__groundSpecular`）改它就能同頁對照
 */
export const GROUND_SPECULAR = { value: 0.1 }

/**
 * Oren-Nayar 的粗糙度 σ：小凸起斜面角度的標準差，弧度。0 = Lambert；0.4 約 23°，
 * 一般的田與草地。過了 0.6 畫面幾乎不再變。除錯出口 `__groundRough` 可以同頁對照
 */
export const GROUND_ROUGH = { value: 0.4 }

/**
 * 接在 `lights_fragment_end` 之後：鏡面乘倍率；太陽那一份漫射換成 Oren-Nayar。
 *
 * Oren-Nayar 的簡化式：`A + B·max(0, cos(φi − φr))·sin α·tan β`，α、β 是入射角與
 * 出射角取大、取小。`sin α·tan β` 寫成 `√((1 − ci²)(1 − cr²)) / max(ci, cr)`
 */
export const MATTE_GROUND_GLSL = `
reflectedLight.directSpecular *= uGroundSpecular;
reflectedLight.indirectSpecular *= uGroundSpecular;
#if NUM_DIR_LIGHTS > 0
{
  float s2 = uGroundRough * uGroundRough;
  float onA = 1.0 - 0.5 * s2 / (s2 + 0.33);
  float onB = 0.45 * s2 / (s2 + 0.09);
  vec3 onL = directionalLights[0].direction;
  float ci = clamp(dot(geometryNormal, onL), 0.0, 1.0);
  float cr = clamp(dot(geometryNormal, geometryViewDir), 1.0e-4, 1.0);
  vec3 li = onL - geometryNormal * ci;
  vec3 lr = geometryViewDir - geometryNormal * cr;
  float cphi = max(0.0, dot(li, lr) / max(length(li) * length(lr), 1.0e-5));
  float st = sqrt((1.0 - ci * ci) * (1.0 - cr * cr)) / max(max(ci, cr), 1.0e-4);
  vec3 sunDiffuse = ci * directionalLights[0].color * BRDF_Lambert(material.diffuseColor);
  reflectedLight.directDiffuse += (onA + onB * cphi * st - 1.0) * sunDiffuse;
}
#endif`

/**
 * 把地面材質換成上面那一套光照。**接在材質自己的 `onBeforeCompile` 之後**：先設好材質的
 * 掛鉤再呼叫這一支。快取鍵跟著延伸
 */
export function matteGround(material: MeshStandardMaterial): void {
  const compile = material.onBeforeCompile
  const key = material.customProgramCacheKey()
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer)
    shader.uniforms['uGroundSpecular'] = GROUND_SPECULAR
    shader.uniforms['uGroundRough'] = GROUND_ROUGH
    shader.fragmentShader = 'uniform float uGroundSpecular;\nuniform float uGroundRough;\n' + shader.fragmentShader
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>${MATTE_GROUND_GLSL}`)
  }
  material.customProgramCacheKey = () => key + ':matte'
  material.needsUpdate = true
}
