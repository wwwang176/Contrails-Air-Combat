import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_COMMAND, type FlightOrder } from '../../src/ai/command'

/**
 * 撤退令不得把戰鬥推出戰場。
 *
 * ── 【它守的是什麼】────────────────────────────────────
 *
 * 專案負責人試飛回報「Bf109 在戰場周圍一直上下繞，看起來也不像在累積
 * 能量」。實測**兩隊完全一樣**，不是機種問題。
 *
 * 根因（spec §2）：`planFlightOrder` 的集合點是**相對分隊自己當下的位置**
 * 算的（往外 `withdrawRange`、往上 `withdrawClimb`），而唯一的解除條件是
 * 抵達。於是每完成一次撤退，分隊就被永久位移一次，下一張又從新位置起算
 * —— 一個沒有不動點的純積分器。實測 300 秒外擴到平均 9 km、最大 18 km，
 * TAS 從 200 掉到 110 之後四分鐘沒回來過。
 *
 * ── 【為什麼是 300 秒而不是 120】────────────────────────
 *
 * 2026-08-07 的 22 組掃描窗口是 120 秒，而外擴在接敵（約 60 秒）之後才開始
 * —— 那個窗口只涵蓋大約一個半循環。這條刻意跑到 300 秒。
 *
 * ── 【場景綁死 `DEFAULT_BATTLE`】────────────────────────
 *
 * `createBattle(new AiController())`：玩家座位也交給 AI，所以十支分隊全部
 * 受指揮（傳 `Idle` 的話藍方那一支會自治，量到的東西不一樣）。
 * 開場散布、`entryRange`、編成任一改動，下面的 `MAX_RADIUS` 就會變脆。
 */
const DT = 1 / 240
const SECONDS = 300
const STEPS = SECONDS * 240

/**
 * 全場任何一架離開場中心的水平距離上限，m。
 *
 * 【6000 怎麼來的】`DEFAULT_BATTLE` 的出生點在 `z = ±entryRange/2`，開場
 * 半徑實測 5,287 m。「不得比開場更遠」就是這個數加一點餘裕。
 * **不是 `entryRange`（10,000）** —— 那是**兩隊的間距**，拿它當半徑門檻
 * 會鬆一倍。修前基準 18,188 m。
 *
 * 【為什麼是 6500 而不是 5888】5,888 是**開場那一下**的偏擺：兩隊由 5,287 m
 * 相向轉進時會先盪出去一點。六組掃描裡凡是沒有漂移的組別，最大半徑都**恰好
 * 是 5,888**（逐位元相同），連「完全不發撤退令」的對照組也是 —— 它是這個
 * 場景的地板，與這一份的修改無關。門檻取它加一成。
 */
const MAX_RADIUS = 6500

/**
 * 接敵之後允許的外擴，m。
 *
 * 【為什麼比的是 t=60s 而不是 t=0s】開場兩隊相距 10 km，半徑本來就大；
 * 接敵時收斂到最小（實測 t=60s 約 1,676 m）。要守的是「**接敵之後**不再
 * 單調外擴」，所以基準點取收斂處。修前基準：+7,268 m（1676 → 8944，
 * 而且 300 秒時仍在上升）。
 */
const MAX_GROWTH = 2000

/** 300 秒的兩隊總掉血下限。修前基準 9,181（B6353 + R2828）的八成。 */
const MIN_DAMAGE = 7345

interface Pair {
  /** 發令當下分隊存活成員的平均 cornerRatio */
  before: number
  after: number
  /** 這張命令活了幾秒 */
  life: number
}

function teamCentroid(b: Battle, team: 'blue' | 'red', out: Vector3): number {
  out.set(0, 0, 0)
  let n = 0
  for (const c of team === 'blue' ? b.blue : b.red) {
    if (!c.alive) continue
    out.add(c.aircraft.state.position)
    n++
  }
  if (n > 0) out.divideScalar(n)
  return n
}

/** 第 `f` 支分隊此刻的命令。索引是**全域**分隊索引。 */
function orderOf(b: Battle, f: number): FlightOrder | null {
  const st = b.flights.flights[f]!.team === 'blue' ? b.blueCommand : b.redCommand
  return st.orders[f] ?? null
}

