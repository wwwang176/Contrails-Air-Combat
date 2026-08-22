import type { TargetBoard } from './target'

/**
 * 單機的戰術相位。
 *
 * 【為什麼在意圖之上另開一層】六種意圖（approach / merge / engage / extend /
 * defend / rally）沒有一種是**主動占位**：`extend` 是被動止損，觸發條件全是
 * 劣勢。史實的 boom and zoom 需要「已經有優勢了但刻意不動，等對方進入攻擊
 * 姿態」——那是意圖層表達不了的狀態，因為它是一個**連續函數表達不了的等待**。
 *
 * 【為什麼不插進 `rules.ts` 的 arbitrate】那張表的優先序是逐條實測談定的
 * （相對理由 vs 絕對理由、defend 的絕對優先權）。插一列會重談整組關係；走
 * `AiController` 的外部覆寫則一條都不受影響 —— 與命令層同一個手法。
 *
 * ```
 *   off       不參與（沒名額／有命令／transit／太近／沒目標）
 *   build     能量赤字 → 爬升加速，累積盈餘
 *   perch     盈餘達標但目標未承諾 → 保持高度與距離
 *   dive      目標進入承諾姿態 → 帶著能量進場
 *   zoom      一輪射擊結束 → 拉起爬回
 *   cooldown  止損 → 強制脫離一段時間
 * ```
 *
 * 循環是 `build → perch → dive → zoom → build`；`cooldown` 是止損出口。
 */
export type TacticalPhase = 'off' | 'build' | 'perch' | 'dive' | 'zoom' | 'cooldown'

/** 一架飛機的戰術狀態。**熱路徑就地改寫，不配置。** */
export interface TacticalState {
  phase: TacticalPhase
  /** 這個相位已經待多久，s */
  dwell: number
  /**
   * 能量盈餘的閂鎖。**獨立於 `phase`，而且全程更新。**
   *
   * 【為什麼不能用 `phase === 'perch'` 代替】`latch` 的語意是一段獨立的
   * 記憶：`rules.ts` 的 `stepRules` 每個決策節拍更新**所有**閂鎖，即使那一拍
   * 沒有選到那個意圖。少了這個性質，離開再回來時遲滯就沒有記憶，而遲滯正是
   * 擋震盪的東西。
   */
  perchLatch: boolean
  /** 距離的閂鎖。true = 「遠」，也就是可以進戰術層 */
  farLatch: boolean
  /** `psTarget < 0` 已經連續多久，s */
  commit: number
  /** `dive` 期間接近率曾經為正 */
  closed: boolean
  /** 接近率轉負之後持續多久，s */
  passing: number
  /** `cooldown` 剩餘，s */
  cooldown: number
  /** 本輪進入 `build` 時的 `energyRatio` */
  cycleBase: number
  /** 本輪是否有效。換過目標就無效，不參與能量帳止損 */
  cycleValid: boolean
  /** 本輪是否形成過射擊窗 */
  cycleShot: boolean
  /** 連續幾輪沒有射擊窗 */
  dryRounds: number
  /**
   * 進入上一次 `cooldown` 時的 `energyRatio`。`NaN` = 沒有上一次。
   *
   * 【它擋的是一個永久迴圈】只靠距離閘門的話，目標一直很遠時會變成
   * `build → cooldown → off → 立刻 build → …` 永遠繞下去 —— 那正好把原問題
   * 換成另一種永久循環。再進入要求「換過目標」或「能量比那時候高」。
   */
  lastCooldownRatio: number
  /** 上一個目標的識別。−2 = 尚未設定 */
  lastTarget: number
}

