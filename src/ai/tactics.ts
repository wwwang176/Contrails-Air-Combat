import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { latch } from './rules'
import { DEFAULT_STEER, shrinkTowardNose, unloadPull } from './steer'
import type { Situation } from './assess'
import type { EngageBasis } from './steer'
import type { TargetBoard } from './target'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'

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
  /**
   * 本輪的蓄能已經跑滿期限：能量門檻對這一輪免除。
   *
   * 【為什麼不能用 `perchLatch` 代替】那個閂鎖每一拍由
   * `latch(perchLatch, energyRatio, perchEnter, perchExit)` 重算。把它設成
   * true，`energyRatio` 低於 `perchExit` 的下一拍就被打回 false。這一格的
   * 生命週期綁在**一輪**上，不綁在能量上。
   *
   * 【壞掉會怎樣，而且不會報錯】少了它，撞期限進 `perch` 的飛機會因為
   * `perchLatch` 為 false 立刻被彈回 `build`，再撞一次期限，再彈回來 ——
   * build ↔ perch 乒乓，`dive` 永遠不會發生。實測 4v4：`dive` 0 次。
   */
  settled: boolean
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
  /**
   * 繞行的邊，+1 或 −1；**0 = 還沒選。**
   *
   * 【為什麼要記住它】水平面上「切向」只有兩個選擇，而**沒有任何連續的方式
   * 從幾何決定要繞哪一邊** —— 那是一個拓撲上的事實，不是實作沒寫好。任何
   * 由當下幾何導出的側向都會在某條線上翻號：由航向導出的會在「機首正對
   * 目標」翻，由距離導出的會在 `perchRange` 上翻。
   *
   * 專案對翻轉點的答案一向是**給它記憶**（`rules.ts` 的 `latch`）。進入
   * 站位保持時選一次邊，之後就一直繞同一邊，於是兩個自由度上都連續。
   */
  orbitSide: number
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
  // 而那個基準每重跑一次都要負責人重新定值。出 0 的話整個開發期間那條測試
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
  // 【它是節奏，不是止損】撞到期限時相位去 `perch`（帶著手上的能量去打），
  // 所以這個值決定的是「花多久蓄能」。實測 `energyRatio` 的累積速率
  // 0.0057 /s，由進場的 0.16 爬到 `perchEnter` 0.5 需要約 60 秒 —— 勢均力敵
  // 的遭遇戰裡沒有人蓄得滿，所以這個值一定會咬到。
  //
  // 【20 的來源是掃描】13 / 20 / 30 / 45 各跑一次 f4f4 vs a6m5 20v20：
  // 進入 `dive` 時的高度優勢中位是 233 / 396 / 409 / 462 m，射擊解佔時是
  // 4.5 / 4.3 / 1.6 / 3.7%。取 20 —— 高度優勢過 300 m，射擊解沒有代價。
  //
  // 【訂太大會怎樣】飛機長時間爬升不參戰。45 那一檔有 20.9% 的時間在
  // `build`，一分鐘裡有十二秒不在打人。
  buildMax: 20,
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
    settled: false,
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
    orbitSide: 0,
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
  s.settled = false
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
  s.orbitSide = 0
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

/**
 * `stepTactics` 的輸入。**呼叫端每步就地重填，不配置。**
 *
 * 【為什麼是一個結構而不是九個參數】九個參數的呼叫端沒有人看得懂順序，而且
 * 加一個量就要改所有測試的呼叫。與 `command.ts` 的 `CommandUnit` 同一手法。
 */
