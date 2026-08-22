import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  createTacticalState, resetTacticalState, stepTactics, tacticalCommand,
  teamIndexOf, hasSlot, DEFAULT_TACTICS,
} from '../../src/ai/tactics'
import type { TacticalInput, TacticalPhase, TacticalState } from '../../src/ai/tactics'
import { createTargetBoard } from '../../src/ai/target'
import type { TargetCandidate } from '../../src/ai/target'
import type { Team } from '../../src/world/World'
import { createCommand } from '../../src/control/Controller'
import { createSituation, evaluateGeometry, evaluateEnergy } from '../../src/ai/assess'
import { buildEngageBasis, createEngageBasis } from '../../src/ai/steer'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { BF109G6 } from '../../src/specs/bf109g6'
import { P51D } from '../../src/specs/p51d'

/**
 * 造一組只有 `index` / `team` / `alive` 有意義的候選。
 *
 * 【為什麼可以這樣造】名額只讀那三個欄位。給一台真的 `Aircraft` 會讓這幾條
 * 測試同時依賴飛行模型 —— 那不是它們在問的事。
 */
function board(blue: number, red: number) {
  const cs: TargetCandidate[] = []
  for (let i = 0; i < blue + red; i++) {
    cs.push({
      index: i,
      team: (i < blue ? 'blue' : 'red') as Team,
      alive: true,
    } as unknown as TargetCandidate)
  }
  return createTargetBoard(cs)
}

describe('戰術層的名額', () => {
  it('隊內序號是「我是我方第幾架」', () => {
    const b = board(4, 4)
    expect(teamIndexOf(b, 0)).toBe(0)
    expect(teamIndexOf(b, 3)).toBe(3)
    // 紅隊的第一架全域索引是 4，隊內序號回到 0
    expect(teamIndexOf(b, 4)).toBe(0)
    expect(teamIndexOf(b, 7)).toBe(3)
  })

  it('索引越界回 −1', () => {
    const b = board(2, 2)
    expect(teamIndexOf(b, -1)).toBe(-1)
    expect(teamIndexOf(b, 4)).toBe(-1)
  })

  it('兩隊拿到相同的名額數 —— 這是隊內序號存在的唯一理由', () => {
    // 【為什麼不能用全域 selfIndex】編組表是一隊一個連續區塊，低差異序列在
    // 兩個區塊上會取到不同的比例。實算 quota = 0.5：6v6 是藍 4 紅 2（33%
    // 的偏差）、14v14 是藍 8 紅 6、20v20 是藍 10 紅 11。那會直接變成平衡
    // 偏差，而且沒有任何測試會紅。
    for (const n of [3, 4, 6, 7, 10, 14, 16, 20]) {
      const b = board(n, n)
      let blue = 0
      let red = 0
      for (let i = 0; i < n; i++) if (hasSlot(teamIndexOf(b, i), 0.5)) blue++
      for (let i = n; i < 2 * n; i++) if (hasSlot(teamIndexOf(b, i), 0.5)) red++
      expect(blue).toBe(red)
    }
  })

  it('quota = 0 一律沒有名額，quota = 1 一律有', () => {
    for (let k = 0; k < 40; k++) {
      expect(hasSlot(k, 0)).toBe(false)
      expect(hasSlot(k, 1)).toBe(true)
    }
  })

  it('隊內序號為負時沒有名額 —— 負數取模的陷阱', () => {
    // 【為什麼要專門釘住】JavaScript 的 (−1 × 0.618) % 1 = −0.618，而
    // −0.618 < 0.5 為真。沒有接指派板的單元測試會意外啟用戰術層。
    expect(hasSlot(-1, 0.5)).toBe(false)
    expect(hasSlot(-1, 0.999)).toBe(false)
    expect(hasSlot(-7, 0.5)).toBe(false)
  })

  it('名額的比例大致等於 quota', () => {
    for (const q of [0.25, 0.5, 0.75]) {
      let n = 0
      for (let k = 0; k < 400; k++) if (hasSlot(k, q)) n++
      expect(Math.abs(n / 400 - q)).toBeLessThan(0.02)
    }
  })

  it('同一個序號的答案不隨呼叫改變 —— 逐位元重播的前提', () => {
    for (let k = 0; k < 20; k++) {
      const first = hasSlot(k, 0.5)
      for (let n = 0; n < 5; n++) expect(hasSlot(k, 0.5)).toBe(first)
    }
  })
})

