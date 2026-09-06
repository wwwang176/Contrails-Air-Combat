import { THREAT_RANGE, threatFactor, turnTime } from './assess'
import { latch } from './rules'
import type { TargetBoard, TargetCandidate } from './target'
import type { Aircraft } from '../aircraft/Aircraft'

/**
 * 目標的來源等級。**數字越小越緊急，可以插隊**（M6 spec §7.4）。
 *
 * 【為什麼是數字而不是字串聯集】它唯一的用途就是比大小 ——「更緊急的
 * 一級可以立刻換目標」。字串要另外配一張優先序表，等於把同一件事寫兩次。
 */
export const LEVEL_NONE = 0
export const LEVEL_SELF_DEFENCE = 1
export const LEVEL_COVER = 2
export const LEVEL_FOCUS = 3

export interface WingmanConfig {
  /** 離站位多近才**開始**交戰，m */
  breakEnter: number
  /** 離站位多遠就**放棄**交戰回站，m */
  breakExit: number
  /** 換過目標之後不再換的秒數 */
  minDwell: number
  /**
   * 切換成本的特徵時間與相對重要性，與 `DEFAULT_TARGET` 的同名欄位
   * **同義同值** —— 自由獵手與僚機用同一套「轉過去要多久」的概念，
   * 兩邊分岔的話同一個戰場上會有兩種代價觀。掃描資料與「為什麼不取更重的」
   * 見 `DEFAULT_TARGET` 的同名欄位。
   */
  turnTimeScale: number
  turnWeight: number
  /**
   * **同一級之內**，新目標要好過現任的比例才換。與 `DEFAULT_TARGET` 的
   * 同名欄位同義同值。
   *
   * 【原本沒有這一道，兩條路徑不對稱】僚機的換目標條件只有
   * `state.dwell <= 0 && bestIndex !== state.current` —— 停留一過就換成當下
   * 最好的，新舊只要差一絲就換。長機那條路徑（`selectTarget`）從 M5 起就
   * 有這道門檻，僚機漏了。實測 20v20：僚機 21–31% 的換目標是「換走又換
   * 回來」，持有時間中位剛好卡在 `minDwell` 下限 1.10 s —— 遲滯完全飽和。
   *
   * 【為什麼只加在同一級內】跨級插隊（`bestLevel < state.level`）必須維持
   * 無條件 —— 「有人正在打我」不能被門檻擋住，那與 `rules.ts` 讓 `defend`
   * 豁免 `minDwell` 是同一條原則。而 `LEVEL_FOCUS` 沒有可比的分數（它就是
   * 「長機在打誰」），那一級也不套門檻。
   */
  switchMargin: number
}

/**
 * `breakEnter`、`breakExit`、`minDwell` 仍是起始值。
 * `turnTimeScale`、`turnWeight` 是切換成本，與 `DEFAULT_TARGET` 同值
 * —— 掃描表在那邊。
 *
 * 【`breakEnter` / `breakExit` = 800 / 1,200 m】800 m 約是站位橫向間距
 * （200 m）的四倍 —— 散到這個程度還讀得出是編隊。1,200 m 落在 M5 的
 * `extendRange`（1,500 m）之下，所以長機脫離時僚機跟得上，而不是各自
 * 脫離。**這是本里程碑最可能需要調的一個數字**：太小則僚機永遠打不到人，
 * 太大則編隊在混戰中永久散開、歸隊看不到。
 *
 * 【`minDwell` = 1.0 s】M5 的自由獵手用 2 s（「約 20 個決策節拍，長到一次
 * 目標變更撐得過一個機動」）。僚機反應的是長機身上的威脅、本來就該更快，
 * 取一半。
 */
export const DEFAULT_WINGMAN: WingmanConfig = {
  breakEnter: 800,
  breakExit: 1200,
  minDwell: 1.0,
  turnTimeScale: 4,
  turnWeight: 2,
  switchMargin: 0.25,
}

/**
 * 一架僚機的目標選擇狀態。**這是兩個遲滯的記憶。**
 *
 * 【只能由 `selectWingmanTarget` 自己寫】M4 在遲滯上踩過一個坑：`latch`
 * 的 OR 結果被寫回它自己的記憶，遲滯因此被毒化，0.29°/s 的雜訊就能讓
 * 閂鎖永遠關不掉。教訓是遲滯的記憶不能有第二條寫入路徑。
 */
