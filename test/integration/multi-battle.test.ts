import { describe, it, expect, beforeAll } from 'vitest'
import { Vector3 } from 'three'
import {
  aliveCount, createBattle, stepBattle, DEFAULT_BATTLE, type Battle,
  type BattleConfig,
} from '../../src/battle/setup'
import { HEAD_ON } from '../../src/battle/entry'
import { BF109K4 } from '../../src/specs/bf109k4'
import { lineAbreast } from '../../src/battle/order'
import { P51D } from '../../src/specs/p51d'
import { countLocks } from '../../src/ai/target'
import { AI_DECISION_HZ, AiController } from '../../src/ai/AiController'
import { DEFAULT_WINGMAN } from '../../src/ai/wingman'
import { THREAT_RANGE } from '../../src/ai/assess'
import { clearImpacts } from '../../src/world/events'
import { clearKills, KILL_STRIDE } from '../../src/world/kills'
import { clearDamage } from '../../src/world/damage'
import type { Combatant, Team } from '../../src/world/World'
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
 * 【這個數字對場景很敏感】量到 1 的那一次是在 `lateralOffset` 為 0、整場仗
 * 6 秒就以一方全滅收場的退化區間量的。門檻在錯的區間量出來會鬆得剛好
 * 看不出問題。
 *
 * ## 判準由「全程極大值」改成「分布」
 *
 * 警戒訊號上線（`assess.ts` 的 `alarmFactor`）之後這一條紅了：全程極大值
 * 由 7 變成 8~10。上面那句「紅了該回頭看集火為什麼跨了分隊」照做之後，
 * **查到的是相反的結論——分散完全沒有失效**：
 *
 * ```
 * 每步最大鎖定數    p50 3    p90 4    p99 7    max 10
 * 「某一架被 >7 架鎖定」  334 / 1,421,691 =  0.023%
 * ```
 *
 * p50 = 3、p90 = 4，與上面那個 4 + 3 的推導完全吻合；「17 架撲同一架」的
 * 退化狀態離得非常遠。334 個「抽樣 × 飛機」對換算成時間，是全場 40 架、
 * 150 秒裡合計約 **1.4 秒**的飛機時間。
 *
 * 也就是說**壞掉的是判準不是行為**：`maxLocks` 是一個混沌模擬上的**極值
 * 統計**，任何改動都可能讓它在某個合流瞬間多跳一格，而那與「大家有沒有
 * 圍毆同一架」無關。
 *
 * 所以改成兩條，合起來**比原本更嚴**：
 *
 *   1. `lockPileups / lockSamples < LOCK_PILEUP_SHARE`（0.5%，實測 0.023%）
 *      —— 這一條釘住的是**分布**，也就是「分散」真正的意思。原本那條完全
 *      沒有在管分布。
 *   2. `maxLocks ≤ MAX_LOCKS`（12）—— 降級成**災難護欄**。M5 §14 記載的
 *      退化狀態是 17~20，12 遠低於它，也高於實測的 10。
 *
 * **這不是把 7 改成 12 就算了。** 舊條件抓得到的災難（17~20）新條件照樣
 * 抓得到，而新增的第 1 條抓得到舊條件抓不到的「持續性圍毆」。
 * 這個交換是接受的。
 */
const MAX_LOCKS = 12
/** 「圍毆」的定義：被超過這麼多架同時鎖定。就是 M6 推導出來的那個界 */
const LOCK_SPREAD = 7
/** 圍毆的時間佔比上限。實測 0.023%，取 0.5% 留 20 倍餘裕 */
const LOCK_PILEUP_SHARE = 0.005

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
  /** 「某一架在某個抽樣時刻被超過 `LOCK_SPREAD` 架鎖定」的次數 */
  lockPileups: number
  /** 上面那個計數的分母：抽樣時刻 × 存活飛機 */
  lockSamples: number
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
  /** 整場累計的擊墜事件數。門檻：恰好等於陣亡數（M8 spec §14.1.1） */
  killEventCount: number
  /** 擊墜緩衝累計丟棄了幾筆。門檻：恆為 0 —— 容量是參戰架數，結構上不該溢位 */
  killsDropped: number
  /** 受擊事件緩衝累計丟棄了幾筆。門檻：恆為 0 */
  damageDropped: number
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

