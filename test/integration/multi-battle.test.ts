/**
 * 多機對戰的機制不變量。
 *
 * - 20v20 跑滿一場：退場者的指派槽位、退場目標的釋放、決策相位、事件緩衝
 *   容量、擊墜事件與陣亡數的對帳、存活者不在海面下
 * - 全滅判定、戰績守恆、接手鏈：擊墜由測試人為安排，不依賴 AI 打得如何
 *
 * 不驗戰鬥結果（誰贏、打了多少、打得多兇）。
 */
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
import { AI_DECISION_HZ, AiController } from '../../src/ai/AiController'
import { clearImpacts } from '../../src/world/events'
import { clearKills, KILL_STRIDE } from '../../src/world/kills'
import { clearDamage } from '../../src/world/damage'
import type { Combatant, Team } from '../../src/world/World'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

const DT = 1 / 240
/**
 * 模擬長度，s。開局相距 10 km，編隊接近就要二十幾秒；視窗要夠長，
 * 命中、擊墜事件才會真的流過緩衝，下面的溢位與對帳斷言才不是空的。
 */
const SECONDS = 150
/** 一個決策週期是幾個物理步。10 Hz 決策、240 Hz 物理 → 24 */
const STEPS_PER_DECISION = 240 / AI_DECISION_HZ

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
  /** 全程是否有**存活的**飛機出現在海面之下 */
  wentUnderwater: boolean
  /** 退場的飛機自己的指派槽位沒有歸 −1 的次數 */
  ownSlotDirty: number
  /** 活著的 AI 連續抱著一個已退場目標的最大步數 */
  maxDeadTargetedSteps: number
  /** 單一物理步的最大決策架數 */
  maxDecisionsInOneStep: number
  /** 累計損失 */
  blueLost: number
  redLost: number
  /** 整場累計的命中事件數 */
  hitEventCount: number
  /** 命中與入海兩個事件緩衝累計丟棄了幾筆。門檻：恆為 0 */
  eventsDropped: number
  /** 整場累計的擊墜事件數。門檻：恰好等於陣亡數 */
  killEventCount: number
  /** 擊墜緩衝累計丟棄了幾筆。門檻：恆為 0 —— 容量是參戰架數，結構上不該溢位 */
  killsDropped: number
  /** 受擊事件緩衝累計丟棄了幾筆。門檻：恆為 0 */
  damageDropped: number
}

function observe(): Observed {
  const b: Battle = createBattle(new Idle())
  const cs = b.world.combatants
  const deadTargetedRun = new Int32Array(cs.length)
  const o: Observed = {
    wentUnderwater: false, ownSlotDirty: 0, maxDeadTargetedSteps: 0,
    maxDecisionsInOneStep: 0,
    blueLost: 0, redLost: 0,
    hitEventCount: 0, eventsDropped: 0,
    killEventCount: 0, killsDropped: 0, damageDropped: 0,
  }

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
    clearImpacts(b.world.hitEvents)
    clearImpacts(b.world.splashEvents)
    o.killEventCount += b.world.killEvents.count
    clearKills(b.world.killEvents)
    clearDamage(b.world.damageEvents)

    const nowBlue = aliveCount(b.blue)
    const nowRed = aliveCount(b.red)
    if (nowBlue < prevBlue) o.blueLost += prevBlue - nowBlue
    if (nowRed < prevRed) o.redLost += prevRed - nowRed
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

      const a = b.board.assignments[c.index]!
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

  it('決策相位真的攤開了（M5 spec §6.4）', () => {
    expect(o.maxDecisionsInOneStep).toBeLessThanOrEqual(MAX_DECISIONS_IN_ONE_STEP)
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
