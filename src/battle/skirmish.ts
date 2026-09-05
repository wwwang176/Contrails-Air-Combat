import { DEFAULT_BATTLE, type BattleConfig } from './setup'
import { flightLine, type FlightSpec } from './order'
import { SCHWARM_SIZE } from './flights'
import { HEAD_ON } from './entry'
import { VETERAN } from '../ai/profile'
import { P51D, P51D_HISTORICAL } from '../specs/p51d'
import { F6F5, F6F5_HISTORICAL } from '../specs/f6f5'
import { BF109K4, BF109K4_HISTORICAL } from '../specs/bf109k4'
import { KI84, KI84_HISTORICAL } from '../specs/ki84'
import { A6M5, A6M5_HISTORICAL } from '../specs/a6m5'
import { G4M, G4M_HISTORICAL } from '../specs/g4m'
import { B17G, B17G_HISTORICAL } from '../specs/b17g'
import { HE111, HE111_HISTORICAL } from '../specs/he111'
import type { AircraftSpec, HistoricalReference } from '../specs/types'
import type { TerrainKind } from '../world/terrainKind'
import type { TimeOfDay } from '../world/timeOfDay'

/** 每隊最少架數。一架也要能打 —— 那時玩家沒有僚機可接，一死就落敗 */
export const MIN_SIDE = 1
/** 每隊最多架數。M5 以來的既有上限，效能閘門是照 40 架訂的 */
export const MAX_SIDE = 20
/** 特效池的容量。兩隊都滿編時的總架數 */
export const MAX_COMBATANTS = MAX_SIDE * 2
/** 每隊最多幾個分隊。20 ÷ 4 = 5 —— 隊數滿與架數滿是同一件事的兩面 */
export const MAX_FLIGHTS = MAX_SIDE / SCHWARM_SIZE

/**
 * 一個分隊：一種機種、幾架（1 … `SCHWARM_SIZE`）。
 *
 * 【為什麼一隊一種機種】編組頁的單位是「分隊」（2026-09-04 選單重做）：
 * 玩家掛一塊牌上去、調它的架數、選我帶哪一隊。混編小隊在 `FlightPlan.members`
 * 仍然表達得出來，但那不是這一頁要給的操作 —— 兩種機種要兩塊牌。
 */
export interface Flight {
  readonly id: string
  readonly count: number
}

/**
 * 遭遇戰的出戰編組。**逐隊一個機種與架數，順序即編隊順序。**
 *
 * ── 為什麼從逐架名單改成分隊清單（2026-09-04）──
 *
 * 舊形狀是 `blue: string[]` 逐架，`mixedLine` 每 4 架硬切一隊，所以「一隊 3 架」
 * 會跟下一隊混隊（`[p,p,p,b,b,b,b]` → `[p,p,p,b]、[b,b,b]`）。編組頁的單位
 * 是分隊，畫面上的一隊必須就是模擬裡的一隊 —— 而 `FlightPlan.members` 本來
 * 就允許 1~4 架，限制只在切法。改走 `flightLine`，切法跟著清單走。
 */