export interface TacticalConfig {
  /** 有多少比例的飛機參與戰術層。**0 = 完全關掉**（消融的對照組） */
  quota: number
  /** 進入戰術層的距離門檻，m */
  enterRange: number
  /** 離開的距離門檻，m。與 `enterRange` 不同就是遲滯 */
  exitRange: number
  /** 進 `perch` 的能量盈餘門檻（`energyRatio`） */
  perchEnter: number
  /** 掉回 `build` 的門檻。遲滯 */
  perchExit: number
  /** 每個相位的最短停留，s */
  minDwell: number
  /** 目標要維持承諾姿態多久才俯衝，s */
  commitSeconds: number
  /** `build` 的上限，s */
  buildMax: number
  /** `perch` 的上限，s。到期強制 `dive` */
  perchMax: number
  /** 接近率轉負後多久算通過，s */
  passSeconds: number
  /** `dive` 的上限，s。沒打到也要拉起 */
  diveMax: number
  /** `zoom` 的下限，s */
  zoomMin: number
  /** `zoom` 的上限，s */
  zoomMax: number
  /** 一般冷卻，s */
  cooldownSeconds: number
  /** 長冷卻，s。連續幾輪打不到時用 */
  longCooldownSeconds: number
  /** 單輪 `energyRatio` 淨損失的上限 */
  cycleLossMax: number
  /** 連續幾輪沒有射擊窗就長冷卻 */
  dryRounds: number
  /** `perch` 盤旋時保持的距離，m */
  perchRange: number
}

/**
 * 【`pressureRange` 為什麼不在這裡】任務壓力由 `battle` 層算一次寫進
 * `TargetBoard.pressure`，而那一層拿不到每架自己的 `TacticalConfig`。它以
 * `PRESSURE_RANGE` 的形式住在 `target.ts`，兩邊讀的就是同一個值。
 */

/**
 * **全部是起始值，待掃描。** 掃描的優先序：
 *
 *   1. `quota`（0 / 0.5 / 1）—— 它同時是消融的對照組
 *   2. `buildMax` 與 `perchEnter` —— 一起決定「循環跑不跑得完一輪」
 *   3. `commitSeconds` 與 `perchMax` —— 「等太久」與「出手太早」的平衡
 *
 * `enterRange` / `exitRange` **不掃** —— 沿用指揮層的 `FLANK_RANGE` 與
 * `focusRange`，動它等於發明第二套幾何。
 */
export const DEFAULT_TACTICS: TacticalConfig = {
  // 【開發期間出 0】戰術層一開就會改變 `order-of-battle-replay` 的 digest，
  // 而那個基準每重跑一次都要專案負責人裁定。出 0 的話整個開發期間那條測試
  // 都是綠的，所有參數定案後才翻開，只需要重跑一次。
  //
  // 消融與整合測試自己注入 `quota`，不受這個預設影響。
  quota: 0,
  // 【與指揮層共用同一對】側翼命令的 `FLANK_RANGE` 與集火的 `focusRange`。
  // 免費得到遲滯，也不發明第二套幾何
  enterRange: 2500,
  exitRange: 1500,
  // 【0.50 的來源】要俯衝到比 P-51 快一成，109 需要約 630 m 的高度盈餘；
  // 109 在 6000 m 的角落速度取 160 m/s，能量尺標 160² / 19.61 ≈ 1305 m，
  // 630 / 1305 ≈ 0.48。**只用了一種配對與一個高度**，而且假設高度可以無損
  // 換成速度、沒有計入進場轉向的耗能，所以它是量級合理的起點不是通用值
  perchEnter: 0.5,
  perchExit: 0.35,
  minDwell: 0.5,
  commitSeconds: 1.5,
  // 【待實測回填】用自己的爬升率推相對建能時間會系統性低估 —— 高度與速度是
  // 同一份比能量的分配，而且敵人同時也在累積能量。正確的量是
  // `d(energyRatio)/dt = (psSelf − psTarget) / (vc² / 2 G0)`
  buildMax: 60,
  perchMax: 20,
  passSeconds: 1,
  diveMax: 12,
  zoomMin: 4,
  zoomMax: 15,
  cooldownSeconds: 12,
  longCooldownSeconds: 30,
  cycleLossMax: 0.3,
  dryRounds: 2,
  perchRange: 2000,
}