export interface TacticalInput {
  /** 有名額（`hasSlot` 的結果）。`selfIndex < 0` 時呼叫端給 `false` */
  slot: boolean
  /**
   * 徵召：這架飛機沒有別的打法可選（機體迴旋明顯吃虧）。
   *
   * 【與 `slot` 的分工】`slot` 是「有名額」—— 一個與機種無關的抽籤，用來
   * 控制有多少架**轉得贏的**飛機也去打能量戰。`mandatory` 是「非這樣不
   * 可」，它不佔名額也不受名額限制。
   *
   * 【它豁免哪兩道門】入場的距離門檻與再進入條件（見 `stepTactics` 的
   * `off → build`）。那兩道門的前提都是「這架飛機還有別的事可做」；對
   * 徵召者不成立，它們會從節流變成永久關門。
   */
  mandatory: boolean
  /** 有命令（rally / flank / focus）或 `transit` */
  suspended: boolean
  /** 目標的識別。−1 = 沒有目標 */
  targetIndex: number
  /** 兩機距離，m */
  range: number
  energyRatio: number
  /** 他的比超量功率。負 = 他在耗能量 */
  psTarget: number
  /** 接近率，m/s。正 = 正在接近 */
  closureRate: number
  /** 我打得到他的瞬時程度，0..1 */
  shotInstant: number
  /** 我方的被保護單位正在挨打 */
  pressure: boolean
}

/** 換相位：重設計時，其餘不動 */
function enter(s: TacticalState, phase: TacticalPhase): void {
  s.phase = phase
  s.dwell = 0
}

/**
 * 清掉所有「相對當前目標、而且是差分或計時」的量。
 *
 * 【誰會用到它】兩個情境，而它們是同一件事：**這些量在中斷期間的累積是假的**。
 *
 * ```
 *   換目標   energyRatio / psTarget / closureRate 全部換了參考對象
 *   強制離場 沒名額、有命令、transit、目標消失 —— 期間根本沒有在經營
 * ```
 *
 * 具體的誤判：命令下達前累積了 1.4 秒的 `psTarget < 0`，命令期間相位是
 * `off` 但計量原封不動，命令一解除**第一拍**就變成 1.5 秒而立刻俯衝。
 * 「連續承諾 1.5 秒」於是是假的。換目標那一版的誤判形狀完全相同。
 *
 * 【`farLatch` 不在這裡】它問的是「我離這個目標多遠」，是一個瞬時量的閂鎖，
 * 不是差分也不是計時。強制離場另外清它（那是「離場就重新來過」的意思）。
 */
function clearRelative(s: TacticalState, energyRatio: number): void {
  s.perchLatch = false
  s.commit = 0
  s.closed = false
  s.passing = 0
  // 【基準重設成當下，而且該輪標記為無效】只設 `cycleValid` 的話基準還停在
  // 舊的尺度上，下一輪開帳前的每一格都在跟一個沒有意義的數字比
  s.cycleBase = energyRatio
  s.cycleValid = false
  s.cycleShot = false
  s.lastCooldownRatio = NaN
  // 【`settled` 也是相對的】它免除的門檻是 `perchEnter`，而那個門檻拿
  // `energyRatio` 跟**當前目標**比。對前一個目標「已經盡力」不代表對新的
  // 也是 —— 留著它，換完目標的飛機會拿著對新目標毫無優勢的能量直接俯衝。
  s.settled = false
}

/** 開一輪新的能量帳 */
function openCycle(s: TacticalState, energyRatio: number): void {
  s.cycleBase = energyRatio
  s.cycleValid = true
  s.cycleShot = false
  // 【一輪一次】`settled` 說的是「本輪的蓄能已經盡力」。開新一輪就要重新
  // 爭取，否則第一次撞期限之後每一輪都免除門檻，等於門檻不存在。
  s.settled = false
}

/** 進 `cooldown`，並記下這次是在什麼能量下放棄的 */
function goCooldown(s: TacticalState, energyRatio: number, seconds: number): void {
  s.lastCooldownRatio = energyRatio
  s.cooldown = seconds
  enter(s, 'cooldown')
}

/**
 * 推進一架飛機的戰術狀態。**純函數（就地改寫 `s`），熱路徑不配置。**
 *
 * 【轉移的優先序】同一拍可能有多條成立，順序不同會產生不同的戰術：
 *
 * ```
 *   1. 強制離場   沒名額／有命令／目標消失            → off
 *   2. 絕對止損   建能期限、能量帳                    → cooldown
 *   3. 任務壓力                                       → dive
 *   4. 期限出口   perchMax → dive、diveMax → zoom …
 *   5. 條件轉移   perchLatch、承諾姿態、通過判定
 * ```
 *
 * 三個實際的後果：`build` 同時達到 `perchEnter` 與建能期限時 **cooldown 贏**
 * （期限到了表示這一輪的建能不健康，帶著它進 `perch` 只是把問題延後）；
 * `perch` 同時要 `dive` 與要回 `build` 時 **dive 贏**（承諾姿態稍縱即逝，
 * 能量掉一點還打得到）；`cooldown` 倒數歸零一律先回 `off` 停一拍。
 *
 * 【呼叫頻率是 10 Hz】相位是決策層級的事。每個物理步呼叫一次等於讓它以
 * 240 Hz 仲裁，而所有期限都是秒級的。
 */
