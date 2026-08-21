import { Vector3 } from 'three'
import { DEFAULT_BATTLE, type BattleConfig } from './setup'
import { specsFor, type FactionChoice } from './skirmish'
import { VETERAN } from '../ai/profile'
import { ENTRY_PLANS, type EntryPlanId } from './entry'
import { lineAbreast } from './order'
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
   * 開局怎麼擺。**`battle/entry.ts` 那張表的鍵。**
   *
   * 【為什麼是每張卡自己的欄位】專案負責人 2026-08-16：「任務的擺位不一定
   * 只有對頭 OR 追我，應該要把擺位、面向、初始狀態都寫成陣列，讓每個任務
   * 有不同的擺法。」寫成 `type === '撤離' ? 追擊 : 對頭` 的話，第三種擺法
   * 一出現那條式子就要改，而且它會散落在別處。
   */
  entry: EntryPlanId
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
  objective: '', evacDistance: 0, evacRadius: 0, seconds: Infinity,
  entry: 'headOn', playable: false,
} as const

/**
 * 殲滅：沒有撤離點也沒有時限，贏的條件就是敵方歸零。
 *
 * 【起始值，待掃描】藍 8／紅 6 是 2 星。見 spec §8。
 */
const KILL = {
  objective: '擊落全部敵機',
  evacDistance: 0, evacRadius: 0, seconds: Infinity,
  entry: 'headOn', playable: true,
} as const

/**
 * 撤離的共用幾何。**由 `test/tools/evacuate.probe.ts` 實測定值**（spec §8）。
 *
 * ── ⚠ 【暫時關閉：`playable: false`】專案負責人 2026-08-16 ──────────
 *
 * 試飛兩輪之後的裁定：**「我發現，根本追不到，撤退這個任務先 DISABLED。」**
 *
 * ```
 *   第一版  後方 800 m、高 1,000 m  →  斜距 1,281 m、俯角 51°  →  追不到
 *   第二版  後方 400 m、高   200 m  →  斜距   447 m、俯角 27°  →  還是追不到
 * ```
 *
 * 【關掉的是卡片，不是機制】撤離的判定、圓環、目標列、時限全部留著，而且
 * 仍然由 `test/unit/mission.test.ts` 與 `test/integration/mission-evacuate.test.ts`
 * 守著 —— 那三支測試不讀 `playable`，所以這面旗子翻下來它們一條都不會少。
 * **這一張卡缺的不是判定，是一個玩得起來的追逐。**
 *
 * 【真正的缺口】把敵機擺在身後只是把「追不上」推遲了幾秒 —— 開局幾何管
 * 得了第一次接觸，管不了之後。要讓追逐成立，缺的是**AI 的撤離行為**
 * （`docs/backlog.md` §2.12）：目前紅隊只會照一般空戰邏輯纏鬥，沒有人負責
 * 「壓在逃跑者的能量線上不放」。**這件事沒補上之前，調 `gap` 與 `climb`
 * 只是在換一個追不到的距離。**
 *
 * 【要翻回來的條件】§2.12 補上之後重跑 `evacuate.probe.ts`，再由試飛裁定。
 *
 * ```
 *   撤離點 −20,000 m ── 玩家起點 z≈+5,000（entryRange/2），直線 25 km。
 *                       表一實測直飛 12/16/20/25/30 km 各要 84.0/104.8/125.5/
 *                       151.3/177.0 s —— 線性，沒有結構，所以維持 20 km
 *   抵達半徑  1,000 m ── 表三：四個候選的判定都是精確的（判到達時的距離
 *                       等於半徑，差 0~1 m），沒有跨步漏判。挑 1,000 是
 *                       因為它在 20 km 外佔螢幕高度 8.8%：500 只有 4.4%
 *                       （太小），2,000 有 17.6%（大到擋視野）
 * ```
 *
 * 【為什麼撤離點在敵人後方】藍隊開局朝 −Z，紅隊在 −Z。所以玩家必須打穿
 * 出去 —— 撤離點若在背後，最佳打法是開局轉頭直線飛，那不是一場仗。
 *
 * 【時限不在這裡】它逐卡不同，見下面兩張撤離卡。
 */
const EVAC = {
  objective: '飛抵撤離點',
  evacDistance: 20000, evacRadius: 1000,
  // 【追兵在正後方 400 m、高 200 m】理由與數字的推導見 `entry.ts` 的 `PURSUIT`
  entry: 'pursuit', playable: false,
} as const

