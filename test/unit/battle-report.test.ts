import { afterEach, describe, it, expect } from 'vitest'
import {
  REPORT_FADE, REPORT_LINE_SECONDS, REPORT_MAX_LINES, REPORT_QUEUE_CAPACITY,
  REPORT_RELEASE_INTERVAL, REPORT_SLIDE,
  createBattleReport, queueReport, reportAlpha, reportSlide, reportText,
  resetBattleReport, stepBattleReport, type BattleReport, type ReportKind,
} from '../../src/hud/battleReport'
import { GROUND_UNITS } from '../../src/render/geometry/ground'
import { aircraftNameKey, groundUnitNameKey, shipNameKey } from '../../src/i18n/names'
import { setLang, t, type MessageKey } from '../../src/i18n'

/**
 * 戰果通報的狀態機。
 *
 * 【為什麼這一層要有測試，畫的那一層沒有】canvas 在 node 環境驗不到，
 * 而會靜靜壞掉的性質全部在這裡：佇列的先後、過期的行不消失、擠掉的是新的
 * 那一行。症狀都只是「畫面上的字不對」，不會報錯。
 */

afterEach(() => setLang('zh'))

/** 從 `t0` 起推進 `seconds` 秒，步長與物理步同量級 */
function run(b: BattleReport, t0: number, seconds: number): number {
  const dt = 1 / 240
  let now = t0
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    now += dt
    stepBattleReport(b, now)
  }
  return now
}

const BF109 = aircraftNameKey('bf109k4')!
const TRUCK = groundUnitNameKey('truck')
const T34 = groundUnitNameKey('tank')
const FLETCHER = shipNameKey('fletcher')
const ESSEX = shipNameKey('essex')

/** 一串互不相同的名稱鍵，只拿來分辨是哪一則 */
const K: readonly MessageKey[] = GROUND_UNITS.map((u) => groundUnitNameKey(u.id))

const VERB: Record<ReportKind, MessageKey> = {
  air: 'report.air', ship: 'report.ship', ground: 'report.ground', torpedo: 'report.torpedo',
}
/** 這一則在目前語言該印出的整行 */
const line = (kind: ReportKind, name: MessageKey): string =>
  t('report.line', { verb: t(VERB[kind]), name: t(name) })

