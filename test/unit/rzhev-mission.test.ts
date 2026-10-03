import { describe, expect, it } from 'vitest'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import type { GroundTarget } from '../../src/world/groundTargets'
import { ENTRY_PLANS } from '../../src/battle/entry'
import { DEFAULT_BATTLE } from '../../src/battle/setup'
import { ARENA_RADIUS } from '../../src/world/arena'
import { PANZER_ROUTE_B } from '../../src/world/rzhev'
import { AiController } from '../../src/ai/AiController'
import { YAK1B } from '../../src/specs/yak1b'
import type { ReinforceBeat } from '../../src/battle/beats'

/**
 * # 德 M4 的兩個節拍：縱隊出發與換目標
 *
 * 用真的卡片建場，**手動**把目標打掉（不跑飛行），只看節拍那一層：反坦克砲全毀的
 * 那一步換成第二段、不判勝；縱隊開始走；藏著的反擊縱隊出現；第二段數到才贏。
 */

const card = MISSIONS.germany.find((c) => c.id === 'germany-m4') as ReadyMissionCard
const DT = 1 / 240

function battle(): Battle {
  return createBattle({ update() {} }, missionConfigFrom(card), 1)
}
function units(b: Battle, id: string): GroundTarget[] {
  return b.world.groundTargets.filter((t) => t.unit.id === id)
}
function wreck(t: GroundTarget): void {
  t.hp = 0
  t.alive = false
}
function steps(b: Battle, n: number): void {
  for (let i = 0; i < n; i++) stepBattle(b, DT)
}

describe('德 M4 的縱隊與換目標', () => {
  it('開場：反擊的 T-34 藏著，德軍縱隊停著', () => {
    const b = battle()
    steps(b, 240)
    for (const t of units(b, 'tank')) {
      expect(t.dormant).toBe(true)
      expect(t.alive).toBe(false)
    }
    const panzers = b.world.groundTargets.filter((t) => t.motion !== null && t.team === 'blue')
    expect(panzers.length).toBe(20)
    for (const t of panzers) expect(t.speed).toBe(0)
    expect(b.rules).toMatchObject({ kind: 'destroy', count: 7, unit: 'atGun' })
  })

  it('反坦克砲炸夠七門的那一步換成第二段，不判勝', () => {
    const b = battle()
    steps(b, 10)
    for (const t of units(b, 'atGun')) wreck(t)
    steps(b, 1)
    expect(b.mission.outcome).toBe('fighting')
    expect(b.rules).toMatchObject({ kind: 'destroy', count: 8, unit: 'tank' })
    expect(b.objectiveKey).toBe('mission.germany-m4.retarget')
    expect(b.message).toBe('mission.germany-m4.retarget')
  })

  /**
   * 【不必全部殲滅】炸到七門缺口就開了；剩下的三門由前進的德軍戰車打掉（劇本，`mopUp`），
   * 畫面上由地面戰的戲補一發命中的砲彈。劇本打掉的不算進摧毀數。
   */
  describe('炸夠數就進下一段，剩下的砲由戰車打掉', () => {
    it('六門還不夠：目標不換、縱隊不出發', () => {
      const b = battle()
      steps(b, 10)
      const guns = units(b, 'atGun')
      for (let i = 0; i < 6; i++) wreck(guns[i]!)
      steps(b, 2 * 240)
      expect(b.rules).toMatchObject({ kind: 'destroy', unit: 'atGun' })
      for (const t of b.world.groundTargets.filter((x) => x.motion !== null && x.team === 'blue')) expect(t.speed).toBe(0)
      for (const g of guns.slice(6)) expect(g.killAt).toBe(Infinity)
    })

    it('第七門炸掉的那一步：換成第二段、縱隊出發、剩下三門排定在 12～45 秒內被打掉', () => {
      const b = battle()
      steps(b, 10)
      const guns = units(b, 'atGun')
      for (let i = 0; i < 7; i++) wreck(guns[i]!)
      const now = b.world.time
      steps(b, 1)
      expect(b.rules).toMatchObject({ kind: 'destroy', count: 8, unit: 'tank' })
      const left = guns.slice(7)
      expect(left).toHaveLength(3)
      for (const g of left) {
        expect(g.alive).toBe(true)
        expect(g.killAt - now).toBeGreaterThanOrEqual(12 - 1e-6)
        expect(g.killAt - now).toBeLessThanOrEqual(45 + 0.1)
      }
      // 不是同一刻一排爆：三門的時刻各不相同
      expect(new Set(left.map((g) => g.killAt)).size).toBe(3)
    })

    it('50 秒後剩下的都死了，標成劇本打掉的、不算進摧毀數；已經炸掉的七門不受影響', () => {
      const b = battle()
      steps(b, 10)
      const guns = units(b, 'atGun')
      for (let i = 0; i < 7; i++) wreck(guns[i]!)
      steps(b, 50 * 240)
      for (const g of guns.slice(7)) {
        expect(g.alive).toBe(false)
        expect(g.scripted).toBe(true)
      }
      for (const g of guns.slice(0, 7)) expect(g.scripted).toBe(false)
      expect(b.mission.outcome).toBe('fighting')
    })
  })

  it('換段之後縱隊出發，反擊的 T-34 出現', () => {
    const b = battle()
    steps(b, 10)
    for (const t of units(b, 'atGun')) wreck(t)
    steps(b, 2 * 240)
    for (const t of units(b, 'tank')) {
      expect(t.dormant).toBe(false)
      expect(t.alive).toBe(true)
      expect(t.speed).toBeGreaterThan(0)
    }
    const panzers = b.world.groundTargets.filter((t) => t.motion !== null && t.team === 'blue')
    for (const t of panzers) expect(t.speed).toBeGreaterThan(0)
  })

  it('第二段：反擊的預備隊 T-34 炸掉 8 輛才贏，半埋的不算', () => {
    const b = battle()
    steps(b, 10)
    for (const t of units(b, 'atGun')) wreck(t)
    steps(b, 2)
    for (const t of units(b, 'tankDug')) wreck(t)
    steps(b, 2)
    expect(b.mission.outcome).toBe('fighting')
    const tanks = units(b, 'tank')
    expect(tanks.length).toBe(20)
    for (let i = 0; i < 7; i++) wreck(tanks[i]!)
    steps(b, 2)
    expect(b.mission.outcome).toBe('fighting')
    wreck(tanks[7]!)
    steps(b, 2)
    expect(b.mission.outcome).toBe('victory')
  })
})

