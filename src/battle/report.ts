/**
 * # 戰果通報
 *
 * 玩家自己打出來的戰果，一行一則，新的在最上面、舊的往下擠。
 *
 * 【為什麼只報玩家自己的】這不是「誰殺了誰」的戰報流。敵機的血量刻意不
 * 顯示（`types.ts` 的 `hp` 那一段），而一張列著全場人名與擊殺的表是同一
 * 類的上帝視角資訊。這裡回答的只有一個問題：**剛剛那下算我的嗎**。
 * 800 m 外的火球，自己打下來的與隊友打下來的長得一模一樣。
 *
 * 【為什麼堆疊而不是覆蓋】覆蓋的話連下兩架時第一行只閃三分之一秒就被
 * 換掉，讀起來像畫面在抖而不是像戰果。
 *
 * 【為什麼同一種不併成一行加計數】`×3` 讀起來是一個數字，而三行是三件事
 * —— 打中多個的感覺來自看到它們一條一條長出來。
 *
 * 【為什麼要有出場佇列】一顆炸彈在**同一個物理步**裡能炸掉一整排，直接推
 * 的話五條字會在同一幀一起蹦出來，讀起來是一塊招牌而不是五件事。進佇列
 * 之後每 0.3 秒放一條，那個節奏本身就是「打中了好多個」。
 */
import type { MessageKey } from '../i18n'

/**
 * 一則通報的種類。**動詞跟著它走，不做標題** —— 一波之內完全可能混到
 * 好幾種（掃下一架，兩秒後炸掉油槽），共用標題就會說謊。
 */
export type ReportKind = 'air' | 'ship' | 'ground' | 'torpedo'

/** 名稱的鍵沒有意義時的佔位（池裡還沒用到的格子） */
const NO_NAME: MessageKey = 'name.aircraft.p51d'

export interface ReportLine {
  kind: ReportKind
  /**
   * 顯示名的鍵：機種、艦級或地面單位。**存鍵不存文字** —— 畫的時候才查，語言切換時
   * 已經在畫面上的那幾行跟著換
   */
  nameKey: MessageKey
  /** 這一行出現的時間，s。打字機、壽命與淡出都讀它 */
  bornAt: number
  /**
   * 這一行上一次**往下移動一格**的時間，s。滑移動畫讀它。
   *
   * 【新長出來的那一行設成已經滑完】它是出現，不是移動 —— 不設的話新的
   * 一行會從上一格掉下來，而它上面就是節拍預警那一帶。
   */
  shiftedAt: number
}

export interface BattleReport {
  /** 固定長度的池。只有前 `count` 行有效，索引 0 是最新的 */
  readonly lines: readonly ReportLine[]
  count: number
  /**
   * 還沒出場的戰果。環狀佇列，先進先出。
   *
   * 【為什麼是兩個平行陣列而不是一個物件陣列】物件陣列要嘛每次入列配置一
   * 個物件，要嘛也是逐欄搬 —— 而入列發生在物理步裡。
   */
  readonly queueKind: ReportKind[]
  readonly queueNameKey: MessageKey[]
  queueHead: number
  queueCount: number
  /**
   * 下一條最早可以在什麼時候出場，s。
   *
   * 【初值 −Infinity】第一則不該等 —— 打下來的那一刻就要看到字，等 0.3 秒
   * 的回饋讀起來像延遲。
   */
  nextAt: number
}

/** 一行的壽命，s。 */
export const REPORT_LINE_SECONDS = 3

/**
 * 往下擠一格要滑多久，s。
 *
 * 【為什麼不是 0】瞬間跳格時，正在讀的那一行會在眼睛底下閃一下位置，
 * 讀起來像畫面抖了而不是像「被推下去」。
 *
 * 【為什麼這麼短】它是次要動作 —— 主角是新出現的那一行。滑得比打字慢的話
 * 眼睛會跟著往下走，正好背離要看的地方。
 */
export const REPORT_SLIDE = 0.12

/**
 * 同時最多幾行。
 *
 * 【5 怎麼來】錨點在畫面 0.62，一行約佔 0.022 —— 五行的底緣落在 0.73，
 * 而儀表與小地圖在 0.8 之下。再多就疊到它們了。
 */
export const REPORT_MAX_LINES = 5

/**
 * 兩條之間的間隔，s。
 *
 * 【0.3 怎麼來】`擊墜　Bf 109 K-4` 十六個字在 0.02 s/字 下要 0.32 秒打完
 * —— 間隔比它短的話，下一條會壓在上一條還沒打完的時候出現，整疊字同時
 * 在動。取一個剛好「上一條印完、下一條接上」的節奏。
 */
export const REPORT_RELEASE_INTERVAL = 0.3

