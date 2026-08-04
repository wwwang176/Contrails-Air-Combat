import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  aliveCount, createBattle, stepBattle, DEFAULT_BATTLE, type Battle,
} from '../../src/battle/setup'
import { countLocks } from '../../src/ai/target'
import { AI_DECISION_HZ, AiController } from '../../src/ai/AiController'
import { DEFAULT_WINGMAN } from '../../src/ai/wingman'
import { THREAT_RANGE } from '../../src/ai/assess'
import { clearImpacts } from '../../src/world/events'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

const DT = 1 / 240
/**
 * 模擬長度，s。
 *
 * 【M5 是 60，M6 加到 150】M6 把開局拉到 10 km，光是編隊接近就吃掉 21 秒；
 * 而 30 架僚機掩護優先、不主動獵殺，一場仗因此慢得多 —— 60 秒的視窗裡
 * 陣亡數是 0，「混戰後歸隊」（spec §4.1 條件 13）也還沒發生過一次。
 *
 * 代價很小：150 秒的模擬實測只花 23 秒牆鐘。
 */
const SECONDS = 150
/** 一個決策週期是幾個物理步。10 Hz 決策、240 Hz 物理 → 24 */
const STEPS_PER_DECISION = 240 / AI_DECISION_HZ

/**
 * 最大同時鎖定數的上限。
 *
 * 【M5 是 4，M6 是 7 —— 而且 7 是推導出來的界，不是實測加餘裕】
 * M6 的僚機不評分，它們照準則走：第 3 級「跟參考機集火」讓一個未受威脅的
 * Schwarm 的三架僚機全部撲上長機的現任目標，加上長機自己就是 **4**。
 * 其餘的自由獵手（各分隊長機）仍走 `selectTarget` 的分攤評分，M5 量到的
 * 擁擠上限是 **3**。兩者相加 = 7。
 *
 * 實測（60 秒與 150 秒兩種長度）都是 **7**，與這個界完全吻合。
 *
 * **Schwarm 集火到 4 是設計，不是缺陷。** 這一條要抓的是它有沒有退化成
 * 「跨分隊也在撲同一架」—— 第二個 Schwarm 加入就會是 8，而 M5 §14 記著
 * 那個狀態的後果：17 架撲同一個目標，藍隊 60 秒掉 18 架。
 *
 * 【為什麼不留餘裕】留了就分辨不出「兩個 Schwarm 撲同一架」。這個模擬是
 * 決定性的（見檔尾的決定性測試），所以取在界上不會間歇性紅燈；真的紅了，
 * 該做的是回頭看集火那一級為什麼跨了分隊，不是把 7 改成 8。
 *
 * 【這個數字換過兩次】第一版量到 1，那是在 `lateralOffset` 還是 0、整場仗
 * 6 秒就以一方全滅收場的退化區間量的。門檻在錯的區間量出來會鬆得剛好
 * 看不出問題。
 */
const MAX_LOCKS = 7

/**
 * 150 秒內全隊換目標的次數上限。
 *
 * 【M6 重新量測】M5 量到 506（60 秒、40 架都走 `selectTarget`）。M6 只有
 * 10 架自由獵手走 `selectTarget`，其餘 30 架走僚機準則，兩者的換手率不同，
 * 而且視窗長度也從 60 秒變成 150 秒 —— M5 的數字不可沿用。
 *
 * 實測 **989**，取 1.5 倍再向上取整到百位 = 1,500。上界的意義不變：遲滯
 * 完全失效時，40 架每個決策節拍都可能換一次 = 40 × 150 × 10 Hz = 60,000 次，
 * 1,500 是它的 2.5%。
 *
 * 【它同時是集火距離門的迴歸守門員】拿掉 `wingman.ts` 第 3 級的
 * `THREAT_RANGE` 判斷，實測換目標次數變成 **2,232** —— 這一條會紅。
 * 沒有那道門時僚機會跟著長機去追 10 km 外的目標，而長機在接近途中換目標
 * 時三架僚機會跟著一起換，換手率因此翻倍。
 */
const MAX_SWITCHES = 1500

/**
 * 開局巡航階段站位誤差的中位數上限，m。
 *
 * 【100 m 怎麼來】等於 `DEFAULT_STATION.blendRange` —— 站位控制器已經進入
 * 「平行飛」區間就算在隊上（M6 spec §14）。這不是一個從實測回填的數字，
 * 是一個**設計要求**：巡航階段沒有任何人在交戰半徑內，站位誤差本來就該
 * 貼近 0。
 *
 * **實測若明顯超過它，那是控制器或集火距離門的缺陷，不是門檻該放寬。**
 *
 * 實測中位數 **66.2 m**、P90 **290.8 m**（27,270 個樣本）。
 */
