import { FogExp2 } from 'three'

/**
 * 霧色。**刻意不等於天空球的 `SKY_HORIZON`。**
 *
 * 遠海化進霧色之後若與天空完全同色，地平線就消失了 —— 而畫面上不會有
 * 任何錯誤，也不會有任何測試紅，只是海與天連成一片。取同色相、暗一階，
 * 那一階明度就是地平線。
 *
 * 專案負責人的要求原文：「遠方可以考慮 FOG，但是要看得出地平線」。
 * 這條關係由 `test/unit/fog.test.ts` 釘住。
 */
export const FOG_COLOR = 0x7ea8c4

/**
 * 指數霧的密度，m⁻¹。
 *
 * 【為什麼用指數霧不用線性霧】線性霧要選一個 near，而 near 之內完全沒有
 * 霧、之外立刻開始 —— 在那個半徑上會出現一道看得見的環。指數霧的因子是
 * `1 − exp(−(d·ρ)²)`，近處由二次項壓到幾乎是零，沒有起點可言。而「近處
 * 不影響、遠處吃滿」正是這裡要的形狀。
 *
 * 【1.4e-5 是怎麼來的】它要同時滿足三件相互拉扯的事：
 *
 *   5 km（纏鬥距離）    0.5 %   —— 敵機的顏色不能被霧改掉
 *   30 km（全戰場）      16 %   —— 開始化開，給得出深度感
 *   250 km（遠海邊緣）  ~100 %  —— 邊緣要完全化掉，否則就是另一條硬邊
 *
 * 三個數字都被 `test/unit/fog.test.ts` 釘住。要改密度就得同時面對這三個
 * 後果，那正是那三條測試存在的理由。
 */
export const FOG_DENSITY = 1.4e-5

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
  return new FogExp2(FOG_COLOR, FOG_DENSITY)
}
