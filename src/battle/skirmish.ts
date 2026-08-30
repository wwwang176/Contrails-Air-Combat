import { DEFAULT_BATTLE, type BattleConfig } from './setup'
import { mixedLine } from './order'
import { SCHWARM_SIZE } from './flights'
import { HEAD_ON } from './entry'
import { VETERAN } from '../ai/profile'
import { P51D } from '../specs/p51d'
import { F6F5 } from '../specs/f6f5'
import { BF109K4 } from '../specs/bf109k4'
import { B17G } from '../specs/b17g'
import { HE111 } from '../specs/he111'
import type { Faction } from './names'
import type { AircraftSpec } from '../specs/types'
import type { TerrainKind } from '../world/terrainKind'

/** 遭遇戰的陣營選擇。與 `battle/names.ts` 的 `Faction` 是同一組值 */
export type FactionChoice = Faction

/** 每隊最少架數。一架也要能打 —— 那時玩家沒有僚機可接，一死就落敗 */
export const MIN_SIDE = 1
/** 每隊最多架數。M5 以來的既有上限，效能閘門是照 40 架訂的 */
export const MAX_SIDE = 20
/** 特效池的容量。兩隊都滿編時的總架數 */
export const MAX_COMBATANTS = MAX_SIDE * 2

/**
 * 遭遇戰的出戰名單。**逐架一個機種代號，順序即編隊順序。**
 *
 * ── 為什麼不是「陣營 + 一個機種 + 兩個架數」（2026-08-21 之前的形狀）──
 *
 * 專案負責人 2026-08-21：「遭遇戰改一下 UI，要可以設定我方機種、敵方機種
 * ……點一台 P51 就增加一台 P51 到出戰卡牌中，點幾台出幾台（不是用數量
 * 增減），然後要可以讓我選我是當哪一台；陣營可以混搭，也就是 P51 可以跟
 * BF109 同一隊。」
 *
 * 「一隊一個機種」在舊形狀裡是**型別層級的限制**，不是一個可以放寬的設定。
 * 換成逐架的名單之後，混編、每隊各自的組成、玩家坐哪一架三件事同時成立，
 * 而且**與 `FlightPlan.members` 是同一個形狀** —— 那是編組表那一輪就定下
 * 來的（見 `order.ts` 的 `FlightPlan`），所以 battle 層一個字都不用改。
 */
export interface SkirmishSetup {
  /** 我方（藍隊）逐架的機種代號 */
  readonly blue: readonly string[]
  /** 敵方（紅隊）逐架的機種代號 */
  readonly red: readonly string[]
  /**
   * 玩家坐 `blue` 的第幾架。
   *
   * 【它不是小隊序號】`mixedLine` 會把那一架與它所在小隊的長機對調，
   * 因為 `player` 旗標的語意是「玩家開這一小隊的 `members[0]`」。
   */
  readonly playerAt: number
  /** 這一場打在什麼地方。**任務模式不吃它** —— 那邊的地形是關卡設計的一部分 */
  readonly terrain: TerrainKind
  /**
   * 開場高度，m。必須是 `ALTITUDES` 裡的值。
   *
   * 【為什麼它是一個設定】上一輪把群島放進了畫面，但地形感知在真實的仗裡
   * 一次都沒跑到 —— 開場恆為 4,000 m 而島最高 1,000 m。高度可選是
   * 「地形進得了場」的另一半。
   */
  readonly altitude: number
}

/**
 * 開場高度的三個選項。**順序即按鈕順序。**
 *
 * ```
 *   甲板     600 m   地形是主角。實測繞島佔時 4~7%
 *   低空   1,500 m   島在腳下，但擋不住路（實測繞島 0%）
 *   中空   4,000 m   預設
 * ```
 *
 * 【為什麼上面不再加】He 111 的實用升限是 6,300 m，而 `altitudeSpread`
 * 還會再加 ±300。開場給到 6,000 的話，混編裡的 He 111 一出生就在升限上、
 * 會一路往下沉。4,000 已經是地形完全不相干的高度。
 *
 * 【為什麼甲板是 600 而不是 400】400 m 會把飛機壓在海面上，20v20 的繞島
 * 佔時反而掉到 0。600 m 在 8v8 與 20v20 兩種規模都落在 4~7%，兩邊都不是
 * 邊界。
 *
 * 【為什麼中間那一格留著】1,500 m 的繞島佔時確實是 0 —— 島在那裡是景，
 * 不是障礙。那仍然是一種玩法，只是不要假裝它有戰術意義。
 */