/** 第 `f` 支分隊存活成員的平均 `cornerRatio`；沒有存活成員回 NaN。 */
function flightCornerRatio(b: Battle, f: number): number {
  const fl = b.flights.flights[f]!
  let sum = 0
  let n = 0
  for (let p = 0; p < fl.count; p++) {
    const i = fl.members[p]!
    const c = b.world.combatants[i]
    if (c === undefined || !c.alive) continue
    sum += b.commandUnits[i]!.cornerRatio
    n++
  }
  return n === 0 ? NaN : sum / n
}

describe('撤退令不得把戰鬥推出戰場（20v20、300 秒）', () => {
  it('半徑有界、撤退真的補到能量、佔時合理', () => {
    const b = createBattle(new AiController())
    const hp0 = b.world.combatants.map((c) => c.hp)
    const nFlights = b.flights.flights.length

    const held: (FlightOrder | null)[] = new Array(nFlights).fill(null)
    const bornAt = new Float64Array(nFlights)
    const bornRatio = new Float64Array(nFlights)
    const pairs: Pair[] = []

    let aliveSamples = 0
    let leavingSamples = 0
    /** 見底、但因為閘門（或任何理由）沒拿到命令的取樣 */
    let spentWithoutOrder = 0
    let deathsUnderOrder = 0
    let maxRadius = 0
    let maxConcurrentRally = 0

    const wasAlive = b.world.combatants.map((c) => c.alive)
    const BLUE = new Vector3()
    const RED = new Vector3()
    let r60 = { blue: 0, red: 0 }
    let r300 = { blue: 0, red: 0 }

    const meanRadius = (team: 'blue' | 'red'): number => {
      let sum = 0
      let n = 0
      for (const c of team === 'blue' ? b.blue : b.red) {
        if (!c.alive) continue
        const p = c.aircraft.state.position
        sum += Math.hypot(p.x, p.z)
        n++
      }
      return n === 0 ? 0 : sum / n
    }

    for (let s = 0; s <= STEPS; s++) {
      if (s > 0) stepBattle(b, DT)
      const t = s / 240

      teamCentroid(b, 'blue', BLUE)
      teamCentroid(b, 'red', RED)

      // ── 命令的生死 ───────────────────────────────────
      let concurrent = 0
      for (let f = 0; f < nFlights; f++) {
        const now = orderOf(b, f)
        if (now?.kind === 'rally') concurrent++
        const was = held[f]
        if (now !== was) {
          if (now?.kind === 'rally') {
            bornAt[f] = t
            bornRatio[f] = flightCornerRatio(b, f)
          } else if (was?.kind === 'rally') {
            const after = flightCornerRatio(b, f)
            const before = bornRatio[f]!
            // 【解除時已全滅的那幾對要丟掉】沒有存活成員可比，平均是 NaN
            if (Number.isFinite(after) && Number.isFinite(before)) {
              pairs.push({ before, after, life: t - bornAt[f]! })
            }
          }
          held[f] = now
        }
      }
      if (concurrent > maxConcurrentRally) maxConcurrentRally = concurrent

      // ── 每架每取樣 ───────────────────────────────────
      for (const c of b.world.combatants) {
        if (!c.alive) {
          if (wasAlive[c.index]) {
            wasAlive[c.index] = false
            const f = b.flights.flightOf[c.index]!
            if (f >= 0 && held[f]?.kind === 'rally') deathsUnderOrder++
          }
          continue
        }
        aliveSamples++
        const p = c.aircraft.state.position
        const r = Math.hypot(p.x, p.z)
        if (r > maxRadius) maxRadius = r
        const f = b.flights.flightOf[c.index]!
        if (f < 0) continue
        const o = orderOf(b, f)
        if (o?.kind === 'rally') {
          leavingSamples++
        } else if (o === null) {
          const st = b.flights.flights[f]!.team === 'blue' ? b.blueCommand : b.redCommand
          if (st.spent[f]! >= DEFAULT_COMMAND.spentSeconds) spentWithoutOrder++
        }
      }

      if (s === 60 * 240) r60 = { blue: meanRadius('blue'), red: meanRadius('red') }
      if (s === STEPS) r300 = { blue: meanRadius('blue'), red: meanRadius('red') }
    }

    let blueDmg = 0
    let redDmg = 0
    for (const c of b.world.combatants) {
      const lost = hp0[c.index]! - c.hp
      if (c.team === 'blue') blueDmg += lost
      else redDmg += lost
    }
    const leavingShare = leavingSamples / Math.max(aliveSamples, 1)
    const improved = pairs.filter((p) => p.after > p.before).length
    const lives = pairs.map((p) => p.life).sort((x, y) => x - y)

    // 【全部印出來】Task 5 的掃描要拿這些數字選值，而且其中好幾個是設計
    // 假設的可證偽量，不是斷言（見下方各自的註解）
    console.log(JSON.stringify({
      r60: { blue: r60.blue.toFixed(0), red: r60.red.toFixed(0) },
      r300: { blue: r300.blue.toFixed(0), red: r300.red.toFixed(0) },
      maxRadius: maxRadius.toFixed(0),
      alive: { blue: b.blue.filter((c) => c.alive).length, red: b.red.filter((c) => c.alive).length },
      damage: { blue: blueDmg.toFixed(0), red: redDmg.toFixed(0) },
      ratio: (Math.max(blueDmg, redDmg) / Math.max(Math.min(blueDmg, redDmg), 1)).toFixed(3),
      leavingShare: (leavingShare * 100).toFixed(2) + '%',
      spentWithoutOrderShare: (100 * spentWithoutOrder / Math.max(aliveSamples, 1)).toFixed(2) + '%',
      rallyPairs: pairs.length,
      improvedShare: pairs.length === 0 ? '—' : (100 * improved / pairs.length).toFixed(1) + '%',
      lifeMedian: lives.length === 0 ? '—' : lives[Math.floor(lives.length / 2)]!.toFixed(1) + 's',
      maxConcurrentRally,
      deathsUnderOrder,
    }))

    // ── 主判準一：戰鬥不得漂出戰場 ────────────────────────
    expect(r300.blue).toBeLessThanOrEqual(r60.blue + MAX_GROWTH)
    expect(r300.red).toBeLessThanOrEqual(r60.red + MAX_GROWTH)
    expect(maxRadius).toBeLessThanOrEqual(MAX_RADIUS)

    // ── 主判準二：撤退令要真的補到能量 ─────────────────────
    // 【為什麼是配對比較而不是絕對值】TAS／cornerRatio 是**結果**不是判準，
    // 訂一個數字等於把飛行模型的結論寫死在 AI 的測試裡。這裡比的是同一張
    // 命令的發令當下與解除當下，門檻 0.5 沒有可調的數字 —— 與
    // `ai-command-channel.test.ts` 的「命令期間編隊收攏」同一個手法。
    //
    // 【它擋的是什麼】撤退的行程若被縮成 0（命令發出下一格就判到達），
    // 半徑那三條照樣全綠，而這一份的起因（「不像在累積能量」）原封不動。
    expect(pairs.length).toBeGreaterThan(0)
    expect(improved / pairs.length).toBeGreaterThan(0.5)

    // ── 次判準 ──────────────────────────────────────
    // 【這把尺】每架飛機、每取樣，與 `ai-command-channel.test.ts:426` 的
    // `leavingSamples / aliveSamples` 同一個定義。**不可以拿分隊格數當分母**
    // —— `createCommandState` 是用全部分隊數建的，對方那五格恆為 null。
    //
    // 【與既有的 LEAVING 有一點差】既有那個數的是 rally + flank，這裡只數
    // rally。目前 flank 實務上不觸發，兩者接近，但不是同一個數。
    //
    // 【5%~25% 沿用 2026-08-07 的判準】低於 5% 指揮層的影響量不出來，
    // 高於 25% 表示場上有四分之一的飛機在離場 —— 那不是空戰。
    expect(leavingShare).toBeGreaterThan(0.05)
    expect(leavingShare).toBeLessThan(0.25)

    // 【粗篩，不是精確判準】只回答「他們還在打仗嗎」。留兩成餘裕是因為
    // 單次量測當門檻是變更偵測器不是設計判準
    // （`ai-command-decision.test.ts:144-172` 已裁定這把尺解析不了 10%）。
    expect(blueDmg + redDmg).toBeGreaterThanOrEqual(MIN_DAMAGE)
  }, 10 * 60 * 1000)
})
