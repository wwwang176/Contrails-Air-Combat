import { describe, expect, it } from 'vitest'
import { missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { BF109K4 } from '../../src/specs/bf109k4'
import { applyFeel, BOMBER_FEEL, feelFor, GAME_FEEL } from '../../src/specs/feel'
import { JU87 } from '../../src/specs/ju87'
import { cardWith, readyCard } from '../fixtures/mission'
import type { Combatant } from '../../src/world/World'

/**
 * # 任務卡指定用哪一組手感
 *
 * 與 `loadouts`、`liveries` 同一個概念：卡片以機種 id 指名，沒指名的機種照角色挑（戰鬥機 `GAME_FEEL`、
 * 轟炸機 `BOMBER_FEEL`）。德 M4 讓 Ju 87 用戰鬥機那一組：爬回進場高度的時間縮短，極速不動。
 */

const idle = { update() {} }
const powerOf = (c: Combatant): number => c.aircraft.spec.engine.gears[0]!.powerSeaLevel

describe('feelFor：依角色挑，也可以指名', () => {
  it('不指名：轟炸機 BOMBER_FEEL、戰鬥機 GAME_FEEL（與改之前相同）', () => {
    expect(feelFor(JU87)).toBe(BOMBER_FEEL)
    expect(feelFor(BF109K4)).toBe(GAME_FEEL)
  })

  it('指名 fighter／bomber：不管角色', () => {
    expect(feelFor(JU87, 'fighter')).toBe(GAME_FEEL)
    expect(feelFor(BF109K4, 'bomber')).toBe(BOMBER_FEEL)
    expect(feelFor(JU87, 'bomber')).toBe(BOMBER_FEEL)
  })
})

describe('任務卡 → 戰鬥設定', () => {
  it('德 M4 指定 Ju 87 用戰鬥機手感', () => {
    expect(missionConfigFrom(readyCard('germany-m4')).feels).toEqual({ ju87: 'fighter' })
  })

  it('沒有 feels 的卡片與遭遇戰，戰鬥設定沒有這個鍵', () => {
    for (const id of ['germany-m1', 'germany-m2', 'germany-m3']) {
      expect('feels' in missionConfigFrom(readyCard(id)), id).toBe(false)
    }
    expect('feels' in battleConfigFrom(DEFAULT_SKIRMISH)).toBe(false)
  })
})

describe('建場時套的手感', () => {
  const base = JU87.engine.gears[0]!.powerSeaLevel

  it('德 M4：Ju 87 的功率是史實值乘戰鬥機那一組的倍率，不是轟炸機的', () => {
    const b = createBattle(idle, missionConfigFrom(readyCard('germany-m4')), 1)
    const ju = b.world.combatants.filter((c) => c.aircraft.spec.id === 'ju87')
    expect(ju).toHaveLength(6)
    for (const c of ju) expect(powerOf(c)).toBeCloseTo(base * GAME_FEEL.power, 3)
  })

  it('沒指名的卡：Ju 87 仍是轟炸機的倍率', () => {
    const m = readyCard('germany-m4')
    const { feels: _feels, ...rest } = m.battle
    const card = { ...m, battle: rest } as ReadyMissionCard
    const b = createBattle(idle, missionConfigFrom(card), 1)
    for (const c of b.world.combatants.filter((x) => x.aircraft.spec.id === 'ju87')) {
      expect(powerOf(c)).toBeCloseTo(base * BOMBER_FEEL.power, 3)
    }
  })

  it('護航的 Bf 109 不受影響：還是戰鬥機那一組', () => {
    const b = createBattle(idle, missionConfigFrom(readyCard('germany-m4')), 1)
    const k4 = b.world.combatants.find((c) => c.aircraft.spec.id === 'bf109k4')!
    expect(powerOf(k4)).toBeCloseTo(BF109K4.engine.gears[0]!.powerSeaLevel * GAME_FEEL.power, 3)
  })

  it('增援進場的 Ju 87 也照卡片的指名（與開場同一條生成路徑）', () => {
    const wave = {
      when: { kind: 'clock' as const, at: 1 }, warnKey: 'mission.germany-m4.wave.fighters' as const, warnLead: 0,
      side: 'mine' as const, spec: JU87, count: 1,
    }
    const b = createBattle(idle, missionConfigFrom(cardWith('germany-m4', { waves: [wave] })), 1)
    const before = b.world.combatants.length
    for (let i = 0; i < 600 && b.world.combatants.length === before; i++) stepBattle(b, 1 / 240)
    expect(b.world.combatants.length).toBe(before + 1)
    expect(powerOf(b.world.combatants[before]!)).toBeCloseTo(base * GAME_FEEL.power, 3)
  })

  it('套戰鬥機手感的 Ju 87，爬升比轟炸機手感快（極速幾乎不動）', async () => {
    const { maxClimbRate, maxLevelSpeed } = await import('../../src/analysis/envelope')
    const bomber = applyFeel(JU87, BOMBER_FEEL)
    const fighter = applyFeel(JU87, GAME_FEEL)
    expect(maxClimbRate(fighter, 800).rate).toBeGreaterThan(maxClimbRate(bomber, 800).rate * 1.4)
    expect(maxLevelSpeed(fighter, 1700) / maxLevelSpeed(bomber, 1700)).toBeLessThan(1.02)
  })
})
