import { Color } from 'three'

/**
 * # 季節
 *
 * 田區的地色與樹冠色由季節決定。**農地與群島恆為夏季**；洛伊納
 * （`world/leuna.ts`）是 1944 年 11 月的晚秋；勒熱夫（`world/rzhev.ts`）是 1942 年
 * 11 月的雪原。色值都是起始值，拿眼睛校。
 *
 * 【為什麼是一張查表而不是散在各檔的常數】`fields.ts` 把色值烘進 GLSL
 * 字串、`floraShapes.ts` 把色值寫進頂點色 —— 兩邊都在模組載入時就做完了。
 * 換季節要在建構期給參數，而參數的來源只能有一份。
 */
export type Season = 'summer' | 'lateAutumn' | 'winterSteppe'
export const SEASONS: readonly Season[] = ['summer', 'lateAutumn', 'winterSteppe']

/**
 * 林子從空中看的顏色 = 樹冠色 × 這個倍率（線性值；畫面上約 0.85 倍）：樹冠的
 * 側面在陰影裡，整株看下去比樹冠色暗。同一片林子有模型與只剩烘圖時，畫面的
 * 平均色在這個倍率對得上。植被圈外樹不畫，烘進地面的林子、樹冠色塊、遠處的樹籬
 * 都用它
 */
export const CANOPY_SHADE = 0.9

/** 樹冠色乘 `CANOPY_SHADE`（線性值） */
export function canopyColor(hex: number): Color {
  return new Color(hex).multiplyScalar(CANOPY_SHADE)
}

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
  /**
   * 空地（牧草地、荒地、休耕）的兩個色，大片地低頻地在兩者之間漸變。只有
   * 「田圍著村」的地圖用（`fields.ts` 的 `open`）
   */
  readonly open: number
  readonly openAlt: number
  /**
   * 空地長樹林的雜訊門檻（`fields.ts` 的 `openWoodCover`）：雜訊低於下限沒有樹、
   * 高於上限整片是林。**地色與植被讀同一份** —— 兩邊各訂各的話，地上畫的林子與
   * 長出來的樹就對不上
   */
  readonly woodGate: readonly [number, number]
  /**
   * 一條田界長樹籬的機率（`fields.ts` 的 `HEDGE_CHANCE` 是中歐的值）。地色、CPU 的
   * `fieldAt`、植被的樹籬散佈器讀同一份 —— 地上畫了樹籬而沒有樹，或有樹而沒畫，都是
   * 兩邊各讀各的
   */
  readonly hedgeChance: number
  /**
   * 田的格局。`european` 是中歐的小田塊、田界長樹籬；`steppe` 是俄國南部集體農場的大
   * 田：大矩形、不對切、田界是淺色的田埂、沒有樹籬，一部分的田是不耕的牧草地
   * （`fields.ts` 的 `STEPPE_LAYOUT`）。**`steppe` 時 `hedge` 是田埂的顏色**，`wood`
   * 與 `hedgeChance` 不用
   */
  readonly layout: 'european' | 'steppe'
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
    // 牧草地的橄欖綠與荒地、休耕地的枯黃
    open: 0x626b43,
    openAlt: 0x78754f,
    woodGate: [0.5, 0.62],
    hedgeChance: 0.92,
    layout: 'european',
  },
  /**
   * 晚秋：收割後的麥茬赭 → 冬麥苗的淡綠；大半的田犁過了，露出深褐的土。
   *
   * 【彩度壓在 8–15%】薩勒河的水與廠區的混凝土要有地方站。田再飽和一點，
   * 河在畫面上就讀不出來。
   *
   * 【犁田貼著漸層的最暗端】它占 45% 的面積，三個維度都要靠著作物漸層：
   *
   * ```
   *   作物漸層   明度 33–50%   飽和 8–15%   色相 34–106°
   *   犁田       明度 31%      飽和 11%     色相 32°
   * ```
   *
   * 明度低兩個點就分得出來。拉得更開的話整片圖是黑白棋盤，一眼只看得到
   * 那個對比。
   */
  lateAutumn: {
    palette: [0x615848, 0x6b6154, 0x756a5c, 0x7f7566, 0x857d6c, 0x84836f, 0x808773, 0x7a8b75],
    ploughed: 0x585046,
    hedge: 0x36312b,
    track: 0x756e61,
    wood: 0x444434,
    ploughChance: 0.45,
    // 十一月的枯草與濕地的深褐
    open: 0x6e6a4a,
    openAlt: 0x5f5a47,
    woodGate: [0.5, 0.62],
    hedgeChance: 0.92,
    layout: 'european',
  },
  /**
   * 十一月下旬的勒熱夫：雪蓋住了整片田，只有田埂與被踩過的路露出灰褐。`steppe` 格局沒有空地長
   * 樹林那一套，所以 `woodGate` 在這裡不起作用；樹只長在村裡與田界的防風林帶（`flora.ts` 的
   * `steppeBeltFloraFor`）。德 M4 勒熱夫用
   *
   * 【色盤是雪的明暗，不是作物】八階從帶一點藍的白漸層到淡灰藍（薄雪下的殘茬）；相鄰兩階差一截，
   * 田塊的圖案靠這個明暗讀出來，從高空看每一塊田分得開，但不能深到變成藍色的田。**亮度（線性值）
   * > 0.35、飽和度 < 0.3、越往後越暗、頭尾差 > 0.4** 由 `season.test.ts` 守著。
   */
  winterSteppe: {
    palette: [0xf0f4f7, 0xe4e9ee, 0xd8dfe6, 0xcdd5dd, 0xc1cbd5, 0xb6c1cd, 0xabb7c4, 0xa0acba],
    // 犁過的田：雪被風吹走，露出的土蓋著一層薄雪，灰白微暖
    ploughed: 0xbab9b6,
    // 田埂：露出雪面的枯草，深灰褐
    hedge: 0x827a6c,
    // 凹路：被踩實的雪與泥，灰
    track: 0x8a8d90,
    wood: 0x8a9893,
    ploughChance: 0.15,
    // 牧草地與荒地的雪，比田更平更白
    open: 0xe2e7eb,
    openAlt: 0xd6dce2,
    woodGate: [0.7, 0.8],
    hedgeChance: 0,
    layout: 'steppe',
  },
}

export const FLORA_COLORS: Readonly<Record<Season, FloraColors>> = {
  summer: { broadLeaf: 0x3f5233, conifer: 0x2f4530, bushLeaf: 0x33452c },
  // 闊葉樹落葉：樹冠是枯枝的褐灰（形狀不動，只換色）；針葉略暗；灌木褐
  lateAutumn: { broadLeaf: 0x5a4a3c, conifer: 0x2b3d2c, bushLeaf: 0x4d3f30 },
  // 覆雪：闊葉與灌木幾乎是白的，針葉略帶灰綠，才分得出林帶與村裡的樹
  winterSteppe: { broadLeaf: 0xe6ecef, conifer: 0xc4d3cf, bushLeaf: 0xd8dfe3 },
}