export const ALTITUDES: readonly { readonly label: string; readonly value: number }[] = [
  { label: '甲板', value: 600 },
  { label: '低空', value: 1500 },
  { label: '中空', value: 4000 },
]

/**
 * **遭遇戰可以編進名單的全部機種。順序即卡片順序。**
 *
 * 【為什麼不分陣營】混搭上線之後「陣營」不再是一個選擇 —— 兩隊各自的
 * 名單就是全部的設定。任務模式仍然分陣營（`specsFor`），那是另一回事：
 * 那裡的陣營決定的是**打哪一組關卡**。
 *
 * 【順序】戰鬥機在前、轟炸機在後。與 `SPECS` 每一列的順序一致，
 * `missions.ts` 依賴「`specsFor(f)[0]` 是戰鬥機、`[1]` 是轟炸機」。
 */
export const ALL_SPECS: readonly AircraftSpec[] = [P51D, BF109K4, F6F5, B17G, HE111]

/**
 * 各陣營的機種。**任務模式專用** —— 遭遇戰請用 `ALL_SPECS`。
 *
 * 【第一台是戰鬥機、第二台是轟炸機】`missions.ts` 的 `missionConfigFrom`
 * 直接吃這個順序（`[0]` 護航、`[1]` 被護送），改順序會靜靜地換掉四張卡的
 * 編成。
 */
const SPECS: Record<FactionChoice, readonly AircraftSpec[]> = {
  allies: [P51D, B17G],
  axis: [BF109K4, HE111],
}

export function specsFor(faction: FactionChoice): readonly AircraftSpec[] {
  return SPECS[faction]
}

/**
 * 機種代號 → 機種。**找不到落回第一台**（`ALL_SPECS[0]`）。
 *
 * 【為什麼要有落回】名單從 DOM 來，而一個打錯的代號若一路傳到生成迴圈，
 * 症狀是「開始戰鬥之後那一架不見了」而不是任何錯誤。與 `clampSide` 對
 * NaN 的處理同一條理由。
 */
export function specOf(id: string): AircraftSpec {
  return ALL_SPECS.find((s) => s.id === id) ?? ALL_SPECS[0]!
}

/**
 * 「兩隊各自同一種機」的名單。**探針與測試的一行替換。**
 *
 * 【玩家的座位取那個小隊的長機】`Math.floor(小隊數 / 2) × SCHWARM_SIZE`
 * 就是 `lineAbreast` 的 `playerFlight` 長機 —— 所以這一支產出的編組表與
 * 舊路徑**逐項相同**（`test/unit/battle-order.test.ts` 釘住那條等價）。
 */
export function uniform(
  blueId: string, blueCount: number, redId: string, redCount: number,
): SkirmishSetup {
  const n = clampSide(blueCount)
  return {
    blue: Array.from({ length: n }, () => blueId),
    red: Array.from({ length: clampSide(redCount) }, () => redId),
    playerAt: Math.floor(Math.ceil(n / SCHWARM_SIZE) / 2) * SCHWARM_SIZE,
    terrain: 'archipelago',
    altitude: DEFAULT_BATTLE.altitude,
  }
}

/**
 * 名單末端加一架。**滿編時原樣回傳。**
 *
 * 【為什麼是純函數而不是留在 `ui/menu.ts`】那個檔案沒有測試（要 DOM），
 * 而「玩家的座位有沒有跟著動」正是最容易錯又最看不出來的一件事。
 */
export function withAircraft(
  setup: SkirmishSetup, team: 'blue' | 'red', id: string,
): SkirmishSetup {
  const list = team === 'blue' ? setup.blue : setup.red
  if (list.length >= MAX_SIDE) return setup
  const next = [...list, id]
  return team === 'blue' ? { ...setup, blue: next } : { ...setup, red: next }
}

/**
 * 名單拿掉第 `index` 架。
 *
 * 【玩家的座位要跟著動】拿掉的若在他前面，他就往前移一格；拿掉的就是他
 * 本人則留在同一格（也就是接下來那一架）。**不管的話玩家會默默換一台
 * 飛機開** —— 而畫面上只是一張卡消失，完全看不出來。
 *
 * 【可以刪到空】那是重編一整組時的正常中間狀態。設定頁在兩邊任一邊
 * 空著時會禁用「開始戰鬥」，所以不會有「名單是空的卻打得起來」。
 */
