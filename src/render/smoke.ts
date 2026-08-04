import { Color, NormalBlending, Vector3 } from 'three'
import { createParticles, type Particles } from './particles'
import { coneDirection } from './scatter'
import { IMPACT_STRIDE, type ImpactEvents } from '../world/events'
import { KILL_STRIDE, type KillEvents } from '../world/kills'

/** 壽命，s。60 fps 下 150 幀 —— 拖得出一條讀得到的煙帶。 */
export const SMOKE_LIFE = 2.5

/**
 * 壽命的隨機幅度。0.25 = 每一團各自活 0.75×~1.25× 的 `SMOKE_LIFE`
 * （1.875 ~ 3.125 s）。
 *
 * 【為什麼】專案負責人在試驗場上指出煙帶的尾端太齊。同一批煙用同一個
 * 壽命的話它們會**同時**淡到不見，讀起來是一條被切斷的線；壽命一抖，
 * 尾端就自己散開了。
 */
export const SMOKE_LIFE_JITTER = 0.25

/** 最長的一團活多久，s。池子容量與各種「煙還在不在」的推導用這個上界。 */
export const SMOKE_LIFE_MAX = SMOKE_LIFE * (1 + SMOKE_LIFE_JITTER)

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

/**
 * 殘骸每隔多久冒一團，s。
 *
 * 【人工驗收後由 0.08 縮到 0.04】專案負責人要求「煙霧連續性更高一點」。
 * 150 m/s 下相鄰兩團由相距 12 m 變成 6 m，而煙團一出生就有 2 m 直徑、
 * 很快長到 9 m —— 間距小於直徑，煙帶才是連的而不是一串珠子。
 */
export const WRECK_SMOKE_INTERVAL = 0.04

/**
 * 冒煙的零件每隔多久冒一團，s。
 *
 * 【0.3 → 0.15 → 0.075】每一次都是同一個理由，而零件這一邊特別嚴重：
 * 散射初速 40 m/s 疊在母機的 150 m/s 上，一個間隔內零件會走
 * `速度 × 間隔` 那麼遠。0.15 s 下那是二十幾公尺，遠大於煙團的出生直徑，
 * 煙帶因此有斷點 —— 專案負責人在試驗場上指出來的正是這件事。
 */
export const DEBRIS_SMOKE_INTERVAL = 0.075

/**
 * 一片零件冒多久的煙，s。**必須短於 `DEBRIS_MAX_LIFE`。**
 *
 * 【為什麼要有上限】零件在 5 s 時整片消失；煙若冒到最後一刻，最後那一團
 * 會在零件消失後還飄一整個 `SMOKE_LIFE_MAX` —— 一團沒有來源的煙掛在空中。
 * 提早 2 s 收尾，殘留就壓到 1 s 出頭，而且那時煙帶早已稀疏。
 *
 * 【也是密度翻倍的配套】間隔減半而總時長不變的話，每一片的煙團數會翻倍；
 * 3 s 上限把它壓回原本的量級（40 團 vs 原本 0.15 × 全程的量）。
 */
export const DEBRIS_SMOKE_SECONDS = 3

/**
 * 三十六片零件裡有幾片冒煙。
 *
 * 【4 → 8 → 4】第一次調高是因為零件縮小五倍後細煙看不見；那個問題後來由
 * `DEBRIS_SMOKE_SIZE` 放大到 0.9 解決了，於是片數又調回 4 ——「部分零件
 * 冒煙」讀得出來靠的是每一條夠粗，不是條數夠多。
 *
 * 【為什麼不是全部 36 片】畫面上會糊成一片，讀不出「零件在散開」
 * （M8 spec §6.1），而且發射量會從 20×4 變成 20×36。
 */
export const DEBRIS_SMOKE_COUNT = 4