/**
 * 佇列容量。
 *
 * 【16 怎麼來】最大的一次是一顆炸彈落在洛伊納的廠區裡，`applyBombBlast`
 * 在同一個物理步掃完所有地面目標 —— 實際炸得掉的是個位數。16 是它的兩倍
 * 有餘，而排滿 16 條要放 4.8 秒。
 *
 * 【滿了丟掉新的而不是擠掉舊的】擠掉舊的會讓已經發生的戰果永遠不出場，
 * 而玩家是照發生順序在等它們。
 */
export const REPORT_QUEUE_CAPACITY = 16

function createLine(): ReportLine {
  return { kind: 'air', nameKey: NO_NAME, bornAt: 0, shiftedAt: 0 }
}

export function createBattleReport(): BattleReport {
  const lines: ReportLine[] = []
  for (let i = 0; i < REPORT_MAX_LINES; i++) lines.push(createLine())
  return {
    lines,
    count: 0,
    queueKind: new Array<ReportKind>(REPORT_QUEUE_CAPACITY).fill('air'),
    queueNameKey: new Array<MessageKey>(REPORT_QUEUE_CAPACITY).fill(NO_NAME),
    queueHead: 0,
    queueCount: 0,
    nextAt: -Infinity,
  }
}

/** 清空。重開一場用 —— 上一場的字與還沒出場的戰果都不該跟過來。 */
export function resetBattleReport(b: BattleReport): void {
  b.count = 0
  b.queueHead = 0
  b.queueCount = 0
  b.nextAt = -Infinity
}

/** 逐欄搬，不搬參考；池裡的物件從頭到尾是同一批。 */
function copyLine(dst: ReportLine, src: ReportLine): void {
  dst.kind = src.kind
  dst.nameKey = src.nameKey
  dst.bornAt = src.bornAt
  dst.shiftedAt = src.shiftedAt
}

/**
 * 把一則戰果排進出場佇列。**一筆一行，同種也不合併。**
 *
 * 出場由 `stepBattleReport` 依 `REPORT_RELEASE_INTERVAL` 放行 —— 這裡不碰
 * 畫面上的那幾行。
 *
 * 熱路徑：不配置。`drainReports` 在物理步裡呼叫它，而一幀可能跑好幾步。
 */
export function queueReport(b: BattleReport, kind: ReportKind, nameKey: MessageKey): void {
  if (b.queueCount >= REPORT_QUEUE_CAPACITY) return
  const i = (b.queueHead + b.queueCount) % REPORT_QUEUE_CAPACITY
  b.queueKind[i] = kind
  b.queueNameKey[i] = nameKey
  b.queueCount++
}

/** 佇列最前面那一則出場。呼叫端保證佇列非空。 */
function release(b: BattleReport, now: number): void {
  const lines = b.lines
  // 【從下往上搬】反過來的話每一格都會被上一格的新值蓋掉
  for (let i = Math.min(b.count, REPORT_MAX_LINES - 1); i > 0; i--) {
    copyLine(lines[i]!, lines[i - 1]!)
    // 【搬完才蓋】`copyLine` 連 `shiftedAt` 一起抄，所以要在它之後寫
    lines[i]!.shiftedAt = now
  }
  const head = lines[0]!
  head.kind = b.queueKind[b.queueHead]!
  head.nameKey = b.queueNameKey[b.queueHead]!
  head.bornAt = now
  // 【最上面那一行沒有在移動】見 `shiftedAt` 的說明
  head.shiftedAt = now - REPORT_SLIDE
  if (b.count < REPORT_MAX_LINES) b.count++
  b.queueHead = (b.queueHead + 1) % REPORT_QUEUE_CAPACITY
  b.queueCount--
}

/**
 * 放行到期的那一則，並淘汰過期的行。
 *
 * 【一次只放一則】放到追上為止的話，佇列裡積著的會在同一幀全部蹦出來 ——
 * 那正是佇列要治的事。物理步是 240 Hz，「一步一則」對 0.3 秒的間隔而言
 * 密得綽綽有餘。
 *
 * 【為什麼淘汰不是只砍尾巴】`bornAt` 沿著池由新到舊遞減，所以過期的確實
 * 只會在尾端 —— 但那是一條靠 `release` 維持的不變式，而這裡是它唯一的
 * 消費者。就地壓縮不多花什麼，壞掉時也不會留下一個中間的空洞。
 */
export function stepBattleReport(b: BattleReport, now: number): void {
  if (b.queueCount > 0 && now >= b.nextAt) {
    release(b, now)
    b.nextAt = now + REPORT_RELEASE_INTERVAL
  }
  const lines = b.lines
  let w = 0
  for (let i = 0; i < b.count; i++) {
    const line = lines[i]!
    if (now - line.bornAt >= REPORT_LINE_SECONDS) continue
    if (w !== i) copyLine(lines[w]!, line)
    w++
  }
  b.count = w
}
