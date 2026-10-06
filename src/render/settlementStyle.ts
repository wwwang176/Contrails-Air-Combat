import type { PlanSpec } from './townPlan'

/** 城鎮外觀與街網的配置規則；生成與佔位演算法見 settlements.ts。 */
/**
 * 鎮上沿街的建築，全部是公尺：面寬、進深、牆高、棟與棟的空隙。換成
 * `pushFlora` 的縮放與倍率見 `settlements.ts` 的 `sized`。
 *
 * - 老城：深的市民屋，連棟、兩三層半，屋頂陡
 * - 外圍：出租公寓與別墅，有空隙
 * - 花園城市：一層半的雙併住宅，每戶帶花園
 */
interface Frontage {
  readonly front: readonly [number, number]
  readonly depth: readonly [number, number]
  readonly wall: readonly [number, number]
  readonly gap: readonly [number, number]
  /** 正面離街面多遠（人行道、前院），m */
  readonly setback: number
}
const OLD_TOWN: Frontage = { front: [6, 12], depth: [12, 16], wall: [8, 12], gap: [0, 0.4], setback: 0.5 }
const OUTER_TOWN: Frontage = { front: [10, 18], depth: [10, 13], wall: [7, 11], gap: [1, 5], setback: 1.5 }
const GARDEN_CITY: Frontage = { front: [14, 19], depth: [8, 9.5], wall: [5, 6.5], gap: [7, 10], setback: 5 }

/**
 * 鎮的一區（老城或外圍）怎麼蓋：沿街建築、中心 → 外緣蓋房子的機率、中庭種樹
 * 的機率
 */
export interface ZoneStyle {
  readonly frontage: Frontage
  readonly fill: readonly [number, number]
  readonly courtyardTree: number
  /** 每一棟前屋後面隔個小院子蓋後屋（`REAR`） */
  readonly rear: boolean
  /** 房子後面的花園種果樹（花園城市） */
  readonly garden: boolean
  /** 街廓有別的用途：公園、墓園、小菜園、大院（`blockUse`） */
  readonly uses: boolean
}

/** 一種鎮：街網（`townPlan.ts`）、市集廣場在教堂留地外再留多寬（m）、兩區 */
interface TownStyle {
  readonly plan: PlanSpec
  readonly market: number
  readonly old: ZoneStyle
  readonly outer: ZoneStyle
}

/**
 * 一般的鎮：老城是窄巷、深的連棟市民屋加後屋，城牆的位置是環路；外圍是公寓與
 * 別墅，夾著公園、墓園、小菜園、大院。
 *
 * 【市集廣場多留 16 m】教堂墓園的樹種在留地外 5 m，樹冠再 6 m —— 少了的話樹長在
 * 廣場那一圈街上
 */
export const TOWN_STYLE: TownStyle = {
  plan: {
    oldTown: 0.4,
    old: { band: [55, 75], cross: [45, 70], half: 2.5 },
    outer: { band: [70, 95], cross: [90, 130], half: 4 },
    mainHalf: 5, ringHalf: 6, marketHalf: 4,
    warp: { old: 10, outer: 7, wave: 130 },
  },
  market: 16,
  old: { frontage: OLD_TOWN, fill: [0.97, 0.92], courtyardTree: 0, rear: true, garden: false, uses: false },
  outer: { frontage: OUTER_TOWN, fill: [0.9, 0.55], courtyardTree: 0.8, rear: false, garden: false, uses: true },
}

/** 洛伊納的花園城市：沒有老城，緩彎的街、雙併住宅、前院、後面是花園 */
export const GARDEN_CITY_STYLE: TownStyle = {
  plan: {
    oldTown: 0,
    old: { band: [60, 75], cross: [100, 140], half: 3.5 },
    outer: { band: [60, 75], cross: [100, 140], half: 3.5 },
    mainHalf: 4.5, ringHalf: 4.5, marketHalf: 4,
    warp: { old: 4, outer: 4, wave: 200 },
  },
  market: 16,
  old: { frontage: GARDEN_CITY, fill: [0.95, 0.85], courtyardTree: 0.2, rear: false, garden: true, uses: false },
  outer: { frontage: GARDEN_CITY, fill: [0.95, 0.85], courtyardTree: 0.2, rear: false, garden: true, uses: false },
}