export function stepTactics(
  s: TacticalState, inp: TacticalInput, dt: number, cfg: TacticalConfig,
): void {
  // ── 目標切換：逐欄重置計量，相位不動 ──────────────────
  //
  // 【為什麼必須做】`energyRatio`、`psTarget`、`closureRate` 全部是**相對
  // 當前目標**的。目標一換它們不連續地跳，而下面每一個都是差分或計時。
  // 具體的誤判：換目標前累積 1.4 秒的 `psTarget < 0`，新目標第一拍也是負
  // 值，於是 0.1 秒後就誤判「已持續承諾 1.5 秒」而俯衝。
  const switched = inp.targetIndex !== s.lastTarget
  if (switched) {
    s.lastTarget = inp.targetIndex
    clearRelative(s, inp.energyRatio)
  }

  s.dwell += dt
  if (s.cooldown > 0) s.cooldown -= dt

  // ── 第 1 級：強制離場 ────────────────────────────────
  //
  // 【計量要一起清】相位切到 `off` 但計量留著，等於讓命令期間的空白時間
  // 「算數」—— 解除的第一拍就會拿一組幾秒前的累積去觸發轉移。見
  // `clearRelative`。
  if (!inp.slot || inp.suspended || inp.targetIndex < 0) {
    if (s.phase !== 'off') enter(s, 'off')
    clearRelative(s, inp.energyRatio)
    s.farLatch = false
    return
  }

  // 【換目標的那一拍整拍讓過】所有的閂鎖與計時剛剛才被清空，而**相位轉移
  // 讀的就是它們**：`perchLatch` 清成 false 之後若同一拍跑轉移邏輯，
  // `perch` 會立刻被踢回 `build` —— 那等於「相位不重置」這條規則被自己的
  // 重置動作推翻。下一拍用新目標的數字重新算，一切照常。
  if (switched) {
    // 【但射擊窗不能丟】`cycleShot` 剛被清成 false，而這一拍若真的有射擊解，
    // 那是**新目標**的第一筆。丟掉它會讓一輪被誤判成空手而回，`dryRounds`
    // 因此少清一次
    if (inp.shotInstant > 0) s.cycleShot = true
    return
  }

  // ── 全程維護的閂鎖與計時（不論在哪一個相位）──────────
  //
  // 【為什麼全程】`latch` 的語意是一段獨立的記憶。`rules.ts` 的 `stepRules`
  // 每拍更新所有閂鎖，即使那一拍沒有選到那個意圖。
  s.perchLatch = latch(s.perchLatch, inp.energyRatio, cfg.perchEnter, cfg.perchExit)
  s.farLatch = latch(s.farLatch, inp.range, cfg.enterRange, cfg.exitRange)
  s.commit = inp.psTarget < 0 ? s.commit + dt : 0
  if (inp.shotInstant > 0) s.cycleShot = true
  // 【通過的判定要「轉負」不是「非正」】接近率恰好為 0 是切向飛行，那不是
  // 「正在拉開」
  if (inp.closureRate > 0) { s.closed = true; s.passing = 0 }
  else if (s.closed && inp.closureRate < 0) s.passing += dt

  // ── cooldown 自己的出口 ───────────────────────────────
  if (s.phase === 'cooldown') {
    if (s.cooldown <= 0) enter(s, 'off')
    return
  }

  // ── off → build ──────────────────────────────────────
  if (s.phase === 'off') {
    // 【冷卻沒走完就不准重進】強制離場（第 1 級）把相位直接設成 `off`，
    // 冷卻的**剩餘時間**卻還在倒數。少了這一行，冷卻期間收到命令、進
    // transit 或短暫失去目標，中斷一解除就重進 `build` —— 止損等於沒有。
    // 徵召者不豁免這一條：它是時間，會自己走完，不會變成永久關門。
    if (s.cooldown > 0) return
    // 【徵召者不看距離】這道門的意思是「還不必急著蓄能」，前提是這架飛機
    // 有別的打法可選。徵召者沒有 —— 對它，門外就是那個它打不贏的盤旋戰。
    if (!inp.mandatory && !s.farLatch) return
    // 【再進入條件】同一個目標、同樣打不動的能量，不會一直重試。少了它，
    // `build → cooldown → off → 立刻 build → …` 會永遠繞下去，正好把原問題
    // 換成另一種永久循環
    //
    // 【徵召者豁免】「不再重試」對它等於永久失效，而它沒有別的打法可以
    // 退回去。節流改由 `cooldownSeconds` 與 `longCooldownSeconds` 承擔 ——
    // 那兩個是時間，會自己走完。
    const fresh = Number.isNaN(s.lastCooldownRatio)
      || inp.energyRatio > s.lastCooldownRatio
    if (!inp.mandatory && !fresh) return
    enter(s, 'build')
    openCycle(s, inp.energyRatio)
    return
  }

  // ── 第 2 級：絕對止損 ────────────────────────────────
  // 【撞期限不是放棄這一輪】蓄能是盡力而為：跑滿期限代表「這就是我拿得到
  // 的能量」，那就帶著它去等機會。實測 `energyRatio` 的累積速率 0.0057 /s，
  // 由進場的 0.16 爬到 `perchEnter` 0.5 需要約 60 秒 —— 而 60 秒不可能不被
  // `defend`、命令或丟失目標打斷。要求「蓄滿才准打」等於永遠不准打。
  if (s.phase === 'build' && s.dwell >= cfg.buildMax) {
    s.settled = true
    enter(s, 'perch')
    return
  }
  if (s.cycleValid && inp.energyRatio - s.cycleBase < -cfg.cycleLossMax) {
    goCooldown(s, inp.energyRatio, cfg.cooldownSeconds)
    return
  }

  // ── 第 3、4 級：任務壓力與期限出口 ────────────────────
  if (s.phase === 'perch' && (inp.pressure || s.dwell >= cfg.perchMax)) {
    enter(s, 'dive')
    return
  }
  if (s.phase === 'dive' && s.dwell >= cfg.diveMax) {
    enter(s, 'zoom')
    return
  }

  if (s.dwell < cfg.minDwell) return

  // ── 第 5 級：條件轉移 ────────────────────────────────
  switch (s.phase) {
    case 'build':
      if (s.perchLatch) enter(s, 'perch')
      break
    case 'perch':
      if (s.commit >= cfg.commitSeconds) enter(s, 'dive')
      // 【`settled` 擋掉彈回】撞期限進來的飛機定義上 `perchLatch` 就是
      // false，少了這個條件它會立刻被彈回 `build` 形成乒乓。
      else if (!s.perchLatch && !s.settled) {
        // 【回 build 也要開新帳】一輪的定義是「進入 build 到下一次進入
        // build」。少了這一行，`cycleBase` 會跨過好幾次 perch → build，
        // 能量帳比的就不是本輪
        enter(s, 'build')
        openCycle(s, inp.energyRatio)
      }
      break
    case 'dive':
      if (s.passing >= cfg.passSeconds) enter(s, 'zoom')
      break
    case 'zoom': {
      // 【zoomMin 是拉起的最短時間】少了它，`zoom` 只會待 `minDwell`（0.5 s）
      // 就走，整個循環會在一秒半內轉完一圈 —— 那不是 boom and zoom，是抖動。
      if (s.dwell < cfg.zoomMin) break
      // 【zoom 的唯一出口是 build，不能直接跳 perch】直接跳的話會形成
      //     build → perch → dive → zoom → perch → dive → zoom → …
      // 永遠不回 build，於是輪次永遠不結算、`dryRounds` 永遠不累積，整條
      // 能量帳止損等於不存在。回 build 之後若能量還在，下一格的 `perchLatch`
      // 會自然把它帶回 perch —— 那才是兩步的路徑。
      if (!s.perchLatch && s.dwell < cfg.zoomMax) break
      // 一輪結束：結算能量帳
      if (s.cycleValid && !s.cycleShot) s.dryRounds++
      else if (s.cycleShot) s.dryRounds = 0
      if (s.dryRounds >= cfg.dryRounds) {
        s.dryRounds = 0
        goCooldown(s, inp.energyRatio, cfg.longCooldownSeconds)
        break
      }
      enter(s, 'build')
      openCycle(s, inp.energyRatio)
      break
    }
    default:
      break
  }
}

