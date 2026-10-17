import type { MeshStandardMaterial } from 'three'

/**
 * # 地面的光照：林子不反光、太陽漫射走 Oren-Nayar
 *
 * 標準材質把地面當成一片平滑的面，這裡改兩件事：
 *
 * 1. **烘在地上的林子與屋頂不算鏡面**。斜看時菲涅耳把鏡面放大 —— 正午迎著太陽 18°
 *    斜看，林子正中央的鏡面約是漫射的一半，而視角係數（`viewShade.ts`）只乘在漫射上：
 *    烘在地上的林子被沖得又灰又亮，與 6 km 內的點、立體樹冠（沒有這片平地反光）接不上。
 *    地面著色器把這一點的顏色裡樹冠與屋頂佔的比例寫進 `groundTreeShare`，那一份的鏡面
 *    拿掉；田、草地、路照舊（`GROUND_SPECULAR` 倍率）。
 * 2. **太陽的漫射走 Oren-Nayar**（`GROUND_ROUGH`）。小凸起順光露出受光面、逆光露出
 *    背光面與影子：地面背光時亮、迎光時暗，太陽越低差越多。遠處的林子也是迎光暗、
 *    背光亮，兩者同一個方向。
 *
 * 【只改太陽那一份】天空光與環境光照舊是 Lambert；爆炸的點光源不受影響 —— 係數只乘在
 * 第一盞平行光（場上唯一的一盞，`lighting.ts` 的太陽）的漫射上。
 */

/**
 * 地面的鏡面反射倍率，1 = 標準材質原本的。**所有地面材質共用這一個 uniform**，除錯出口
 * （`__groundSpecular`）改它就能同頁對照
 */
export const GROUND_SPECULAR = { value: 1 }

/**
 * Oren-Nayar 的粗糙度 σ：小凸起斜面角度的標準差，弧度。0 = Lambert；0.2 約 11°。
 * 越大順光、逆光的明暗差越大，過了 0.6 畫面幾乎不再變。除錯出口 `__groundRough` 可以
 * 同頁對照
 */
export const GROUND_ROUGH = { value: 0.2 }

/**
 * 接在 `lights_fragment_end` 之後：鏡面乘倍率、樹冠與屋頂那一份拿掉；太陽那一份漫射換成
 * Oren-Nayar。
 *
 * Oren-Nayar 的簡化式：`A + B·max(0, cos(φi − φr))·sin α·tan β`，α、β 是入射角與
 * 出射角取大、取小。`sin α·tan β` 寫成 `√((1 − ci²)(1 − cr²)) / max(ci, cr)`
 */
export const MATTE_GROUND_GLSL = `
{
  float specKeep = uGroundSpecular * (1.0 - clamp(groundTreeShare, 0.0, 1.0));
  reflectedLight.directSpecular *= specKeep;
  reflectedLight.indirectSpecular *= specKeep;
}
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
 * 掛鉤再呼叫這一支。快取鍵跟著延伸。
 *
 * 【`groundTreeShare`】這一支在片段著色器開頭宣告它（預設 0，整片照常反光）；材質自己的
 * 掛鉤在算出樹冠份量的地方寫它
 */
export function matteGround(material: MeshStandardMaterial): void {
  const compile = material.onBeforeCompile
  const key = material.customProgramCacheKey()
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer)
    shader.uniforms['uGroundSpecular'] = GROUND_SPECULAR
    shader.uniforms['uGroundRough'] = GROUND_ROUGH
    shader.fragmentShader = 'uniform float uGroundSpecular;\nuniform float uGroundRough;\nfloat groundTreeShare = 0.0;\n'
      + shader.fragmentShader
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>${MATTE_GROUND_GLSL}`)
  }
  material.customProgramCacheKey = () => key + ':matte'
  material.needsUpdate = true
}