describe('戰術狀態的建立與重置', () => {
  it('createTacticalState 起始是 off', () => {
    const s = createTacticalState()
    expect(s.phase).toBe('off')
    expect(s.dwell).toBe(0)
    expect(s.perchLatch).toBe(false)
    expect(s.lastTarget).toBe(-2)
    expect(Number.isNaN(s.lastCooldownRatio)).toBe(true)
  })

  it('resetTacticalState 回到與新建完全相同的形狀', () => {
    // 【為什麼要逐欄比而不是只看 phase】漏掉任何一欄的症狀是「第二場的第一
    // 秒有幾架飛機從別人的 perch 中途開始」，而那不會讓任何測試變紅。
    const s = createTacticalState()
    s.phase = 'perch'
    s.dwell = 12
    s.perchLatch = true
    s.farLatch = true
    s.commit = 3
    s.closed = true
    s.passing = 2
    s.cooldown = 9
    s.cycleBase = 0.7
    s.cycleValid = true
    s.cycleShot = true
    s.dryRounds = 3
    s.lastCooldownRatio = 0.4
    s.lastTarget = 17
    resetTacticalState(s)
    // NaN !== NaN，所以逐欄比之前先把那一欄挑出來單獨驗
    expect(Number.isNaN(s.lastCooldownRatio)).toBe(true)
    s.lastCooldownRatio = 0
    const fresh = createTacticalState()
    fresh.lastCooldownRatio = 0
    expect(s).toEqual(fresh)
  })
})

describe('起始設定的內部一致性', () => {
  const c = DEFAULT_TACTICS

  it('遲滯的方向對：離開門檻比進入門檻鬆', () => {
    expect(c.perchExit).toBeLessThan(c.perchEnter)
    expect(c.exitRange).toBeLessThan(c.enterRange)
  })

  it('每個期限都留得住它要等的那件事', () => {
    // 【它擋的是「參數自我否定」】期限比它要等的條件還短，那個條件就永遠
    // 不會成立，相位只會被期限踢走 —— 機制看起來在跑，實際上退化成計時器。
    //
    // 【原本這裡寫的是 `perchMax < buildMax`】那是設計期的假設，被實測推翻：
    // `energy-cycle.probe.ts` 量到 `build` 的停留中位是 0.4 s（也就是
    // `minDwell`），進場時 `energyRatio` 多半已經高於 `perchEnter`。「建能要
    // 多久」根本不是這一層的限制，拿它當另一個期限的上界沒有依據。
    expect(c.buildMax).toBeGreaterThan(c.minDwell)
    expect(c.perchMax).toBeGreaterThan(c.commitSeconds)
    expect(c.diveMax).toBeGreaterThan(c.passSeconds)
    expect(c.zoomMax).toBeGreaterThan(c.zoomMin)
  })

  it('盤旋半徑落在兩個距離門檻之間', () => {
    expect(c.perchRange).toBeGreaterThan(c.exitRange)
    expect(c.perchRange).toBeLessThan(c.enterRange)
  })

  it('長冷卻比一般冷卻長，zoom 的下限比上限短', () => {
    expect(c.cooldownSeconds).toBeLessThan(c.longCooldownSeconds)
    expect(c.zoomMin).toBeLessThan(c.zoomMax)
  })

  it('開發期間預設是關掉的', () => {
    // 【為什麼】戰術層一開就會改變 order-of-battle-replay 的 digest，而那個
    // 基準每重跑一次都要專案負責人裁定。出 0 的話整個開發期間那條測試都是
    // 綠的，所有參數定案後才翻開，只需要重跑一次。
    expect(c.quota).toBe(0)
  })
})

const DT = 1 / 240
const C = DEFAULT_TACTICS

/** 一個「有名額、有目標、很遠、能量持平」的預設輸入 */
function input(over: Partial<TacticalInput> = {}): TacticalInput {
  return {
    slot: true,
    suspended: false,
    targetIndex: 7,
    range: 3000,
    energyRatio: 0,
    psTarget: 5,
    closureRate: 0,
    shotInstant: 0,
    pressure: false,
    ...over,
  }
}

/** 跑 `seconds` 秒，每一步用同一組輸入 */
function run(s: TacticalState, inp: TacticalInput, seconds: number): void {
  for (let k = 0; k < Math.round(seconds / DT); k++) stepTactics(s, inp, DT, C)
}

