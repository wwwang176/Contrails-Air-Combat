import { describe, it, expect } from 'vitest'
import { createBattle, resetBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { HEAD_ON } from '../../src/battle/entry'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { B17G } from '../../src/specs/b17g'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'
import type { BattleConfig } from '../../src/battle/setup'
import type { FlightPlan } from '../../src/battle/order'

/**
 * # 擊落的累計
 *
 * `hunt` 規則讀的是 `Battle.redKilled` 與 `redKilledBombers`，而那兩格在
 * `drainKills` 裡累加。
 *
 * 【這裡守什麼】三件會靜靜壞掉的事：
 *
 * ```
 *   數到藍隊頭上    玩家自己摔一架，進度就前進 —— 而畫面上一切正常
 *   同一筆數兩次    headless 不排空擊墜緩衝，同一筆事件每步都會被重掃
 *   重開不歸零      第二局開場就帶著上一局的進度，可能第一幀判勝
 * ```
 *
 * 角色分得開那一條的代價最大：德 M1 的目標是轟炸機，不分的話打護航機也能
 * 過關，那一關的內容就整個變了。
 */

const DT = 1 / 240
const SEED = 20260913

class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

/** 藍隊兩架、紅隊兩架轟炸機加兩架戰鬥機 —— 角色要分得開就得兩種都在場 */
const UNITS: readonly FlightPlan[] = [
  {
    team: 'blue', members: [P51D, P51D], entry: HEAD_ON.blue,
    duty: 'combat', lane: 0, tier: 0, player: true,
  },
  {
    team: 'red', members: [B17G, B17G], entry: HEAD_ON.red,
    duty: 'combat', lane: -1, tier: 0,
  },
  {
    team: 'red', members: [BF109K4, BF109K4], entry: HEAD_ON.red,
    duty: 'combat', lane: 1, tier: 2,
  },
]

const CFG: BattleConfig = {
  ...DEFAULT_BATTLE,
  units: UNITS,
  // 【殲滅而不是 hunt】這一份釘的是**計數**，不是判定。用 hunt 的話打掉
  // 幾架就分出勝負，而分出勝負之後 `stepMission` 不再寫任何欄位 —— 測試
  // 會變成在量「定案凍結」，那是另一條護欄的事
  rules: { kind: 'annihilate' },
}

function start() {
  const b = createBattle(new Idle(), CFG, SEED)
  return b
}

/** 打掉第 `n` 架符合條件的飛機。回傳實際打掉幾架 */
function killSome(
  b: ReturnType<typeof start>, team: 'blue' | 'red', role: 'fighter' | 'bomber', n: number,
): number {
  let done = 0
  for (const c of b.world.combatants) {
    if (done >= n) break
    if (!c.alive || c.team !== team || c.aircraft.spec.role !== role) continue
    b.world.destroy(c)
    done++
  }
  return done
}

describe('擊落的累計', () => {
  it('開局是 0', () => {
    const b = start()
    expect(b.redKilled).toBe(0)
    expect(b.redKilledBombers).toBe(0)
  })

  it('紅隊陣亡才算，而且分得出角色', () => {
    const b = start()
    expect(killSome(b, 'red', 'bomber', 2)).toBe(2)
    expect(killSome(b, 'red', 'fighter', 1)).toBe(1)
    stepBattle(b, DT)
    expect(b.redKilled).toBe(3)
    expect(b.redKilledBombers).toBe(2)
  })

  /**
   * 【代價】玩家自己摔一架就讓進度前進 —— 那一關會在玩家什麼都沒打到的
   * 情況下判勝，而每一個畫面上的數字都正常。
   */
  it('藍隊陣亡完全不算', () => {
    const b = start()
    expect(killSome(b, 'blue', 'fighter', 1)).toBe(1)
    stepBattle(b, DT)
    expect(b.redKilled).toBe(0)
    expect(b.redKilledBombers).toBe(0)
  })

  /**
   * 【headless 不排空擊墜緩衝】同一筆事件每一步都會被重掃，靠 `killsSeen`
   * 游標擋住。少了游標，站著不動也會一直加。
   */
  it('同一筆不會被數第二次', () => {
    const b = start()
    killSome(b, 'red', 'bomber', 1)
    for (let i = 0; i < 50; i++) stepBattle(b, DT)
    expect(b.redKilled).toBe(1)
    expect(b.redKilledBombers).toBe(1)
  })

  it('重開一場歸零', () => {
    const b = start()
    killSome(b, 'red', 'bomber', 2)
    stepBattle(b, DT)
    expect(b.redKilled).toBe(2)

    resetBattle(b, SEED)
    expect(b.redKilled).toBe(0)
    expect(b.redKilledBombers).toBe(0)
    // 【重開之後還要能繼續數】游標若跳過頭，第二局的擊落就全部不算了
    killSome(b, 'red', 'fighter', 1)
    stepBattle(b, DT)
    expect(b.redKilled).toBe(1)
    expect(b.redKilledBombers).toBe(0)
  })
})
