import { describe, expect, it } from 'vitest'
import { MISSIONS, missionConfigFrom, type GroundEntry, type ReadyMissionCard } from '../../src/battle/missions'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { settleAtSpawn } from '../../src/battle/flightSpawn'
import { reinforce } from '../../src/battle/reinforcements'
import { countDestroyed } from '../../src/battle/objectiveQueries'
import type { GroundTarget } from '../../src/world/groundTargets'
import { ENTRY_PLANS } from '../../src/battle/entry'
import { FRONT_HEADING, toLocal } from '../../src/world/rzhev'
import { AiController } from '../../src/ai/AiController'
import { YAK1B } from '../../src/specs/yak1b'
import type { DepartBeat, MopUpBeat, ReinforceBeat, RetargetBeat } from '../../src/battle/beats'
import { cardWith, KILL_CARD } from '../fixtures/mission'

/**
 * # 德 M4（勒熱夫）的節拍接線
 *
 * 用真的卡片建場，**手動**把目標打掉（不跑飛行），只看節拍那一層：炸夠數的那一步換成第二段、
 * 藏著的縱隊出發。`mopUp` 的排程用一張合成卡驗。
 */

const card = MISSIONS.germany.find((c) => c.id === 'germany-m4') as ReadyMissionCard
const DT = 1 / 240

/** 地面節拍的測試不需要空戰：拿掉 Yak 的波次，模擬才不會花時間在飛機身上 */
const groundCard = { ...card, battle: { ...card.battle, waves: [] } } as ReadyMissionCard

function battle(): Battle {
  return createBattle({ update() {} }, missionConfigFrom(groundCard), 1)
}
function units(b: Battle, id: string, team?: 'blue' | 'red'): GroundTarget[] {
  return b.world.groundTargets.filter((t) => t.unit.id === id && (team === undefined || t.team === team))
}
function wreck(t: GroundTarget): void {
  t.hp = 0
  t.alive = false
}
function steps(b: Battle, n: number): void {
  for (let i = 0; i < n; i++) stepBattle(b, DT)
}

describe('德 M4 的換目標與縱隊出發', () => {
  const beats = missionConfigFrom(card).beats ?? []
  const retarget = beats.find((x): x is RetargetBeat => x.kind === 'retarget')
  const departs = beats.filter((x): x is DepartBeat => x.kind === 'depart')

  /** 【換參考】`stepBeats` 把 `b.rules` 換成節拍上建好的那一份規則物件 */
  it('蘇軍支援砲炸夠數的那一步換成第二段、縱隊在同一刻出發，不判勝', () => {
    const b = battle()
    steps(b, 10)
    for (const t of units(b, 'atGun', 'red')) wreck(t)
    steps(b, 1)
    expect(b.mission.outcome).toBe('fighting')
    const cfgRetarget = b.cfg.beats?.find((x): x is RetargetBeat => x.kind === 'retarget')
    expect(cfgRetarget).toBeDefined()
    expect(b.rules).toBe(cfgRetarget!.rules)
    expect(b.objectiveKey).toBe(cfgRetarget!.messageKey)
    expect(b.message).toBe(cfgRetarget!.messageKey)
    // 【索引範圍指到的就是縱隊】`depart` 節拍用 `first`／`count` 指認地面目標
    const columns = b.world.groundTargets.filter((t) => t.motion !== null)
    expect(columns.length).toBeGreaterThan(0)
    for (const t of columns) expect(t.departAt).toBe(b.world.time)
  })

  /** 【同一個觸發】縱隊晚一步出發的話，第二段的目標在換段那一刻還不在場上 */
  it('縱隊出發與換目標掛在同一個條件上', () => {
    expect(retarget).toBeDefined()
    expect(departs.length).toBeGreaterThan(0)
    for (const d of departs) expect(d.when).toEqual(retarget!.when)
  })
})

/**
 * # mopUp：炸夠數之後，剩下的敵方單位照劇本被打掉
 *
 * 合成卡：殲滅卡加幾門敵我雙方的反坦克砲與一個 `mopUp`。**只打敵方** —— 同一種單位的
 * 友軍也在場上（德 M4 的德軍反坦克砲與蘇軍支援砲都是 `atGun`）。
 */