/**
 * 一步一步走到相位改變為止，回傳新的相位。最多走 `capSeconds`。
 *
 * 【為什麼需要它】用固定秒數跑完再看相位，多跑的那零點幾秒會讓狀態又往前
 * 走一格 —— 測試於是在問「N 秒後在哪裡」而不是「下一個相位是什麼」，而後者
 * 才是這些條款要釘的東西。
 */
function until(s: TacticalState, inp: TacticalInput, capSeconds = 120): TacticalPhase {
  const from = s.phase
  const n = Math.round(capSeconds / DT)
  for (let k = 0; k < n; k++) {
    stepTactics(s, inp, DT, C)
    if (s.phase !== from) return s.phase
  }
  return s.phase
}

/** 把一架推進到 `perch`（能量達標、還沒承諾） */
function toPerch(): TacticalState {
  const s = createTacticalState()
  run(s, input({ energyRatio: 0 }), 1)
  run(s, input({ energyRatio: 0.6 }), 1)
  return s
}

/**
 * 跑完一整圈 `build → perch → dive → zoom → 下一個相位`，回傳那個相位。
 *
 * 【為什麼每一段都用 `until` 而不是固定秒數】固定秒數多跑的那零點幾秒會讓
 * 狀態又往前走一格，於是「一輪」的邊界會漂。
 */
function oneRound(s: TacticalState, shot: number): TacticalPhase {
  // 【第二輪以後已經在 build】上一輪的出口就是 build，再跑一次「進入
  // build」會卡在那裡直到建能期限到期 —— 整個序列就從這裡開始錯開。
  if (s.phase === 'off') until(s, input({ energyRatio: 0 }))             // → build
  until(s, input({ energyRatio: 0.6 }))                                  // → perch
  until(s, input({ energyRatio: 0.6, psTarget: -5 }))                    // → dive
  run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: 120, shotInstant: shot }), 1)
  until(s, input({ energyRatio: 0.4, psTarget: -5, closureRate: -120 })) // → zoom
  return until(s, input({ energyRatio: 0.4 }))                           // → build 或 cooldown
}

