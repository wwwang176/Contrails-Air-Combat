import { describe, it, expect } from 'vitest'
import { MISSIONS, CAMPAIGNS, missionConfigFrom } from '../../src/battle/missions'
import { ALL_SPECS, MAX_SIDE } from '../../src/battle/skirmish'
import { createBattle, stepBattle } from '../../src/battle/setup'
import type { MissionCard, ReadyMissionCard } from '../../src/battle/missions'
import { BOMBS_CAPACITY } from '../../src/world/bomb'
import { loadoutOf } from '../../src/weapons/stores'

/**
 * # 三條戰役與 9 張卡
 *
 * 卡片拆成兩層：**目錄**（選單畫得出來就靠它）與**戰鬥設定**（`battle`）。
 * `battle === null` 就是「還沒做」——那取代了原本的 `playable` 旗標，
 * 而且把「資料要嘛完整、要嘛全空」從一條測試變成型別保證。
 */

const ALL: readonly MissionCard[] = CAMPAIGNS.flatMap((c) => MISSIONS[c])

const ready = (m: MissionCard): m is ReadyMissionCard => m.battle !== null

describe('三條戰役', () => {
  it('三條線各 3 關', () => {
    expect(CAMPAIGNS).toEqual(['allies', 'germany', 'japan'])
    for (const c of CAMPAIGNS) expect(MISSIONS[c], c).toHaveLength(3)
  })

  it('9 個 id 唯一，而且前綴就是戰役', () => {
    expect(new Set(ALL.map((m) => m.id)).size).toBe(9)
    for (const c of CAMPAIGNS) {
      for (const m of MISSIONS[c]) expect(m.id.startsWith(`${c}-`), m.id).toBe(true)
    }
  })

  it('全部標題不重複，而且每一張都有一行說明', () => {
    expect(new Set(ALL.map((m) => m.title)).size).toBe(9)
    for (const m of ALL) expect(m.summary.length, m.id).toBeGreaterThan(0)
  })

  it('九張全部打得起來', () => {
    expect(ALL.filter(ready).map((m) => m.id).sort()).toEqual([
      'allies-m1', 'allies-m2', 'allies-m4', 'germany-m1', 'germany-m2', 'germany-m4',
      'japan-m1', 'japan-m3', 'japan-m4',
    ])
  })
})

