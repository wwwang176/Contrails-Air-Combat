/**
 * **撤離卡的時限接得上 `Battle` 的勝負。**
 *
 * 判定本身（時限歸零 = defeat、Infinity 不會被吃掉）由 `test/unit/mission.test.ts`
 * 對 `stepMission` 驗；這一支驗的是撤離卡經 `missionConfigFrom` 建場之後，時限
 * 歸零那一步 `b.outcome` 真的翻成 defeat。
 *
 *   有限時限 → 必須 `defeat`、`secondsLeft <= 0`、藍隊還有人、玩家還在圈外
 *   Infinity  → 走同樣的步數必須仍然是 `fighting`
 *
 * 合起來說的是「**它是因為時限到了才輸的**」，而不只是「它輸了」。
 */
import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import type { Controller } from '../../src/control/Controller'
import { readyCard, KILL_CARD } from '../fixtures/mission'
import type { ReadyMissionCard } from '../../src/battle/missions'

const DT = 1 / 240

/** 玩家席位什麼都不做 —— 兩步之內飛不進撤離圈 */
const IDLE: Controller = { update() {} }

/** 時限：兩個物理步。第一步還在打、第二步歸零 */
const LIMIT = 2 * DT

/**
 * 一張撤離卡。**自己建，不從 `MISSIONS` 找** —— 出貨的關卡裡沒有撤離卡，撤離的
 * 判定是德 M3 返航節拍靠的那一條。
 */
const CARD: ReadyMissionCard = (() => {
  const kill = readyCard(KILL_CARD).battle
  return {
    id: 'test-evac', titleKey: 'mission.type.withdraw', type: 'withdraw',
    summaryKey: 'mission.type.withdraw',
    placeKey: 'mission.japan-m2.place', period: { year: 1944, month: 11 },
    battle: {
      objectiveKey: 'mission.type.withdraw',
      blueSpec: kill.blueSpec, redSpec: kill.redSpec, convoySpec: null,
      blueCount: 4, redCount: 4, convoyCount: 0, convoyPriority: 1,
      targetDistance: 4000, targetRadius: 1000, seconds: LIMIT,
      entry: 'pursuit', terrain: 'archipelago', arena: kill.arena, clouds: kill.clouds,
    },
  }
})()

/** 照卡片建場、走兩步。`limit` 省略 = 卡片上的時限 */
function run(limit?: number) {
  const base = missionConfigFrom(CARD)
  if (base.rules.kind !== 'evacuate') throw new Error('撤離卡的 rules 應為 evacuate')
  const rules = limit === undefined ? base.rules : { ...base.rules, seconds: limit }
  const b = createBattle(IDLE, { ...base, rules })
  stepBattle(b, DT)
  stepBattle(b, DT)
  return { b, radius: base.rules.radius }
}

describe('撤離任務', () => {
  /**
   * 【四條斷言缺一不可】只斷言 `defeat` 的話，任何原因的落敗都算通過。
   */
  it('時限歸零 → defeat（而且不是被打死、也不是飛到了）', () => {
    const { b, radius } = run()
    expect(b.outcome).toBe('defeat')
    expect(b.mission.secondsLeft).toBeLessThanOrEqual(0)
    expect(b.blue.filter((c) => c.alive).length, '不得是被全滅輸的').toBeGreaterThan(0)
    expect(b.mission.metric, '玩家必須還在圈外').toBeGreaterThan(radius)
  })

  /**
   * ★ **消融：拿掉時限，上一條必須不再成立。**
   */
  it('把時限設成 Infinity 之後，同樣的步數仍然是 fighting', () => {
    const { b } = run(Infinity)
    expect(b.mission.secondsLeft).toBe(Infinity)
    expect(b.outcome).toBe('fighting')
  })
})