describe('mopUp 的排程與執行', () => {
  const RED_GUNS = 4
  const WRECKED = 2
  const BLUE_GUNS = 2
  const ground: GroundEntry[] = [
    ...Array.from({ length: RED_GUNS }, (_, i) => ({
      unit: 'atGun' as const, team: 'red' as const, x: i * 60, z: -2000, heading: 0,
    })),
    ...Array.from({ length: BLUE_GUNS }, (_, i) => ({
      unit: 'atGun' as const, team: 'blue' as const, x: i * 60, z: 2000, heading: 0,
    })),
  ]
  const mopUp = {
    when: { kind: 'destroyed', atLeast: WRECKED, unit: 'atGun' }, unit: 'atGun', within: [12, 45],
  } as const

  /** 打掉前 `WRECKED` 門敵方砲、走一步讓節拍觸發。回傳觸發那一刻 */
  function triggered() {
    const b = createBattle(
      { update() {} }, missionConfigFrom(cardWith(KILL_CARD, { blueCount: 1, redCount: 1, ground, mopUp })), 1)
    steps(b, 1)
    const red = units(b, 'atGun', 'red')
    const blue = units(b, 'atGun', 'blue')
    for (const g of red.slice(0, WRECKED)) wreck(g)
    steps(b, 1)
    return { b, now: b.world.time, red, blue }
  }

  it('卡片的 mopUp 變成一個節拍', () => {
    const beat = missionConfigFrom(cardWith(KILL_CARD, { ground, mopUp })).beats
      ?.find((x): x is MopUpBeat => x.kind === 'mopUp')
    expect(beat).toBeDefined()
    expect(beat!.unit).toBe(mopUp.unit)
    expect(beat!.within).toEqual(mopUp.within)
  })

  it('觸發那一步：剩下的敵方砲排在 within 之內、各不相同；已炸掉的與友軍不排', () => {
    const { now, red, blue } = triggered()
    const left = red.slice(WRECKED)
    for (const g of left) {
      expect(g.alive).toBe(true)
      expect(g.killAt - now).toBeGreaterThanOrEqual(mopUp.within[0] - 1e-6)
      expect(g.killAt - now).toBeLessThanOrEqual(mopUp.within[1] + 1e-6)
    }
    // 不是同一刻一排爆
    expect(new Set(left.map((g) => g.killAt)).size).toBe(left.length)
    for (const g of red.slice(0, WRECKED)) expect(g.killAt).toBe(Infinity)
    expect(blue).toHaveLength(BLUE_GUNS)
    for (const g of blue) expect(g.killAt).toBe(Infinity)
  })

  /** 【時鐘直接撥】`World.step` 每一步對每座地面目標跑 `stepScriptedKill` */
  it('時間到了照劇本打掉：標成劇本打掉的、不算摧毀數；友軍與已炸掉的不受影響', () => {
    const { b, red, blue } = triggered()
    const left = red.slice(WRECKED)
    b.world.time = Math.max(...left.map((g) => g.killAt))
    steps(b, 1)
    for (const g of left) {
      expect(g.alive).toBe(false)
      expect(g.scripted).toBe(true)
    }
    for (const g of red.slice(0, WRECKED)) expect(g.scripted).toBe(false)
    expect(countDestroyed(b.world.groundTargets, b.world.combatants, 'atGun')).toBe(WRECKED)
    for (const g of blue) {
      expect(g.alive).toBe(true)
      expect(g.scripted).toBe(false)
    }
  })
})