describe('庫斯克的進場對準戰場', () => {
  const lead = ENTRY_PLANS[card.battle.entry].blue
  const x = lead.across * DEFAULT_BATTLE.lateralOffset
  const z = lead.along * DEFAULT_BATTLE.entryRange + lead.gap

  it('玩家開場離德軍集結地至少 4.5 km，而且橫向對準路（差不到 500 m）', () => {
    // 離玩家最近的德軍單位：B 縱隊的尾端（路線第一點）
    const staging = PANZER_ROUTE_B[0]!
    expect(z - staging.z).toBeGreaterThan(4500)
    expect(Math.abs(x - staging.x)).toBeLessThan(500)
  })

  it('開場位置在競技場裡', () => {
    expect(Math.hypot(x, z)).toBeLessThan(ARENA_RADIUS)
  })

  /**
   * 【三批交錯進場】兩架一批、共六架；第 `g` 批比第一批多落後 `g × depth`，玩家在第一批。
   * 同一張卡把 `depth` 設成 0 當對照，量差值，才不會綁死站位表的數字。
   */
  it('六架分三批，每批兩架；後面的批依序多落後 depth，玩家在第一批', () => {
    const waves = card.battle.blueWaves!
    expect(card.battle.blueCount).toBe(6)
    expect(waves.size).toBe(2)
    expect(waves.depth).toBeGreaterThan(0)
    const flat = { ...card, battle: { ...card.battle, blueWaves: { ...waves, depth: 0 } } } as ReadyMissionCard
    const base = createBattle({ update() {} }, missionConfigFrom(flat), 1)
    const trailed = battle()
    expect(trailed.playerSeat).toBeLessThan(2)
    for (let i = 0; i < 6; i++) {
      const p = base.world.combatants[i]!.aircraft.state.position
      const q = trailed.world.combatants[i]!.aircraft.state.position
      expect(q.x, `x ${i}`).toBeCloseTo(p.x, 6)
      expect(q.y, `y ${i}`).toBeCloseTo(p.y, 6)
      expect(q.z - p.z, `z ${i}`).toBeCloseTo(Math.floor(i / 2) * waves.depth, 6)
    }
  })
})

