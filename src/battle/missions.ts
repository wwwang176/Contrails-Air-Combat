import { Vector3 } from 'three'
import { DEFAULT_BATTLE, type BattleConfig } from './setup'
import { specsFor, type FactionChoice } from './skirmish'
import { VETERAN } from '../ai/profile'
import type { MissionRules } from './mission'

/** 任務類型。對應 `docs/prompt.md` 規劃的五種 */
export type MissionType = '殲滅' | '攔截' | '打擊' | '護航' | '撤離'

/**
 * 一張任務卡。
 *
 * 【為什麼從 `ui/` 搬到 `battle/`】M10 時它只有標題與文案，是 UI 的東西。
 * 現在它帶著編制與勝負條件 —— 那是**關卡資料**，而選單只是它的一個讀者。
 */
export interface MissionCard {
  /**
   * 全域唯一。`main.ts` 用它認出玩家點的是哪一關。
   *
   * 【前綴就是陣營】`main.ts` 由 `id.startsWith('axis')` 推陣營，由
   * `test/unit/missions.test.ts` 釘住。
   */
  id: string
  title: string
  type: MissionType
  /**
   * 1~5 星。**這一張卡的配置的標籤，不是玩家的選項** —— 難度由編制與幾何
   * 給，`DifficultyProfile` 一貫不碰（見 `setup.ts` 的 `aiProfile` 註解）。
   */
  difficulty: number
  /** 卡片上的一行說明 */
  summary: string
  /**
   * HUD 目標列上的文字。未實作的卡是空字串。
   *
   * 【為什麼放在卡片上而不是 `MissionState`】它是常數。放進狀態的話
   * `stepMission` 每個物理步跑 240 次，等於每秒配置 240 個字串。
   */
  objective: string
  /** 我方架數，含玩家 */
  blueCount: number
  redCount: number
  /** 撤離點在 −Z 多遠，m。非撤離任務為 0 */
  evacDistance: number
  /** 抵達半徑，m。**就是圓環半徑**。非撤離任務為 0 */
  evacRadius: number
  /** 時限，秒。無時限為 `Infinity` */
  seconds: number
  /**
   * 這一張卡做了沒有。false 的在選單上維持 disabled。
   *
   * 【為什麼是資料而不是由 `type` 推導】推導要寫成
   * `type === '殲滅' || type === '撤離'`，而那條式子會散落在選單與測試裡。
   * 補上攔截時只要把那張卡的旗標翻成 true。
   */
  playable: boolean
}

/** 沒有撤離點、沒有時限、還沒做的卡共用這一組 */
const LOCKED = {
  objective: '', evacDistance: 0, evacRadius: 0, seconds: Infinity, playable: false,
} as const

/**
 * 殲滅：沒有撤離點也沒有時限，贏的條件就是敵方歸零。
 *
 * 【起始值，待掃描】藍 8／紅 6 是 2 星。見 spec §8。
 */
const KILL = {
  objective: '擊落全部敵機',
  evacDistance: 0, evacRadius: 0, seconds: Infinity, playable: true,
} as const

/**
 * 撤離。**四個數字全部是起始值，待 spec §8 的掃描回填。**
 *
 * ```
 *   撤離點 −20,000 m ── 玩家起點 z≈+5,000（entryRange/2），直線 25 km
 *   抵達半徑  1,000 m ── 20 km 外佔螢幕高度 8.8%（2·atan(1000/20000)/65°）
 *   時限        240 s ── 巡航 200 m/s 要 125 s；纏鬥速度 100~130 m/s 要 190~250 s
 * ```
 *
 * 【為什麼撤離點在敵人後方】藍隊開局朝 −Z，紅隊在 −Z。所以玩家必須打穿
 * 出去 —— 撤離點若在背後，最佳打法是開局轉頭直線飛，那不是一場仗。
 */
const EVAC = {
  objective: '飛抵撤離點',
  evacDistance: 20000, evacRadius: 1000, seconds: 240, playable: true,
} as const

/**
 * 兩個陣營的任務。
 *
 * 【只有殲滅與撤離可打】其餘三種缺前置：攔截與護航要第三種機體（轟炸機／
 * 運輸機），打擊要對地武器與地面目標 —— 兩者都不存在。它們的架數照填，
 * 補上前置時只要把 `playable` 翻成 true。
 */
