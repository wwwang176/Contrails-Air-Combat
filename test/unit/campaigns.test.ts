import { describe, it, expect } from 'vitest'
import { MISSIONS, CAMPAIGNS, missionConfigFrom } from '../../src/battle/missions'
import { ALL_SPECS } from '../../src/battle/skirmish'
import type { MissionCard, ReadyMissionCard } from '../../src/battle/missions'

/**
 * # 三條戰役與 12 張卡
 *
 * 卡片拆成兩層：**目錄**（選單畫得出來就靠它）與**戰鬥設定**（`battle`）。
 * `battle === null` 就是「還沒做」——那取代了原本的 `playable` 旗標，
 * 而且把「資料要嘛完整、要嘛全空」從一條測試變成型別保證。
 */

const ALL: readonly MissionCard[] = CAMPAIGNS.flatMap((c) => MISSIONS[c])

const ready = (m: MissionCard): m is ReadyMissionCard => m.battle !== null

describe('三條戰役', () => {
  it('三條線各 4 關', () => {
    expect(CAMPAIGNS).toEqual(['allies', 'germany', 'japan'])
    for (const c of CAMPAIGNS) expect(MISSIONS[c], c).toHaveLength(4)
  })

  it('12 個 id 唯一，而且前綴就是戰役', () => {
    expect(new Set(ALL.map((m) => m.id)).size).toBe(12)
    for (const c of CAMPAIGNS) {
      for (const m of MISSIONS[c]) expect(m.id.startsWith(`${c}-`), m.id).toBe(true)
    }
  })

  it('全部標題不重複，而且每一張都有一行說明', () => {
    expect(new Set(ALL.map((m) => m.title)).size).toBe(12)
    for (const m of ALL) expect(m.summary.length, m.id).toBeGreaterThan(0)
  })

  it('八張打得起來，四張是目錄卡', () => {
    const playable = ALL.filter(ready)
    expect(playable.map((m) => m.id).sort()).toEqual([
      'allies-m1', 'allies-m2', 'allies-m4', 'germany-m1', 'germany-m4',
      'japan-m1', 'japan-m3', 'japan-m4',
    ])
    expect(ALL.length - playable.length).toBe(4)
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
    // 【為什麼要這一條】只加欄位不給值的話，五關全填 archipelago 一樣通得過
    // 「地形是合法的一種」，而日 M3 仍然開在群島上
    const of = (id: string) => playable.find((m) => m.id === id)!.battle.terrain
    expect(of('japan-m3')).toBe('sea')
    expect(of('germany-m4')).toBe('farmland')
    expect(new Set(playable.map((m) => m.battle.terrain)).size).toBeGreaterThan(1)
  })

  it('架數都是正整數', () => {
    for (const m of playable) {
      const b = m.battle
      for (const [k, v] of [['blue', b.blueCount], ['red', b.redCount]] as const) {
        expect(Number.isInteger(v), `${m.id} ${k}`).toBe(true)
        expect(v, `${m.id} ${k}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('目錄卡', () => {
  it('沒做的那四張仍然有完整的目錄資料', () => {
    // 【原本這裡還斷言「battle 是 null」，那是恆真的】篩選用的 `ready` 的
    // 定義就是 `battle !== null`。真正有內容的是「哪幾張
    // 是 ready」那一條，以及這裡：**目錄那一半不准跟著空掉** ——
    // 一張沒有標題的卡在選單上是一塊點不下去的空白
    const locked = ALL.filter((m) => !ready(m))
    expect(locked).toHaveLength(4)
    for (const m of locked) {
      expect(m.title.length, m.id).toBeGreaterThan(0)
      expect(m.summary.length, m.id).toBeGreaterThan(0)
    }
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

  /** 【兩種進攻規則不共存】`missionRules` 先看擊沉，炸毀那一格會靜靜地被忽略 */
  it('sinkCount 與 destroyCount 不共存', () => {
    for (const m of ALL.filter(ready)) {
      if (m.battle.sinkCount !== undefined) expect(m.battle.destroyCount, m.id).toBeUndefined()
    }
  })
})

describe('盟 M2 的卡片', () => {
  const m2 = ALL.find((m) => m.id === 'allies-m2') as ReadyMissionCard

  /** 【釘住精確的資料】通用的護欄只擋「有廠區才要求炸毀」；這裡釘的是這一關本身 */
  it('十二座構件、八座砲位、卡車；炸毀六座；洛伊納、十一月正午', () => {
    const b = m2.battle
    const units = b.ground!.map((e) => e.unit)
    expect(units.filter((u) => u === 'flakHeavy')).toHaveLength(8)
    expect(units.filter((u) => u === 'truck').length).toBeGreaterThan(0)
    const plant = units.filter((u) => u !== 'flakHeavy' && u !== 'truck')
    expect(plant).toHaveLength(12)
    expect(b.ground!.every((e) => e.team === 'red')).toBe(true)
    expect(b.destroyCount).toBe(6)
    expect(b.terrain).toBe('leuna')
    expect(b.timeOfDay).toBe('novemberNoon')
    expect(b.blueSpec.id).toBe('b17g')
    expect(b.blueCount).toBe(4)
  })

  it('第二批恰好四架 Bf 109，從後方（starboard = π）', () => {
    const waves = m2.battle.waves!
    expect(waves).toHaveLength(1)
    expect(waves[0]!.count).toBe(4)
    expect(waves[0]!.spec.id).toBe('bf109k4')
    expect(waves[0]!.starboard).toBe(Math.PI)
  })
})
