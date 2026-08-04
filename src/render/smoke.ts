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
 * 十二片零件裡有幾片冒煙。
 *
 * 【為什麼不是全部】12 條煙會糊成一團，讀不出「零件在散開」；而發射器數量
 * 會從 20 次擊墜 × 4 變成 × 12，穩態團數逼近 2,600（M8 spec §6.1）。
 */
export const DEBRIS_SMOKE_COUNT = 4

/**
 * 池子大小。
 *
 * 【3072 怎麼來】20 具殘骸各 `2.5 / 0.08 = 31` 團、80 片大零件各
 * `2.5 / 0.3 = 8` 團 —— 穩態約 1,260 團。3072 是它的兩倍餘裕。
 */
export const SMOKE_CAPACITY = 3072

/**
 * 年齡比例 → 顏色。**常數深灰。**
 *
 * 【為什麼不隨年齡變色】煙的消失靠 alpha，不靠顏色。往黑淡在亮天空上方向
 * 是反的（愈淡愈明顯），往白淡則會變成蒸汽（M8 spec §4.3）。
 */
export function smokeColor(_t: number, out: Color): void {
  out.setRGB(0.102, 0.102, 0.102)
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
export function emitSmoke(pool: Particles, events: ImpactEvents): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * IMPACT_STRIDE
    pool.emit(d[o]!, d[o + 1]!, d[o + 2]!, 0, 0, 0)
  }
}