export const MISSIONS: Record<FactionChoice, readonly MissionCard[]> = {
  allies: [
    {
      id: 'allies-sweep', title: '諾曼第上空掃蕩', type: '殲滅', difficulty: 2,
      summary: '清空灘頭上空的攔截機。',
      blueCount: 8, redCount: 6, ...KILL,
    },
    {
      id: 'allies-intercept', title: '攔截 He 111 轟炸群', type: '攔截', difficulty: 3,
      summary: '在轟炸機投彈前擊落它們。',
      blueCount: 4, redCount: 8, ...LOCKED,
    },
    {
      id: 'allies-strike', title: '打擊魯爾鐵路', type: '打擊', difficulty: 3,
      summary: '切斷補給線上的列車與調車場。',
      blueCount: 4, redCount: 6, ...LOCKED,
    },
    {
      id: 'allies-escort', title: '護送 B-17 至集合點', type: '護航', difficulty: 4,
      summary: '把每一架轟炸機帶到集合點。',
      blueCount: 4, redCount: 10, ...LOCKED,
    },
    {
      id: 'allies-evac', title: '且戰且走', type: '撤離', difficulty: 5,
      summary: '頂著數量劣勢活著退出戰區。',
      blueCount: 4, redCount: 16, ...EVAC,
    },
  ],
  axis: [
    {
      id: 'axis-patrol', title: '帝國防空巡邏', type: '殲滅', difficulty: 2,
      summary: '驅離侵入本土空域的護航機。',
      blueCount: 8, redCount: 6, ...KILL,
    },
    {
      id: 'axis-intercept', title: '攔截 B-17 轟炸群', type: '攔截', difficulty: 3,
      summary: '突破護航網，打掉重轟炸機。',
      blueCount: 4, redCount: 8, ...LOCKED,
    },
    {
      id: 'axis-strike', title: '打擊登陸艦隊', type: '打擊', difficulty: 4,
      summary: '在灘頭上空掩護，攻擊登陸艦艇。',
      blueCount: 4, redCount: 8, ...LOCKED,
    },
    {
      id: 'axis-escort', title: '護送運輸機', type: '護航', difficulty: 3,
      summary: '掩護運輸機穿越敵方巡邏區。',
      blueCount: 4, redCount: 8, ...LOCKED,
    },
    {
      id: 'axis-evac', title: '撤出包圍', type: '撤離', difficulty: 5,
      summary: '在補給斷絕的機場起飛並脫離。',
      blueCount: 4, redCount: 16, ...EVAC,
    },
  ],
}

/**
 * 卡片 → 勝負條件。
 *
 * 【為什麼撤離點的高度是參數而不是常數】高度設定改了，撤離點要自動跟上。
 * 寫死 4000 的話兩者會在某次調整之後靜靜地差開 —— 而症狀是「圓環浮在
 * 戰場上方，飛過去卻沒判到」。
 *
 * 【為什麼判準是 `type` 而不是 `evacDistance > 0`】後者把「這是撤離任務」
 * 這件事編碼進一個數字的正負，而那個數字的意思是距離。
 */
export function missionRules(card: MissionCard, altitude: number): MissionRules {
  if (card.type !== '撤離') return { kind: 'annihilate' }
  return {
    kind: 'evacuate',
    point: new Vector3(0, altitude, -card.evacDistance),
    radius: card.evacRadius,
    seconds: card.seconds,
  }
}

/**
 * 卡片 → 戰鬥設定。與 `skirmish.ts` 的 `battleConfigFrom` 對稱 ——
 * **兩者都是「設定 → `BattleConfig`」的唯一入口**，難度也在這裡套
 * （理由見 `setup.ts` 的 `aiProfile` 註解）。
 *
 * 【玩家恆在藍隊】換的是機種不是隊伍顏色（M9 spec §14、M10 spec §7.1）。
 *
 * 【為什麼架數不夾制】`battleConfigFrom` 要夾是因為那些數字從 DOM 讀進來；
 * 這裡的來源是本檔的常數表，夾制只會把一個寫錯的關卡藏起來。真的寫錯的話
 * `createBattle` 會拋「玩家沒有被建立」，而那正是要的。
 */
export function missionConfigFrom(card: MissionCard, faction: FactionChoice): BattleConfig {
  const mine = specsFor(faction)
  const theirs = specsFor(faction === 'allies' ? 'axis' : 'allies')
  return {
    ...DEFAULT_BATTLE,
    blueCount: card.blueCount,
    redCount: card.redCount,
    blueSpec: mine[0]!,
    redSpec: theirs[0]!,
    aiProfile: VETERAN,
    rules: missionRules(card, DEFAULT_BATTLE.altitude),
  }
}