describe('戰果通報', () => {
  it('一筆通報長一行，動詞跟著種類走', () => {
    const b = createBattleReport()
    queueReport(b, 'air', BF109)
    stepBattleReport(b, 0)
    expect(b.count).toBe(1)
    expect(reportText(b.lines[0]!)).toBe(line('air', BF109))
  })

  /**
   * 第一則不該等 —— 打下來的那一刻就要看到字，等 0.3 秒的回饋讀起來像延遲。
   */
  it('佇列空著時進來的第一則立刻出場', () => {
    const b = createBattleReport()
    queueReport(b, 'air', BF109)
    stepBattleReport(b, 12.5)
    expect(b.count).toBe(1)
  })

  it('四種動詞各自不同', () => {
    const b = createBattleReport()
    queueReport(b, 'ground', TRUCK)
    queueReport(b, 'ship', FLETCHER)
    queueReport(b, 'torpedo', ESSEX)
    run(b, 0, 1)
    expect(reportText(b.lines[2]!)).toBe(line('ground', TRUCK))
    expect(reportText(b.lines[1]!)).toBe(line('ship', FLETCHER))
    expect(reportText(b.lines[0]!)).toBe(line('torpedo', ESSEX))
    const verbs = (Object.keys(VERB) as ReportKind[]).map((k) => t(VERB[k]))
    expect(new Set(verbs).size).toBe(4)
  })

  /**
   * 【為什麼同一種不併成一行加計數】`×3` 讀起來是一個數字，而三行是三件
   * 事 —— 打中多個的感覺來自看到它們一條一條長出來。
   */
  it('同種同名也各自長一行', () => {
    const b = createBattleReport()
    for (let i = 0; i < 3; i++) queueReport(b, 'ground', TRUCK)
    run(b, 0, 1)
    expect(b.count).toBe(3)
    for (let i = 0; i < 3; i++) {
      expect(reportText(b.lines[i]!)).toBe(line('ground', TRUCK))
    }
  })

  /**
   * 一顆炸彈在同一個物理步炸掉五個目標。直接推的話五條字會在同一幀一起
   * 蹦出來，讀起來是一塊招牌而不是五件事。
   */
  it('同一瞬間的五筆一條一條出場，每 0.3 秒一條', () => {
    const b = createBattleReport()
    for (let i = 0; i < 5; i++) queueReport(b, 'ground', K[i]!)
    stepBattleReport(b, 0)
    expect(b.count).toBe(1)
    expect(b.queueCount).toBe(4)

    // 【多跑一點點】步長是 1/240，累加到 0.3 會落在邊界兩側，差一步就差一條
    const STEP = REPORT_RELEASE_INTERVAL + 0.05
    let now = run(b, 0, STEP)
    expect(b.count).toBe(2)
    now = run(b, now, STEP)
    expect(b.count).toBe(3)
    now = run(b, now, STEP * 2)
    expect(b.queueCount).toBe(0)
    // 五筆剛好填滿畫面，最早那一筆還在最底下
    expect(b.count).toBe(REPORT_MAX_LINES)
    expect(b.lines[0]!.nameKey).toBe(K[4])
    expect(b.lines[REPORT_MAX_LINES - 1]!.nameKey).toBe(K[0])
  })

  it('出場過程中進來的排在後面，不插隊', () => {
    const b = createBattleReport()
    queueReport(b, 'air', K[0]!)
    queueReport(b, 'air', K[1]!)
    stepBattleReport(b, 0)
    // 第一則已經出場，第二則還在等；此刻又來一筆
    queueReport(b, 'air', K[2]!)
    run(b, 0, 1)
    expect(b.lines.slice(0, 3).map((l) => l.nameKey)).toEqual([K[2], K[1], K[0]])
  })

  it('滿了就丟掉新的，已經發生的照順序出場', () => {
    const b = createBattleReport()
    for (let i = 0; i < REPORT_QUEUE_CAPACITY + 3; i++) queueReport(b, 'air', K[i]!)
    expect(b.queueCount).toBe(REPORT_QUEUE_CAPACITY)
    stepBattleReport(b, 0)
    expect(b.lines[0]!.nameKey).toBe(K[0])
  })

  it('每一行的壽命各自從自己出現的時間算', () => {
    const b = createBattleReport()
    queueReport(b, 'air', BF109)
    stepBattleReport(b, 0)
    queueReport(b, 'air', BF109)
    stepBattleReport(b, 2.5)
    expect(b.count).toBe(2)
    stepBattleReport(b, 3.2)
    expect(b.count).toBe(1)
    expect(b.lines[0]!.bornAt).toBe(2.5)
    stepBattleReport(b, 5.6)
    expect(b.count).toBe(0)
  })

  /**
   * 魚雷命中一艘船、接著把它打沉，是兩件不同的事，必須分成兩行 ——
   * 併成一行的話「命中」會被「擊沉」吃掉，而那正是玩家最想看到的兩拍。
   */
  it('命中與擊沉是兩行', () => {
    const b = createBattleReport()
    queueReport(b, 'torpedo', FLETCHER)
    queueReport(b, 'ship', FLETCHER)
    run(b, 0, 1)
    expect(b.count).toBe(2)
    expect(reportText(b.lines[0]!)).toBe(line('ship', FLETCHER))
    expect(reportText(b.lines[1]!)).toBe(line('torpedo', FLETCHER))
  })

  it('順序就是發生的順序，新的永遠在最上面', () => {
    const b = createBattleReport()
    queueReport(b, 'ground', TRUCK)
    queueReport(b, 'ground', T34)
    queueReport(b, 'ground', TRUCK)
    run(b, 0, 1)
    expect(b.lines.slice(0, 3).map((l) => l.nameKey)).toEqual([TRUCK, T34, TRUCK])
  })

  it('滿了擠掉最舊的那一行，不是最新的', () => {
    const b = createBattleReport()
    for (let i = 0; i < 6; i++) queueReport(b, 'air', K[i]!)
    run(b, 0, REPORT_RELEASE_INTERVAL * 8)
    expect(b.count).toBe(REPORT_MAX_LINES)
    expect(b.lines[0]!.nameKey).toBe(K[5])
    // 六條進五格，被擠掉的是最早的那一條
    expect(b.lines[REPORT_MAX_LINES - 1]!.nameKey).toBe(K[1])
  })

  /**
   * 最上面那一行是**出現**不是移動。少了這條，新的一行會從上一格掉下來，
   * 而它上面就是節拍預警那一帶。
   */
  it('被擠下來的行才滑，新長出來的那一行不滑', () => {
    const b = createBattleReport()
    queueReport(b, 'air', K[0]!)
    stepBattleReport(b, 0)
    expect(reportSlide(b.lines[0]!, 0)).toBe(0)
    queueReport(b, 'air', K[1]!)
    stepBattleReport(b, 1)
    expect(reportSlide(b.lines[0]!, 1)).toBe(0)
    // 被擠下去的那一行，此刻還差整整一格
    expect(reportSlide(b.lines[1]!, 1)).toBe(1)
    expect(reportSlide(b.lines[1]!, 1 + REPORT_SLIDE / 2)).toBeCloseTo(0.5)
    expect(reportSlide(b.lines[1]!, 1 + REPORT_SLIDE)).toBe(0)
    // 滑完之後不會變成負的 —— 往回滑就是往上跳
    expect(reportSlide(b.lines[1]!, 99)).toBe(0)
  })

  it('過期的行被淘汰，還活著的往前補', () => {
    const b = createBattleReport()
    queueReport(b, 'air', K[0]!)
    stepBattleReport(b, 0)
    queueReport(b, 'air', K[1]!)
    stepBattleReport(b, 2)
    stepBattleReport(b, 3.5)
    expect(b.count).toBe(1)
    expect(b.lines[0]!.nameKey).toBe(K[1])
  })

  it('淡出只發生在最後那一段，而且夾在 0..1', () => {
    const b = createBattleReport()
    queueReport(b, 'air', BF109)
    stepBattleReport(b, 0)
    const l = b.lines[0]!
    expect(reportAlpha(l, 0)).toBe(1)
    expect(reportAlpha(l, REPORT_LINE_SECONDS - REPORT_FADE)).toBe(1)
    const mid = reportAlpha(l, REPORT_LINE_SECONDS - REPORT_FADE / 2)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    // 過期之後不會變負 —— 淘汰與繪製是兩個呼叫端，中間可能差一幀
    expect(reportAlpha(l, REPORT_LINE_SECONDS + 10)).toBe(0)
  })

  it('重開一場把畫面上的與還沒出場的一起清掉', () => {
    const b = createBattleReport()
    for (let i = 0; i < 6; i++) queueReport(b, 'air', K[i]!)
    stepBattleReport(b, 0)
    resetBattleReport(b)
    expect(b.count).toBe(0)
    expect(b.queueCount).toBe(0)
    // 【`nextAt` 也要回去】不回的話新場的第一則要等上一場的間隔走完
    stepBattleReport(b, 0)
    queueReport(b, 'air', K[9]!)
    stepBattleReport(b, 0)
    expect(b.count).toBe(1)
    expect(b.lines[0]!.nameKey).toBe(K[9])
  })

  /** 存的是鍵，畫的時候才查 —— 已經在畫面上的那一行跟著語言換 */
  it('語言切換時，已經出場的那一行跟著換', () => {
    const b = createBattleReport()
    queueReport(b, 'ground', TRUCK)
    stepBattleReport(b, 0)
    const zh = reportText(b.lines[0]!)
    setLang('en')
    const en = reportText(b.lines[0]!)
    expect(en).toBe(line('ground', TRUCK))
    expect(en).not.toBe(zh)
  })

  /**
   * 入列與步進都在物理步裡跑，而一幀可能跑好幾步。
   * 熱路徑：不配置。
   */
  it('入列與步進都不配置新物件', () => {
    const b = createBattleReport()
    const before = b.lines.slice()
    let now = 0
    for (let i = 0; i < 20; i++) {
      queueReport(b, 'air', K[i % 2]!)
      now = run(b, now, REPORT_RELEASE_INTERVAL)
    }
    for (const l of b.lines) expect(before).toContain(l)
  })
})
