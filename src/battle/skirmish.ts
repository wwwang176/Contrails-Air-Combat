import { DEFAULT_BATTLE, type BattleConfig } from './setup'
import { lineAbreast } from './order'
import { HEAD_ON } from './entry'
import { VETERAN } from '../ai/profile'
import { P51D } from '../specs/p51d'
import { BF109G6 } from '../specs/bf109g6'
import { B17G } from '../specs/b17g'
import { HE111 } from '../specs/he111'
import type { Faction } from './names'
import type { AircraftSpec } from '../specs/types'

/** 遭遇戰的陣營選擇。與 `battle/names.ts` 的 `Faction` 是同一組值 */
export type FactionChoice = Faction

/** 每隊最少架數。一架也要能打 —— 那時玩家沒有僚機可接，一死就落敗 */
export const MIN_SIDE = 1
/** 每隊最多架數。M5 以來的既有上限，效能閘門是照 40 架訂的 */
export const MAX_SIDE = 20
/** 特效池的容量。兩隊都滿編時的總架數 */
export const MAX_COMBATANTS = MAX_SIDE * 2

export interface SkirmishSetup {
  faction: FactionChoice
  /**
   * 玩家的機種代號。
   *
   * 【為什麼 M10 只有一個合法值還要有這個欄位】每個陣營目前就一台，卡片
   * 畫出來只有一個選項。M11 補第三台機時，版面、選取狀態與這條資料流
   * 都已經在了（M10 spec §7.2）。
   */
  specId: string
  /** 我方架數，含玩家 */
  blueCount: number
  /** 敵方架數 */
  redCount: number
}

/**
 * 各陣營可選的機種。**順序即卡片順序，第一台是預設**。
 *
 * 【第一台同時是「敵隊開什麼」】`battleConfigFrom` 的敵方一律取
 * `specsFor(對面)[0]`，`missionConfigFrom` 的雙方也都取 `[0]`。所以往後面
 * 加機種**不會動到任何既有的對戰組合** —— 加的是玩家的選項，不是敵人的。
 *
 * 【轟炸機兩台 2026-08-20 開放】外型與武裝都已經落地（`specs/b17g.ts`、
 * `specs/he111.ts`、`weapons/*.ts`），飛行模型與 HUD 對機種是無關的，
 * 缺的一直只有這張名單。
 *
 * 一件要知道的事：`blueSpec` 套用在**整隊**，所以選 B-17G 就是一個
 * B-17 編隊而不是「一架轟炸機配一群野馬」。那是刻意的（真機就是編隊
 * 出擊），但它把畫面上的三角形數乘上架數 —— 見 `test/unit/perf-gate.test.ts`。
 */
const SPECS: Record<FactionChoice, readonly AircraftSpec[]> = {
  allies: [P51D, B17G],
  axis: [BF109G6, HE111],
}

export function specsFor(faction: FactionChoice): readonly AircraftSpec[] {
  return SPECS[faction]
}

export const DEFAULT_SKIRMISH: SkirmishSetup = {
  faction: 'allies',
  specId: P51D.id,
  blueCount: MAX_SIDE,
  redCount: MAX_SIDE,
}

/** 另一個陣營。 */
function opposing(f: FactionChoice): FactionChoice {
  return f === 'allies' ? 'axis' : 'allies'
}

/**
 * 夾進 [MIN_SIDE, MAX_SIDE]。非有限值落回 `MIN_SIDE`。
 *
 * 【為什麼要處理 NaN】數量從 DOM 讀進來是字串。`Number('')` 是 NaN，而
 * `Math.min/max` 對 NaN 是傳染的 —— 不擋的話會一路傳到生成迴圈，
 * 表現成「開始戰鬥之後什麼都沒有」。
 */
function clampSide(n: number): number {
  if (!Number.isFinite(n)) return MIN_SIDE
  return Math.max(MIN_SIDE, Math.min(MAX_SIDE, Math.floor(n)))
}

/**
 * 設定 → 戰鬥設定。
 *
 * 【為什麼不讓 DOM 直接組 `BattleConfig`】「選軸心國時紅隊是不是真的變成
 * P-51」這件事必須測得到，而 DOM 測不到。夾制也放在這裡（M10 spec §7.3）。
 *
 * 【玩家恆在藍隊】換的是機種不是隊伍顏色（M9 spec §14、M10 spec §7.1）。
 */
export function battleConfigFrom(setup: SkirmishSetup): BattleConfig {
  const mine = specsFor(setup.faction)
  const theirs = specsFor(opposing(setup.faction))
  const blueSpec = mine.find((s) => s.id === setup.specId) ?? mine[0]!
  return {
    ...DEFAULT_BATTLE,
    // 【夾制留在這裡】來源是 DOM 的字串，`Number('')` 是 NaN 而
    // `Math.min/max` 對 NaN 是傳染的。見 `clampSide`
    units: lineAbreast(
      HEAD_ON, blueSpec, clampSide(setup.blueCount),
      theirs[0]!, clampSide(setup.redCount)),
    // 【難度只在這條路上生效】`DEFAULT_BATTLE` 留 `ACE`，因為那是全部 AI
    // 測試量天花板用的基準。這裡是「史實的 AI」變成「打得動的 AI」的唯一
    // 入口，與 `specs/feel.ts` 在 `setup.ts` 的位置對稱。
    aiProfile: VETERAN,
  }
}
