import { Color, Vector3 } from 'three'
import { SKY_GRADIENT_POWER, SKY_HORIZON, SKY_ZENITH } from './sky'
import { SEA_COLOR, SEA_HORIZON_COLOR } from './ocean'
import { FOG_DENSITY } from './fog'
import type { TimeOfDay } from '../world/timeOfDay'
// 【只匯入型別】這兩支都要用這裡的值，值匯入會成環
import type { SceneContext } from './scene'

/**
 * # 時段
 *
 * 光照的設定值。任務由卡片指定（`MissionBattle.timeOfDay`，省略 = 正午）、
 * 遭遇戰由玩家在編組頁選（`SkirmishSetup.timeOfDay`）。
 *
 * 【不是日夜循環】場上的光照開局後固定不變 —— 遠處植被的亮度是烘進頂點色
 * 的（見 `lighting.ts`），會隨時間變的光照要把那一份也一起重烘。
 *
 * 【聯集本身住在 `world/`】見 `world/timeOfDay.ts`。這裡再匯出，既有的
 * import 站點不用動 —— 與 `TerrainKind` 同一個安排。
 */
export type { TimeOfDay }

/**
 * 【`novemberNoon` 排最後】它進工具頁的時段按鈕，**不進遭遇戰選單** ——
 * `ui/menu.ts` 的那份清單是手寫的四筆，任務卡才會選它。
 */
export const TIME_OF_DAY_IDS: readonly TimeOfDay[] = ['dawn', 'noon', 'dusk', 'night', 'novemberNoon']

/**
 * 一個時段的完整光照設定。
 *
 * **顏色一律是 sRGB 的十六進位字面值**，與 `sky.ts` / `ocean.ts` 的常數
 * 同一個慣例 —— `new Color(hex)` 會轉進線性工作空間，而天空著色器末端的
 * `colorspace_fragment` 再轉回去。
 */
export interface DayPalette {
  readonly id: TimeOfDay
  readonly name: string
  /** 天空漸層的兩端與指數，語意見 `sky.ts` 的 `SKY_HORIZON`。 */
  readonly skyHorizon: number
  readonly skyZenith: number
  readonly skyPower: number
  /** 星點強度，0 = 沒有星星。只有上半球看得到。 */
  readonly stars: number
  /** 由地面**指向光源**的方向，不必先正規化。夜間指的是月亮。 */
  readonly sunDir: readonly [number, number, number]
  readonly sunColor: number
  readonly sunIntensity: number
  readonly hemiSky: number
  readonly hemiGround: number
  readonly hemiIntensity: number
  readonly ambientColor: number
  readonly ambientIntensity: number
  /** 海的本色，與 `ocean.ts` 的 `SEA_COLOR` 同一個位置。 */
  readonly seaColor: number
  /** 海面接近地平線時融向的顏色。 */
  readonly seaHorizon: number
  /**
   * 海面碎光的強度倍率，`ocean.ts` 的 `SPARKLE_STRENGTH` 乘上它。正午 = 1。
   *
   * 【為什麼是倍率而不是絕對值】碎光的形狀由 `ocean.ts` 那十幾個常數決定，
   * 那是另一份調校。這裡只管「這個時段的海該閃多亮」。
   *
   * 【夜間非壓不可】碎光是加色的，總量與光照強度無關 —— 暗海上同一批亮面
   * 會變成整片白色多邊形，而不是水面的閃爍。
   */
  readonly sparkle: number
  /**
   * 遠處植被（點池）的亮度倍率。正午 = 1。
   *
   * 【為什麼只有點池要這一格】近、中兩級的樹與房子走 `MeshStandardMaterial`，
   * 換了燈就自己變暗。**點走 `PointsMaterial`，是 basic 的** —— 見
   * `vegetation.ts` 的 `POINT_LIGHT`。不補的話夜間會是一片發光的樹海。
   *
   * 【為什麼是可調的數字而不是從三盞燈推導】推導要假設一個照度模型，而
   * `POINT_LIGHT` 本身就是量出來的、不是算出來的。同一條規矩：拿眼睛校。
   */
  readonly foliage: number
  readonly fogDensity: number
}

/**
 * 四個時段。
 *
 * 【`noon` 是恆等】它的每一個欄位都直接引用 `sky.ts` / `ocean.ts` 的模組層
 * 常數，所以「沒有指定時段」的關卡與所有既有的基準線完全不受影響。
 * **要改正午請改那些常數，不要在這裡寫第二份數字。**
 *
 * 【三個新時段的太陽都很低】清晨與黃昏的仰角約 7°，逆光時海面的鏡面反射
 * 因此撐起大部分亮度 —— 那正是這兩個時段看起來與正午不同的主因，不是天空色。
 *
 * 【夜間是有月光的夜，不是全黑】史實的夜襲確實接近全黑，但那樣玩家看不到
 * 艦隊也看不到海平面。月亮放在高仰角、冷色、強度 0.35。
 */