describe('可玩卡的戰鬥設定', () => {
  const playable = ALL.filter(ready)

  it('機種是 ALL_SPECS 裡的同一個物件，不是等值的複本', () => {
    // 【為什麼是 toBe 不是 toEqual】下游三張依物件識別的快取（envelope、
    // doctrine、ceilings）認的是參考。等值的複本會讓那三張表全部落空，
    // 症狀是進場那一瞬間的卡頓，而且沒有任何錯誤
    for (const m of playable) {
      const b = m.battle
      expect(ALL_SPECS, `${m.id} blue`).toContain(b.blueSpec)
      expect(ALL_SPECS, `${m.id} red`).toContain(b.redSpec)
      if (b.convoySpec !== null) expect(ALL_SPECS, `${m.id} convoy`).toContain(b.convoySpec)
    }
  })

  it('convoySpec 與 convoyCount 同時有或同時沒有', () => {
    for (const m of playable) {
      // 【只問兩格一致，不問 type】德 M1 的 type 是攔截但規則是 hunt（轟炸機
      // 是一般的敵機、沒有 convoySpec），日 M1 有 convoySpec 但規則是 sink
      // （攻擊隊）—— 用 type 推導的話這兩張都會被判錯。誰該有被護送者由下面
      // 那一條依規則與職務管
      expect(m.battle.convoySpec !== null, m.id).toBe(m.battle.convoyCount > 0)
    }
  })

  /**
   * 【transit 的那幾架只在護送規則下有終點】攻擊隊（strike）不是被護送者，
   * 它要有自己能打的東西，否則那幾架轟炸機起飛之後無事可做。
   */
  it('被護送者只出現在護送規則的卡上，攻擊隊一定配著擊沉或炸毀', () => {
    for (const m of playable) {
      const b = m.battle
      if (b.convoySpec === null) continue
      const convoy = missionConfigFrom(m).rules.kind === 'convoy'
      expect(convoy, `${m.id} 的 convoyDuty`).toBe(b.convoyDuty === undefined || b.convoyDuty === 'transit')
      // 【轟炸機流的終點不判勝負】那一關要有自己的勝負 —— 擊落
      if (b.convoyDuty === 'stream') expect(b.huntCount, m.id).toBeDefined()
      if (b.convoyDuty === 'strike') {
        expect(b.sinkCount !== undefined || b.destroyCount !== undefined, m.id).toBe(true)
      }
    }
  })

  it('地形逐關指定，不是全部群島', () => {
    // 【為什麼要這一條】只加欄位不給值的話，每一關全填 archipelago 一樣通得過
    // 「地形是合法的一種」，而日 M3 仍然開在群島上
    const of = (id: string) => playable.find((m) => m.id === id)!.battle.terrain
    // 日 M3 換成漢口（華中農地）、德 M4 換成底板行動（Y-29）
    expect(of('japan-m3')).toBe('farmland')
    expect(of('germany-m4')).toBe('asch')
    expect(new Set(playable.map((m) => m.battle.terrain)).size).toBeGreaterThan(1)
  })

  it('我方架數是正整數、敵方架數是非負整數', () => {
    for (const m of playable) {
      const b = m.battle
      expect(Number.isInteger(b.blueCount), `${m.id} blue`).toBe(true)
      expect(b.blueCount, `${m.id} blue`).toBeGreaterThan(0)
      expect(Number.isInteger(b.redCount), `${m.id} red`).toBe(true)
      // 【0 是合法的】對手全是地面的關沒有敵機
      expect(b.redCount, `${m.id} red`).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('德 M2 波爾塔瓦', () => {
  const card = MISSIONS.germany.find((m) => m.id === 'germany-m2') as ReadyMissionCard

  it('沒有敵機、8 架 He 111、夜間、波爾塔瓦地形、1,500 m', () => {
    const b = card.battle
    expect(b.redCount).toBe(0)
    expect(b.blueCount).toBe(8)
    expect(b.blueSpec.id).toBe('he111')
    expect(b.timeOfDay).toBe('night')
    expect(b.terrain).toBe('poltava')
    expect(b.altitude).toBe(1500)
  })

  it('24 架停放的 B-17、3 堆、16 輕砲、6 重砲、6 探照燈；炸毀 12 座', () => {
    const units = card.battle.ground!.map((e) => e.unit)
    const count = (id: string) => units.filter((u) => u === id).length
    expect(count('parkedB17')).toBe(24)
    expect(count('fuelDump')).toBe(2)
    expect(count('bombDump')).toBe(1)
    expect(count('flakLight')).toBe(16)
    expect(count('flakHeavy')).toBe(6)
    expect(count('searchlight')).toBe(6)
    expect(card.battle.ground!.every((e) => e.team === 'red')).toBe(true)
    expect(card.battle.destroyCount).toBe(12)
  })

  it('照這張卡建得起來、跑一秒不炸', () => {
    // 【走真正的路】missionConfigFrom → stackedEntry → ground，不是自己組的編組表
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    for (let i = 0; i < 240; i++) stepBattle(b, 1 / 240)
    expect(b.mission.outcome).toBe('fighting')
    // 16 座輕砲 + 6 座重砲都掛了砲
    expect(b.world.groundTargets.filter((t) => t.guns.length > 0)).toHaveLength(22)
  })
})

describe('德 M1 梅澤堡上空', () => {
  const card = MISSIONS.germany.find((m) => m.id === 'germany-m1') as ReadyMissionCard

  it('擊落 6 架轟炸機；8 架 K-4 攔 8 架 B-17 的轟炸機流；洛伊納、十一月正午', () => {
    const b = card.battle
    expect(b.huntCount).toBe(6)
    expect(b.huntRole).toBe('bomber')
    expect(b.blueSpec.id).toBe('bf109k4')
    expect(b.blueCount).toBe(8)
    expect(b.convoySpec?.id).toBe('b17g')
    expect(b.convoyCount).toBe(8)
    expect(b.convoyDuty).toBe('stream')
    expect(b.redCount).toBe(0)
    expect(b.targetDistance).toBeGreaterThan(0)
    expect(b.targetRadius).toBeGreaterThan(0)
    // 【不是洛伊納】`leuna` 會把廠區的墊面與佈景烤進地形，這一關地上不該有工廠
    expect(b.terrain).toBe('autumnFarmland')
    expect(b.timeOfDay).toBe('novemberNoon')
  })

  it('在路途上攔截：沒有地面目標、沒有整隊重生', () => {
    expect(card.battle.ground).toBeUndefined()
    expect(card.battle.recycle).toBeUndefined()
  })

  it('護航機兩批各四架 P-51', () => {
    const waves = card.battle.waves!
    expect(waves).toHaveLength(2)
    for (const w of waves) {
      expect(w.side).toBe('theirs')
      expect(w.spec.id).toBe('p51d')
      expect(w.count).toBe(4)
    }
  })

  it('照這張卡建得起來、規則是 hunt、B-17 在紅隊而且是 transit、跑一秒不炸', () => {
    const cfg = missionConfigFrom(card)
    const bombers = cfg.units.filter((u) => u.members[0]!.id === 'b17g')
    expect(bombers).toHaveLength(8)
    for (const u of bombers) {
      expect(u.team).toBe('red')
      expect(u.duty).toBe('transit')
    }
    const b = createBattle({ update() {} }, cfg, 1)
    expect(b.cfg.rules).toEqual({ kind: 'hunt', count: 6, role: 'bomber' })
    for (let i = 0; i < 240; i++) stepBattle(b, 1 / 240)
    expect(b.mission.outcome).toBe('fighting')
  })
})

describe('德 M3 底板行動', () => {
  const card = MISSIONS.germany.find((m) => m.id === 'germany-m4') as ReadyMissionCard

  it('Y-29、拂曉、8 架 K-4、開場沒有敵機在前方；炸毀 8 座', () => {
    const b = card.battle
    expect(b.terrain).toBe('asch')
    expect(b.timeOfDay).toBe('dawn')
    expect(b.blueSpec.id).toBe('bf109k4')
    expect(b.blueCount).toBe(8)
    expect(b.redSpec.id).toBe('p51d')
    expect(b.redCount).toBe(0)
    expect(b.destroyCount).toBe(8)
    expect(b.destroyUnit).toBe('parkedP51')
    expect(b.priorityGroundUnit).toBe('parkedP51')
    expect(missionConfigFrom(card).tuning.priorityGroundUnit).toBe('parkedP51')
  })

  it('地面 P-51 優先權只在德國第三張任務卡啟用', () => {
    for (const campaign of CAMPAIGNS) {
      for (const mission of MISSIONS[campaign]) {
        if (!ready(mission)) continue
        const expected = mission.id === 'germany-m4' ? 'parkedP51' : undefined
        expect(missionConfigFrom(mission).tuning.priorityGroundUnit, mission.id).toBe(expected)
      }
    }
  })

  it('打掉油桶與砲位不算，打掉八架停放的 P-51 才算', () => {
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    for (const t of b.world.groundTargets) if (t.unit.id !== 'parkedP51') t.alive = false
    stepBattle(b, 1 / 240)
    expect(b.mission.outcome).toBe('fighting')
    const parked = b.world.groundTargets.filter((t) => t.unit.id === 'parkedP51')
    for (const t of parked.slice(0, 8)) t.alive = false
    stepBattle(b, 1 / 240)
    expect(b.mission.outcome).toBe('victory')
  })

  it('每一架只算一次、不管死在哪裡：停機墊上打掉的加上起飛後被打掉的湊到 8 就判勝', () => {
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    const parked = b.world.groundTargets.filter((t) => t.unit.id === 'parkedP51')
    // 停機墊上先打掉 5 架
    for (const t of parked.slice(0, 5)) t.alive = false
    const before = b.world.combatants.length
    // 第一批在第 0 秒開始滑行：剩下的 7 格裡 4 格離場
    stepBattle(b, 1 / 240)
    const flight = b.world.combatants.slice(before)
    expect(flight).toHaveLength(4)
    expect(parked.filter((t) => t.departed)).toHaveLength(4)
    // 【離場的那一格不算摧毀】它還活著，只是在滑行道上
    expect(b.mission.metric).toBe(3)
    b.world.destroy(flight[0]!)
    b.world.destroy(flight[1]!)
    stepBattle(b, 1 / 240)
    expect(b.mission.metric).toBe(1)
    expect(b.mission.outcome).toBe('fighting')
    b.world.destroy(flight[2]!)
    stepBattle(b, 1 / 240)
    expect(b.mission.outcome).toBe('victory')
  })

  it('12 架停放的 P-51、2 堆油桶、6 座輕砲，全部是敵方的', () => {
    const units = card.battle.ground!.map((e) => e.unit)
    const count = (id: string) => units.filter((u) => u === id).length
    expect(count('parkedP51')).toBe(12)
    expect(count('fuelDump')).toBe(2)
    expect(count('flakLight')).toBe(6)
    expect(units).toHaveLength(20)
    expect(card.battle.ground!.every((e) => e.team === 'red')).toBe(true)
  })

  it('敵機全部從地上來：每一批是一個小隊從停機墊滑出去，席位加起來等於停機線', () => {
    const takeoff = card.battle.waves!
    expect(takeoff).toHaveLength(3)
    for (const w of takeoff) {
      expect(w.count).toBe(4)
      expect(w.side).toBe('theirs')
      expect(w.takeoff?.route).toBeDefined()
      expect(w.departs).toBe('parkedP51')
    }
    // 【停機線上的每一架最後都起得來】起飛的席位少於停放的架數，剩下的永遠在地上
    const parked = card.battle.ground!.filter((e) => e.unit === 'parkedP51').length
    expect(takeoff.reduce((s, w) => s + w.count, 0)).toBe(parked)
  })

  it('照這張卡建得起來、開場每一架離地 100 m 以上、跑一秒不炸', () => {
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    for (const c of b.world.combatants) expect(c.aircraft.state.position.y, `${c.index}`).toBeGreaterThan(100)
    for (let i = 0; i < 240; i++) stepBattle(b, 1 / 240)
    expect(b.mission.outcome).toBe('fighting')
    expect(b.world.groundTargets.filter((t) => t.guns.length > 0)).toHaveLength(6)
  })
})

describe('missionConfigFrom', () => {
  it('只吃可玩的卡，不再吃陣營', () => {
    for (const m of ALL.filter(ready)) {
      const cfg = missionConfigFrom(m)
      expect(cfg.units.length, m.id).toBeGreaterThan(0)
    }
  })

  it('雙方的機種照卡片，不是照陣營推出來的', () => {
    // 【這是整輪的本體】日 M2 玩家開 Ki-84 —— 那是「第三架」，
    // 舊的 `specsFor(f)[0]` 永遠選不到它
    const m3 = ALL.filter(ready).find((m) => m.id === 'japan-m3')!
    const blue = missionConfigFrom(m3).units.find((u) => u.team === 'blue')!
    expect(blue.members[0]!.id).toBe('ki84')
    const m1 = ALL.filter(ready).find((m) => m.id === 'japan-m1')!
    const g4m = missionConfigFrom(m1).units.filter((u) => u.members[0]!.id === 'g4m')
    expect(g4m.length).toBeGreaterThan(0)
  })
})

describe('日 M1 瓜達康納爾上空', () => {
  const card = MISSIONS.japan.find((m) => m.id === 'japan-m1') as ReadyMissionCard

  it('A6M5 ×12 掩護 G4M ×8，對上 F4F-4 ×8；群島；擊沉三艘', () => {
    const b = card.battle
    expect(b.blueSpec.id).toBe('a6m5')
    expect(b.blueCount).toBe(12)
    expect(b.convoySpec?.id).toBe('g4m')
    expect(b.convoyCount).toBe(8)
    expect(b.convoyDuty).toBe('strike')
    // 【零戰加陸攻都在藍隊】`blueCount` 不含攻擊隊，兩者相加才是藍隊的席位
    expect(b.blueCount + b.convoyCount).toBeLessThanOrEqual(MAX_SIDE)
    expect(b.redSpec.id).toBe('f4f4')
    expect(b.redCount).toBe(8)
    expect(b.terrain).toBe('archipelago')
    expect(b.sinkCount).toBe(3)
    // 【不覆寫掛載】陸攻保留預設的魚雷；覆寫的話藍隊全體（含零戰）一起換
    expect(b.blueLoadout).toBeUndefined()
  })

  it('船團全是敵艦、沒有要害艦 —— 否則規則會被判成守住艦隊', () => {
    const ships = card.battle.fleet!.ships
    for (const s of ships) {
      expect(s.team).toBe('red')
      expect(s.vital).toBeUndefined()
    }
    expect(missionConfigFrom(card).rules).toEqual({ kind: 'sink', count: 3, escorts: true })
  })

  /**
   * 【零戰全滅就是任務失敗】這一關的目標是掩護。走真正的 `stepBattle`，
   * 守的是 `setup.ts` 真的把「藍隊存活的戰鬥機」填進判定。
   */
  it('零戰全滅、陸攻還活著 —— 判敗', () => {
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    for (const c of b.world.combatants) {
      if (c.team === 'blue' && c.aircraft.spec.role === 'fighter') c.alive = false
    }
    stepBattle(b, 1 / 240)
    const g4mAlive = b.world.combatants.filter((c) => c.alive && c.aircraft.spec.id === 'g4m')
    expect(g4mAlive).toHaveLength(8)
    expect(b.mission.outcome).toBe('defeat')
  })

  it('還剩一架零戰就不判敗', () => {
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    const fighters = b.world.combatants.filter(
      (c) => c.team === 'blue' && c.aircraft.spec.role === 'fighter')
    for (const c of fighters.slice(1)) c.alive = false
    stepBattle(b, 1 / 240)
    expect(b.mission.outcome).toBe('fighting')
  })

  it('F4F 整隊重生，陸攻不重生', () => {
    const r = card.battle.recycle!
    expect(r.side).toBe('theirs')
    expect(r.role).toBe('fighter')
    expect(r.batches).toBe(3)
  })

  it('照這張卡建得起來、跑一秒不炸；陸攻是 combat 而且在藍隊', () => {
    // 【走真正的路】strike 的陸攻若被排成 transit，createBattle 會拋「沒有終點可飛」
    const cfg = missionConfigFrom(card)
    const g4m = cfg.units.filter((u) => u.members[0]!.id === 'g4m')
    expect(g4m).toHaveLength(8)
    for (const u of g4m) {
      expect(u.team).toBe('blue')
      expect(u.duty).toBe('combat')
    }
    const b = createBattle({ update() {} }, cfg, 1)
    for (let i = 0; i < 240; i++) stepBattle(b, 1 / 240)
    expect(b.mission.outcome).toBe('fighting')
    expect(b.convoy).toBeNull()
  })
})

describe('日 M3 倫內爾島不受護衛條件影響', () => {
  const card = MISSIONS.japan.find((m) => m.id === 'japan-m4') as ReadyMissionCard

  it('規則沒有護衛編制', () => {
    expect(missionConfigFrom(card).rules).toEqual({ kind: 'sink', count: 4 })
  })

  /** 【藍隊一架戰鬥機都沒有】護衛條件若無條件套用，這一關開場第一步就判敗 */
  it('藍隊全是陸攻，跑一秒仍在打', () => {
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    expect(b.world.combatants.some((c) => c.team === 'blue' && c.aircraft.spec.role === 'fighter'))
      .toBe(false)
    for (let i = 0; i < 240; i++) stepBattle(b, 1 / 240)
    expect(b.mission.outcome).toBe('fighting')
  })
})

describe('日 M2 漢口上空', () => {
  const card = MISSIONS.japan.find((m) => m.id === 'japan-m3') as ReadyMissionCard

  it('Ki-84 ×8 對 P-51D ×10；高度劣勢開局；農地；殲滅；沒有第二階段', () => {
    const b = card.battle
    expect(b.blueSpec.id).toBe('ki84')
    expect(b.blueCount).toBe(8)
    expect(b.redSpec.id).toBe('p51d')
    expect(b.redCount).toBe(10)
    expect(b.entry).toBe('bounce')
    expect(b.terrain).toBe('farmland')
    expect(missionConfigFrom(card).rules.kind).toBe('annihilate')
    // 【刻意不加】九關裡唯一一場封閉的戰鬥機對決
    expect(b.waves).toBeUndefined()
    expect(b.recycle).toBeUndefined()
    expect(b.withdraw).toBeUndefined()
  })

  it('紅隊開場真的比藍隊高 —— bounce 有流進編組表', () => {
    const cfg = missionConfigFrom(card)
    const red = cfg.units.find((u) => u.team === 'red')!
    const blue = cfg.units.find((u) => u.team === 'blue')!
    expect(red.entry.climb - blue.entry.climb).toBe(1000)
  })
})

describe('擊沉任務', () => {
  /**
   * 【要求擊沉卻沒有艦隊 = 永遠打不完】而且畫面上一切正常：目標列顯示
   * 「還差三艘」，海上一艘船都沒有。這是關卡資料的錯，要在這一層擋掉，
   * 不是在戰鬥中判一個玩家看不懂的敗北。
   */
  it('有 sinkCount 就一定要有 fleet，而且艦隊數量夠', () => {
    for (const m of ALL.filter(ready)) {
      const n = m.battle.sinkCount
      if (n === undefined) continue
      expect(m.battle.fleet, `${m.id} 要求擊沉卻沒有艦隊`).toBeDefined()
      const enemies = m.battle.fleet!.ships.filter((x) => x.team === 'red').length
      expect(enemies, `${m.id} 目標 ${n} 艘但敵艦只有 ${enemies} 艘`).toBeGreaterThanOrEqual(n)
    }
  })

  it('沒有艦隊的卡不會要求擊沉', () => {
    for (const m of ALL.filter(ready)) {
      if (m.battle.fleet === undefined) expect(m.battle.sinkCount, m.id).toBeUndefined()
    }
  })
})

describe('炸毀任務', () => {
  /** 【要求炸毀卻沒有廠區 = 永遠打不完】與擊沉同一個理由，在資料層擋 */
  it('有 destroyCount 就一定要有 ground，而且敵方構件數量夠', () => {
    for (const m of ALL.filter(ready)) {
      const n = m.battle.destroyCount
      if (n === undefined) continue
      expect(m.battle.ground, `${m.id} 要求炸毀卻沒有廠區`).toBeDefined()
      const unit = m.battle.destroyUnit
      const hostile = m.battle.ground!
        .filter((e) => e.team === 'red' && (unit === undefined || e.unit === unit)).length
      expect(hostile, `${m.id} 目標 ${n} 座但敵方構件只有 ${hostile} 座`).toBeGreaterThanOrEqual(n)
    }
  })

  it('沒有廠區的卡不會要求炸毀', () => {
    for (const m of ALL.filter(ready)) {
      if (m.battle.ground === undefined) expect(m.battle.destroyCount, m.id).toBeUndefined()
    }
  })

  /**
   * 【三種進攻規則不共存】`missionRules` 依序看擊沉、炸毀、擊落，落選的那
   * 幾格會靜靜地被忽略 —— 而它們在卡片上看起來完全正常。
   */
  it('sinkCount、destroyCount、huntCount 三者只能有一個', () => {
    for (const m of ALL.filter(ready)) {
      const counts = [m.battle.sinkCount, m.battle.destroyCount, m.battle.huntCount]
      expect(counts.filter((c) => c !== undefined).length, m.id).toBeLessThanOrEqual(1)
    }
  })

  /**
   * 【`huntRole` 不能單獨出現】只寫角色不寫數量的話 `missionRules` 根本走不到
   * 擊落那一條，那一格就是一句沒有人讀的話。
   */
  it('有 huntRole 就一定要有 huntCount', () => {
    for (const m of ALL.filter(ready)) {
      if (m.battle.huntRole !== undefined) expect(m.battle.huntCount, m.id).toBeDefined()
    }
  })

  /**
   * 【`need` 只有護送與攔截讀得到】寫在別種卡上不會報錯，但它不會有任何
   * 效果 —— 而卡片上看起來像是設了一個門檻。
   */
  it('need 只出現在護航與攔截的卡上，而且不超過被護送的架數', () => {
    for (const m of ALL.filter(ready)) {
      if (m.battle.need === undefined) continue
      expect(m.type === '護航' || m.type === '攔截', m.id).toBe(true)
      expect(m.battle.need, m.id).toBeGreaterThan(0)
      expect(m.battle.need, m.id).toBeLessThanOrEqual(m.battle.convoyCount)
    }
  })
})

describe('盟 M2 的卡片', () => {
  const m2 = ALL.find((m) => m.id === 'allies-m2') as ReadyMissionCard

  /** 【釘住精確的資料】通用的護欄只擋「有廠區才要求炸毀」；這裡釘的是這一關本身 */
  it('十二座構件、四十八座砲位；炸毀六座；洛伊納、十一月正午、1,500 m', () => {
    const b = m2.battle
    const units = b.ground!.map((e) => e.unit)
    expect(units.filter((u) => u === 'flakHeavy')).toHaveLength(48)
    const plant = units.filter((u) => u !== 'flakHeavy')
    expect(plant).toHaveLength(12)
    expect(b.ground!.every((e) => e.team === 'red')).toBe(true)
    expect(b.destroyCount).toBe(6)
    expect(b.terrain).toBe('leuna')
    expect(b.timeOfDay).toBe('novemberNoon')
    expect(b.blueSpec.id).toBe('b17g')
    expect(b.blueCount).toBe(12)
    // 【高度要釘住】它是這一關唯一覆寫預設的飛行參數，掉回 4,000 不會報錯
    expect(b.altitude).toBe(1500)
  })

  it('第二批恰好四架 Bf 109，從後方（starboard = π）', () => {
    const waves = m2.battle.waves!
    expect(waves).toHaveLength(1)
    expect(waves[0]!.count).toBe(4)
    expect(waves[0]!.spec.id).toBe('bf109k4')
    expect(waves[0]!.starboard).toBe(Math.PI)
  })
})

/** 【轟炸機不編隊】每一關的開場編組與增援波次，轟炸機都是一架一個小隊 */
describe('任務的轟炸機一架一個小隊', () => {
  it('開場與波次都沒有兩架以上的轟炸機小隊', () => {
    for (const card of Object.values(MISSIONS).flat()) {
      if (card.battle === null) continue
      const cfg = missionConfigFrom(card as ReadyMissionCard)
      const flights = [
        ...cfg.units,
        ...(cfg.beats ?? []).flatMap((x) => (x.kind === 'reinforce' ? [x.flight] : [])),
      ]
      for (const f of flights) {
        if (f.members.some((m) => m.role === 'bomber')) {
          expect(f.members.length, card.id).toBe(1)
        }
      }
    }
  })
})

/**
 * 【炸彈池裝得下每一關】池是環狀寫入，滿了就把還在空中的炸彈蓋掉 —— 那幾顆
 * 從空中消失，不爆也不報錯。上限取「開場每一架掛滿 + 每一個增援波次掛滿」。
 *
 * 【transit 不算】被護送／被攔截的轟炸機不挑目標，掛著彈也不會投。
 */
describe('炸彈池裝得下每一關同時掛著的炸彈', () => {
  it('每一關會投彈的飛機掛彈總數不超過 BOMBS_CAPACITY', () => {
    for (const card of Object.values(MISSIONS).flat()) {
      if (card.battle === null) continue
      const cfg = missionConfigFrom(card as ReadyMissionCard)
      const flights = [
        ...cfg.units,
        ...(cfg.beats ?? []).flatMap((x) => (x.kind === 'reinforce' ? [x.flight] : [])),
      ]
      let bombs = 0
      for (const f of flights) {
        if (f.duty === 'transit') continue
        for (const m of f.members) {
          const l = (f.team === 'blue' ? cfg.blueLoadout : undefined)
            ?? cfg.loadouts?.[m.id] ?? loadoutOf(m.id)
          if (l?.kind === 'bomb') bombs += l.count
        }
      }
      expect(bombs, card.id).toBeLessThanOrEqual(BOMBS_CAPACITY)
    }
  })

  it('盟 M2 的 B-17 一輪齊投（120 顆）裝得下', () => {
    const m2 = MISSIONS.allies.find((m) => m.id === 'allies-m2') as ReadyMissionCard
    const cfg = missionConfigFrom(m2)
    let bombs = 0
    for (const f of cfg.units) {
      for (const m of f.members) if (m.id === 'b17g') bombs += loadoutOf('b17g')!.count
    }
    expect(bombs).toBe(120)
    expect(BOMBS_CAPACITY).toBeGreaterThanOrEqual(bombs)
  })
})