const T = makeScratch(4)
const FWD = new Vector3(0, 0, -1)

/** `build` 的最大爬升角，rad。與 `EXTEND_PITCH` 同級 */
const BUILD_PITCH = 20 * (Math.PI / 180)
/** `zoom` 的爬升角，rad。比 `build` 陡 —— 它在花掉剛換到的速度 */
const ZOOM_PITCH = 35 * (Math.PI / 180)

/** 取一個永遠有定義的水平航向：自己的機首投影到水平面 */
function selfHeading(self: Aircraft, out: Vector3): void {
  out.copy(FWD).applyQuaternion(self.state.orientation)
  out.y = 0
  if (out.lengthSq() < 1e-6) out.set(0, 0, -1)
  out.normalize()
}

/**
 * 站位保持：把 `flat`（由我指向目標的水平方向）改寫成「往 `perchRange` 靠」
 * 的水平指令。**`build` 與 `perch` 共用同一條律。**
 *
 * ```
 *   誤差 = (range − perchRange) / perchRange，夾在 ±1
 *   +1  太遠 → 全力靠近
 *    0  剛好 → 純切向繞行
 *   −1  太近 → 全力遠離
 * ```
 *
 * 【它擋的是兩件事】
 *
 * 一、**門檻式的翻號**。寫成「距離小於 perchRange 就轉開」會在門檻上翻：
 * 飛離 → 距離變大 → 翻號 → 飛近 → 距離變小 → 翻號。振幅由飛機的響應決定，
 * 不由任何設計參數決定 —— 那是專案在 1000 m 線上震盪 40 秒那次的同型錯誤，
 * 見 `extendPitchAngle` 的註解。
 *
 * 二、**無界的後退**。`build` 一律取反（`flat.negate()`）的話，離場就只有
 * 能量出口、沒有距離出口。實測（`tactics-ablation.probe.ts`）：掃蕩卡上只要
 * **3 架**進過 `build`，全場戰鬥機與目標的距離中位就由 734 m 變成 12 301 m、
 * 射擊解由 5.5% 掉到 0.0% —— 跑掉的人會把鎖定它們的人一起帶出去。**建能是
 * 爬升，不是拉開距離**；水平方向該做的事與 `perch` 完全一樣。
 *
 * 【切向為什麼是閂鎖而不是算出來的】水平面上的切向只有 ±1 兩個選擇，沒有
 * 連續的選法。由航向投影導出並正規化的版本，在同一條視線、
 * `range === perchRange` 上，yaw +0.0009 rad 給 `+X`、+0.0011 rad 給 `−X`
 * —— 差 0.011° 而水平指令翻半圈；不正規化則把翻轉點搬到 `perchRange` 上
 * （徑向穿零時整個向量穿零）。兩個都是翻。見 `TacticalState.orbitSide`。
 */