/**
 * 時限的餘裕倍率。**這是難度的旋鈕**，起始值 1.4（四成的機動預算）。
 *
 * 表一實測（直飛、不迴避、WEP）給的是路徑時間的**下限**；乘上餘裕才是
 * 「一邊閃一邊走」的預算。1.2 = 兩成，緊到完全不能停下來打；1.6 = 六成，
 * 寬到時限形同虛設。
 *
 * 【為什麼兩張卡的秒數不一樣】表四：同盟國玩家開 P-51（全場最快），
 * 對頭交錯之後 16 架 Bf109 追不上，125.5 s 到；軸心國玩家開 Bf109，
 * 被更快的 P-51 追，168.2 s 到而且掉一架僚機。**同一個秒數會讓一張卡
 * 太鬆、另一張幾乎不可能。**
 */
const EVAC_MARGIN = 1.4

/**
 * 直飛到撤離點的實測秒數（`evacuate.probe.ts` 表四，20 km、WEP、不迴避）。
 *
 * 【為什麼把它們寫成常數再乘】時限**是推導出來的**，不是挑出來的。
 * 直接寫 175 與 235 的話，下一次量出不同的路徑時間時，沒有人知道要
 * 怎麼重算。
 */
const EVAC_STRAIGHT_ALLIES = 125.5
const EVAC_STRAIGHT_AXIS = 168.2

/** 同盟國「且戰且走」：125.5 × 1.4 = 175.70 → 176 */
const EVAC_SECONDS_ALLIES = Math.round(EVAC_STRAIGHT_ALLIES * EVAC_MARGIN)
/**
 * 軸心國「撤出包圍」：168.2 × 1.4 = 235.48 → **235**。
 *
 * 【這裡原本寫 236】我心算成 235.5 才進位。實際是 235.48，`Math.round`
 * 給 235（Codex 審查 2026-08-16）。**程式一直是對的，錯的是註解** ——
 * 這正是「把推導寫進程式而不是寫死結果」的價值：算式不會算錯，只有
 * 註解會。兩個秒數現在由 `test/unit/missions.test.ts` 逐值釘住。
 */
const EVAC_SECONDS_AXIS = Math.round(EVAC_STRAIGHT_AXIS * EVAC_MARGIN)

/**
 * 兩個陣營的任務。
 *
 * 【現在只有殲滅可打】其餘四種各缺各的：
 *
 * ```
 *   攔截／護航  缺第三種機體（轟炸機／運輸機）—— 不存在
 *   打擊        缺對地武器與地面目標 —— 兩者都不存在
 *   撤離        判定做好了，缺一個追得到的追兵（見上面 EVAC 的 ⚠）
 * ```
 *
 * 架數照填，補上前置時只要把 `playable` 翻成 true。
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
      blueCount: 4, redCount: 16, ...EVAC, seconds: EVAC_SECONDS_ALLIES,
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
      blueCount: 4, redCount: 16, ...EVAC, seconds: EVAC_SECONDS_AXIS,
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
 * 這裡的來源是本檔的常數表，夾制只會把一個寫錯的關卡藏起來。
 *
 * 【但「寫錯就會炸」只對一半】`blueCount` 為 0 時 `createBattle` 確實會拋
 * 「玩家沒有被建立」；**大於 `MAX_SIDE` 不會拋**，只會建一個超出特效池容量
 * 假設的超大戰場（Codex 審查 2026-08-16）。所以那道保險由
 * `test/unit/missions.test.ts` 的「架數落在 1~MAX_SIDE 的整數」補上。
 */
export function missionConfigFrom(card: MissionCard, faction: FactionChoice): BattleConfig {
  const mine = specsFor(faction)
  const theirs = specsFor(faction === 'allies' ? 'axis' : 'allies')
  return {
    ...DEFAULT_BATTLE,
    // 【擺法現在是 lineAbreast 的第一個參數】`card.entry` 仍然是
    // `ENTRY_PLANS` 的鍵，那張表一個字不動
    units: lineAbreast(
      ENTRY_PLANS[card.entry], mine[0]!, card.blueCount, theirs[0]!, card.redCount),
    aiProfile: VETERAN,
    rules: missionRules(card, DEFAULT_BATTLE.altitude),
  }
}
