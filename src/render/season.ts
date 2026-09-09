/**
 * # 季節
 *
 * 田區的地色與樹冠色由季節決定。**農地與群島恆為夏季**；洛伊納
 * （`world/leuna.ts`）是 1944 年 11 月的晚秋。色值都是起始值，拿眼睛校。
 *
 * 【為什麼是一張查表而不是散在各檔的常數】`fields.ts` 把色值烘進 GLSL
 * 字串、`floraShapes.ts` 把色值寫進頂點色 —— 兩邊都在模組載入時就做完了。
 * 換季節要在建構期給參數，而參數的來源只能有一份。
 */
export type Season = 'summer' | 'lateAutumn'
export const SEASONS: readonly Season[] = ['summer', 'lateAutumn']

/**
 * 作物色盤的階數。**兩個季節都必須是這個數** —— `fields.ts` 的區塊基調
 * 是 `hash % 階數`，階數不同的話同一個種子在兩個季節會落到不同的基調，
 * 田的圖案跟著換季節而變，那不是換色。
 */
export const PALETTE_STEPS = 8

export interface FieldColors {
  /** 作物色，一條漸層 —— `fields.ts` 在「區塊基調 ± 1」裡挑，索引相鄰就必須顏色相近 */
  readonly palette: readonly number[]
  /** 犁過的田。不在漸層上 —— 它是另一種地 */
  readonly ploughed: number
  /** 樹籬。比任何一塊田都暗 */
  readonly hedge: number
  /** 凹路 */
  readonly track: number
  /** 樹林。不在漸層上 */
  readonly wood: number
  /** 犁過的田的比例。與色調無關，散落在各處 */
  readonly ploughChance: number
}

export interface FloraColors {
  readonly broadLeaf: number
  readonly conifer: number
  readonly bushLeaf: number
}

export const FIELD_COLORS: Readonly<Record<Season, FieldColors>> = {
  // 夏季：深綠 → 淺綠 → 麥金。飽和度是取樣稿的 0.6
  summer: {
    palette: [0x414d37, 0x4d5a40, 0x59664a, 0x677253, 0x767e5c, 0x858863, 0x928f6a, 0xa09872],
    ploughed: 0x615242,
    hedge: 0x293123,
    track: 0x938b77,
    wood: 0x2f3a28,
    ploughChance: 0.12,
  },
  /**
   * 晚秋：收割後的麥茬赭 → 冬麥苗的淡綠；大半的田犁過了，露出深褐的土。
   *
   * 【飽和度砍到原來的 55%】原本是 15–27%，田與薩勒河的水在明度與彩度上
   * 都太接近 —— 河讀不出來。十一月的德國中部本來就是灰的，這一版更接近
   * 當時的偵察照片，而且讓水與混凝土有地方站。
   */
  lateAutumn: {
    palette: [0x615848, 0x6b6154, 0x756a5c, 0x7f7566, 0x857d6c, 0x84836f, 0x808773, 0x7a8b75],
    ploughed: 0x433a33,
    hedge: 0x36312b,
    track: 0x756e61,
    wood: 0x444434,
    ploughChance: 0.45,
  },
}

export const FLORA_COLORS: Readonly<Record<Season, FloraColors>> = {
  summer: { broadLeaf: 0x3f5233, conifer: 0x2f4530, bushLeaf: 0x33452c },
  // 闊葉樹落葉：樹冠是枯枝的褐灰（形狀不動，只換色）；針葉略暗；灌木褐
  lateAutumn: { broadLeaf: 0x5a4a3c, conifer: 0x2b3d2c, bushLeaf: 0x4d3f30 },
}
