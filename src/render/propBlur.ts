import { Color, DoubleSide, MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three'

/**
 * # 轉動中的螺旋槳：槳葉的殘影
 *
 * 一張圓盤，片段端照角度與半徑算出「離最近一片槳葉多遠」：槳葉本身最濃，往後拖出一道
 * 扇形殘影，越往後越淡。殘影的長度、濃淡隨半徑變（槳根濃而短、槳尖淡而長），外圈可以
 * 往後彎。槳葉之間是透明的，看得到後面的機身。
 *
 * 【殘影不照真實轉速轉】圖案隨角度變化，照真實轉速轉的話每幀跨過的角度與槳葉間隔
 * 打拍子，看起來是慢慢轉、停住或倒轉（馬車輪效應）。圓盤另外照 `spin` 轉
 *
 * 【參數是全場共用的一份】`PROP_BLUR` 改了，下一幀所有螺旋槳一起變（工具頁的滑桿就是改它）
 */
export const PROP_BLUR = {
  /** 整體不透明度 */
  opacity: 0.85,
  /** 槳根、槳尖那一圈殘影的濃度（0–1） */
  rootAlpha: 0.75,
  tipAlpha: 0.25,
  /** 殘影拖多長，倍槳葉間隔（0–1）：槳根、槳尖 */
  rootSmear: 0.12,
  tipSmear: 0.35,
  /** 槳葉本身的寬度，倍槳葉間隔 */
  bladeWidth: 0.04,
  /** 外圈往後彎多少，圈（槳尖比槳根落後這麼多圈） */
  curve: 0.04,
  /** 整張圓盤的底色濃度：槳葉之間也留一點點 */
  base: 0.04,
  /** 殘影本身的轉速，rad/s */
  spin: 4,
  /** 殘影的顏色亮度（0 = 黑、1 = 白） */
  shade: 0.12,
}

/** 所有殘影材質共用的 uniform：`PROP_BLUR` 每幀由 `syncPropBlur` 寫進來 */
const SHARED = {
  uOpacity: { value: PROP_BLUR.opacity },
  uRootAlpha: { value: PROP_BLUR.rootAlpha },
  uTipAlpha: { value: PROP_BLUR.tipAlpha },
  uRootSmear: { value: PROP_BLUR.rootSmear },
  uTipSmear: { value: PROP_BLUR.tipSmear },
  uBladeWidth: { value: PROP_BLUR.bladeWidth },
  uCurve: { value: PROP_BLUR.curve },
  uBase: { value: PROP_BLUR.base },
}

const MATERIALS = new Set<MeshStandardMaterial>()

/** 把 `PROP_BLUR` 寫進共用的 uniform 與每個材質的顏色。改完參數呼叫一次 */
export function syncPropBlur(): void {
  SHARED.uOpacity.value = PROP_BLUR.opacity
  SHARED.uRootAlpha.value = PROP_BLUR.rootAlpha
  SHARED.uTipAlpha.value = PROP_BLUR.tipAlpha
  SHARED.uRootSmear.value = PROP_BLUR.rootSmear
  SHARED.uTipSmear.value = PROP_BLUR.tipSmear
  SHARED.uBladeWidth.value = PROP_BLUR.bladeWidth
  SHARED.uCurve.value = PROP_BLUR.curve
  SHARED.uBase.value = PROP_BLUR.base
  for (const m of MATERIALS) m.color.copy(SHADE.setScalar(PROP_BLUR.shade))
}
const SHADE = new Color()

/**
 * 一具螺旋槳的殘影材質。圓盤在轉軸的 XY 平面上、繞 +Z 轉（`rotation.z` 增加 = 槳葉往角度
 * 增加的方向走），殘影拖在角度較小的那一側。
 *
 * 【半透明、不寫深度】與舊的模糊圓盤同一套：繪製順序見 `PROP_DISC_RENDER_ORDER`
 */
export function createPropBlurMaterial(blades: number, radius: number): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: new Color().setScalar(PROP_BLUR.shade), roughness: 0.6,
    transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true,
  })
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, SHARED)
    shader.uniforms['uBlades'] = { value: blades }
    shader.uniforms['uRadius'] = { value: radius }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
       varying vec2 vProp;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
       vProp = position.xy;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
       varying vec2 vProp;
       uniform float uBlades, uRadius, uOpacity, uRootAlpha, uTipAlpha, uRootSmear, uTipSmear, uBladeWidth, uCurve, uBase;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
       float rr = length(vProp) / uRadius;
       // 外圈往後彎：槳尖比槳根落後 uCurve 圈
       float turn = atan(vProp.y, vProp.x) / 6.28318530718 + uCurve * rr;
       // 在這一片的間隔裡走到哪：0 = 槳葉前緣，往後（角度較小那一側）是 1 → 0，所以「落後多少」= 1 − 這個
       float behind = 1.0 - fract(turn * uBlades);
       float smear = mix(uRootSmear, uTipSmear, rr);
       float trail = behind < uBladeWidth ? 1.0 : exp(-(behind - uBladeWidth) / max(smear, 1e-3));
       // 前緣柔一點，不然是一條鋸齒
       trail *= smoothstep(0.0, 0.015, behind);
       float dens = mix(uRootAlpha, uTipAlpha, clamp(rr, 0.0, 1.0));
       // 外緣柔邊：圓盤是多邊形，硬邊看得出稜角
       float rim = 1.0 - smoothstep(0.94, 1.0, rr);
       gl_FragColor.a = clamp(trail * dens + uBase, 0.0, 1.0) * uOpacity * rim;`)
  }
  m.customProgramCacheKey = () => 'propBlur'
  MATERIALS.add(m)
  m.addEventListener('dispose', () => { MATERIALS.delete(m) })
  return m
}

/**
 * 從一具螺旋槳的頂點（以轉軸為原點、繞 +Z 轉）數出槳葉片數：取半徑 0.55～1.05 倍那一圈的
 * 頂點，照角度排序，相鄰兩點隔超過 30° 就是兩片之間的空隙。數不出來（沒有頂點）退回 3 片
 *
 * @param positions xyz 交錯的頂點座標
 */
export function countBlades(positions: ArrayLike<number>, radius: number): number {
  const angles: number[] = []
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!
    const r = Math.hypot(x, y)
    if (r < radius * 0.55 || r > radius * 1.05) continue
    angles.push(Math.atan2(y, x))
  }
  if (angles.length < 2) return 3
  angles.sort((a, b) => a - b)
  const GAP = Math.PI / 6
  let gaps = 0
  for (let i = 0; i < angles.length; i++) {
    const next = i + 1 < angles.length ? angles[i + 1]! : angles[0]! + Math.PI * 2
    if (next - angles[i]! > GAP) gaps++
  }
  return gaps >= 2 ? gaps : 3
}