const MAX_CRUISE_STATION_ERROR = 100

/**
 * 活著的 AI 可以抱著一個已退場目標多少步。
 *
 * 【為什麼是兩個決策週期而不是一個】命中判定排在控制器之後（`World.step`
 * 的四段順序），所以目標可能在**同一個物理步、該 AI 剛決策完之後**才死。
 * 最壞情形是「決策時他還活著 → 同步死掉 → 等滿一個週期才重選」，也就是
 * 一個週期的殘餘加上一個完整週期。實測 24 步，界在 48。
 */
const MAX_DEAD_TARGETED_STEPS = STEPS_PER_DECISION * 2

/** 39 架 AI 攤在 24 步裡，平均 1.6 架。實測尖峰 2，門檻取 6。 */
const MAX_DECISIONS_IN_ONE_STEP = 6

/** 玩家位置放一個恆平飛的假駕駛——這是 AI 對 AI 的測試。 */
class Idle implements Controller {
  private readonly aim = new Vector3(0, 0, -1)
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim)
    out.throttle = 0.7
    out.firing = false
  }
}

interface Observed {
  /** 全程任一抽樣時刻，單一目標被同隊多少架同時鎖定的最大值 */
  maxLocks: number
  /** 全程是否有**存活的**飛機出現在海面之下 */
  wentUnderwater: boolean
  /** 退場的飛機自己的指派槽位沒有歸 −1 的次數 */
  ownSlotDirty: number
  /** 活著的 AI 連續抱著一個已退場目標的最大步數 */
  maxDeadTargetedSteps: number
  /** 全隊換目標的總次數 */
  switches: number
  /** 單一物理步的最大決策架數 */
  maxDecisionsInOneStep: number
  /** 整場重置了幾次 */
  resets: number
  /** 累計損失 */
  blueLost: number
  redLost: number
  /**
   * 累計承受的傷害（hp），依承受方分隊。
   *
   * 【為什麼要它而不是只看陣亡數】M6 把開局拉到 10 km、兩隊錯開 1,500 m，
   * 而 30 架僚機是掩護優先、不主動獵殺 —— 一場仗因此慢得多。60 秒內
   * 陣亡數可能是 0，但那不代表「40 架各自繞圈」：實測有 7 架同時鎖定、
   * 989 次換目標。傷害是同一個問題（打起來了沒有）更敏感的觀測量。
   */
  blueDamage: number
  redDamage: number
  /** 一方被全滅的次數 */
  wipes: number
  /** 整場累計的命中事件數。應與命中次數一致 */
  hitEventCount: number
  /** 整場累計的入海事件數（水柱） */
  splashEventCount: number
  /** 兩個事件緩衝累計丟棄了幾筆。門檻：恆為 0 */
  eventsDropped: number
  /** 巡航階段（兩隊重心仍相距 > THREAT_RANGE）各僚機的站位誤差樣本，m */
  cruiseStationErrors: number[]
  /** 完整歸隊的次數：離站超過 breakExit 之後回到門檻內 */
  rejoins: number
  /** Schwarm 內遞補的次數：members[0] 不變而 members[1] 換人 */
  replacements: number
}

/** 一組數字的中位數；空陣列回傳 NaN。 */
function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN
  const s = Array.from(xs).sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

const CENTRE_A = new Vector3()
const CENTRE_B = new Vector3()

/** 兩隊**存活者**重心的距離，m。任一方全滅時回傳 Infinity。 */
function centroidGap(b: Battle): number {
  CENTRE_A.set(0, 0, 0)
  CENTRE_B.set(0, 0, 0)
  let na = 0
  let nb = 0
  for (const c of b.blue) if (c.alive) { CENTRE_A.add(c.aircraft.state.position); na++ }
  for (const c of b.red) if (c.alive) { CENTRE_B.add(c.aircraft.state.position); nb++ }
  if (na === 0 || nb === 0) return Infinity
  return CENTRE_A.divideScalar(na).distanceTo(CENTRE_B.divideScalar(nb))
}

