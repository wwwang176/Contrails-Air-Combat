import { describe, expect, it } from 'vitest'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { settleAtSpawn } from '../../src/battle/flightSpawn'
import type { GroundTarget } from '../../src/world/groundTargets'
import { ENTRY_PLANS, type SideEntry } from '../../src/battle/entry'
import { DEFAULT_BATTLE } from '../../src/battle/setup'
import { GROUND_LIGHT_FLAK_SPEC } from '../../src/world/shipGuns'
import { FRONT_HEADING, GERMAN_FLAK, SOVIET_FLAK, toLocal, VILLAGE_BOX } from '../../src/world/rzhev'
import { AiController } from '../../src/ai/AiController'
import { YAK1B } from '../../src/specs/yak1b'
import type { ReinforceBeat } from '../../src/battle/beats'

/**
 * # 德 M4（勒熱夫）的兩個節拍：縱隊出發與換目標
 *
 * 用真的卡片建場，**手動**把目標打掉（不跑飛行），只看節拍那一層：蘇軍支援砲炸夠七門的
 * 那一步換成第二段、不判勝；四支藏著的縱隊（蘇軍戰車、德軍預備隊）出現並出發；第二段數到才贏。
 * 德軍（藍）的反坦克砲、固定戰車與防空都是友軍，不算摧毀數、也不被 `mopUp` 打掉。
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

describe('德 M4 的縱隊與換目標', () => {
  it('開場：四支縱隊都藏著（蘇軍 20 輛 T-34、德軍預備隊 20 輛 IV 號）', () => {
    const b = battle()
    steps(b, 240)
    const columns = b.world.groundTargets.filter((t) => t.motion !== null)
    expect(columns.length).toBe(40)
    for (const t of columns) {
      expect(t.dormant).toBe(true)
      expect(t.alive).toBe(false)
    }
    expect(columns.filter((t) => t.team === 'red' && t.unit.id === 'tank')).toHaveLength(20)
    expect(columns.filter((t) => t.team === 'blue' && t.unit.id === 'panzer4')).toHaveLength(20)
    expect(b.rules).toMatchObject({ kind: 'destroy', count: 7, unit: 'atGun' })
  })

  it('蘇軍支援砲炸夠七門的那一步換成第二段，不判勝', () => {
    const b = battle()
    steps(b, 10)
    for (const t of units(b, 'atGun', 'red')) wreck(t)
    steps(b, 1)
    expect(b.mission.outcome).toBe('fighting')
    expect(b.rules).toMatchObject({ kind: 'destroy', count: 8, unit: 'tank' })
    expect(b.objectiveKey).toBe('mission.germany-m4.retarget')
    expect(b.message).toBe('mission.germany-m4.retarget')
  })

  /**
   * 【不必全部殲滅】炸到七門缺口就開了；剩下的三門由德軍的反坦克砲與戰車打掉（劇本，`mopUp`），
   * 畫面上由地面戰的戲補一發命中的砲彈。劇本打掉的不算進摧毀數。**只打敵方**：德軍的反坦克砲也是
   * `atGun`。
   */
  describe('炸夠數就進下一段，剩下的砲由德軍打掉', () => {
    it('六門還不夠：目標不換、縱隊不出發', () => {
      const b = battle()
      steps(b, 10)
      const guns = units(b, 'atGun', 'red')
      for (let i = 0; i < 6; i++) wreck(guns[i]!)
      steps(b, 2 * 240)
      expect(b.rules).toMatchObject({ kind: 'destroy', unit: 'atGun' })
      for (const t of b.world.groundTargets.filter((x) => x.motion !== null)) expect(t.dormant).toBe(true)
      for (const g of guns.slice(6)) expect(g.killAt).toBe(Infinity)
    })

    it('第七門炸掉的那一步：換成第二段、縱隊出發、剩下三門排定在 12～45 秒內被打掉', () => {
      const b = battle()
      steps(b, 10)
      const guns = units(b, 'atGun', 'red')
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

    it('50 秒後剩下的蘇軍砲都死了，標成劇本打掉的、不算進摧毀數；已經炸掉的七門不受影響', () => {
      const b = battle()
      steps(b, 10)
      const guns = units(b, 'atGun', 'red')
      for (let i = 0; i < 7; i++) wreck(guns[i]!)
      steps(b, 50 * 240)
      for (const g of guns.slice(7)) {
        expect(g.alive).toBe(false)
        expect(g.scripted).toBe(true)
      }
      for (const g of guns.slice(0, 7)) expect(g.scripted).toBe(false)
      expect(b.mission.outcome).toBe('fighting')
    })

    /** 德軍的反坦克砲也是 `atGun`：`mopUp` 不分隊伍的話，它們會被一起「打掉」 */
    it('德軍（藍）的反坦克砲不被 mopUp 動', () => {
      const b = battle()
      steps(b, 10)
      for (const g of units(b, 'atGun', 'red').slice(0, 7)) wreck(g)
      steps(b, 50 * 240)
      const german = units(b, 'atGun', 'blue')
      expect(german).toHaveLength(10)
      for (const g of german) {
        expect(g.alive).toBe(true)
        expect(g.scripted).toBe(false)
        expect(g.killAt).toBe(Infinity)
      }
    })
  })

  it('換段之後四支縱隊出發：蘇軍 T-34 與德軍預備隊都現身、開動', () => {
    const b = battle()
    steps(b, 10)
    for (const t of units(b, 'atGun', 'red')) wreck(t)
    steps(b, 2 * 240)
    const columns = b.world.groundTargets.filter((t) => t.motion !== null)
    expect(columns).toHaveLength(40)
    for (const t of columns) {
      expect(t.dormant).toBe(false)
      expect(t.alive).toBe(true)
      expect(t.speed).toBeGreaterThan(0)
    }
  })

  it('第二段：突擊的 T-34 炸掉 8 輛才贏；劇本戰車與殘骸（紅 tankDug）不算、德軍的車不算', () => {
    const b = battle()
    steps(b, 10)
    for (const t of units(b, 'atGun', 'red')) wreck(t)
    steps(b, 2)
    for (const t of units(b, 'tankDug', 'red')) wreck(t)
    for (const t of units(b, 'panzer4')) wreck(t)
    steps(b, 2)
    expect(b.mission.outcome).toBe('fighting')
    const tanks = units(b, 'tank', 'red')
    expect(tanks.length).toBe(20)
    for (let i = 0; i < 7; i++) wreck(tanks[i]!)
    steps(b, 2)
    expect(b.mission.outcome).toBe('fighting')
    wreck(tanks[7]!)
    steps(b, 2)
    expect(b.mission.outcome).toBe('victory')
  })
})