export interface WingmanState {
  /** 目前允許離開站位交戰。`breakRange` 閂鎖的記憶 */
  engaging: boolean
  /** 現任目標在 `board.candidates` 裡的索引；−1 = 無 */
  current: number
  /** 現任目標是由第幾級選出來的。插隊判斷用 */
  level: number
  /** 距離可以再換目標還有多久，s */
  dwell: number
}

export function createWingmanState(): WingmanState {
  // 【engaging 起始為 false】出生時就在站位上，第一次呼叫的 latch 會立刻
  // 把它翻成 true（0 < breakEnter）。起始值因此不重要，取保守的那一個。
  return { engaging: false, current: -1, level: LEVEL_NONE, dwell: 0 }
}

/**
 * 僚機的目標選擇。回傳它的 `Aircraft`；沒有值得打的敵機時回傳 null
 * —— 呼叫端據此飛回站位。
 *
 * 四級優先序（M6 spec §7.1）：
 *
 * | 級 | 條件 | 受 `breakRange` 限制？ |
 * |---|---|---|
 * | 1 | 正在威脅**我自己**的敵機 | **否** |
 * | 2 | 正在威脅**站位參考機**的敵機 | 是 |
 * | 3 | 參考機的現任目標，且它離參考機不到 `THREAT_RANGE` | 是 |
 * | 4 | 無 → 歸隊 | — |
 *
 * 【自衛為什麼不受限制】有人在打你，這件事跟你離站位多遠無關。而且沒有
 * 這一級，`defend` 意圖在歸隊途中**結構上不可能觸發** —— `AiController`
 * 的「沒有目標」分支會整個跳過態勢評估（M6 spec §3.2）。一條資料上的
 * 優先序，換掉一條控制流上的特例。
 *
 * 【第 3 級的距離門】M5 的 AI 全知，開局 10 km 外長機就選定目標了。沒有
 * 這道門，僚機會在 10 km 外跟著撲出去，而 `breakRange` 擋不住它（目標
 * 大致就在航向上，偏離站位只有幾百公尺），開局的編隊會融成一條線。
 * 語意是：**集火是加入長機正在進行的交戰，不是陪他走完一段接近航程。**
 *
 * @param stationError 自己離站位點多遠，m。沒有站位時傳 0
 * @param dt 距離上次呼叫的秒數。呼叫端是 10 Hz 的決策節拍
 *
 * 熱路徑之外（10 Hz），但仍然不配置。
 */