describe('戰術層的狀態機', () => {
  it('沒有名額時恆為 off', () => {
    const s = createTacticalState()
    run(s, input({ slot: false }), 120)
    expect(s.phase).toBe('off')
  })

  it('有命令或 transit 時恆為 off', () => {
    const s = createTacticalState()
    run(s, input({ suspended: true }), 120)
    expect(s.phase).toBe('off')
  })

  it('太近時不進戰術層', () => {
    const s = createTacticalState()
    run(s, input({ range: 800 }), 120)
    expect(s.phase).toBe('off')
  })

  it('夠遠、有目標、有名額 → 進 build', () => {
    const s = createTacticalState()
    run(s, input(), 1)
    expect(s.phase).toBe('build')
  })

  it('距離的進出是遲滯的', () => {
    const s = createTacticalState()
    // 2000 m 落在 exitRange(1500) 與 enterRange(2500) 之間 —— 進不去
    run(s, input({ range: 2000 }), 5)
    expect(s.phase).toBe('off')
    // 拉到 2600 進得去
    run(s, input({ range: 2600 }), 1)
    expect(s.phase).toBe('build')
    // 回到 2000 不會馬上掉出來（閂鎖記著「遠」）
    run(s, input({ range: 2000 }), 1)
    expect(s.phase).not.toBe('off')
  })

  it('能量達標 → 進 perch', () => {
    expect(toPerch().phase).toBe('perch')
  })

  it('perchLatch 是獨立記憶，dive 期間也更新', () => {
    // 【為什麼重要】少了這個性質，離開 perch 再回來時遲滯就沒有記憶，而遲滯
    // 正是擋震盪的東西。
    const s = toPerch()
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), C.commitSeconds + 1)
    expect(s.phase).toBe('dive')
    expect(s.perchLatch).toBe(true)
    // dive 期間能量掉破 perchExit，閂鎖要跟著掉
    run(s, input({ energyRatio: 0.1, psTarget: -5 }), 1)
    expect(s.perchLatch).toBe(false)
  })

  it('能量在遲滯帶裡來回 100 次，相位不得翻超過一次', () => {
    // 【這一條守的是極限環】專案在 1000 m 線上震盪 40 秒那次，根因就是裸
    // 門檻。閂鎖 + 最短停留是既有的解藥。
    const s = toPerch()
    let flips = 0
    let prev = s.phase
    for (let k = 0; k < 100; k++) {
      // 0.42 / 0.44 都落在 perchExit(0.35) 與 perchEnter(0.5) 之間
      run(s, input({ energyRatio: k % 2 === 0 ? 0.42 : 0.44 }), 0.1)
      if (s.phase !== prev) { flips++; prev = s.phase }
    }
    expect(flips).toBeLessThanOrEqual(1)
  })

  it('minDwell 生效 —— 任何相位不得停留短於它', () => {
    // 【前置只能跑不到 minDwell】跑滿一秒的話 build 的停留早就過了 0.5 s，
    // 下一格立刻進 perch，這條測試什麼都沒驗到。
    const s = createTacticalState()
    run(s, input(), C.minDwell * 0.4)
    expect(s.phase).toBe('build')
    stepTactics(s, input({ energyRatio: 0.9 }), DT, C)
    expect(s.phase).toBe('build')
    run(s, input({ energyRatio: 0.9 }), C.minDwell)
    expect(s.phase).toBe('perch')
  })

  it('建能期限到 → cooldown，而且贏過同拍成立的 perch', () => {
    // 【優先序】期限到了表示這一輪的建能不健康，帶著它進 perch 只是把問題
    // 延後。絕對止損（第 2 級）高於條件轉移（第 5 級）。
    const s = createTacticalState()
    // 全程能量為 0（不會進 perch），跑到期限
    run(s, input({ energyRatio: 0 }), C.buildMax + 1)
    expect(s.phase).toBe('cooldown')
  })

  it('建能期限與 perch 同拍成立時，cooldown 贏', () => {
    // 【為什麼手工造狀態而不是跑到那一拍】要讓「期限到期」與「閂鎖翻真」
    // 落在同一個 dt 上，靠累加 14400 次浮點是碰運氣的。直接把狀態擺成
    // 「還差半拍到期、閂鎖還沒開」，一步就是那一拍。
    const s = createTacticalState()
    s.phase = 'build'
    s.dwell = C.buildMax - DT / 2
    s.lastTarget = 7
    s.farLatch = true
    s.cycleValid = true
    stepTactics(s, input({ energyRatio: 0.9 }), DT, C)
    expect(s.phase).toBe('cooldown')
  })

  it('待機期限到 → 強制 dive，不是 cooldown', () => {
    const s = toPerch()
    run(s, input({ energyRatio: 0.6 }), C.perchMax + 1)
    expect(s.phase).toBe('dive')
  })

  it('dive 期限到也要拉起 —— 否則退化成一路追擊', () => {
    const s = toPerch()
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), C.commitSeconds + 1)
    expect(s.phase).toBe('dive')
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), C.diveMax + 1)
    expect(s.phase).toBe('zoom')
  })

  it('通過目標 → zoom', () => {
    const s = toPerch()
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), C.commitSeconds + 1)
    expect(s.phase).toBe('dive')
    run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: 120 }), 1)
    expect(s.phase).toBe('dive')
    run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: -120 }), C.passSeconds + 0.5)
    expect(s.phase).toBe('zoom')
  })

  it('接近率恰好為 0 不算「正在拉開」', () => {
    // 切向飛行時接近率是 0。那不是通過目標。
    const s = toPerch()
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), C.commitSeconds + 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: 120 }), 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: 0 }), C.passSeconds + 2)
    expect(s.phase).toBe('dive')
  })

  it('zoom 只回 build，不直接跳 perch', () => {
    // 【它擋的是輪次永不結算】直接跳 perch 會形成
    // build → perch → dive → zoom → perch → … 永遠不回 build，於是輪次永遠
    // 不結算、dryRounds 永遠不累積，整條能量帳止損等於不存在。
    const s = toPerch()
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), C.commitSeconds + 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: 120 }), 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: -120 }), C.passSeconds + 0.5)
    expect(s.phase).toBe('zoom')
    // 能量還在（perchLatch 仍為真），但過了 zoomMin 之後**下一個相位**要是
    // build，不是 perch
    expect(until(s, input({ energyRatio: 0.6 }))).toBe('build')
  })

  it('一整圈跑得完', () => {
    const s = createTacticalState()
    expect(oneRound(s, 0.4)).toBe('build')
  })

  it('cooldown 之後先回 off，不會同拍重進 build', () => {
    const s = createTacticalState()
    run(s, input({ energyRatio: 0 }), C.buildMax + 1)
    expect(s.phase).toBe('cooldown')
    run(s, input({ energyRatio: 0 }), C.cooldownSeconds + 0.1)
    expect(s.phase).toBe('off')
  })

  it('同一個目標、同樣的能量，cooldown 之後不會一直重試', () => {
    // 【它擋的是一個永久迴圈】build → cooldown → off → 立刻 build → …
    // 目標一直很遠的話會永遠繞下去，正好把原問題換成另一種永久循環。
    const s = createTacticalState()
    run(s, input({ energyRatio: 0 }), C.buildMax + 1)
    run(s, input({ energyRatio: 0 }), C.cooldownSeconds + 1)
    expect(s.phase).toBe('off')
    run(s, input({ energyRatio: 0 }), 60)
    expect(s.phase).toBe('off')
  })

  it('換了目標就可以重進', () => {
    const s = createTacticalState()
    run(s, input({ energyRatio: 0 }), C.buildMax + 1)
    run(s, input({ energyRatio: 0 }), C.cooldownSeconds + 1)
    expect(s.phase).toBe('off')
    run(s, input({ energyRatio: 0, targetIndex: 99 }), 1)
    expect(s.phase).toBe('build')
  })

  it('能量比上次冷卻時高也可以重進', () => {
    const s = createTacticalState()
    run(s, input({ energyRatio: 0 }), C.buildMax + 1)
    run(s, input({ energyRatio: 0 }), C.cooldownSeconds + 1)
    expect(s.phase).toBe('off')
    run(s, input({ energyRatio: 0.3 }), 1)
    expect(s.phase).toBe('build')
  })

  it('目標消失 → 立刻 off', () => {
    const s = toPerch()
    stepTactics(s, input({ targetIndex: -1 }), DT, C)
    expect(s.phase).toBe('off')
  })

  it('quota = 0 時 stepTactics 恆回 off', () => {
    // 【這一條守著整張消融表的對照組】若關不乾淨，「上線前的行為」那一列量
    // 到的就不是基準。
    const s = createTacticalState()
    const off = { ...C, quota: 0 }
    for (let k = 0; k < Math.round(300 / DT); k++) {
      stepTactics(s, input({ slot: false, energyRatio: 0.9, psTarget: -5 }), DT, off)
      expect(s.phase).toBe('off')
    }
  })
})