/**
 * # 德 M4 的蘇軍戰鬥機與我方護航
 *
 * 只驗卡片的接線：誰在哪一邊、多少架、護航與 Ju 87 同一刻生成、Ju 87 在敵機眼裡值多少、護航機只打
 * 飛機、Ju 87 全滅就敗。打起來合不合理是試玩的事。
 */
describe('德 M4 的 Yak-1B 與 Bf 109 護航', () => {
  const reinforces = (missionConfigFrom(card).beats ?? []).filter((x): x is ReinforceBeat => x.kind === 'reinforce')
  const yaks = reinforces.filter((x) => x.flight.team === 'red')

  it('敵方六架 Yak-1B 從紅方開局點進場，護航不走波次', () => {
    expect(yaks.reduce((s, x) => s + x.flight.members.filter((m) => m.id === 'yak1b').length, 0)).toBe(6)
    expect(reinforces.every((x) => x.flight.team === 'red')).toBe(true)
  })

  it('開場藍隊是六架 Ju 87 加六架 Bf 109 護航；護航在轟炸機上方', () => {
    const b = createBattle(new AiController(), missionConfigFrom(card), 1)
    const blue = b.world.combatants.filter((c) => c.team === 'blue')
    const stukas = blue.filter((c) => c.aircraft.spec.id === 'ju87')
    const escorts = blue.filter((c) => c.aircraft.spec.id === 'bf109k4')
    expect(stukas).toHaveLength(6)
    expect(escorts).toHaveLength(6)
    const lowestEscort = Math.min(...escorts.map((c) => c.aircraft.state.position.y))
    const highestStuka = Math.max(...stukas.map((c) => c.aircraft.state.position.y))
    expect(lowestEscort).toBeGreaterThan(highestStuka)
  })

  it('玩家在 Ju 87 裡，不是護航機', () => {
    const b = createBattle(new AiController(), missionConfigFrom(card), 1)
    expect(b.world.combatants[b.playerSeat]!.aircraft.spec.id).toBe('ju87')
  })

  it('Ju 87 在敵機的目標評分裡值很多倍、護航機只打飛機、Ju 87 全滅就敗', () => {
    const cfg = missionConfigFrom(card)
    expect(cfg.tuning.bomberPriority).toBeGreaterThan(1)
    expect(cfg.tuning.airOnly).toBe(true)
    expect(cfg.rules).toMatchObject({ kind: 'destroy', bombers: true })
  })

  it('第二段（反擊的 T-34）也是 Ju 87 全滅就敗', () => {
    const retarget = (missionConfigFrom(card).beats ?? []).find((x) => x.kind === 'retarget')
    expect(retarget).toBeDefined()
    expect((retarget as { rules: unknown }).rules).toMatchObject({ kind: 'destroy', bombers: true })
  })

  it('護航機的控制器接到 airOnly，Ju 87 也接到（它不受影響）', () => {
    const b = createBattle(new AiController(), missionConfigFrom(card), 1)
    const flags = (id: string): boolean[] => b.world.combatants
      .filter((c) => c.aircraft.spec.id === id && c.controller instanceof AiController)
      .map((c) => (c.controller as AiController).airOnly)
    expect(flags('bf109k4')).toEqual([true, true, true, true, true, true])
    expect(flags('ju87').every(Boolean)).toBe(true)
  })

  it('增援進來的敵機沒有接到 airOnly', () => {
    const patched = {
      ...card,
      battle: {
        ...card.battle,
        waves: [{
          when: { kind: 'clock', at: 1 }, warnKey: 'mission.germany-m4.wave.fighters', warnLead: 0,
          side: 'theirs', spec: YAK1B, count: 2,
        }],
      },
    } as ReadyMissionCard
    const b = createBattle(new AiController(), missionConfigFrom(patched), 1)
    steps(b, 240 * 3)
    const red = b.world.combatants.filter((c) => c.team === 'red' && c.controller instanceof AiController)
    expect(red).toHaveLength(2)
    expect(red.every((c) => !(c.controller as AiController).airOnly)).toBe(true)
  })
})