describe('勒熱夫的進場對準戰場', () => {
  const plan = ENTRY_PLANS[card.battle.entry]

  it('藍隊機首沿路軸朝南對著村', () => {
    expect(Math.cos(plan.blue.heading - (FRONT_HEADING + Math.PI))).toBeGreaterThan(0.999)
  })

  it('紅隊機首沿路軸朝北對著村', () => {
    expect(Math.cos(plan.red.heading - FRONT_HEADING)).toBeGreaterThan(0.999)
  })

  /** 兩批槽位相同的話會生在同一點上 */
  it('增援的 Yak 各批橫向槽位互不重疊', () => {
    const beats = (missionConfigFrom(card).beats ?? []).filter((x): x is ReinforceBeat => x.kind === 'reinforce')
    const lanes = beats.map((x) => x.flight.lane)
    expect(lanes.length).toBeGreaterThan(1)
    expect(new Set(lanes).size).toBe(lanes.length)
  })

  /**
   * 【玩家重生走的是另一條路】`Aircraft.respawn` 一律朝 −Z（北）飛，主程式的 `respawnPlayer` 要接著
   * `settleAtSpawn` 才會回到開局的機首。沒接的話玩家背對村莊飛，其他飛機（`createBattle` 的路徑）卻朝著它。
   */
  it('玩家重生之後機首朝著村莊（局部縱深增加），沒有 settleAtSpawn 的話是背對', () => {
    const b = battle()
    const seat = b.playerSeat
    const c = b.world.combatants[seat]!
    const ahead = (): number => {
      const v = c.aircraft.state.velocity
      const p = c.aircraft.state.position
      const a = toLocal(p.x, p.z)
      const z = toLocal(p.x + v.x, p.z + v.z)
      return z.lz - a.lz
    }
    expect(ahead(), '建場時').toBeGreaterThan(0)
    b.world.respawn(c)
    expect(ahead(), '只有 respawn').toBeLessThan(0)
    settleAtSpawn(b, c)
    expect(ahead(), 'settleAtSpawn 之後').toBeGreaterThan(0)
    const p = c.aircraft.state.position
    expect(p.x).toBeCloseTo(c.spawnPosition.x, 6)
    expect(p.z).toBeCloseTo(c.spawnPosition.z, 6)
  })

  /**
   * 【分批交錯進場】第 `g` 批比第一批多落後 `g × depth`，玩家在第一批。
   * 同一張卡把 `depth` 設成 0 當對照，量差值，才不會綁死站位表的數字。
   */
  it('後面的批依序多落後 depth，玩家在第一批', () => {
    const waves = card.battle.blueWaves!
    expect(waves.depth).toBeGreaterThan(0)
    const flat = { ...card, battle: { ...card.battle, blueWaves: { ...waves, depth: 0 } } } as ReadyMissionCard
    const base = createBattle({ update() {} }, missionConfigFrom(flat), 1)
    const trailed = battle()
    expect(trailed.playerSeat).toBeLessThan(waves.size)
    for (let i = 0; i < card.battle.blueCount; i++) {
      const p = base.world.combatants[i]!.aircraft.state.position
      const q = trailed.world.combatants[i]!.aircraft.state.position
      expect(q.y, `y ${i}`).toBeCloseTo(p.y, 6)
      // 落後 = 機首的反方向：每一批的局部橫向不變（排在長機的正後方），局部縱深往德軍後方退 g × depth
      const lp = toLocal(p.x, p.z)
      const lq = toLocal(q.x, q.z)
      expect(lq.lx, `lx ${i}`).toBeCloseTo(lp.lx, 0)
      expect(lp.lz - lq.lz, `lz ${i}`).toBeCloseTo(Math.floor(i / waves.size) * waves.depth, 0)
    }
  })
})

/**
 * # 德 M4 的蘇軍戰鬥機與我方護航
 *
 * 只驗接線：護航機的開場速度與方向、護航機只打飛機、Ju 87 全滅就敗。打起來合不合理是試玩的事。
 */
describe('德 M4 的 Yak-1B 與 Bf 109 護航', () => {
  /**
   * 護航機照戰鬥機的速度（187 m/s）開場，會一開場就超過 Ju 87（81 m/s）、掉頭回來歸位，機首背對村莊
   * 十幾秒。開場空速與 Ju 87 同一個量級；而且開場在站位後面，要往前補、不是掉頭。
   */
  it('護航機開場空速不到 Ju 87 的 1.5 倍，而且第一秒全部朝著村莊飛', () => {
    const b = createBattle(new AiController(), missionConfigFrom(card), 1)
    const speed = (id: string): number => {
      const l = b.world.combatants.filter((c) => c.aircraft.spec.id === id)
      return l.reduce((s, c) => s + c.aircraft.state.velocity.length(), 0) / l.length
    }
    expect(speed('bf109k4')).toBeLessThan(speed('ju87') * 1.5)
    for (const c of b.world.combatants) {
      const v = c.aircraft.state.velocity
      const p = c.aircraft.state.position
      expect(toLocal(p.x + v.x, p.z + v.z).lz - toLocal(p.x, p.z).lz, c.aircraft.spec.id).toBeGreaterThan(0)
    }
  })

  it('護航機只打飛機、Ju 87 全滅就敗', () => {
    const cfg = missionConfigFrom(card)
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
    expect(flags('bf109k4').length).toBeGreaterThan(0)
    expect(flags('bf109k4').every(Boolean)).toBe(true)
    expect(flags('ju87').every(Boolean)).toBe(true)
  })

  /** 【增援在戰鬥中建控制器】`reinforce` 自己接 `airOnly`，只給藍隊 */
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
    const wave = b.cfg.beats?.find((x): x is ReinforceBeat => x.kind === 'reinforce')
    expect(wave).toBeDefined()
    const seats = reinforce(b, wave!.flight)
    expect(seats.length).toBeGreaterThan(0)
    for (const s of seats) {
      const c = b.world.combatants[s]!
      expect(c.team).toBe('red')
      expect((c.controller as AiController).airOnly).toBe(false)
    }
  })
})