export function createTacticalState(): TacticalState {
  return {
    phase: 'off',
    dwell: 0,
    perchLatch: false,
    farLatch: false,
    commit: 0,
    closed: false,
    passing: 0,
    cooldown: 0,
    cycleBase: 0,
    cycleValid: false,
    cycleShot: false,
    dryRounds: 0,
    lastCooldownRatio: NaN,
    lastTarget: -2,
  }
}

/**
 * 就地重置。**`resetBattle` 每一顆 `AiController` 呼叫一次。**
 *
 * 【為什麼需要它】`resetBattle` 保留絕大多數既有的 `AiController` 實體，只
 * 重建曾被玩家接手過的那幾顆。少了這一段，相位、計時、輪次、冷卻與上一個
 * 目標會跨場殘留 —— 第二場的第一秒就會有幾架飛機從別人的 `perch` 中途開始。
 */
export function resetTacticalState(s: TacticalState): void {
  s.phase = 'off'
  s.dwell = 0
  s.perchLatch = false
  s.farLatch = false
  s.commit = 0
  s.closed = false
  s.passing = 0
  s.cooldown = 0
  s.cycleBase = 0
  s.cycleValid = false
  s.cycleShot = false
  s.dryRounds = 0
  s.lastCooldownRatio = NaN
  s.lastTarget = -2
}

/**
 * 我是我方第幾架。**−1 = 索引無效。**
 *
 * 【為什麼不用全域的 `selfIndex`】編組表是一隊一個連續區塊（`order.ts` 先推
 * 藍隊的全部小隊、再推紅隊），而 `world.add` 照那個順序給索引。用全域索引的
 * 話低差異序列會在兩個區塊上取到不同的比例：`quota = 0.5` 時 6v6 是藍 4
 * 紅 2、14v14 是藍 8 紅 6、20v20 是藍 10 紅 11。**偏差的方向與大小都隨編制
 * 變，而且沒有任何測試會紅** —— 它會直接變成平衡偏差。改用隊內序號之後兩隊
 * 拿到完全相同的序列。
 *
 * 【成本】`selfIndex` 在一場之內不變，所以呼叫端算一次快取起來就夠。
 */
export function teamIndexOf(board: TargetBoard, selfIndex: number): number {
  if (selfIndex < 0 || selfIndex >= board.candidates.length) return -1
  const team = board.candidates[selfIndex]!.team
  let n = 0
  for (let i = 0; i < selfIndex; i++) {
    if (board.candidates[i]!.team === team) n++
  }
  return n
}

/**
 * 低差異序列的乘子。與砲塔點放的 √3 / (1+√2) 互為無理數比 —— 三個乘子若不是
 * 這個關係，錯開的三件事會縮成一件。
 */
const GOLDEN = 0.6180339887498949

/**
 * 這架飛機有沒有戰術層的名額。
 *
 * 固定分配、零協調、**逐位元重播友善**、熱路徑零配置。副作用是史實的：一場
 * 裡有些人打 boom and zoom、有些人纏鬥。
 *
 * 【為什麼不做動態名額】「同時最多 N 架在 build」需要跨機協調，而協調要嘛走
 * 指揮層，要嘛在戰機端維護一個必須每步同步的全域計數 —— 後者會產生一個永遠
 * 不消失的幽靈狀態。
 *
 * 【`teamIndex < 0` 必須擋掉】JavaScript 的負數取模仍是負數，
 * `(−1 × 0.618) % 1 = −0.618`，而 `−0.618 < 0.5` 為真 —— 沒有接指派板的
 * 單元測試會意外啟用戰術層。
 */
export function hasSlot(teamIndex: number, quota: number): boolean {
  if (teamIndex < 0 || quota <= 0) return false
  if (quota >= 1) return true
  return ((teamIndex * GOLDEN) % 1) < quota
}
