/** 縮放 1.0 的喬木高度，m。場景縮放 0.5～1.0 時為 15～30 m。 */
export const TREE_HEIGHT = 30

/** 闊葉樹冠半徑，m。幾何、地面覆蓋率與機場植被淨空共用。 */
export const BROAD_CROWN_R = 10

/** 針葉樹冠半徑，m。幾何、地面覆蓋率與機場植被淨空共用。 */
export const CONE_CROWN_R = 7

/** 灌木半徑，m。大於樹籬間距，讓相鄰兩叢交疊成連續的堤。 */
export const BUSH_R = 6

/**
 * 逐株的縮放。**上界是 1.0** —— 幾何本身就是最大的那一棵（喬木 30 m、
 * 灌木 8 m），抖動只往下走。
 */
export const TREE_SCALE = [0.5, 1.0] as const

export const BUSH_SCALE = [0.5, 1.0] as const