export interface SkirmishSetup {
  /** 我方（藍隊）的分隊，最多 `MAX_FLIGHTS` 隊、`MAX_SIDE` 架 */
  readonly blue: readonly Flight[]
  /** 敵方（紅隊）的分隊 */
  readonly red: readonly Flight[]
  /**
   * 我帶 `blue` 的第幾隊（分隊索引，不是座位）。那一隊的長機就是我開的。
   *
   * 【不再需要對調】舊模型的 `playerAt` 是座位，`mixedLine` 得把那一架與長機
   * 對調；分隊一種機種，長機是誰都一樣。
   */
  readonly lead: number
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
  /**
   * 這一場打在什麼時候。**任務模式不吃它** —— 那邊的時段寫在卡片上
   * （`MissionBattle.timeOfDay`），與地形同一個道理。
   *
   * 【它只影響畫面】光照與模擬無關，所以 `battleConfigFrom` 不帶它，
   * `main.ts` 直接讀這一格。
   */
  readonly timeOfDay: TimeOfDay
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
 * 清單就是全部的設定。任務模式也不分了：**每一張卡直接指名雙方飛什麼**
 * （`missions.ts` 的 `MissionBattle`）。
 *
 * 【順序】戰鬥機在前、轟炸機在後。選單照它畫卡片。
 */
export const ALL_SPECS: readonly AircraftSpec[] = [P51D, BF109K4, F6F5, KI84, A6M5, B17G, HE111, G4M]

/**
 * 機種代號 → 史實參考。編組頁顯示極速用。
 *
 * 【為什麼不從 `AircraftSpec` 讀】極速不在 spec 上 —— 它在各機種檔另外匯出的
 * `HistoricalReference`（spec 是模擬用的係數，極速是量測結果，兩者刻意分開）。
 * 這張表的完整性由測試守：`ALL_SPECS` 每個 id 都要在表上。
 */
export const HISTORICAL: Record<string, HistoricalReference> = {
  p51d: P51D_HISTORICAL, bf109k4: BF109K4_HISTORICAL, f6f5: F6F5_HISTORICAL,
  ki84: KI84_HISTORICAL, a6m5: A6M5_HISTORICAL,
  b17g: B17G_HISTORICAL, he111: HE111_HISTORICAL, g4m: G4M_HISTORICAL,
}

/** 史實極速，km/h，四捨五入。找不到回 0 —— 顯示層印 0 比印 NaN 好認 */
export function topSpeedKmh(id: string): number {
  const h = HISTORICAL[id]
  return h === undefined ? 0 : Math.round(h.vmaxAtCritical.speed * 3.6)
}

/**
 * 機種代號 → 機種。**找不到落回第一台**（`ALL_SPECS[0]`）。
 *
 * 【為什麼要有落回】名單從 DOM 來，而一個打錯的代號若一路傳到生成迴圈，
 * 症狀是「開始戰鬥之後那一架不見了」而不是任何錯誤。
 */
export function specOf(id: string): AircraftSpec {
  return ALL_SPECS.find((s) => s.id === id) ?? ALL_SPECS[0]!
}

/** 一側的總架數 */
export function flightsTotal(side: readonly Flight[]): number {
  let n = 0
  for (const f of side) n += f.count
  return n
}

/**
 * 「兩隊各自同一種機」的編組。**探針與測試的一行替換。**
 *
 * 【我帶的隊取中間那一隊】`floor(隊數 / 2)` 就是 `lineAbreast` 的 `playerFlight`
 * —— 所以這一支產出的編組表與舊路徑**逐項相同**（`skirmish.test.ts` 用
 * `mixedLine` 當對照組釘住）。
 */
export function uniform(
  blueId: string, blueCount: number, redId: string, redCount: number,
): SkirmishSetup {
  const blue = split(blueId, clampSide(blueCount))
  return {
    blue,
    red: split(redId, clampSide(redCount)),
    lead: Math.floor(blue.length / 2),
    terrain: 'archipelago',
    altitude: DEFAULT_BATTLE.altitude,
    timeOfDay: 'noon',
  }
}

/** n 架同一種機切成每隊最多 4 架的分隊 */
function split(id: string, n: number): Flight[] {
  const out: Flight[] = []
  for (let left = n; left > 0; left -= SCHWARM_SIZE) {
    out.push({ id, count: Math.min(SCHWARM_SIZE, left) })
  }
  return out
}

function side(setup: SkirmishSetup, team: 'blue' | 'red'): readonly Flight[] {
  return team === 'blue' ? setup.blue : setup.red
}

function withSide(
  setup: SkirmishSetup, team: 'blue' | 'red', next: readonly Flight[],
): SkirmishSetup {
  return team === 'blue' ? { ...setup, blue: next } : { ...setup, red: next }
}

/** lead 夾進 `[0, blue.length − 1]`；空清單是 0 */
function clampLead(lead: number, flights: number): number {
  if (!Number.isFinite(lead)) return 0
  return Math.max(0, Math.min(flights - 1, Math.floor(lead)))
}

/**
 * 末端加一隊。架數是 4，剩餘不足時填到滿；**沒有位置時原樣回傳**（架數滿
 * 或隊數滿都算）。
 *
 * 【為什麼是純函數而不是留在 `ui/menu.ts`】那個檔案沒有測試（要 DOM），
 * 而「我帶的隊有沒有跟著動」正是最容易錯又最看不出來的一件事。
 */
export function addFlight(setup: SkirmishSetup, team: 'blue' | 'red', id: string): SkirmishSetup {
  const list = side(setup, team)
  if (list.length >= MAX_FLIGHTS) return setup
  const room = Math.min(SCHWARM_SIZE, MAX_SIDE - flightsTotal(list))
  if (room <= 0) return setup
  return withSide(setup, team, [...list, { id, count: room }])
}

/**
 * 改某一隊的架數。夾在 1..4，而且整側總數不超過 `MAX_SIDE`；
 * `n <= 0` 等於拿掉那一隊。
 */
export function setCount(
  setup: SkirmishSetup, team: 'blue' | 'red', index: number, n: number,
): SkirmishSetup {
  if (n <= 0) return removeFlight(setup, team, index)
  const list = side(setup, team)
  const f = list[index]
  if (f === undefined) return setup
  const others = flightsTotal(list) - f.count
  const count = Math.max(1, Math.min(SCHWARM_SIZE, MAX_SIDE - others, Math.floor(n)))
  if (count === f.count) return setup
  return withSide(setup, team, list.map((x, i) => (i === index ? { id: x.id, count } : x)))
}

/**
 * 拿掉一隊。
 *
 * 【我帶的隊要跟著動】拿掉的若在它前面，它往前移一格；拿掉的就是它本身
 * 則留在同一格（也就是接下來那一隊）。**不管的話玩家會默默換一隊帶** ——
 * 而畫面上只是一列消失，完全看不出來。
 */
export function removeFlight(setup: SkirmishSetup, team: 'blue' | 'red', index: number): SkirmishSetup {
  const list = side(setup, team)
  if (list[index] === undefined) return setup
  const next = list.filter((_, i) => i !== index)
  if (team === 'red') return { ...setup, red: next }
  const lead = index < setup.lead ? setup.lead - 1 : setup.lead
  return { ...setup, blue: next, lead: clampLead(lead, next.length) }
}

/** 我帶第幾隊 */
export function setLead(setup: SkirmishSetup, index: number): SkirmishSetup {
  return { ...setup, lead: clampLead(index, setup.blue.length) }
}

/**
 * 四個想定。**編成是定案的資料**（2026-09-04 mockup 與專案負責人往返定的），
 * 改了要改 `skirmish.test.ts` 的斷言。
 */
export const PRESETS = {
  even: {
    label: '勢均力敵',
    blue: [{ id: 'p51d', count: 4 }, { id: 'p51d', count: 4 }],
    red: [{ id: 'bf109k4', count: 4 }, { id: 'bf109k4', count: 4 }],
  },
  escort: {
    label: '護航突破',
    blue: [{ id: 'p51d', count: 4 }, { id: 'b17g', count: 4 }],
    red: [{ id: 'bf109k4', count: 4 }, { id: 'bf109k4', count: 4 }, { id: 'bf109k4', count: 2 }],
  },
  few: {
    label: '以寡擊眾',
    blue: [{ id: 'ki84', count: 3 }],
    red: [{ id: 'f6f5', count: 4 }, { id: 'f6f5', count: 4 }, { id: 'f6f5', count: 2 }],
  },
  hunt: {
    label: '轟炸機獵殺',
    blue: [{ id: 'bf109k4', count: 4 }, { id: 'bf109k4', count: 4 }],
    red: [{ id: 'b17g', count: 4 }, { id: 'b17g', count: 4 }, { id: 'p51d', count: 2 }],
  },
} as const satisfies Record<string, { label: string; blue: readonly Flight[]; red: readonly Flight[] }>

export type PresetKey = keyof typeof PRESETS

/**
 * 套一個想定。地形與高度不動；**lead 重設為 0** —— 從 lead = 4 套一個我方只有
 * 一隊的想定而保留 lead，`flightLine` 不會有任何 player（Codex 審查 2026-09-04）。
 */
export function applyPreset(setup: SkirmishSetup, key: PresetKey): SkirmishSetup {
  const p = PRESETS[key]
  return { ...setup, blue: [...p.blue], red: [...p.red], lead: 0 }
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
 * 分隊清單 → `flightLine` 的輸入。空清單補一隊一架預設機；超編從末端砍到
 * `MAX_SIDE`（整隊砍、尾隊截）。
 *
 * 【為什麼空清單不是錯誤】編組頁上「把我方清空」是一個正常的中間狀態
 * （要換一整組編制），只有按下起飛時它才是問題 —— 而那一顆在兩邊任一邊
 * 空著時是禁用的。這裡補一架是防禦，不是 UI 的行為。
 */
function roster(list: readonly Flight[], fallback: AircraftSpec): FlightSpec[] {
  const out: FlightSpec[] = []
  let left = MAX_SIDE
  for (const f of list) {
    if (left <= 0 || out.length >= MAX_FLIGHTS) break
    const count = Math.max(1, Math.min(SCHWARM_SIZE, left, Math.floor(f.count)))
    out.push({ spec: specOf(f.id), count })
    left -= count
  }
  if (out.length === 0) out.push({ spec: fallback, count: 1 })
  return out
}

/**
 * 設定 → 戰鬥設定。
 *
 * 【為什麼不讓 DOM 直接組 `BattleConfig`】夾制、落回、我帶哪一隊這三件事
 * 必須測得到，而 DOM 測不到（M10 spec §7.3）。
 *
 * 【玩家恆在藍隊】換的是機種不是隊伍顏色（M9 spec §14、M10 spec §7.1）。
 */
export function battleConfigFrom(setup: SkirmishSetup): BattleConfig {
  const blue = roster(setup.blue, P51D)
  const red = roster(setup.red, BF109K4)
  // 【lead 也要夾】清單縮短之後 `lead` 可能指到不存在的那一隊，而 `flightLine`
  // 對超界是丟錯的 —— 這裡是 UI 語意的邊界，夾進去；否則按下起飛直接白畫面
  return {
    ...DEFAULT_BATTLE,
    units: flightLine(HEAD_ON, blue, red, clampLead(setup.lead, blue.length)),
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
