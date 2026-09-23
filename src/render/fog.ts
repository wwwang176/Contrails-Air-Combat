import { Color, FogExp2 } from 'three'
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
 * 【0.7e-5 是怎麼來的】它要同時滿足三件相互拉扯的事：
 *
 *   5 km（纏鬥距離）    0.1 %   —— 敵機的顏色不能被霧改掉
 *   30 km（全戰場）     4.3 %   —— 只是一層薄薄的空氣感
 *   140 km（幾何地平線）  62 %   —— 海面也吃霧：遠海只化掉一半多，海天那一階
 *                                  還在；再濃的話地平線糊成一片
 *
 * **前兩個**數字被 `test/unit/fog.test.ts` 釘住。要改密度就得同時面對那兩個
 * 後果，那正是那兩條測試存在的理由。
 */
export const FOG_DENSITY = 0.7e-5

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