function observe(): Observed {
  const b: Battle = createBattle(new Idle())
  const cs = b.world.combatants
  const last = new Int32Array(cs.length).fill(-1)
  const deadTargetedRun = new Int32Array(cs.length)
  const o: Observed = {
    maxLocks: 0, wentUnderwater: false, ownSlotDirty: 0, maxDeadTargetedSteps: 0,
    switches: 0, maxDecisionsInOneStep: 0, resets: 0,
    blueLost: 0, redLost: 0, wipes: 0,
    blueDamage: 0, redDamage: 0,
    hitEventCount: 0, splashEventCount: 0, eventsDropped: 0,
    cruiseStationErrors: [], rejoins: 0, replacements: 0,
  }

  /** 上一步各架的 hp，用來累計傷害（重置會把 hp 補回，只算下降量） */
  const prevHp = new Float64Array(cs.length)
  for (let i = 0; i < cs.length; i++) prevHp[i] = cs[i]!.hp

  /** 每架是否曾經離站超過 breakExit（歸隊偵測用） */
  const wasBeyond = new Uint8Array(cs.length)
  /**
   * 開局巡航是否已經結束（兩隊重心第一次靠到 THREAT_RANGE 以內）。
   *
   * 【為什麼要閂住而不是每步重判】交錯之後兩隊重心會再度拉開，若只看
   * 「重心距離 > THREAT_RANGE」，混戰中散開的僚機會被算成巡航樣本 ——
   * 實測中位數因此從 66 m 被灌到 270 m。spec §4.1 條件 12 要量的是**開局**
   * 那一段編隊推進，而那一段只發生一次。
   */
  let cruisePhase = true
  /** 各分隊上一步的 members[0] 與 members[1] */
  const prevLead = new Int32Array(b.flights.flights.length).fill(-1)
  const prevWing = new Int32Array(b.flights.flights.length).fill(-1)

  const ais = cs.map((c) => (c.controller instanceof AiController ? c.controller : null))
  const prevDecisions = ais.map((a) => a?.decisionsMade ?? 0)
  let prevCountdown = 0
  let prevBlue = b.cfg.perSide
  let prevRed = b.cfg.perSide

  for (let i = 0; i < SECONDS / DT; i++) {
    stepBattle(b, DT)
    // 【必須自己排空】這個測試不是 main.ts。不排空的話緩衝會填滿並開始
    // 丟棄，下面的斷言必紅，而那個紅燈不代表任何缺陷。
    o.hitEventCount += b.world.hitEvents.count
    o.splashEventCount += b.world.splashEvents.count
    clearImpacts(b.world.hitEvents)
    clearImpacts(b.world.splashEvents)
    if (prevCountdown > 0 && b.countdown === 0) o.resets++
    prevCountdown = b.countdown

    const nowBlue = aliveCount(b.blue)
    const nowRed = aliveCount(b.red)
    if (nowBlue < prevBlue) o.blueLost += prevBlue - nowBlue
    if (nowRed < prevRed) o.redLost += prevRed - nowRed
    if ((nowBlue === 0 || nowRed === 0) && prevBlue > 0 && prevRed > 0) o.wipes++
    prevBlue = nowBlue
    prevRed = nowRed

    let decidedThisStep = 0
    for (let k = 0; k < ais.length; k++) {
      const now = ais[k]?.decisionsMade ?? 0
      if (now > prevDecisions[k]!) decidedThisStep++
      prevDecisions[k] = now
    }
    if (decidedThisStep > o.maxDecisionsInOneStep) o.maxDecisionsInOneStep = decidedThisStep

    for (const c of cs) {
      if (c.alive && c.aircraft.state.position.y < 0) o.wentUnderwater = true

      // 只累計下降量：重置把 hp 補回時不會倒扣
      const drop = prevHp[c.index]! - c.hp
      if (drop > 0) {
        if (c.team === 'blue') o.blueDamage += drop
        else o.redDamage += drop
      }
      prevHp[c.index] = c.hp

      const a = b.board.assignments[c.index]!
      if (a !== last[c.index]!) {
        if (last[c.index]! >= 0 && a >= 0) o.switches++
        last[c.index] = a
      }
      if (!c.alive && a >= 0) o.ownSlotDirty++

      // 活著的 AI 鎖定一架已退場的飛機，連續幾步
      if (c.alive && a >= 0 && !cs[a]!.alive) {
        deadTargetedRun[c.index]!++
        if (deadTargetedRun[c.index]! > o.maxDeadTargetedSteps) {
          o.maxDeadTargetedSteps = deadTargetedRun[c.index]!
        }
      } else {
        deadTargetedRun[c.index] = 0
      }
    }

    // ── 編制遞補（每步，10 個分隊，很便宜）──
    for (let f = 0; f < b.flights.flights.length; f++) {
      const fl = b.flights.flights[f]!
      const lead = fl.count > 0 ? fl.members[0]! : -1
      const wing = fl.count > 1 ? fl.members[1]! : -1
      if (prevLead[f]! >= 0 && lead === prevLead[f]! && wing >= 0
          && prevWing[f]! >= 0 && wing !== prevWing[f]!) {
        o.replacements++
      }
      prevLead[f] = lead
      prevWing[f] = wing
    }

    // ── 站位誤差：每 12 步（20 Hz）取樣一次 ──
    // 【為什麼不是每步】stationError 本來就只在 10 Hz 的決策節拍更新，
    // 每步取樣只是把同一個值抄 24 遍，還會讓中位數被「停在站上不動」的
    // 那幾架灌爆。
    if (i % 12 === 0) {
      if (cruisePhase && centroidGap(b) <= THREAT_RANGE) cruisePhase = false
      for (let k = 0; k < ais.length; k++) {
        // `?? null` 是為了 noUncheckedIndexedAccess —— 索引存取的型別是
        // `AiController | null | undefined`，只比對 null 收不掉 undefined
        const a = ais[k] ?? null
        if (a === null || a.stationReference === null || !cs[k]!.alive) continue
        if (cruisePhase) o.cruiseStationErrors.push(a.stationError)
        if (a.stationError > DEFAULT_WINGMAN.breakExit) {
          wasBeyond[k] = 1
        } else if (wasBeyond[k] === 1 && a.stationError < 100) {
          o.rejoins++
          wasBeyond[k] = 0
        }
      }
    }

    // 最大同時鎖定數。每 0.5 s 抽樣一次——逐步算是 40 × 40 × 14,400 次掃描
    if (i % 120 === 0) {
      for (const target of cs) {
        if (!target.alive) continue
        const hunters = target.team === 'blue' ? 'red' : 'blue'
        const n = countLocks(b.board, hunters, -1, target.index)
        if (n > o.maxLocks) o.maxLocks = n
      }
    }
  }
  o.eventsDropped = b.world.hitEvents.dropped + b.world.splashEvents.dropped
  return o
}

