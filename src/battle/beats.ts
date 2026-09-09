import type { Vector3 } from 'three'
import type { Team } from '../world/World'
import type { AircraftSpec } from '../specs/types'
import type { FlightPlan } from './order'
import type { SideEntry } from './entry'

/**
 * # 節拍 —— 一場仗中途會發生的事
 *
 * 規劃裡的每一關都有「第二波」的節拍：
 *
 * ```
 *   德 M1  發現 B-17 編隊 → 「敵方護航機！」P-51 出現
 *   盟 M4  打退 A6M5 → 雷達發現低空目標 → 魚雷機正朝航母接近
 *   德 M4  友軍逐漸減少 → 任務更新：返航
 * ```
 *
 * 最後一條與前兩條不同：它不生增援，它**改任務目標**。同一套條件判斷接
 * 不同的效果 —— 所以條件與效果是兩件事。
 *
 * ## 為什麼是兩個具名節拍，不是「條件 × 效果」矩陣
 *
 * 可任意交叉的話會產生一堆目前沒有合法語意的組合（「時鐘到了把 convoy
 * 規則換成任意其他規則」）。實際需求只有兩類，所以就寫兩類。有第三個真實
 * 案例再談抽象。
 */

/** 條件的成立與否只看**當步的狀態**，是純函數。 */
export type BeatCondition =
  /** 開場後第 `at` 秒 */
  | { readonly kind: 'clock'; readonly at: number }
  /**
   * 指定隊伍（可再限定機種角色）的存活數降到 `atMost` 以下。
   *
   * 【`role` 是必要的，不是裝飾】盟 M4 是「打退**戰鬥機**之後魚雷機才來」，
   * 不是「紅隊剩幾架」。日 M2 同理。之後補這一格會很痛。
   *
   * 【`byLatest` 是必填的兜底】玩家太慢（打不完第一波）或太快（繞過去）時
   * 條件可能永遠不成立，那一關就卡死了。到了這個秒數無條件成立。
   */
  | {
    readonly kind: 'alive'
    readonly team: Team
    readonly role?: AircraftSpec['role']
    readonly atMost: number
    readonly byLatest: number
  }
  /**
   * 重生節拍已經預警的批數達到 `at`。
   *
   * 【沒有 `byLatest`】批數只增不減，而每一批的殲滅是防空砲保證的；到不了
   * `at` 的情形只有藍方全滅或要害艦沉沒，那兩條都已經判輸。
   */
  | { readonly kind: 'batch'; readonly at: number }

/** 一支增援進場。條件成立後先顯示 `warn`，過 `warnLead` 秒才真的來。 */
export interface ReinforceBeat {
  readonly kind: 'reinforce'
  readonly when: BeatCondition
  /** 畫面中心的預警文字 */
  readonly warn: string
  /** 預警到進場之間的秒數 */
  readonly warnLead: number
  readonly flight: FlightPlan
}

/** 任務目標改成「飛到某個點」。德 M4 的 返航。 */
export interface WithdrawBeat {
  readonly kind: 'withdraw'
  readonly when: BeatCondition
  /** 畫面中心的文字 */
  readonly message: string
  readonly point: Vector3
  readonly radius: number
  readonly seconds: number
}

/**
 * 開場的小隊被殲滅之後整隊重生。**席位回收，不佔預留。**
 *
 * 【為什麼是整隊而不是補半隊】`compactFlights` 會把復活的席位編回原小隊，
 * 補半隊的話新機會成為還活著那兩架的僚機，而那兩架已經在敵陣裡 —— 新機
 * 從進場點跨越幾公里去歸隊。
 *
 * 【`batches` 是預警的次數上限】用完之後小隊死光就死光，勝負判定才收得了尾。
 */
export interface RecycleBeat {
  readonly kind: 'recycle'
  readonly team: Team
  /** 只回收這個角色的小隊（看 roster 第一席）。省略 = 該隊全部 */
  readonly role?: AircraftSpec['role']
  readonly batches: number
  readonly warn: string
  readonly warnLead: number
  /** 重生的進場座標框，同 `ReinforceBeat.flight.entry` */
  readonly entry: SideEntry
}

export type Beat = ReinforceBeat | WithdrawBeat | RecycleBeat

/** 一個節拍走到哪裡。**執行狀態放這裡，不放 `MissionCard`** —— 見下。 */
export type BeatPhase = 'waiting' | 'warned' | 'done'

/**
 * 節拍的執行狀態。
 *
 * 【為什麼不放在 `Beat` 上】`MISSIONS` 是模組級常數、跨場重用。把 `fired`
 * 寫回卡片的話，同一張卡第二次開場時波次已經是 fired，而重置沒有任何波次
 * 邏輯 —— **同一組設定跑兩次會得到不同結果**。
 */
export interface BeatState {
  phase: BeatPhase
  /** 預警之後，到了這個世界時間就生效。`waiting` 時無意義 */
  dueAt: number
  /**
   * 這個節拍用第幾支預留的分隊。**返航節拍是 −1。**
   *
   * 【為什麼要記】增援的座位是依序附加到 `world.combatants` 尾端的，而每一支
   * 預留的分隊在建構期就綁死了自己的座位範圍與隊伍。所以**預留是一個佇列**：
   * 第 n 支只能在第 n−1 支之後進場。第二個波次的條件先成立時，`stepBeats`
   * 靠這一格認出「還沒輪到」而讓它等 —— 沒有它，那幾架會落進前一支預留的
   * 座位，也就是**別隊**的分隊裡。
   */
  readonly slot: number
}

export function createBeatStates(beats: readonly Beat[]): BeatState[] {
  let slot = 0
  return beats.map((b) => ({
    phase: 'waiting' as BeatPhase,
    dueAt: 0,
    slot: b.kind === 'reinforce' ? slot++ : -1,
  }))
}

/**
 * 判斷條件成立與否。**純函數，只讀當步的快照。**
 *
 * @param aliveOf 指定隊伍（與角色）的存活數。呼叫端**在套用任何效果之前**
 *   數好一次 —— 見 `stepBeats` 的「先判斷後套效果」。
 * @param batches 重生節拍已經預警的批數。只有 `batch` 條件讀它
 */
export function conditionMet(
  when: BeatCondition, time: number, aliveOf: (team: Team, role?: AircraftSpec['role']) => number,
  batches = 0,
): boolean {
  if (when.kind === 'clock') return time >= when.at
  if (when.kind === 'batch') return batches >= when.at
  if (time >= when.byLatest) return true
  return aliveOf(when.team, when.role) <= when.atMost
}