function stationKeeping(
  st: TacticalState, range: number, self: Aircraft, cfg: TacticalConfig,
  flat: Vector3, tan: Vector3,
): void {
  const err = (range - cfg.perchRange) / cfg.perchRange
  const radial = err < -1 ? -1 : err > 1 ? 1 : err

  // 切向取**視線的水平法向**（與航向無關，所以不會隨機首擺動而變），繞哪
  // 一邊由 `orbitSide` 記住。見那個欄位的註解 —— 「連續地從幾何選邊」不存在。
  tan.set(-flat.z, 0, flat.x).normalize()
  if (st.orbitSide === 0) {
    // 第一次：往當前航向比較順的那一邊繞，少轉一點
    const head = T.v[3]!
    selfHeading(self, head)
    st.orbitSide = head.dot(tan) >= 0 ? 1 : -1
  }
  tan.multiplyScalar(st.orbitSide)

  const w = radial < 0 ? -radial : radial
  flat.multiplyScalar(radial).addScaledVector(tan, 1 - w)
  // 【不會退化】兩項正交，模長是 √(radial² + (1−|radial|)²) ≥ √2/2
  flat.normalize()
}

/**
 * `build` / `perch` / `zoom` 的矄準解。**`dive` 與 `cooldown` 不走這裡**
 * ——它們覆寫既有的意圖（`engage` 與 `extend`），不需要新的轉向邏輯。
 *
 * 【為什麼不做成 `steerCommand` 尾端的偏置】那個位階已經有一個
 * `sweetPitch`，它會繞過 `pullCeiling`、抵消 `speedRecover`、疊在破防軸上。
 * 再加一個同位階的後處理器會讓那個問題更嚴重。戰術相位要成為**主要**的
 * 矄準解。
 *
 * 【四個欄位每次都要寫】`out` 是呼叫端重用的物件。
 *
 * 熱路徑：不配置。
 */