describe('目標切換的重置', () => {
  it('承諾計時歸零 —— 否則會誤判新目標已經承諾很久', () => {
    // 【具體的誤判】換目標前累積 1.4 秒的 psTarget < 0，新目標第一拍也是負
    // 值，於是 0.1 秒後就誤判「已持續承諾 1.5 秒」而俯衝。
    const s = toPerch()
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), C.commitSeconds - 0.2)
    expect(s.phase).toBe('perch')
    expect(s.commit).toBeGreaterThan(C.commitSeconds - 0.3)
    stepTactics(s, input({ energyRatio: 0.6, psTarget: -5, targetIndex: 99 }), DT, C)
    expect(s.commit).toBe(0)
    expect(s.phase).toBe('perch')
  })

  it('perchLatch 與通過計時歸零，而且那一拍不會被重新算回來', () => {
    // 【為什麼要專門測「不會被算回來」】清成 false 之後若同一拍又用新目標的
    // 數字跑一次 latch，「切換拍重置」就只是一句沒有效果的話。
    const s = toPerch()
    expect(s.perchLatch).toBe(true)
    stepTactics(s, input({ energyRatio: 0.6, targetIndex: 99 }), DT, C)
    expect(s.perchLatch).toBe(false)
    expect(s.passing).toBe(0)
    expect(s.closed).toBe(false)
    expect(s.cycleValid).toBe(false)
  })

  it('相位不重置 —— 換目標是常態，跟著重置就永遠跑不完一輪', () => {
    const s = toPerch()
    stepTactics(s, input({ energyRatio: 0.6, targetIndex: 99 }), DT, C)
    expect(s.phase).toBe('perch')
  })

  it('相位的計時不歸零 —— 它問的是「這個相位待多久」', () => {
    const s = createTacticalState()
    run(s, input(), 10)
    const before = s.dwell
    stepTactics(s, input({ targetIndex: 99 }), DT, C)
    expect(s.dwell).toBeGreaterThan(before)
  })

  it('能量帳的基準重設成當下', () => {
    // 【只設 cycleValid 不夠】基準若還停在舊目標的尺度上，下一輪開帳之前的
    // 每一格都在跟一個沒有意義的數字比。
    const s = createTacticalState()
    run(s, input({ energyRatio: 0.2 }), 1)
    stepTactics(s, input({ energyRatio: -0.9, targetIndex: 99 }), DT, C)
    expect(s.cycleBase).toBeCloseTo(-0.9, 9)
  })
})