export const DAY_PALETTES: Readonly<Record<TimeOfDay, DayPalette>> = {
  dawn: {
    id: 'dawn',
    name: '清晨',
    skyHorizon: 0xffd9b4,
    skyZenith: 0x2b5586,
    skyPower: 0.7,
    stars: 0,
    sunDir: [-0.62, 0.13, 0.77],
    sunColor: 0xffc79a,
    sunIntensity: 1.5,
    hemiSky: 0xa8c2dc,
    hemiGround: 0x2b3138,
    hemiIntensity: 0.6,
    ambientColor: 0xdfe8f4,
    ambientIntensity: 0.12,
    seaColor: 0x16293c,
    seaHorizon: 0x51637a,
    sparkle: 0.75,
    foliage: 0.6,
    fogDensity: 1.6e-5,
  },
  noon: {
    id: 'noon',
    name: '正午',
    skyHorizon: SKY_HORIZON,
    skyZenith: SKY_ZENITH,
    skyPower: SKY_GRADIENT_POWER,
    stars: 0,
    sunDir: [-0.4, 0.8, 0.45],
    sunColor: 0xfff2e0,
    sunIntensity: 2.2,
    hemiSky: 0xbfd8ee,
    hemiGround: 0x2a3a48,
    hemiIntensity: 0.9,
    ambientColor: 0xffffff,
    ambientIntensity: 0.15,
    seaColor: SEA_COLOR,
    seaHorizon: SEA_HORIZON_COLOR,
    sparkle: 1,
    foliage: 1,
    fogDensity: FOG_DENSITY,
  },
  dusk: {
    id: 'dusk',
    name: '黃昏',
    skyHorizon: 0xff9a52,
    skyZenith: 0x1e3c70,
    skyPower: 0.62,
    stars: 0.15,
    sunDir: [0.72, 0.1, 0.68],
    sunColor: 0xff9645,
    sunIntensity: 1.7,
    hemiSky: 0x8c9ab8,
    hemiGround: 0x2c2622,
    hemiIntensity: 0.5,
    ambientColor: 0xe8d2c0,
    ambientIntensity: 0.1,
    seaColor: 0x13243a,
    seaHorizon: 0x6e5468,
    sparkle: 0.85,
    foliage: 0.5,
    fogDensity: 1.8e-5,
  },
  night: {
    id: 'night',
    name: '夜間',
    skyHorizon: 0x1d3149,
    skyZenith: 0x050a15,
    skyPower: 0.9,
    stars: 1,
    sunDir: [0.35, 0.62, -0.5],
    sunColor: 0xc2d2ee,
    sunIntensity: 0.38,
    hemiSky: 0x2b3c58,
    hemiGround: 0x070a10,
    hemiIntensity: 0.26,
    ambientColor: 0xa8bcdc,
    ambientIntensity: 0.05,
    seaColor: 0x070d17,
    seaHorizon: 0x1b2736,
    sparkle: 0.18,
    foliage: 0.16,
    fogDensity: 2.2e-5,
  },
  /**
   * 深秋的正午：51°N 的十一月，太陽仰角只有二十幾度、天色灰白、遠處泛霧。
   * 洛伊納（`world/leuna.ts`）的色盤是為它調的。海色照抄正午 —— 內陸用不到。
   * **起始值，拿眼睛校。**
   *
   * 【`name` 與其他四個時段一樣是四個字以內】展示區的分頁窄，更長的會直排。
   */
  novemberNoon: {
    id: 'novemberNoon',
    name: '秋天正午',
    skyHorizon: 0xd9d9d6,
    skyZenith: 0x7f93a8,
    skyPower: 0.9,
    stars: 0,
    // 仰角 ≈ 25°
    sunDir: [-0.55, 0.42, 0.72],
    sunColor: 0xfff0dc,
    sunIntensity: 1.5,
    hemiSky: 0xb9c2cc,
    hemiGround: 0x3a3630,
    hemiIntensity: 0.8,
    ambientColor: 0xdfe3e8,
    ambientIntensity: 0.22,
    seaColor: SEA_COLOR,
    seaHorizon: SEA_HORIZON_COLOR,
    sparkle: 0.6,
    foliage: 0.85,
    fogDensity: FOG_DENSITY * 1.6,
  },
}

export function paletteOf(tod: TimeOfDay): DayPalette {
  return DAY_PALETTES[tod]
}

/**
 * 天空在某個視線仰角上的顏色，**CPU 的那一份**，任意 palette 版。
 *
 * `sky.ts` 的 `skyColorAt` 是這一支綁在正午上的特例；霧色由它推導。
 */
export function paletteSkyColorAt(dirY: number, p: DayPalette, out: Color): Color {
  const t = Math.pow(Math.min(Math.max(dirY * 0.5 + 0.5, 0), 1), p.skyPower)
  return out.lerpColors(new Color(p.skyHorizon), new Color(p.skyZenith), t)
}

/** 正規化過的光源方向。呼叫端不必自己算。 */
export function paletteSunDir(p: DayPalette, out: Vector3): Vector3 {
  return out.set(p.sunDir[0], p.sunDir[1], p.sunDir[2]).normalize()
}

/**
 * 把時段套到整個畫面上：天空、霧、三盞燈、海。
 *
 * 【為什麼要有這一支】天空那一半在 `SceneContext`、海那一半在 `Ocean`，兩者
 * 沒有共同的擁有者。呼叫端各叫各的話，漏掉海的症狀是「黃昏的天配中午的海」
 * —— 看得出來但不會有任何東西報錯。
 */
export function applyTimeOfDay(
  ctx: SceneContext,
  world: PaletteTarget | null,
  tod: TimeOfDay,
): void {
  const p = DAY_PALETTES[tod]
  ctx.setPalette(p)
  world?.setPalette(p)
}

/** `Terrain` 與 `Ocean` 都符合這個形狀。 */
export interface PaletteTarget {
  setPalette(p: DayPalette): void
}