export function tacticalCommand(
  st: TacticalState,
  sit: Situation,
  basis: EngageBasis,
  self: Aircraft,
  seaHeight: number,
  cfg: TacticalConfig,
  out: Command,
): void {
  const aim = T.v[0]!
  const flat = T.v[1]!

  // 水平方向：由視線導出，各相位取不同的號
  flat.copy(basis.losAxis)
  flat.y = 0
  if (flat.lengthSq() < 1e-6) selfHeading(self, flat)
  else flat.normalize()

  let pitch = 0
  switch (st.phase) {
    case 'build': {
      // 【爬升角隨赤字連續變化】與 `extendPitchAngle` 同構 —— 差得越多爬
      // 得越陡，接近門檻時自然收斂，不會在門檻上翻號
      const deficit = cfg.perchEnter - sit.energyRatio
      const k = deficit <= 0 ? 0 : deficit >= cfg.perchEnter ? 1 : deficit / cfg.perchEnter
      pitch = BUILD_PITCH * k
      // 【水平方向與 perch 同一條律】建能是爬升，不是拉開距離。見
      // `stationKeeping` 的第二段註解
      stationKeeping(st, sit.range, self, cfg, flat, T.v[2]!)
      break
    }
    case 'perch':
      // 保持能量（平飛）與距離
      pitch = 0
      stationKeeping(st, sit.range, self, cfg, flat, T.v[2]!)
      break
    case 'zoom':
      // 【維持當前航向】轉彎會把剛換到的速度花掉
      pitch = ZOOM_PITCH
      selfHeading(self, flat)
      break
    default:
      // 【`off` / `dive` / `cooldown` 不該走到這裡】呼叫端已經分流。
      // 給一個永遠有定義的方向，不要留下上一格的值
      selfHeading(self, flat)
      break
  }

  const c = Math.cos(pitch)
  aim.set(flat.x * c, Math.sin(pitch), flat.z * c).normalize()

  // 【離地底限】低空不能用高度換速度，這一層與 `extendPitchAngle` 的高度項
  // 是同一個安全關切
  const clearance = self.state.position.y - seaHeight
  if (clearance < DEFAULT_STEER.clearanceScale && aim.y < 0) {
    aim.y = 0
    if (aim.lengthSq() < 1e-6) aim.copy(flat)
    aim.normalize()
  }

  out.aimWorld.copy(aim)

  // 【拉桿紀律取兩層的較小值】`unloadPull` 防的是失速（迎角太大），
  // `pullCeiling` 防的是能量見底（速度太低）。誰先擋住算誰的
  const unload = unloadPull(sit.stallMargin, DEFAULT_STEER)
  const ceiling = unload < sit.pullCeiling ? unload : sit.pullCeiling
  shrinkTowardNose(self, ceiling, out.aimWorld)

  // 【四個欄位都要寫】見函數註解
  out.throttle = 1.1
  out.brake = 0
  out.firing = false
}