export function selectWingmanTarget(
  state: WingmanState,
  board: TargetBoard,
  selfIndex: number,
  referenceIndex: number,
  stationError: number,
  dt: number,
  cfg: WingmanConfig = DEFAULT_WINGMAN,
): Aircraft | null {
  const { candidates, assignments } = board
  const self = candidates[selfIndex]
  if (self === undefined || !self.alive) {
    state.current = -1
    state.level = LEVEL_NONE
    state.dwell = 0
    state.engaging = false
    if (selfIndex >= 0 && selfIndex < assignments.length) assignments[selfIndex] = -1
    return null
  }

  state.dwell = state.dwell > dt ? state.dwell - dt : 0
  // enter < exit：低於 enter 才開始交戰、高於 exit 才放棄
  state.engaging = latch(state.engaging, stationError, cfg.breakEnter, cfg.breakExit)

  const refCandidate = referenceIndex >= 0 && referenceIndex < candidates.length
    ? candidates[referenceIndex]
    : undefined
  const lead = refCandidate !== undefined && refCandidate.alive ? refCandidate : undefined

  let bestIndex = -1
  let bestScore = 0
  let bestLevel = LEVEL_NONE

  // ── 第一級：自衛 ──────────────────────────────────────
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    if (!c.alive || c.team === self.team) continue
    const t = threatFactor(c.aircraft, self.aircraft)
    if (t <= 0) continue
    // 【切換成本只在同一級內部排序】通過這一級條件的候選一定會被選，
    // 代價只決定先挑誰（spec §4.2）。沒有它時兩架威脅相同就取先掃到的
    // —— 那可能是要轉 180° 的那一架。
    const s = t * turnDiscount(self.aircraft, c.aircraft, cfg)
    if (s > bestScore) {
      bestScore = s
      bestIndex = i
    }
  }
  if (bestIndex >= 0) bestLevel = LEVEL_SELF_DEFENCE

  // ── 第二級：掩護站位參考機 ────────────────────────────
  if (bestLevel === LEVEL_NONE && state.engaging && lead !== undefined) {
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!
      if (!c.alive || c.team === self.team) continue
      const t = threatFactor(c.aircraft, lead.aircraft)
      if (t <= 0) continue
      // 【威脅算在長機頭上、代價算在我頭上】要轉過去的是我
      const s = t * turnDiscount(self.aircraft, c.aircraft, cfg)
      if (s > bestScore) {
        bestScore = s
        bestIndex = i
      }
    }
    if (bestIndex >= 0) bestLevel = LEVEL_COVER
  }

  // ── 第三級：跟參考機集火 ──────────────────────────────
  if (bestLevel === LEVEL_NONE && state.engaging && lead !== undefined) {
    const a = assignments[lead.index]!
    const c = a >= 0 && a < candidates.length ? candidates[a] : undefined
    if (
      c !== undefined && c.alive && c.team !== self.team
      && c.aircraft.state.position.distanceTo(lead.aircraft.state.position) < THREAT_RANGE
    ) {
      bestIndex = a
      bestLevel = LEVEL_FOCUS
    }
  }

  // ── 最小停留（M6 spec §7.4）───────────────────────────
  // 【有效性只看「還活著且仍是敵方」】不要把「仍然構成威脅」寫進去 ——
  // 那會讓目標一脫離威脅錐就立刻失效，停留時間等於沒有。
  const held = state.current >= 0 && state.current < candidates.length
    ? candidates[state.current]
    : undefined
  const heldValid = held !== undefined && held.alive && held.team !== self.team

  if (!heldValid) {
    // 現任失效 → 立刻重選，繞過停留
    commit(state, bestIndex, bestLevel, cfg)
  } else if (bestLevel !== LEVEL_NONE && bestLevel < state.level) {
    // 更緊急的一級插隊
    commit(state, bestIndex, bestLevel, cfg)
  } else if (state.dwell <= 0 && bestIndex !== state.current) {
    // 【切換門檻只在同一級內】跨級插隊在上一個分支，無條件。這裡問的是
    // 「這兩架都在威脅同一個人，值得換嗎」—— 兩個評分交錯時若沒有門檻，
    // 每過一次 `minDwell` 就換一次（見 `WingmanConfig.switchMargin`）。
    //
    // 【現任分數為 0 時直接換】現任已經不再威脅任何人（飛走了、掉頭了），
    // 乘法門檻在 0 上失效 —— 任何值都不「好過 0 × 1.25」。不特別處理的話
    // 僚機會抱著一個早已無關的目標不放。
    const curScore = levelScore(state.level, self, lead, candidates[state.current], cfg)
    if (!(curScore > 0) || bestScore > curScore * (1 + cfg.switchMargin)) {
      commit(state, bestIndex, bestLevel, cfg)
    }
  }

  assignments[selfIndex] = state.current
  return state.current >= 0 ? candidates[state.current]!.aircraft : null
}

/**
 * 轉向代價的折扣，`1/(1 + t/scale)^w`。與 `target.ts` 的 `discount` 同一個
 * 形狀 —— 兩條選目標的路徑必須用同一套代價觀。
 */
function turnDiscount(self: Aircraft, enemy: Aircraft, cfg: WingmanConfig): number {
  if (cfg.turnWeight === 0) return 1
  const x = turnTime(self, enemy) / cfg.turnTimeScale
  if (!(x > 0)) return 1
  const d = 1 / (1 + x)
  return cfg.turnWeight === 1 ? d : Math.pow(d, cfg.turnWeight)
}

/**
 * 現任目標在**它被選上的那一級**的評分。找不到可比的分數時回 0。
 *
 * 【為什麼要照原級別算】第一級問「他威脅我多少」、第二級問「他威脅長機
 * 多少」——同一架敵機在兩級的分數完全不同。拿錯級別比，門檻就是在比兩個
 * 不同的量。
 */
function levelScore(
  level: number,
  self: TargetCandidate,
  lead: TargetCandidate | undefined,
  cur: TargetCandidate | undefined,
  cfg: WingmanConfig,
): number {
  if (cur === undefined || !cur.alive || cur.team === self.team) return 0
  if (level === LEVEL_SELF_DEFENCE) {
    return threatFactor(cur.aircraft, self.aircraft)
      * turnDiscount(self.aircraft, cur.aircraft, cfg)
  }
  if (level === LEVEL_COVER && lead !== undefined) {
    return threatFactor(cur.aircraft, lead.aircraft)
      * turnDiscount(self.aircraft, cur.aircraft, cfg)
  }
  // LEVEL_FOCUS 沒有可比的分數 —— 它就是「長機在打誰」，跟著換是對的
  return 0
}

function commit(state: WingmanState, index: number, level: number, cfg: WingmanConfig): void {
  state.current = index
  state.level = level
  state.dwell = index >= 0 ? cfg.minDwell : 0
}