describe('能量帳與長冷卻', () => {
  it('一輪淨損超標 → cooldown', () => {
    const s = createTacticalState()
    run(s, input({ energyRatio: 0.2 }), 1)
    expect(s.phase).toBe('build')
    run(s, input({ energyRatio: 0.2 - C.cycleLossMax - 0.05 }), 0.5)
    expect(s.phase).toBe('cooldown')
  })

  it('換目標那一輪不參與能量帳止損', () => {
    // 【為什麼】energyRatio 是相對當前目標的。換目標時它不連續地跳，硬算那個
    // 差會得到一個沒有意義的數字。
    const s = createTacticalState()
    run(s, input({ energyRatio: 0.2 }), 1)
    run(s, input({ energyRatio: -0.9, targetIndex: 99 }), 1)
    expect(s.phase).not.toBe('cooldown')
  })

  it('連續兩輪沒有射擊窗 → 長冷卻', () => {
    const s = createTacticalState()
    expect(oneRound(s, 0)).toBe('build')
    expect(s.dryRounds).toBe(1)
    expect(oneRound(s, 0)).toBe('cooldown')
    expect(s.cooldown).toBeGreaterThan(C.cooldownSeconds)
  })

  it('有射擊窗就把連續計數歸零', () => {
    const s = createTacticalState()
    oneRound(s, 0)
    expect(s.dryRounds).toBe(1)
    oneRound(s, 0.4)
    expect(s.dryRounds).toBe(0)
  })
})

describe('任務壓力', () => {
  it('任務壓力讓 perch 直接俯衝，不等承諾', () => {
    const s = createTacticalState()
    until(s, input({ energyRatio: 0 }))
    expect(until(s, input({ energyRatio: 0.6 }))).toBe('perch')
    // psTarget 是正的（他沒有在耗能量），承諾判準完全不成立
    expect(until(s, input({ energyRatio: 0.6, psTarget: 5, pressure: true }))).toBe('dive')
  })

  it('沒有壓力時承諾判準照舊', () => {
    const s = createTacticalState()
    until(s, input({ energyRatio: 0 }))
    expect(until(s, input({ energyRatio: 0.6 }))).toBe('perch')
    run(s, input({ energyRatio: 0.6, psTarget: 5, pressure: false }), 5)
    expect(s.phase).toBe('perch')
  })
})

/** 造一組「我在下面、他在前上方 3 km」的態勢 */
function scene() {
  const self = new Aircraft(BF109G6, 5000, 200)
  const target = new Aircraft(P51D, 5300, 240)
  target.state.position.set(0, 5300, -3000)
  self.update(new Vector3(0, 0, -1), 0.8, DT)
  target.update(new Vector3(0, 0, -1), 0.8, DT)
  const sit = createSituation()
  evaluateGeometry(self, target, sit)
  evaluateEnergy(self, target, sit)
  const basis = createEngageBasis()
  buildEngageBasis(self, target, basis)
  return { self, target, sit, basis }
}