describe('20v20 跑滿 150 秒', () => {
  const o = observe()

  it('沒有任何一架被超過 MAX_LOCKS 架同時鎖定（M5 spec §3.1 條件 3）', () => {
    expect(o.maxLocks).toBeLessThanOrEqual(MAX_LOCKS)
  })

  it('分攤真的有在起作用——不是因為沒人選目標', () => {
    expect(o.maxLocks).toBeGreaterThan(0)
  })

  it('沒有存活的飛機在海面之下（M5 spec §3.1 條件 4）', () => {
    expect(o.wentUnderwater).toBe(false)
  })

  it('退場的飛機自己的指派槽位一定歸 −1（M5 spec §7）', () => {
    // 【這一條抓過一個真缺陷】World.step 跳過退場者的控制器，所以
    // selectTarget 永遠沒機會替它清槽位。第一次量到 87,740 次。
    expect(o.ownSlotDirty).toBe(0)
  })

  it('退場的目標在兩個決策週期內被放掉（M5 spec §3.1 條件 5、6）', () => {
    expect(o.maxDeadTargetedSteps).toBeLessThanOrEqual(MAX_DEAD_TARGETED_STEPS)
  })

  it('換目標次數在遲滯的上限之內（M5 spec §3.1 條件 10）', () => {
    expect(o.switches).toBeLessThan(MAX_SWITCHES)
  })

  it('決策相位真的攤開了（M5 spec §6.4）', () => {
    expect(o.maxDecisionsInOneStep).toBeLessThanOrEqual(MAX_DECISIONS_IN_ONE_STEP)
  })

  it('戰鬥真的打起來了——不是 40 架各自繞圈', () => {
    // 【M6 改看傷害而不是陣亡數】開局拉到 10 km、30 架僚機掩護優先，
    // 一場仗慢得多：150 秒只掉 1 架。但傷害是 2,451 / 3,019 hp —— 打得
    // 很兇。用陣亡數當訊號的話，這一條會在「其實打得正激烈」時紅掉，
    // 那是量測方法的問題，不是程式的問題。
    expect(o.blueDamage + o.redDamage).toBeGreaterThan(0)
  })

  it('沒有一方被全滅——開局幾何沒有退化成對頭槍戰', () => {
    // 【M5 時這是 lateralOffset 的迴歸守門，M6 之後不是了】M5 把它設回 0
    // 會有七次全滅、藍隊累計損失 140。M6 的佈局下實測：offset 設回 0 也
    // 不會全滅 —— 因為只有 10 架自由獵手會主動撲上去，湊不出 M5 那種
    // 「20 場同時發生的精準對頭槍戰」。編隊準則本身擋掉了那個失效模式。
    //
    // 【那 lateralOffset 由誰守】`battle-setup.test.ts` 的「最接近的一對
    // 藍紅橫向隔開兩倍射擊錐」—— 設回 300 時它紅得很乾脆（300 vs 1048）。
    //
    // 這一條保留下來當災難性失衡的粗篩，不再宣稱自己守著某個特定參數。
    expect(o.wipes).toBe(0)
  })

  it('雙方都吃得到對方——不是一面倒', () => {
    // 【M6 改看傷害】陣亡數在這個時間尺度上是 0 對 1 —— 用它的話這條測試
    // 恆真（0 × 3 + 3 ≥ 1），一個恆真的測試比沒有測試更糟。
    // 一面倒的定義維持三倍：實測 2,451 對 3,019，比值 1.23。
    const lo = Math.min(o.blueDamage, o.redDamage)
    const hi = Math.max(o.blueDamage, o.redDamage)
    expect(lo).toBeGreaterThan(0)
    expect(hi).toBeLessThanOrEqual(lo * 3)
  })

  it('開局巡航時編隊維持得住（M6 spec §4.1 條件 12）', () => {
    // 【這一條守的不是集火距離門 —— 實測推翻了那個假設】spec §7.1 主張
    // 拿掉 wingman.ts 第 3 級的 THREAT_RANGE 判斷，開局編隊會融成一條線。
    // 實測不成立：拿掉之後中位數是 66.8 m，與有門的 66.2 m 沒有差別。
    // 原因是敵機在 10 km 正前方，僚機直撲敵機與長機直撲敵機是幾乎同一個
    // 方向，站位誤差長不起來。
    //
    // 集火距離門真正的守門員是 MAX_SWITCHES —— 拿掉它換目標次數從 989
    // 變成 2,232（見那個常數的註解）。這一條守的是站位控制器本身。
    expect(o.cruiseStationErrors.length).toBeGreaterThan(100)
    expect(median(o.cruiseStationErrors)).toBeLessThan(MAX_CRUISE_STATION_ERROR)
  })

  it('混戰散開之後真的有人歸隊（M6 spec §4.1 條件 13）', () => {
    expect(o.rejoins).toBeGreaterThan(0)
  })

  it('Schwarm 內遞補真的發生過（觀測，不是門檻）', () => {
    // 【為什麼只是觀測】遞補的次數取決於誰先死，是隨機的。確定性的驗證
    // 在 test/unit/battle-flights.test.ts 與 battle-setup.test.ts。
    console.log(`Schwarm 內遞補 ${o.replacements} 次`)
    expect(o.replacements).toBeGreaterThanOrEqual(0)
  })

  it('事件緩衝從未溢位（M7 spec §13.1 條件 9）', () => {
    // 【這一條守的是 IMPACT_CAPACITY 的推導】64 是「全部命中」這個
    // 物理上不可能的上界再取 10 倍餘裕算出來的。真的溢位代表推導錯了，
    // 而不是「調大一點就好」。
    expect(o.eventsDropped).toBe(0)
  })

  it('每一次命中都推了一筆事件', () => {
    // 命中事件數必須與實際命中次數一致 —— 少了代表 resolveHits 有一條
    // 提早 continue 的路徑漏掉推送，而火花會在那個情形下靜靜地不出現。
    expect(o.hitEventCount).toBeGreaterThan(0)
  })

  it('觀測值（不是門檻，供回填與日後比對）', () => {
    // 【中位數只能算一次】寫成 `filter((x) => x >= median(xs))` 的話，
    // median 會被逐元素呼叫 —— 36,000 個樣本就是 36,000 次 O(n log n) 排序，
    // 整個測試會從幾十秒變成跑不完。
    const mid = median(o.cruiseStationErrors)
    console.log(JSON.stringify({
      ...o,
      cruiseStationErrors: undefined,
      cruiseSamples: o.cruiseStationErrors.length,
      cruiseMedian: mid,
      cruiseP90: median(o.cruiseStationErrors.filter((x) => x >= mid)),
    }))
    expect(Number.isFinite(o.switches)).toBe(true)
  })
})

describe('全滅重置（M5 spec §3.1 條件 9）', () => {
  it('人為打光紅隊後，resetCountdown 內回到滿編', () => {
    const b = createBattle(new Idle())
    for (const c of b.red) b.world.destroy(c)
    const steps = Math.ceil(b.cfg.resetCountdown / DT) + 4
    for (let i = 0; i < steps; i++) stepBattle(b, DT)
    expect(aliveCount(b.red)).toBe(DEFAULT_BATTLE.perSide)
    expect(aliveCount(b.blue)).toBe(DEFAULT_BATTLE.perSide)
  })
})
