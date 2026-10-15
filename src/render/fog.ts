import { Color, FogExp2, type MeshStandardMaterial, type PointsMaterial } from 'three'
import { skyColorAt } from './sky'

/**
 * 霧色。**就是地平線上的天空色。**
 *
 * 霧的工作是空氣透視：物件、陸地與海面都吃同一層霧。座艙視角下物件絕大多數
 * 是在天空的背景上看到的，所以霧色就該是地平線上的天空色；遠海往它化，海天
 * 交界在遠處變軟，而不是一條硬邊。
 *
 * 【不要壓暗】霧色比天空暗的話，遠海化進霧色之後會比天空暗一截，地平線上多出
 * 一條暗帶。
 *
 * 【為什麼是推導不是寫死】天空色怎麼調，霧色都自動跟上。寫死一個像
 * `0x7ea8c4` 的值會出錯：那種值用「比 `SKY_HORIZON` 暗」當判準，而
 * `SKY_HORIZON` 只出現在正下方、被海擋著，畫面上的地平線其實是漸層的正
 * 中間 —— 寫死的霧色於是比天空**亮**，一飛就看得出來。
 *
 * 這條關係由 `test/unit/fog.test.ts` **逐分量**釘住 —— 注意下面 `createFog`
 * 那條守不住它（它比的是 `createFog().color` 與 `FOG_COLOR`，兩邊一起改
 * 照樣綠）。
 */
export const FOG_COLOR: Color = skyColorAt(0, new Color())

/**
 * 指數霧的密度，m⁻¹。
 *
 * 【為什麼用指數霧不用線性霧】線性霧要選一個 near，而 near 之內完全沒有
 * 霧、之外立刻開始 —— 在那個半徑上會出現一道看得見的環。指數霧的因子是
 * `1 − exp(−(d·ρ)²)`，近處由二次項壓到幾乎是零，沒有起點可言。而「近處
 * 不影響、遠處吃滿」正是這裡要的形狀。
 *
 * 【正午的空氣透視】近處保留辨識度，中遠景逐漸淡入天色：
 *
 *   5 km（纏鬥距離）    1.2 %   —— 輕微霧感，仍看得清飛機與地面細節
 *   30 km（全戰場）      35 %   —— 降低遠景對比，避免像一張攤平的地圖
 *   140 km（幾何地平線）近 100 % —— 極遠處的陸地與海面融入地平線天色
 *
 * 這三個距離的辨識度由 `test/unit/fog.test.ts` 守住。
 */
export const FOG_DENSITY = 2.2e-5

/** 海面、群島與海岸的正午沿用較淡的霧，保留海天交界。 */
export const MARITIME_FOG_DENSITY = 0.7e-5

/**
 * 指數霧的因子，0..1。0 = 完全看得到，1 = 完全是霧色。
 *
 * 【為什麼要有這個純函數】`FogExp2` 的計算在 GPU 的著色器裡，測不到。把
 * 同一條公式寫成 CPU 的一份，設計意圖才有東西可以斷言。
 *
 * **兩份必須一致** —— 這是 three 的 `fog_fragment` chunk 在 `FOG_EXP2`
 * 分支用的公式：`1.0 - exp( -fogDensity * fogDensity * vFogDepth * vFogDepth )`。
 */
export function fogFactor(distance: number, density: number): number {
  const d = distance * density
  return 1 - Math.exp(-d * d)
}

export function createFog(): FogExp2 {
  const fog = new FogExp2(0, FOG_DENSITY)
  // 【用 copy 不用建構子傳色】`FOG_COLOR` 已經在工作色彩空間裡；傳進建構子
  // 會被當成 sRGB 再轉一次，顏色會差一截。同理不能用 `getHex()` 繞一圈。
  fog.color.copy(FOG_COLOR)
  return fog
}

/** 地表薄霧：近處也混入場景霧色，再交給原有距離霧；不增加透明面或繪製次數。 */
export function installGroundHaze(material: MeshStandardMaterial | PointsMaterial, amount: { value: number }): void {
  const compile = material.onBeforeCompile
  const cacheKey = material.customProgramCacheKey()
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer)
    shader.uniforms['uGroundHaze'] = amount
    shader.fragmentShader = 'uniform float uGroundHaze;\n' + shader.fragmentShader
      .replace('#include <fog_fragment>', `
#ifdef USE_FOG
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, uGroundHaze);
#endif
#include <fog_fragment>`)
  }
  material.customProgramCacheKey = () => cacheKey + ':ground-haze'
  material.needsUpdate = true
}