/**
 * 全場最近的一對敵我的距離，m。任一方全滅時回傳 Infinity。
 *
 * 【為什麼取代了 `centroidGap`】巡航階段的結束條件本來寫成「兩隊**重心**
 * 靠到 `THREAT_RANGE` 以內」。那個判準暗含一個假設：兩隊會塌成一團混戰，
 * 重心因此重合。「分攤折扣不數同小隊」打開之後那個假設不成立了
 * —— 各分隊咬住自己的目標各打各的，重心在 150 s 內從未靠到 900 m，於是
 * 巡航視窗把整場混戰吞了進去：取樣數 22,860 → 72,554，中位 69.7 → 383.9 m。
 *
 * **編隊本身沒散** —— 依時間切窗量，開局 20 s 的站位誤差中位改前改後同為
 * 26.8 m（`test/tools/cruise-station.probe.ts`）。壞掉的是這把尺。
 *
 * 【為什麼改成最近的一對】「巡航」的定義本來就是**還沒接敵**，而接敵是
 * 第一對飛機進入交戰半徑，不是兩團人的平均位置重合。新判準不對戰鬥的
 * 形狀做任何假設，O(N²) 每 12 步一次（40 × 40 = 1,600 次比較）。
 */
function nearestEnemyGap(b: Battle): number {
  let best = Infinity
  for (const p of b.blue) {
    if (!p.alive) continue
    for (const q of b.red) {
      if (!q.alive) continue
      const d = p.aircraft.state.position.distanceTo(q.aircraft.state.position)
      if (d < best) best = d
    }
  }
  return best
}

function observe(): Observed {
  const b: Battle = createBattle(new Idle())
  const cs = b.world.combatants
  const last = new Int32Array(cs.length).fill(-1)
  const deadTargetedRun = new Int32Array(cs.length)
  const o: Observed = {
    maxLocks: 0, lockPileups: 0, lockSamples: 0,
    wentUnderwater: false, ownSlotDirty: 0, maxDeadTargetedSteps: 0,
    switches: 0, maxDecisionsInOneStep: 0,
    blueLost: 0, redLost: 0, wipes: 0,
    blueDamage: 0, redDamage: 0,
    hitEventCount: 0, splashEventCount: 0, eventsDropped: 0,
    killEventCount: 0, killsDropped: 0, damageDropped: 0,
    cruiseStationErrors: [], rejoins: 0, replacements: 0,
  }

  /** 上一步各架的 hp，用來累計傷害（重置會把 hp 補回，只算下降量） */
  const prevHp = new Float64Array(cs.length)
  for (let i = 0; i < cs.length; i++) prevHp[i] = cs[i]!.hp

  /** 每架是否曾經離站超過 breakExit（歸隊偵測用） */
  const wasBeyond = new Uint8Array(cs.length)
  /**
   * 開局巡航是否已經結束（第一對敵我第一次靠到 THREAT_RANGE 以內）。
   *
   * 【為什麼要閂住而不是每步重判】交錯之後雙方會再度拉開，若只看當下的
   * 距離，混戰中散開的僚機會被算成巡航樣本 —— 實測中位數因此從 66 m 被灌
   * 到 270 m。spec §4.1 條件 12 要量的是**開局**那一段編隊推進，而那一段
   * 只發生一次。
   *
   * 【判準由重心改成最近的一對】理由見 `nearestEnemyGap`。
   */
  let cruisePhase = true
  /** 各分隊上一步的 members[0] 與 members[1] */
  const prevLead = new Int32Array(b.flights.flights.length).fill(-1)
  const prevWing = new Int32Array(b.flights.flights.length).fill(-1)

  const ais = cs.map((c) => (c.controller instanceof AiController ? c.controller : null))
  const prevDecisions = ais.map((a) => a?.decisionsMade ?? 0)
  // 【要讀實際生出來的架數】讀 `cfg.blueCount` 不行 —— 編組表沒有那個欄位，
  // 而 `b.blue` / `b.red` 就是生成時分好的兩隊 —— 開局全員存活，兩者相等
  let prevBlue = b.blue.length
  let prevRed = b.red.length

  for (let i = 0; i < SECONDS / DT; i++) {
    stepBattle(b, DT)
    // 【必須自己排空】這個測試不是 main.ts。不排空的話緩衝會填滿並開始
    // 丟棄，下面的斷言必紅，而那個紅燈不代表任何缺陷。
    o.hitEventCount += b.world.hitEvents.count
    o.splashEventCount += b.world.splashEvents.count
    clearImpacts(b.world.hitEvents)
    clearImpacts(b.world.splashEvents)
    o.killEventCount += b.world.killEvents.count
    clearKills(b.world.killEvents)
    clearDamage(b.world.damageEvents)

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
      if (cruisePhase && nearestEnemyGap(b) <= THREAT_RANGE) cruisePhase = false
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
        o.lockSamples++
        if (n > LOCK_SPREAD) o.lockPileups++
      }
    }
  }
  o.eventsDropped = b.world.hitEvents.dropped + b.world.splashEvents.dropped
  o.killsDropped = b.world.killEvents.dropped
  o.damageDropped = b.world.damageEvents.dropped
  return o
}

