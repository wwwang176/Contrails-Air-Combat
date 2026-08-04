import { Color, NormalBlending } from 'three'
import { createParticles, type Particles } from './particles'
import { IMPACT_STRIDE, type ImpactEvents } from '../world/events'

/** 壽命，s。60 fps 下 150 幀 —— 拖得出一條讀得到的煙帶。 */
export const SMOKE_LIFE = 2.5

/** 出生直徑，m。 */
export const SMOKE_SIZE_FROM = 2

/** 死亡直徑，m。膨脹是煙散開的樣子。 */
export const SMOKE_SIZE_TO = 9

/** 出生時的不透明度，線性淡到 0。 */
export const SMOKE_ALPHA = 0.55

/** 終端上浮速度，m/s。 */
export const SMOKE_RISE = 3

/** 指數阻尼，s⁻¹。 */
export const SMOKE_DRAG = 1.5

/**
 * 餵給積分器的上浮加速度，m/s²。
 *
 * 【為什麼是加速度而不是速度】`particles.ts` 的積分器只有 `gravity` 這一個
 * 欄位，而終端速度是 `gravity / drag`。要 3 m/s 的上浮就得餵
 * 3 × 1.5 = 4.5 —— 與殘骸的阻尼由終端速度 80 m/s 反推是同一個做法。
 */
export const SMOKE_GRAVITY = SMOKE_RISE * SMOKE_DRAG

/** 殘骸每隔多久冒一團，s。150 m/s 下相鄰兩團相距 12 m —— 一條連續的煙帶。 */
export const WRECK_SMOKE_INTERVAL = 0.08

/** 大零件每隔多久冒一團，s。 */
export const DEBRIS_SMOKE_INTERVAL = 0.3

/**
 * 三十六片零件裡有幾片冒煙。
 *
 * 【由 4 改成 8】零件縮小五倍之後 4 條細煙在畫面上幾乎看不到 —— 專案負責人
 * 指出「部分零件也要有煙霧」。8 片仍然是少數（22%），讀得出「有些碎片在
 * 冒煙」而不是「整團都在冒煙」。
 *
 * 【為什麼不是全部 36 片】發射器會從 20×8 變成 20×36，穩態從 1,950 團爆到
 * 5,700 —— 而且畫面上會糊成一片，讀不出「零件在散開」（M8 spec §6.1）。
 */
export const DEBRIS_SMOKE_COUNT = 8

/**
 * 零件冒的煙相對殘骸的尺寸倍率。
 *
 * 【為什麼需要它】一片零件最大 0.4 m，而煙團是 2 → 9 m —— 不縮的話一顆
 * 比碎片大二十倍的煙球黏在碎片上，讀起來不是「碎片在冒煙」而是「煙球在
 * 飛」。0.35 倍讓煙團落在 0.7 → 3.2 m，比碎片大但同一個量級。
 */
export const DEBRIS_SMOKE_SIZE = 0.35

/**
 * 池子大小。
 *
 * 【3072 怎麼來】20 具殘骸各 `2.5 / 0.08 = 31` 團、160 片冒煙的零件各
 * `2.5 / 0.3 = 8` 團 —— 穩態約 1,950 團。3072 有 1.6 倍餘裕。
 */
export const SMOKE_CAPACITY = 3072

/** 煙的顏色，**sRGB**。 */
export const SMOKE_COLOR = 0x1a1a1a

/**
 * 年齡比例 → 顏色。**常數深灰。**
 *
 * 【為什麼不隨年齡變色】煙的消失靠 alpha，不靠顏色。往黑淡在亮天空上方向
 * 是反的（愈淡愈明顯），往白淡則會變成蒸汽（M8 spec §4.3）。
 *
 * 【為什麼是 `setHex` 而不是 `setRGB`】`setRGB` 寫的是**線性**值，而
 * `0x1a1a1a` 是 sRGB 的寫法。初版寫成 `setRGB(0.102, ...)`，three 輸出時
 * 把那個線性值轉成 sRGB 變成約 `0x5c` 的中灰 —— **比深藍色的海面還亮**，
 * 方向完全相反。在試驗場上一眼就看得出來：那不是黑煙，是白霧。
 * `setHex` 預設就是 sRGB 輸入，會做該做的轉換。
 */
export function smokeColor(_t: number, out: Color): void {
  out.setHex(SMOKE_COLOR)
}

/**
 * 這一幀該生幾團。`timer` 是上一幀留下的餘數。
 *
 * 【為什麼低幀率要一次補足】0.5 s 的長幀若只生一團，150 m/s 的殘骸會在煙帶
 * 上留下一段 75 m 的空隙。補足的代價是那幾團生在同一個位置（沒有做位置
 * 內插）—— 一個只在掉幀時出現、而且比空隙輕微得多的瑕疵。
 */
export function smokePuffs(timer: number, dt: number, interval: number): number {
  if (interval <= 0) return 0
  return Math.floor((timer + dt) / interval)
}

/** 這一幀之後計時器該留下多少。與 `smokePuffs` 成對使用。 */
export function smokeTimer(timer: number, dt: number, interval: number): number {
  if (interval <= 0) return 0
  return (timer + dt) % interval
}

export function createSmoke(capacity: number = SMOKE_CAPACITY): Particles {
  return createParticles({
    capacity,
    blending: NormalBlending,
    life: SMOKE_LIFE,
    sizeFrom: SMOKE_SIZE_FROM,
    sizeTo: SMOKE_SIZE_TO,
    gravity: SMOKE_GRAVITY,
    drag: SMOKE_DRAG,
    alphaFrom: SMOKE_ALPHA,
    color: smokeColor,
  })
}

/**
 * 依位置事件生煙。**初速恆為零** —— 一團煙生出來就與發射體脫鉤。
 *
 * 【為什麼重用 `ImpactEvents`】煙只需要「一個位置」，而那個型別就是
 * `x,y,z` 加三個這裡用不到的法線欄位。M7 spec §2.2 已經為「命中與入海共用
 * 一個型別」寫過同樣的理由 —— 為了省三個 float 再發明一個結構才是壞的。
 */
export function emitSmoke(
  pool: Particles, events: ImpactEvents, sizeScale = 1,
): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * IMPACT_STRIDE
    pool.emit(d[o]!, d[o + 1]!, d[o + 2]!, 0, 0, 0, sizeScale)
  }
}