/**
 * 零件冒的煙相對殘骸的尺寸倍率。
 *
 * 【為什麼需要它】煙必須比殘骸拖的那條細，兩種煙才分得出來 —— 一條是
 * 「主體在燒」，另一條是「碎片在燒」。
 *
 * 【由 0.35 放大到 0.9】專案負責人在試驗場上裁決「零件的煙在遠方非常不
 * 明顯，放大三倍但略小於機身的煙」。三倍是 1.05，會超過殘骸的煙 ——
 * 「略小於機身的煙」這個上限才是綁住的那一個，所以取 0.9（2.6 倍）。
 *
 * 【推翻了什麼】原本的 0.35 是為了讓煙團與 0.4 m 的碎片維持同一個量級，
 * 理由是「一顆比碎片大二十倍的煙球黏在碎片上，讀起來是煙球在飛」。那個
 * 顧慮只在鏡頭貼著碎片時成立；空戰的實際視距下，讀不讀得到才是先決條件。
 * 現在煙團是 1.8 → 8.1 m，確實遠大於碎片本身 —— 那是刻意的取捨。
 */
export const DEBRIS_SMOKE_SIZE = 0.9

/**
 * 池子大小。
 *
 * 【6144 怎麼來】20 具殘骸各 `2.5 / 0.04 = 63` 團、80 片冒煙的零件各
 * `2.5 / 0.075 = 33` 團 —— 合計約 3,900 團。6144 有 1.5 倍餘裕。
 * （零件那一邊間隔減半但片數也減半，總量沒變。）
 *
 * 【為什麼容量變大不會讓每幀變貴】`step` 對**已經歸零的死格子跳過寫入**
 * （見 `createParticles`），所以每幀的矩陣寫入量跟著存活數走而不是容量。
 */
export const SMOKE_CAPACITY = 6144

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
    lifeJitter: SMOKE_LIFE_JITTER,
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
/**
 * 擊墜當下的煙球噴幾團。
 *
 * 【為什麼火球之外還要這個】專案負責人要求火焰「轉成黑色後才可以消失」。
 * 火球是**加法混合**的，而加法畫不出黑（`dst + 0` 等於沒加）—— 在那個
 * 混合模式下「變黑」與「消失」是同一件事。真正看得見的黑必須是一團一般
 * 混合的深色東西留在原地：火球褪去、煙球在同一個位置浮現，那正是真實
 * 爆炸的樣子。
 */
export const KILL_SMOKE_COUNT = 10

/** 擊墜煙球的尺寸倍率。4.8 → 21.6 m —— 要蓋得住 8 m 的火球才接得起來。 */
export const KILL_SMOKE_SIZE = 2.4

/** 煙球向外擴的初速，m/s。慢到讀得出是「一團」而不是「炸開」。 */
export const KILL_SMOKE_SPEED = 8

/** 繼承多少母機速度。與火球相同，兩者才會一起往前走。 */
export const KILL_SMOKE_INHERIT = 0.5

/** 模組私有的暫存。熱路徑：不配置。 */
const DIR = new Vector3()

/**
 * 依擊墜事件生一團大煙球，接在火球後面。
 *
 * 與 `emitFireball` 生在同一個位置、繼承同樣比例的母機速度，所以兩者
 * 疊在一起走 —— 火在前 0.5 s 熄掉，煙球撐 2.5 s。
 */
export function emitKillSmoke(pool: Particles, events: KillEvents): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * KILL_STRIDE
    const x = d[o]!
    const y = d[o + 1]!
    const z = d[o + 2]!
    const ivx = d[o + 3]! * KILL_SMOKE_INHERIT
    const ivy = d[o + 4]! * KILL_SMOKE_INHERIT
    const ivz = d[o + 5]! * KILL_SMOKE_INHERIT
    for (let k = 0; k < KILL_SMOKE_COUNT; k++) {
      coneDirection(0, 1, 0, Math.PI, e * KILL_SMOKE_COUNT + k, DIR)
      pool.emit(
        x, y, z,
        ivx + DIR.x * KILL_SMOKE_SPEED,
        ivy + DIR.y * KILL_SMOKE_SPEED,
        ivz + DIR.z * KILL_SMOKE_SPEED,
        KILL_SMOKE_SIZE,
      )
    }
  }
}

export function emitSmoke(
  pool: Particles, events: ImpactEvents, sizeScale = 1,
): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * IMPACT_STRIDE
    pool.emit(d[o]!, d[o + 1]!, d[o + 2]!, 0, 0, 0, sizeScale)
  }
}
