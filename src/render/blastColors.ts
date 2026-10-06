import { Color, SRGBColorSpace } from 'three'

/** 深咖啡色。沙土色在綠地上讀起來像煙不像土 */
const DUST_YOUNG = { r: 0.30, g: 0.19, b: 0.11 }
const DUST_OLD = { r: 0.16, g: 0.10, b: 0.06 }

/**
 * 年齡比例 → 塵土的顏色。
 *
 * 【為什麼不沿用黑煙】土是暖色的，而黑煙整條曲線都是中性灰 —— 兩者疊在
 * 同一次爆炸上時，差別正是「地面被掀起來」與「東西在燒」。
 *
 * 【色標是 sRGB，所以要指定色彩空間】`setRGB` 預設寫的是線性值，火球與黑煙
 * 的色標也一樣要指定。
 */
export function dustColor(t: number, out: Color): void {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  out.setRGB(
    DUST_YOUNG.r + (DUST_OLD.r - DUST_YOUNG.r) * k,
    DUST_YOUNG.g + (DUST_OLD.g - DUST_YOUNG.g) * k,
    DUST_YOUNG.b + (DUST_OLD.b - DUST_YOUNG.b) * k,
    SRGBColorSpace,
  )
}

/**
 * 煙出生時的顏色 —— **幾乎純黑**，接的是燒完的火球那一刻的顏色。
 */
const SMOKE_BORN = { r: 0.03, g: 0.03, b: 0.028 }
/**
 * 煙轉完之後的顏色 —— 兩層明暗都只往暗走，所以這是**最亮的那一顆**。
 *
 * ```
 *   基色        0.19          頂端受光的那幾顆
 *   隨機層 ×    0.5 – 1.0
 *   高度層 ×    0.5 – 1.0
 *   最暗        ≈ 0.048
 *   平均        ≈ 0.11        `SMOKE_COLOR` 是 0.10
 * ```
 *
 * 【不用 `SMOKE_COLOR`】那一支是飛機的拖煙，一條沒有重疊的細線，愈黑愈讀
 * 得出來。0.10 之下明暗的絕對差只有幾個色階，團內看不出前後。
 */
const SMOKE_AGED = { r: 0.19, g: 0.185, b: 0.175 }
/** 黑轉深灰佔壽命的比例 */
const SMOKE_WARM = 0.35

/**
 * 年齡比例 → 爆炸煙的顏色。**黑 → 深灰。**
 *
 * 【出生是黑的】火球燒到最後幾乎純黑，煙在同一個位置接手 —— 出生就是深灰
 * 的話，交棒那一刻會亮一下。
 */
export function blastSmokeColor(t: number, out: Color): void {
  const k = t <= 0 ? 0 : t >= SMOKE_WARM ? 1 : t / SMOKE_WARM
  out.setRGB(
    SMOKE_BORN.r + (SMOKE_AGED.r - SMOKE_BORN.r) * k,
    SMOKE_BORN.g + (SMOKE_AGED.g - SMOKE_BORN.g) * k,
    SMOKE_BORN.b + (SMOKE_AGED.b - SMOKE_BORN.b) * k,
    SRGBColorSpace,
  )
}

const GLOW_HOT = { r: 1.0, g: 0.46, b: 0.14 }
const GLOW_MID = { r: 0.72, g: 0.16, b: 0.03 }
const GLOW_OUT = { r: 0.0, g: 0.0, b: 0.0 }

/**
 * 年齡比例 → 光暈的顏色。橘 → 暗紅 → 黑。
 *
 * 【收到黑】加法混合下黑等於沒加，所以顏色與 alpha 兩條線同時把它關掉。
 */
export function fireGlowColor(t: number, out: Color): void {
  let a = GLOW_HOT
  let b = GLOW_MID
  let k = 0
  if (t <= 0.45) k = t / 0.45
  else {
    a = GLOW_MID
    b = GLOW_OUT
    k = Math.min(1, (t - 0.45) / 0.55)
  }
  out.setRGB(
    a.r + (b.r - a.r) * k,
    a.g + (b.g - a.g) * k,
    a.b + (b.b - a.b) * k,
    SRGBColorSpace,
  )
}

/** 水霧的顏色。`spray.ts` 的 `WATER_COLOR` 同一個值 */
const MIST_TINT = { r: 0.95, g: 0.97, b: 1.0 }

/** 水霧整個壽命都維持同一個白帶藍的色調 */
export function mistColor(_t: number, out: Color): void {
  out.setRGB(MIST_TINT.r, MIST_TINT.g, MIST_TINT.b, SRGBColorSpace)
}