export function withoutAircraft(
  setup: SkirmishSetup, team: 'blue' | 'red', index: number,
): SkirmishSetup {
  const list = team === 'blue' ? setup.blue : setup.red
  const next = list.filter((_, i) => i !== index)
  if (team === 'red') return { ...setup, red: next }
  const at = index < setup.playerAt ? setup.playerAt - 1 : setup.playerAt
  return { ...setup, blue: next, playerAt: Math.max(0, Math.min(at, next.length - 1)) }
}

export const DEFAULT_SKIRMISH: SkirmishSetup = uniform(P51D.id, MAX_SIDE, BF109K4.id, MAX_SIDE)

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
 * 開場高度落回白名單。不在表上的一律退回 `DEFAULT_BATTLE.altitude`。
 *
 * 【為什麼是白名單而不是區間夾】選單只給三個值，而那三個值各自有實測
 * （見 `ALTITUDES`）。區間夾會讓一個沒有人試飛過的高度靜靜地成立。
 *
 * 【這是一個 API 陷阱，要知道】未來的探針若寫
 * `battleConfigFrom({ ...setup, altitude: 800 })`，會**靜靜地**退回 4,000。
 * 既有探針全部是「先 `battleConfigFrom`、再覆寫回傳值的 `altitude`」，
 * 所以不受影響 —— 但下一個人不會知道。
 */
function pickAltitude(v: number): number {
  for (const a of ALTITUDES) if (a.value === v) return a.value
  return DEFAULT_BATTLE.altitude
}

/**
 * 名單 → 機種陣列。空名單補一架預設機，超編砍到 `MAX_SIDE`。
 *
 * 【為什麼空名單不是錯誤】設定頁上「把我方清空」是一個正常的中間狀態
 * （要換一整組編制），只有按下開始戰鬥時它才是問題。在這裡補一架，
 * UI 那一層就不必為了防呆去禁用按鈕。
 */
function roster(ids: readonly string[], fallback: AircraftSpec): AircraftSpec[] {
  if (ids.length === 0) return [fallback]
  return ids.slice(0, MAX_SIDE).map(specOf)
}

/**
 * 設定 → 戰鬥設定。
 *
 * 【為什麼不讓 DOM 直接組 `BattleConfig`】夾制、落回、玩家座位這三件事
 * 必須測得到，而 DOM 測不到（M10 spec §7.3）。
 *
 * 【玩家恆在藍隊】換的是機種不是隊伍顏色（M9 spec §14、M10 spec §7.1）。
 */
export function battleConfigFrom(setup: SkirmishSetup): BattleConfig {
  const blue = roster(setup.blue, P51D)
  const red = roster(setup.red, BF109K4)
  // 【座位也要夾】名單縮短之後 `playerAt` 可能指到不存在的那一架，而
  // `mixedLine` 那時會找不到任何小隊標 `player` —— `assertOrderOfBattle`
  // 會拋「必須恰好有一筆 player」，也就是按下開始戰鬥直接白畫面
  const at = Number.isFinite(setup.playerAt)
    ? Math.max(0, Math.min(blue.length - 1, Math.floor(setup.playerAt)))
    : 0
  return {
    ...DEFAULT_BATTLE,
    units: mixedLine(HEAD_ON, blue, red, at),
    // 【地形不在這裡】`BattleConfig` 不認識地形 —— 畫面那一份與碰撞那一份
    // 必須是同一份高度場，而生成它的是 `render/terrain.ts`。`main.ts` 拿
    // `setup.terrain` 去 `createTerrain`，再把同一個參考接給 AI 與
    // `crashPolicy`（見 `main.ts` 的 `wireTerrain`）
    altitude: pickAltitude(setup.altitude),
    // 【難度只在這條路上生效】`DEFAULT_BATTLE` 留 `ACE`，因為那是全部 AI
    // 測試量天花板用的基準。這裡是「史實的 AI」變成「打得動的 AI」的唯一
    // 入口，與 `specs/feel.ts` 在 `setup.ts` 的位置對稱。
    aiProfile: VETERAN,
  }
}
