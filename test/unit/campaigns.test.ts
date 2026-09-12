import { describe, it, expect } from 'vitest'
import { MISSIONS, CAMPAIGNS, missionConfigFrom } from '../../src/battle/missions'
import { ALL_SPECS } from '../../src/battle/skirmish'
import { createBattle, stepBattle } from '../../src/battle/setup'
import type { MissionCard, ReadyMissionCard } from '../../src/battle/missions'

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

  it('護送與攔截有被護送的機種，其餘沒有', () => {
    for (const m of playable) {
      const wants = m.type === '護航' || m.type === '攔截'
      expect(m.battle.convoySpec !== null, `${m.id}／${m.type}`).toBe(wants)
      expect(m.battle.convoyCount > 0, `${m.id}／${m.type}`).toBe(wants)
    }
  })

  it('地形逐關指定，不是全部群島', () => {
    // 【為什麼要這一條】只加欄位不給值的話，每一關全填 archipelago 一樣通得過
    // 「地形是合法的一種」，而日 M3 仍然開在群島上
    const of = (id: string) => playable.find((m) => m.id === id)!.battle.terrain
    expect(of('japan-m3')).toBe('sea')
    expect(of('germany-m4')).toBe('farmland')
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

describe('missionConfigFrom', () => {
  it('只吃可玩的卡，不再吃陣營', () => {
    for (const m of ALL.filter(ready)) {
      const cfg = missionConfigFrom(m)
      expect(cfg.units.length, m.id).toBeGreaterThan(0)
    }
  })

  it('雙方的機種照卡片，不是照陣營推出來的', () => {
    // 【這是整輪的本體】日 M3 玩家開 Ki-84 —— 那是「第三架」，
    // 舊的 `specsFor(f)[0]` 永遠選不到它
    const m3 = ALL.filter(ready).find((m) => m.id === 'japan-m3')!
    const cfg = missionConfigFrom(m3)
    const blue = cfg.units.find((u) => u.team === 'blue')!
    expect(blue.members[0]!.id).toBe('ki84')
    const convoy = cfg.units.filter((u) => u.duty === 'transit')
    expect(convoy.length).toBeGreaterThan(0)
    expect(convoy[0]!.members[0]!.id).toBe('g4m')
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
      const hostile = m.battle.ground!.filter((e) => e.team === 'red').length
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