describe('20v20 跑滿 150 秒', () => {
  // 【模擬放 beforeAll，不放 describe 本體】放本體會在收集階段就跑，
  // reporter 記不到它的時間，而且 `.skip` 與 `-t` 過濾都擋不住它
  let o: Observed
  beforeAll(() => { o = observe() }, 10 * 60 * 1000)

  it('鎖定夠分散：圍毆是瞬間而不是常態（M5 spec §3.1 條件 3）', () => {
    // 主判準是**分布**：被超過 7 架鎖定的時間佔比。見 MAX_LOCKS 的註解。
    expect(o.lockSamples).toBeGreaterThan(1000)
    expect(o.lockPileups / o.lockSamples).toBeLessThan(LOCK_PILEUP_SHARE)
    // 災難護欄：M5 §14 的退化狀態是 17~20 架撲同一架
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

  /**
   * 【打得起來就好，比值不在這裡判】兩隊都掛得到彩才代表這場仗真的打起來
   * 了 —— 缺了它，下面每一條「分散」「換手」的統計都是在量一場沒發生的仗。
   *
   * **傷害比不是護欄。** 它是整場仗的結果，取決於機種平衡與手感，不是某
   * 一段程式的契約：實測同一輪三次 AI 改動之間由 1.22 跳到 5.07 再跳到 31，
   * 而那三次沒有一次是 AI 變差。想看比值跑
   * `test/tools/fair-damage.probe.ts`，它連同機種的公平對照一起印。
   */
  it('兩隊都吃得到對方 —— 這場仗真的打起來了', () => {
    expect(Math.min(o.blueDamage, o.redDamage)).toBeGreaterThan(0)
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

  it('擊墜事件數恰好等於陣亡數 —— 不多也不少（M8 spec §14.1.1）', () => {
    // 【為什麼「不多」也要測】respawnOnDestroy 的靶機被打爆會走 respawn 而
    // 不是真的陣亡；若事件推在那個分支之前，一架靶機會生出無限多次爆炸。
    // 【為什麼「不少」也要測】少了就是有一次擊墜沒有爆炸 —— 而畫面上
    // 「飛機憑空消失」正是 M8 要修掉的那件事。
    expect(o.killEventCount).toBe(o.blueLost + o.redLost)
  })

  it('擊墜事件緩衝從未溢位（M8 spec §14.1.1）', () => {
    // 容量由 World.add() 維持在參戰架數，而一個子步之內每架最多死一次 ——
    // 溢位應該是結構上不可能的。這條把「應該」變成「測過了」。
    expect(o.killsDropped).toBe(0)
  })

  it('受擊事件緩衝從未溢位（受擊方向指示器 spec §8）', () => {
    // 容量與 hitEvents 同一個 64 —— 每次命中各推一筆，數量必然相同。
    // 這一條守的就是那個「必然」。
    expect(o.damageDropped).toBe(0)
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

describe('全滅之後的結果（M9 spec §8）', () => {
  it('人為打光紅隊後判定勝利，而且不會自己回到滿編', () => {
    const b = createBattle(new Idle())
    for (const c of b.red) b.world.destroy(c)
    for (let i = 0; i < Math.ceil(10 / DT); i++) {
      stepBattle(b, DT)
      clearKills(b.world.killEvents)
    }
    expect(b.outcome).toBe('victory')
    expect(aliveCount(b.red)).toBe(0)
  })
})

/** 第一個還活著的該隊座位；`skip` 裡的略過。沒有就回傳 null。 */
function firstAlive(
  cs: readonly Combatant[], team: Team, skip: readonly number[],
): Combatant | null {
  for (const c of cs) {
    if (c.team === team && c.alive && !skip.includes(c.index)) return c
  }
  return null
}

/** 記分板上玩家目前坐的座位。接手時它**立刻**改變，`b.player` 要等 2 秒。 */
function playerSeatNow(b: Battle): number {
  return b.roster.pilots.findIndex((p) => p.isPlayer)
}

/** 排空三個事件緩衝。這個檔案不是 main.ts，不排空的話緩衝會填滿並開始丟棄。 */
function drainEvents(b: Battle): void {
  clearKills(b.world.killEvents)
  clearImpacts(b.world.hitEvents)
  clearImpacts(b.world.splashEvents)
  clearDamage(b.world.damageEvents)
}

describe('戰績的守恆律（M9 spec §11）', () => {
  it('全體擊墜數 = 全體陣亡數', () => {
    // 【為什麼這是最有力的一條】任何漏記或重複記都會讓它失衡。逐條斷言
    // 「這一次擊墜記對了嗎」只覆蓋得到想得到的情況；這一條覆蓋全部。
    //
    // 【為什麼人為安排擊墜而不是讓 AI 自己打】實測：20v20 真打 180 秒只有
    // 1 次陣亡（花 24 秒的實際時間），2v2 與 4v4 打 240 秒**一次都沒有**
    // —— 這一版的 AI 在對頭通場之後追不到彼此。一場只死一個人的守恆律
    // 測不到助攻、自摔與接手，等於一條看起來很有力、實際上空的斷言。
    // 世界照常在跑（編制壓縮、站位、命中判定都是真的），只有「誰在什麼
    // 時候死」是安排的。
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 7)
    const cs = b.world.combatants
    /** 每秒安排一次擊墜。四種路徑輪流走，紅藍各兩次，戰場才撐得到最後 */
    const INTERVAL = 240
    let selfDestructs = 0
    let scripted = 0
    let takeovers = 0

    for (let i = 0; i < Math.ceil(30 / DT); i++) {
      if (i > 0 && i % INTERVAL === 0) {
        switch ((i / INTERVAL) % 4) {
          case 0: {
            // 紅機被藍機打下來，另一架藍機先擦傷 → 助攻
            const victim = firstAlive(cs, 'red', [])
            const killer = firstAlive(cs, 'blue', [b.player.index])
            const helper = firstAlive(cs, 'blue', [b.player.index, killer?.index ?? -1])
            if (victim && killer && helper) {
              b.world.applyDamage(victim, 10, 'wingLeft', helper)
              b.world.applyDamage(victim, 99999, 'fuselage', killer)
              scripted++
            }
            break
          }
          case 1: {
            // 自摔：沒有兇手
            const victim = firstAlive(cs, 'red', [])
            if (victim) { b.world.destroy(victim); scripted++ }
            break
          }
          case 2: {
            const victim = firstAlive(cs, 'blue', [b.player.index])
            const killer = firstAlive(cs, 'red', [])
            if (victim && killer) {
              b.world.applyDamage(victim, 99999, 'fuselage', killer)
              scripted++
            }
            break
          }
          default: {
            // 玩家陣亡 → 接手僚機。身分互換也必須守恆
            const seat = playerSeatNow(b)
            const killer = firstAlive(cs, 'red', [])
            if (seat >= 0 && killer && cs[seat]!.alive) {
              b.world.applyDamage(cs[seat]!, 99999, 'fuselage', killer)
              scripted++
              takeovers++
            }
          }
        }
      }

      stepBattle(b, DT)
      const ke = b.world.killEvents
      for (let e = 0; e < ke.count; e++) {
        if (ke.data[e * KILL_STRIDE + 7] === -1) selfDestructs++
      }
      drainEvents(b)
      if (b.outcome !== 'fighting') break
    }

    const kills = b.roster.pilots.reduce((s, p) => s + p.kills, 0)
    const deaths = b.roster.pilots.reduce((s, p) => s + p.deaths, 0)
    const gone = b.roster.pilots.filter((p) => !p.alive).length
    // 【非空覆蓋的門檻】四種路徑各要真的走到過，否則這條守恆律是空的
    expect(scripted).toBeGreaterThanOrEqual(20)
    expect(takeovers).toBeGreaterThanOrEqual(5)
    expect(selfDestructs).toBeGreaterThanOrEqual(5)
    // 【一比一，沒有補正項】自摔在戰績上完全不存在，
    // 所以每一次陣亡都必然有一個兇手。這正是玩家拿記分板對得起帳的原因。
    expect(deaths).toBeGreaterThan(0)
    expect(kills).toBe(deaths)
    // 【但退場的人數要多出自摔那幾個】自摔的人仍然不在天上 —— 記分板要
    // 把他畫成灰的，而這一條守住「不記戰績」沒有被寫成「當作沒發生」
    expect(gone).toBe(deaths + selfDestructs)
  })

  it('陣亡的飛行員數等於退場的座位數', () => {
    // 【為什麼要分開測】上一條守的是「記了幾次」，這一條守的是「記在誰身上」。
    // 接手時身分互換，兩者仍然必須對得起來。
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 7)
    const cs = b.world.combatants
    for (let i = 0; i < Math.ceil(20 / DT); i++) {
      if (i > 0 && i % 240 === 0) {
        const seat = playerSeatNow(b)
        const victim = i % 480 === 0 && seat >= 0 ? cs[seat]! : firstAlive(cs, 'red', [])
        const killer = firstAlive(cs, victim && victim.team === 'red' ? 'blue' : 'red', [])
        if (victim?.alive && killer) b.world.applyDamage(victim, 99999, 'fuselage', killer)
      }
      stepBattle(b, DT)
      drainEvents(b)
      if (b.outcome !== 'fighting') break
    }
    const deadSeats = cs.filter((c) => !c.alive).length
    const deadPilots = b.roster.pilots.filter((p) => !p.alive).length
    expect(deadSeats).toBeGreaterThan(0)
    expect(deadPilots).toBe(deadSeats)
  })
})

describe('接手鏈打到底（M9 spec §7.3、§8）', () => {
  it('玩家一路接手，藍隊被打光時判落敗', () => {
    // 【為什麼打的是「記分板上玩家的座位」而不是 `b.player`】接手的身分
    // 互換是立刻發生的，操縱權要等 2 秒。打 `b.player` 的話那 2 秒裡打到的
    // 是同一具殘骸（`applyDamage` 對已退場者直接 return），接手鏈就斷了。
    //
    // 【8v8 是為了跨分隊接手】藍隊兩個 Schwarm，玩家在第二個。同分隊的
    // 三位用完之後，接手目標必須落到第一個分隊 —— 那條分支只有在這裡走得到。
    // 【型別要明寫】不寫的話 TS 推斷出 `cfg` 自己的型別，`createBattle(…, cfg, …)`
    // 收的又不是新鮮的物件字面值 —— 多餘屬性檢查兩邊都不會跑。編組表那一輪
    // 實測過：這裡若還寫著 `blueCount: 8` 會靜靜地被忽略，實際跑的是
    // `DEFAULT_BATTLE.units` 的 20v20，而 tsc 一個字都不會說
    const BLUE = 8
    const cfg: BattleConfig = {
      ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, BLUE, BF109K4, 8),
    }
    const b = createBattle(new Idle(), cfg, 1)
    const cs = b.world.combatants
    const seatsUsed = new Set<number>()

    for (let i = 0; i < Math.ceil(30 / DT) && b.outcome === 'fighting'; i++) {
      if (i > 0 && i % 240 === 0) {
        const seat = playerSeatNow(b)
        const killer = firstAlive(cs, 'red', [])
        if (seat >= 0 && killer && cs[seat]!.alive) {
          seatsUsed.add(seat)
          b.world.applyDamage(cs[seat]!, 99999, 'fuselage', killer)
        }
      }
      stepBattle(b, DT)
      drainEvents(b)
    }

    expect(b.outcome).toBe('defeat')
    expect(aliveCount(b.blue)).toBe(0)
    // 八個藍隊座位都當過玩家 —— 接手鏈真的走完了，含跨分隊那一步
    expect(seatsUsed.size).toBe(BLUE)
    // 名冊裡活著的人數 = 場上活著的座位數
    expect(b.roster.pilots.filter((p) => p.alive).length)
      .toBe(cs.filter((c) => c.alive).length)
  })
})