describe('戰術層的矄準解', () => {
  it('build 命令爬升', () => {
    const { self, sit, basis } = scene()
    const out = createCommand()
    tacticalCommand('build', sit, basis, self, 0, DEFAULT_TACTICS, out)
    expect(out.aimWorld.y).toBeGreaterThan(0)
  })

  it('zoom 命令的爬升比 build 陡', () => {
    const { self, sit, basis } = scene()
    const a = createCommand()
    const b = createCommand()
    tacticalCommand('build', sit, basis, self, 0, DEFAULT_TACTICS, a)
    tacticalCommand('zoom', sit, basis, self, 0, DEFAULT_TACTICS, b)
    expect(b.aimWorld.y).toBeGreaterThan(a.aimWorld.y)
  })

  it('perch 大致平飛 —— 保持能量而不是繼續存', () => {
    const { self, sit, basis } = scene()
    const out = createCommand()
    tacticalCommand('perch', sit, basis, self, 0, DEFAULT_TACTICS, out)
    expect(Math.abs(out.aimWorld.y)).toBeLessThan(0.2)
  })

  it('perch 的徑向修正是連續的 —— 在 perchRange 上不得翻號', () => {
    // 【它擋的是一個極限環】寫成「距離小於 perchRange 就轉開」會在門檻上
    // 翻號：飛離 → 距離變大 → 翻號 → 飛近 → 距離變小 → 翻號。振幅由飛機
    // 的響應決定，不由任何設計參數決定。
    const { self, sit, basis } = scene()
    const out = createCommand()
    const R = DEFAULT_TACTICS.perchRange
    let prev: number | null = null
    let jumps = 0
    for (const range of [R * 0.9, R * 0.97, R, R * 1.03, R * 1.1, R * 1.03, R, R * 0.97]) {
      sit.range = range
      tacticalCommand('perch', sit, basis, self, 0, DEFAULT_TACTICS, out)
      const radial = out.aimWorld.dot(basis.losAxis)
      if (prev !== null && Math.abs(radial - prev) > 0.5) jumps++
      prev = radial
    }
    // 連續的話相鄰兩格的徑向分量不會跳
    expect(jumps).toBe(0)
  })

  it('perch 太遠時靠近、太近時遠離', () => {
    const { self, sit, basis } = scene()
    const out = createCommand()
    sit.range = DEFAULT_TACTICS.perchRange * 3
    tacticalCommand('perch', sit, basis, self, 0, DEFAULT_TACTICS, out)
    expect(out.aimWorld.dot(basis.losAxis)).toBeGreaterThan(0)
    sit.range = DEFAULT_TACTICS.perchRange * 0.2
    tacticalCommand('perch', sit, basis, self, 0, DEFAULT_TACTICS, out)
    expect(out.aimWorld.dot(basis.losAxis)).toBeLessThan(0)
  })

  it('三個相位都不開火', () => {
    // 【為什麼】build / perch / zoom 都在遠距離經營能量。這一層扣扳機只會
    // 把彈藥丟在一個打不到的方向上，而且 `fireShare` 是護欄指標。
    const { self, sit, basis } = scene()
    const out = createCommand()
    out.firing = true
    for (const phase of ['build', 'perch', 'zoom'] as const) {
      tacticalCommand(phase, sit, basis, self, 0, DEFAULT_TACTICS, out)
      expect(out.firing).toBe(false)
    }
  })

  it('四個欄位每次都完整寫入 —— out 是重用的物件', () => {
    // 【為什麼要釘住】AiController 的 raw 是重用的。不寫的欄位會保留上一
    // 格的值，而上一格可能是一個俯衝中的脫離向量或一個扣著的扳機。
    const { self, sit, basis } = scene()
    const out = createCommand()
    out.aimWorld.set(1, 0, 0)
    out.throttle = 0
    out.brake = 1
    out.firing = true
    tacticalCommand('build', sit, basis, self, 0, DEFAULT_TACTICS, out)
    expect(out.aimWorld.x).not.toBe(1)
    expect(out.throttle).toBeGreaterThan(0)
    expect(out.brake).toBe(0)
    expect(out.firing).toBe(false)
  })

  it('矄準方向恆為單位向量', () => {
    const { self, sit, basis } = scene()
    const out = createCommand()
    for (const phase of ['build', 'perch', 'zoom'] as const) {
      tacticalCommand(phase, sit, basis, self, 0, DEFAULT_TACTICS, out)
      expect(out.aimWorld.length()).toBeCloseTo(1, 6)
    }
  })

  it('拉桿紀律取兩層的較小值', () => {
    // 【為什麼不能只套 pullCeiling】正常轉向取的是
    // min(unloadPull(stallMargin), pullCeiling)。只套一層會失去「拉太猛」
    // 那一半的軟限制，而這條路徑繞過了 steerCommand。
    const { self, sit, basis } = scene()
    const out = createCommand()
    sit.pullCeiling = 0.2
    sit.stallMargin = 1.02      // 已經逼近 CLmax
    tacticalCommand('build', sit, basis, self, 0, DEFAULT_TACTICS, out)
    const nose = new Vector3(0, 0, -1).applyQuaternion(self.state.orientation)
    // 收得比純 pullCeiling 更緊 —— 也就是更靠近機首
    expect(out.aimWorld.dot(nose)).toBeGreaterThan(0.9)
  })
})