describe('勒熱夫的進場對準戰場', () => {
  const plan = ENTRY_PLANS[card.battle.entry]
  const startOf = (e: SideEntry): { x: number; z: number } => ({
    x: e.across * DEFAULT_BATTLE.lateralOffset, z: e.along * DEFAULT_BATTLE.entryRange + e.gap,
  })
  const blue = startOf(plan.blue)
  const red = startOf(plan.red)
  const nearestOf = (p: { x: number; z: number }, list: readonly { x: number; z: number }[]): number =>
    Math.min(...list.map((s) => Math.hypot(s.x - p.x, s.z - p.z)))
  const slant = (horizontal: number): number => Math.hypot(horizontal, card.battle.altitude!)
  const flakReach = GROUND_LIGHT_FLAK_SPEC.muzzleVelocity * GROUND_LIGHT_FLAK_SPEC.life

  const villageLz = (VILLAGE_BOX.north + VILLAGE_BOX.south) / 2

  it('藍隊開場在村中心北邊 2 km、在路軸上，機首沿路軸朝南對著村', () => {
    const l = toLocal(blue.x, blue.z)
    expect(Math.abs(l.lx)).toBeLessThan(50)
    expect(villageLz - l.lz).toBeGreaterThan(1950)
    expect(villageLz - l.lz).toBeLessThan(2050)
    expect(Math.cos(plan.blue.heading - (FRONT_HEADING + Math.PI))).toBeGreaterThan(0.999)
  })

  it('紅隊開場在村中心南邊 2 km、在路軸上，機首沿路軸朝北對著村', () => {
    const l = toLocal(red.x, red.z)
    expect(Math.abs(l.lx)).toBeLessThan(50)
    expect(l.lz - villageLz).toBeGreaterThan(1950)
    expect(l.lz - villageLz).toBeLessThan(2050)
    expect(Math.cos(plan.red.heading - FRONT_HEADING)).toBeGreaterThan(0.999)
  })

  it('兩隊對頭：機首正相反，村在兩邊開場位置的正中', () => {
    expect(Math.cos(plan.blue.heading - plan.red.heading)).toBeLessThan(-0.999)
    const lb = toLocal(blue.x, blue.z)
    const lr = toLocal(red.x, red.z)
    expect(Math.abs((lb.lz + lr.lz) / 2 - villageLz)).toBeLessThan(50)
  })

  /**
   * 波次預設的橫向槽位從 `WAVE_LANE`（3 格 = 2.4 km）起外推，Yak 會生在軸線外擦邊而過。卡片用 `lane`
   * 把兩批拉回軸線兩側（∓400 m），而且兩批槽位不同、不會生在同一點上。
   */
  it('兩批 Yak 的橫向槽位在軸線兩側、互不重疊，開場位置離軸線不到 500 m', () => {
    const beats = (missionConfigFrom(card).beats ?? []).filter((x): x is ReinforceBeat => x.kind === 'reinforce')
    const lanes = beats.map((x) => x.flight.lane)
    expect(new Set(lanes).size).toBe(lanes.length)
    for (const x of beats) {
      expect(Math.abs(x.flight.lane)).toBeLessThanOrEqual(0.5)
      const e = x.flight.entry
      const l = toLocal(
        x.flight.lane * DEFAULT_BATTLE.schwarmSpacing + e.across * DEFAULT_BATTLE.lateralOffset,
        e.along * DEFAULT_BATTLE.entryRange + e.gap,
      )
      expect(Math.abs(l.lx)).toBeLessThan(500)
      expect(Math.abs(l.lz - (villageLz + 2000))).toBeLessThan(250)
    }
  })

  it('藍隊在蘇軍輕型防空的射程之外開場（斜距）；紅隊開場就在德軍輕型防空的射程裡（Yak 一開場就挨打）', () => {
    expect(slant(nearestOf(blue, SOVIET_FLAK))).toBeGreaterThan(flakReach)
    expect(slant(nearestOf(red, GERMAN_FLAK))).toBeLessThan(flakReach)
  })

  it('兩隊開場位置都在這一關的界裡', () => {
    const a = card.battle.arena
    expect(Math.hypot(blue.x - a.x, blue.z - a.z)).toBeLessThan(a.radius)
    expect(Math.hypot(red.x - a.x, red.z - a.z)).toBeLessThan(a.radius)
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
      expect(q.y, `y ${i}`).toBeCloseTo(p.y, 6)
      // 落後 = 機首的反方向：每一批的局部橫向不變（排在長機的正後方），局部縱深往德軍後方退 g × depth
      const lp = toLocal(p.x, p.z)
      const lq = toLocal(q.x, q.z)
      expect(lq.lx, `lx ${i}`).toBeCloseTo(lp.lx, 0)
      expect(lp.lz - lq.lz, `lz ${i}`).toBeCloseTo(Math.floor(i / 2) * waves.depth, 0)
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

  it('護航機在領頭 Ju 87 後方 500～800 m、橫向在 700 m 內、比轟炸機高 600 m 上下', () => {
    const b = createBattle(new AiController(), missionConfigFrom(card), 1)
    const lead = b.player.aircraft.state.position
    const l0 = toLocal(lead.x, lead.z)
    const k4 = b.world.combatants.filter((c) => c.aircraft.spec.id === 'bf109k4')
    expect(k4).toHaveLength(6)
    for (const c of k4) {
      const p = c.aircraft.state.position
      const l = toLocal(p.x, p.z)
      expect(l0.lz - l.lz, 'K-4 落後領頭').toBeGreaterThanOrEqual(495)
      expect(l0.lz - l.lz, 'K-4 落後領頭').toBeLessThanOrEqual(805)
      expect(Math.abs(l.lx - l0.lx), 'K-4 橫向').toBeLessThanOrEqual(700)
      expect(p.y - lead.y, 'K-4 高出領頭').toBeGreaterThanOrEqual(595)
      expect(p.y - lead.y, 'K-4 高出領頭').toBeLessThanOrEqual(655)
    }
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
