import { describe, expect, it } from 'vitest'
import {
  burstTimesBetween, BURN_EVERY, BURNS, createGroundBattle, INFANTRY_BURST_PERIOD, INFANTRY_BURST_SECONDS,
  INFANTRY_ROUNDS_PER_SECOND, MORTAR_ELEVATION, MORTAR_PERIOD, MORTAR_RANGE_MAX, MORTAR_RANGE_MIN,
  MORTAR_SCATTER, nearestEnemy, shotTimesBetween, SHOT_JITTER, WRECK_SMOKE_SECONDS,
} from '../../src/render/groundBattle'
import { solveArc, type ArcShot } from '../../src/render/arc'
import { ARC_TRAIL_CAPACITY, ARC_TRAIL_SECONDS } from '../../src/render/arcTrails'
import { FIRE_SECONDS } from '../../src/render/shipFires'
import { BLAST_PACE, FIRE_BLAST } from '../../src/render/blast'
import { FIRE_CHUNK_CAPACITY, FIRE_CHUNK_LIFE } from '../../src/render/chunks'
import { createGroundTarget } from '../../src/world/groundTargets'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import { createBattle, stepBattle } from '../../src/battle/setup'

/**
 * # 地面戰的戲：射擊排程與挑目標
 *
 * 排程是時間的純函數：同一段時間得到同一組射擊，切成幾幀來算也一樣 —— 否則
 * 幀率不同的兩台機器看到的戲不同，而且一幀的長短會改變開火數。
 */

function times(i: number, period: number, t0: number, t1: number): number[] {
  const out = new Float64Array(512)
  const n = shotTimesBetween(i, period, t0, t1, out)
  return Array.from(out.subarray(0, n))
}

describe('射擊排程', () => {
  it('同一段時間同一組結果', () => {
    expect(times(3, 7, 0, 120)).toEqual(times(3, 7, 0, 120))
  })

  it('切成很多幀算，拼起來與一次算相同', () => {
    const whole = times(5, 7, 0, 60)
    const pieces: number[] = []
    for (let t = 0; t < 60; t += 1 / 60) pieces.push(...times(5, 7, t, Math.min(60, t + 1 / 60)))
    expect(pieces).toEqual(whole)
  })

  it('區間是左開右閉：不會在兩幀的交界算兩次', () => {
    const all = times(2, 5, 0, 100)
    const t = all[3]!
    expect(times(2, 5, 0, t)).toContain(t)
    expect(times(2, 5, t, 100)).not.toContain(t)
  })

  it('相鄰兩發的間隔落在 (1 ± 2 × 抖動) 倍的週期內，而且遞增', () => {
    const all = times(7, 6, 0, 600)
    expect(all.length).toBeGreaterThan(80)
    for (let k = 1; k < all.length; k++) {
      const gap = all[k]! - all[k - 1]!
      expect(gap).toBeGreaterThan(6 * (1 - 2 * SHOT_JITTER) - 1e-9)
      expect(gap).toBeLessThan(6 * (1 + 2 * SHOT_JITTER) + 1e-9)
    }
  })

  it('不同的射手錯開，不會全場同一刻開火', () => {
    expect(times(0, 7, 0, 7)).not.toEqual(times(1, 7, 0, 7))
  })
})

/**
 * # 步兵連發
 *
 * 步兵一次打一串（`INFANTRY_ROUNDS_PER_SECOND` 的射速、連發 `INFANTRY_BURST_SECONDS` 秒），然後停一陣再打下一串 ——
 * 與轟炸機砲塔的機槍同一個節奏。排程同樣是時間的純函數。
 */
describe('步兵連發的排程', () => {
  const rounds = (i: number, t0: number, t1: number): number[] => {
    const out = new Float64Array(2048)
    const n = burstTimesBetween(i, INFANTRY_BURST_PERIOD, INFANTRY_BURST_SECONDS, INFANTRY_ROUNDS_PER_SECOND, t0, t1, out)
    return Array.from(out.subarray(0, n))
  }
  const step = 1 / INFANTRY_ROUNDS_PER_SECOND
  /** 依「間隔大於兩發的間距」把一串發射時間切成一串一串 */
  const bursts = (times: number[]): number[][] => {
    const out: number[][] = []
    for (const t of times) {
      const last = out[out.length - 1]
      if (last !== undefined && t - last[last.length - 1]! < step * 1.5) last.push(t)
      else out.push([t])
    }
    return out
  }

  it('同一段時間同一組結果，切成很多幀算拼起來與一次算相同', () => {
    const whole = rounds(4, 0, 90)
    expect(whole.length).toBeGreaterThan(50)
    expect(rounds(4, 0, 90)).toEqual(whole)
    const pieces: number[] = []
    for (let t = 0; t < 90; t += 1 / 60) pieces.push(...rounds(4, t, Math.min(90, t + 1 / 60)))
    expect(pieces).toEqual(whole)
  })

  it('區間是左開右閉：不會在兩幀的交界算兩次', () => {
    const all = rounds(2, 0, 100)
    const t = all[20]!
    expect(rounds(2, 0, t)).toContain(t)
    expect(rounds(2, t, 100)).not.toContain(t)
  })

  it('一串一串地打：串內每發相隔一個射速的間距，每串發數是連發秒數乘射速', () => {
    const all = bursts(rounds(7, 0, 300))
    expect(all.length).toBeGreaterThan(30)
    const expected = Math.round(INFANTRY_BURST_SECONDS * INFANTRY_ROUNDS_PER_SECOND)
    // 頭一串與最後一串可能被區間切掉一截，只看中間的
    for (const b of all.slice(1, -1)) {
      expect(b).toHaveLength(expected)
      for (let k = 1; k < b.length; k++) expect(b[k]! - b[k - 1]!).toBeCloseTo(step, 9)
    }
  })

  it('串與串之間停一陣：停頓不短於一個週期扣掉連發與兩側抖動，而且至少兩秒', () => {
    const all = bursts(rounds(7, 0, 300))
    const burstLength = (Math.round(INFANTRY_BURST_SECONDS * INFANTRY_ROUNDS_PER_SECOND) - 1) * step
    const minPause = INFANTRY_BURST_PERIOD * (1 - 2 * SHOT_JITTER) - burstLength
    expect(minPause).toBeGreaterThan(2)
    for (let k = 1; k < all.length; k++) {
      expect(all[k]![0]! - all[k - 1]![all[k - 1]!.length - 1]!).toBeGreaterThanOrEqual(minPause - 1e-9)
    }
  })

  it('連發加上兩側抖動排得進一個週期：兩串永遠不會疊在一起', () => {
    expect(INFANTRY_BURST_SECONDS + 2 * SHOT_JITTER * INFANTRY_BURST_PERIOD).toBeLessThan(INFANTRY_BURST_PERIOD)
  })

  it('不同的射手錯開，不會全場同一刻開火', () => {
    expect(rounds(0, 0, 20)).not.toEqual(rounds(1, 0, 20))
  })

  /** 排程是純函數，但接不接上要在戰場裡量：場上的步兵不管卡片的 `period`，照連發打 */
  it('戰場裡的步兵照這個排程開火：發數與排程一致，串與串之間停頓', () => {
    const flat = (): number => 0
    const fired: number[] = []
    let now = 0
    const gb = createGroundBattle({ shooters: ['infantry'], period: 1e6, range: 1500 } as never, () => {}, undefined,
      undefined, () => { fired.push(now) })
    const a = createGroundTarget(0, 'infantry', 'blue', 0, 0, 0)
    const b = createGroundTarget(1, 'infantry', 'red', 300, 0, 0)
    let last = 0
    for (now = 0; now <= 70; now += 0.1) {
      gb.update([a, b], now, 0.1, flat)
      last = now
    }
    expect(fired.length).toBe(rounds(0, 0, last).length + rounds(1, 0, last).length)
    expect(fired.length).toBeGreaterThan(100)
    // 兩個射手的發射時間混在一起；各自一串的間距是 0.1 s，所以「停頓」要看兩人同時安靜的空檔
    const quiet = fired.slice(1).map((t, k) => t - fired[k]!)
    expect(Math.max(...quiet)).toBeGreaterThan(1)
    gb.dispose()
  })
})

describe('勒熱夫的長燒火塊', () => {
  /**
   * 【最壞情況：所有能燒的單位都死了、卡片上的火源全開】長燒的殘骸與火源每 `BURN_EVERY` 秒各發
   * 一朵火（`FIRE_BLAST.fireCount` 塊），一塊活 `FIRE_CHUNK_LIFE × BLAST_PACE` 秒。池子滿了新的會
   * 蓋掉還沒熄的，症狀是火一閃一閃地缺塊。與爆炸共用，所以要留餘裕
   */
  it('最壞情況同時活著的火塊不超過共用池的容量', () => {
    const card = MISSIONS.germany.find((c) => c.id === 'germany-m4') as ReadyMissionCard
    const burnable = (id: string): boolean => (BURNS as ReadonlySet<string>).has(id)
    const fromGround = card.battle.ground!.filter((g) => burnable(g.unit)).length
    const fromColumns = card.battle.columns!.reduce((n, c) => n + c.units.filter(burnable).length, 0)
    const sources = fromGround + fromColumns + (card.battle.theater!.smokes?.length ?? 0)
    const batches = Math.ceil((FIRE_CHUNK_LIFE * BLAST_PACE) / BURN_EVERY)
    const need = sources * FIRE_BLAST.fireCount * batches
    expect(sources).toBeGreaterThan(30)
    expect(need).toBeLessThanOrEqual(FIRE_CHUNK_CAPACITY)
  })
})

describe('用真的卡片開打', () => {
  it('德 M4 開場之後雙方都在開火', () => {
    const card = MISSIONS.germany.find((c) => c.id === 'germany-m4') as ReadyMissionCard
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    const gb = createGroundBattle(card.battle.theater!, () => {})
    const flat = (): number => 0
    for (let f = 0; f < 60 * 20; f++) {
      for (let k = 0; k < 4; k++) stepBattle(b, 1 / 240)
      gb.update(b.world.groundTargets, b.world.time, 1 / 60, flat)
    }
    // 30 多台射手、平均 7 秒一發，20 秒至少上百發
    expect(gb.shots).toBeGreaterThan(50)
    gb.dispose()
  })

  it('玩家炸毀的坦克在地面火燒完之後接著冒煙，砲位不冒', () => {
    const card = MISSIONS.germany.find((c) => c.id === 'germany-m4') as ReadyMissionCard
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    const burns: { x: number; z: number }[] = []
    const gb = createGroundBattle({ ...card.battle.theater!, smokes: [] }, (x, _y, z) => burns.push({ x, z }))
    const flat = (): number => 0
    const tank = b.world.groundTargets.find((t) => t.unit.id === 'panzer4' && t.killAt === Infinity)!
    const gun = b.world.groundTargets.find((t) => t.unit.id === 'atGun')!
    tank.alive = false
    gun.alive = false
    const at = (t: { position: { x: number; z: number } }) =>
      burns.filter((p) => p.x === t.position.x && p.z === t.position.z).length
    for (let s = 0; s < 70 * 10; s++) {
      b.world.time += 0.1
      gb.update(b.world.groundTargets, b.world.time, 0.1, flat)
      if (s === 55 * 10) {
        expect(at(tank)).toBe(0)
      }
    }
    expect(at(tank)).toBeGreaterThan(0)
    expect(at(gun)).toBe(0)
    gb.dispose()
  })

  /** 【殘骸的煙會熄】地面火之後再冒 `WRECK_SMOKE_SECONDS` 秒就不再補煙；整場一直冒的話煙柱只增不減 */
  it('殘骸的煙在 FIRE_SECONDS + WRECK_SMOKE_SECONDS 之後不再補', () => {
    const card = MISSIONS.germany.find((c) => c.id === 'germany-m4') as ReadyMissionCard
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    const burns: { x: number; z: number }[] = []
    const gb = createGroundBattle({ ...card.battle.theater!, smokes: [] }, (x, _y, z) => burns.push({ x, z }))
    const flat = (): number => 0
    const tank = b.world.groundTargets.find((t) => t.unit.id === 'panzer4' && t.killAt === Infinity)!
    tank.alive = false
    const at = (): number => burns.filter((p) => p.x === tank.position.x && p.z === tank.position.z).length
    const end = FIRE_SECONDS + WRECK_SMOKE_SECONDS
    let during = 0
    for (let s = 0; s < (end + 30) * 10; s++) {
      b.world.time += 0.1
      gb.update(b.world.groundTargets, b.world.time, 0.1, flat)
      if (s === (end - 5) * 10) during = at()
    }
    // 熄之前的最後幾秒還在冒，熄了之後一朵都沒有多
    expect(during).toBeGreaterThan(0)
    expect(at()).toBeLessThanOrEqual(during + Math.ceil(5 / BURN_EVERY) + 1)
    gb.dispose()
  })
})

/**
 * 【劇本打掉的最後一發】`killAt` 到了，那一台由模擬打掉（沒有血量可言）；畫面上補一發命中的砲彈，
 * 看得到是誰打的、不是憑空爆炸。週期設得極大，只剩這一發。
 */
/**
 * 【砲塔的瞄準目標】SPEC `2026-10-08-gun-traverse-design.md` §5.2：開砲打誰就指著誰；
 * 目標失效才每秒重挑最近的
 */
describe('砲塔的瞄準目標', () => {
  const theater = { shooters: ['tank', 'atGun'], period: 1e6, range: 1500 } as const
  const flat = (): number => 0
  const run = (targets: ReturnType<typeof createGroundTarget>[], from: number, to: number, gb: ReturnType<typeof createGroundBattle>): void => {
    for (let t = from; t < to; t += 0.1) gb.update(targets, t, 0.1, flat)
  }

  it('一秒內挑到射程內最近的敵方；死了換下一個；都沒有是 −1', () => {
    const me = createGroundTarget(0, 'tank', 'blue', 0, 0, 0)
    const near = createGroundTarget(1, 'tank', 'red', 500, 0, 0)
    const far = createGroundTarget(2, 'atGun', 'red', 900, 0, 0)
    const out = createGroundTarget(3, 'tank', 'red', 2000, 0, 0)
    const list = [me, near, far, out]
    const gb = createGroundBattle(theater as never, () => {})
    expect(gb.aimTarget(0)).toBe(-1)
    run(list, 0, 1.2, gb)
    expect(gb.aimTarget(0)).toBe(1)
    near.alive = false
    run(list, 1.2, 2.4, gb)
    expect(gb.aimTarget(0)).toBe(2)
    far.alive = false
    run(list, 2.4, 3.6, gb)
    expect(gb.aimTarget(0)).toBe(-1)
    gb.dispose()
  })

  it('目標還有效就不換成更近的：只有開砲會換', () => {
    const me = createGroundTarget(0, 'tank', 'blue', 0, 0, 0)
    const first = createGroundTarget(1, 'tank', 'red', 500, 0, 0)
    const later = createGroundTarget(2, 'tank', 'red', 300, 0, 0)
    later.dormant = true
    const list = [me, first, later]
    const gb = createGroundBattle(theater as never, () => {})
    run(list, 0, 1.2, gb)
    expect(gb.aimTarget(0)).toBe(1)
    later.dormant = false
    run(list, 1.2, 4, gb)
    expect(gb.aimTarget(0)).toBe(1)
    gb.dispose()
  })

  /** 【劇本補發】最近的是 A，補發打 B：砲塔要指著 B，直到 B 照劇本死掉 */
  it('開砲打誰就指著誰，包括劇本指定的那一台', () => {
    const me = createGroundTarget(0, 'tank', 'blue', 0, 0, 0)
    const a = createGroundTarget(1, 'atGun', 'red', 400, 0, 0)
    const b = createGroundTarget(2, 'tank', 'red', 900, 0, 0)
    b.killAt = 30
    const list = [me, a, b]
    const gb = createGroundBattle(theater as never, () => {})
    run(list, 0, 22, gb)
    expect(gb.aimTarget(0)).toBe(1)
    run(list, 22, 29.5, gb)
    expect(gb.shots).toBe(1)
    expect(gb.aimTarget(0)).toBe(2)
    gb.dispose()
  })

  it('不開直射砲的（步兵、迫擊砲）沒有瞄準目標；reset 清掉', () => {
    const inf = createGroundTarget(0, 'infantry', 'blue', 0, 0, 0)
    const me = createGroundTarget(1, 'tank', 'blue', 10, 0, 0)
    const foe = createGroundTarget(2, 'tank', 'red', 300, 0, 0)
    const list = [inf, me, foe]
    const gb = createGroundBattle({ shooters: ['tank', 'infantry'], period: 1e6, range: 1500 } as never, () => {})
    run(list, 0, 1.2, gb)
    expect(gb.aimTarget(0)).toBe(-1)
    expect(gb.aimTarget(1)).toBe(2)
    gb.reset()
    expect(gb.aimTarget(1)).toBe(-1)
    expect(gb.aimTarget(99)).toBe(-1)
    gb.dispose()
  })
})

describe('劇本打掉前的最後一發', () => {
  const theater = { shooters: ['tank'], period: 1e6, range: 1500 } as const
  const flat = (): number => 0
  const run = (targets: ReturnType<typeof createGroundTarget>[], from: number, to: number, gb: ReturnType<typeof createGroundBattle>): void => {
    for (let t = from; t < to; t += 0.1) gb.update(targets, t, 0.1, flat)
  }

  it('killAt 之前 6 秒內，射程內最近的敵方戰車補一發，而且只補一發', () => {
    const attacker = createGroundTarget(0, 'tank', 'blue', 0, 0, 0)
    const victim = createGroundTarget(1, 'tank', 'red', 900, 0, 0)
    victim.killAt = 30
    const gb = createGroundBattle(theater as never, () => {})
    run([attacker, victim], 0, 22, gb)
    expect(gb.shots).toBe(0)
    run([attacker, victim], 22, 31, gb)
    expect(gb.shots).toBe(1)
    run([attacker, victim], 31, 45, gb)
    expect(gb.shots).toBe(1)
    gb.dispose()
  })

  /** 【必中】補的這一發是這一台被打掉的畫面，打偏的話看起來是砲彈落在旁邊、車自己爆掉 */
  it('補的那一發必中：瞄準點就是被打掉的那一台', () => {
    const attacker = createGroundTarget(0, 'tank', 'blue', 0, 0, 0)
    const victim = createGroundTarget(1, 'tank', 'red', 900, 0, 0)
    victim.killAt = 30
    const gb = createGroundBattle(theater as never, () => {})
    run([attacker, victim], 0, 31, gb)
    expect(gb.shots).toBe(1)
    expect(gb.hitShots).toBe(1)
    gb.dispose()
  })

  it('射程外沒有人補；開場殘骸（killAt 0）不補；沒排定的（Infinity）不補', () => {
    const far = createGroundBattle(theater as never, () => {})
    const a = createGroundTarget(0, 'tank', 'blue', 0, 0, 0)
    const v = createGroundTarget(1, 'tank', 'red', 2400, 0, 0)
    v.killAt = 30
    run([a, v], 0, 40, far)
    expect(far.shots).toBe(0)
    far.dispose()
    const wreck = createGroundBattle(theater as never, () => {})
    const w = createGroundTarget(1, 'tank', 'red', 600, 0, 0)
    w.killAt = 0
    run([createGroundTarget(0, 'tank', 'blue', 0, 0, 0), w], 0, 40, wreck)
    expect(wreck.shots).toBe(0)
    wreck.dispose()
    const none = createGroundBattle(theater as never, () => {})
    run([createGroundTarget(0, 'tank', 'blue', 0, 0, 0), createGroundTarget(1, 'tank', 'red', 600, 0, 0)], 0, 40, none)
    expect(none.shots).toBe(0)
    none.dispose()
  })

  it('補的是砲彈（不是步兵的槍）：只有戰車與砲補，步兵不補', () => {
    // 步兵在自己的射程（600 m）之外，所以場上唯一可能開火的就是「補最後一發」
    const infantry = createGroundTarget(0, 'infantry', 'blue', 0, 0, 0)
    const victim = createGroundTarget(1, 'tank', 'red', 900, 0, 0)
    victim.killAt = 30
    const gb = createGroundBattle({ shooters: ['tank', 'infantry'], period: 1e6, range: 1500 } as never, () => {})
    run([infantry, victim], 0, 40, gb)
    expect(gb.shots).toBe(0)
    gb.dispose()
  })
})

/**
 * 【直射砲彈擊中：用迫擊砲的小爆炸】戰車與反坦克砲的砲彈打中目標，爆出與迫擊砲落地同一份小爆炸
 * （`impact` 回呼）；打偏的揚塵、步兵的槍彈只有一小團火花，都不放。
 */
describe('直射砲彈擊中', () => {
  const flat = (): number => 0

  it('必中的最後一發擊中：爆在被打掉的那一台身上，只爆一次', () => {
    const blasts: { x: number; y: number; z: number }[] = []
    const gb = createGroundBattle({ shooters: ['tank'], period: 1e6, range: 1500 } as never, () => {}, undefined,
      (x, y, z) => { blasts.push({ x, y, z }) })
    const attacker = createGroundTarget(0, 'tank', 'blue', 0, 0, 0)
    const victim = createGroundTarget(1, 'tank', 'red', 900, 0, 0)
    victim.killAt = 30
    for (let t = 0; t < 45; t += 0.1) gb.update([attacker, victim], t, 0.1, flat)
    expect(gb.hitShots).toBe(1)
    expect(blasts).toHaveLength(1)
    expect(blasts[0]!.x).toBeCloseTo(900, 6)
    expect(blasts[0]!.z).toBeCloseTo(0, 6)
    // 爆在車身的高度，不是貼地
    expect(blasts[0]!.y).toBeGreaterThan(0.5)
    gb.dispose()
  })

  it('每一發命中爆一次、打偏的不爆：落地回呼的次數等於命中數', () => {
    let calls = 0
    const gb = createGroundBattle({ shooters: ['tank'], period: 1, range: 1500 } as never, () => {}, undefined,
      () => { calls++ })
    const a = createGroundTarget(0, 'tank', 'blue', 0, 0, 0)
    const b = createGroundTarget(1, 'tank', 'red', 900, 0, 0)
    for (let t = 0; t < 100; t += 0.1) gb.update([a, b], t, 0.1, flat)
    a.alive = false
    b.alive = false
    // 停火之後在飛的砲彈（飛行約 2 秒）全部落地
    for (let t = 100; t < 110; t += 0.1) gb.update([a, b], t, 0.1, flat)
    expect(gb.hitShots).toBeGreaterThan(10)
    expect(gb.shots).toBeGreaterThan(gb.hitShots)
    expect(calls).toBe(gb.hitShots)
    gb.dispose()
  })

  it('步兵的槍彈打中不放小爆炸', () => {
    let calls = 0
    const gb = createGroundBattle({ shooters: ['infantry'], period: 0.5, range: 1500 } as never, () => {}, undefined,
      () => { calls++ })
    const a = createGroundTarget(0, 'infantry', 'blue', 0, 0, 0)
    const b = createGroundTarget(1, 'infantry', 'red', 300, 0, 0)
    for (let t = 0; t < 60; t += 0.1) gb.update([a, b], t, 0.1, flat)
    expect(gb.hitShots).toBeGreaterThan(10)
    expect(calls).toBe(0)
    gb.dispose()
  })
})

/**
 * 【砲口聲的通報】戰車與反坦克砲每開一發通報一次（`fired` 回呼：單位 id 與砲口的世界座標），
 * 聲音由呼叫端決定。步兵的槍、迫擊砲不通報。
 */
describe('砲口聲的通報', () => {
  const flat = (): number => 0
  type Shot = { unit: string; x: number; y: number; z: number }
  const battle = (shooters: string[], period: number): { gb: ReturnType<typeof createGroundBattle>; shots: Shot[] } => {
    const shots: Shot[] = []
    const gb = createGroundBattle({ shooters, period, range: 1500 } as never, () => {}, undefined, undefined,
      (unit, x, y, z) => { shots.push({ unit, x, y, z }) })
    return { gb, shots }
  }

  it('戰車每開一發通報一次，砲口在車頭前方、車身的高度', () => {
    const { gb, shots } = battle(['tank'], 1)
    const a = createGroundTarget(0, 'tank', 'blue', 0, 0, 0)
    const b = createGroundTarget(1, 'tank', 'red', 900, 0, 0)
    for (let t = 0; t < 30; t += 0.1) gb.update([a, b], t, 0.1, flat)
    expect(gb.shots).toBeGreaterThan(10)
    expect(shots).toHaveLength(gb.shots)
    expect(new Set(shots.map((s) => s.unit))).toEqual(new Set(['tank']))
    for (const s of shots) {
      expect(s.y).toBeGreaterThan(0.5)
      // 射手在 x = 0 朝 +x 打，或在 x = 900 朝 −x 打：砲口離車心約半個車長
      const fromBlue = Math.abs(s.x) < 50
      const fromRed = Math.abs(s.x - 900) < 50
      expect(fromBlue || fromRed).toBe(true)
    }
    gb.dispose()
  })

  it('反坦克砲通報自己的單位 id', () => {
    const { gb, shots } = battle(['atGun'], 1)
    const a = createGroundTarget(0, 'atGun', 'blue', 0, 0, 0)
    const b = createGroundTarget(1, 'atGun', 'red', 600, 0, 0)
    for (let t = 0; t < 30; t += 0.1) gb.update([a, b], t, 0.1, flat)
    expect(shots.length).toBeGreaterThan(10)
    expect(new Set(shots.map((s) => s.unit))).toEqual(new Set(['atGun']))
    gb.dispose()
  })

  it('劇本打掉前的最後一發也通報，通報的是開砲的那一台', () => {
    const { gb, shots } = battle(['tank'], 1e6)
    const attacker = createGroundTarget(0, 'tank', 'blue', 0, 0, 0)
    const victim = createGroundTarget(1, 'tank', 'red', 900, 0, 0)
    victim.killAt = 30
    for (let t = 0; t < 45; t += 0.1) gb.update([attacker, victim], t, 0.1, flat)
    expect(shots).toHaveLength(1)
    expect(Math.abs(shots[0]!.x)).toBeLessThan(50)
    gb.dispose()
  })

  it('步兵每開一槍通報一次，砲口在人的高度', () => {
    const { gb, shots } = battle(['infantry'], 0.5)
    const a = createGroundTarget(0, 'infantry', 'blue', 0, 0, 0)
    const b = createGroundTarget(1, 'infantry', 'red', 300, 0, 0)
    for (let t = 0; t < 30; t += 0.1) gb.update([a, b], t, 0.1, flat)
    expect(gb.shots).toBeGreaterThan(10)
    expect(shots).toHaveLength(gb.shots)
    expect(new Set(shots.map((s) => s.unit))).toEqual(new Set(['infantry']))
    for (const s of shots) {
      expect(s.y).toBeGreaterThan(1)
      expect(s.y).toBeLessThan(2)
    }
    gb.dispose()
  })

  /** 開場前就已經在天上飛的彈不是現在發的，沒有砲口聲 */
  it('迫擊砲每發射一發通報一次；開場時已在飛的不通報', () => {
    const { gb, shots } = battle(['mortar'], 1e6)
    const a = createGroundTarget(0, 'mortar', 'blue', 0, 0, 0)
    const b = createGroundTarget(1, 'tank', 'red', 900, 0, 0)
    gb.update([a, b], 0, 0.1, flat)
    const inFlightAtOpening = gb.arcShots
    expect(inFlightAtOpening).toBeGreaterThan(0)
    expect(shots).toHaveLength(0)
    for (let t = 0.1; t < 60; t += 0.1) gb.update([a, b], t, 0.1, flat)
    expect(gb.arcShots).toBeGreaterThan(inFlightAtOpening)
    expect(shots).toHaveLength(gb.arcShots - inFlightAtOpening)
    expect(new Set(shots.map((s) => s.unit))).toEqual(new Set(['mortar']))
    gb.dispose()
  })
})

/**
 * 【迫擊砲：高拋物線的間接射擊】不走直射的曳光彈：發射、飛行、落地各一次，落地時小爆炸。
 * 直射的週期設得極大，場上只剩迫擊砲在打。
 */
describe('迫擊砲', () => {
  const theater = { shooters: ['mortar', 'tank'], period: 1e6, range: 1500 } as const
  const flat = (): number => 0
  const run = (targets: ReturnType<typeof createGroundTarget>[], to: number, gb: ReturnType<typeof createGroundBattle>): void => {
    for (let t = 0; t < to; t += 0.1) gb.update(targets, t, 0.1, flat)
  }
  const mortar = (team: 'red' | 'blue', x: number): ReturnType<typeof createGroundTarget> => createGroundTarget(0, 'mortar', team, x, 0, 0)
  const tank = (team: 'red' | 'blue', x: number, i = 1): ReturnType<typeof createGroundTarget> => createGroundTarget(i, 'tank', team, x, 0, 0)

  it('射程內的敵方挨炮：打出弧線彈、飛完落地各通報一次；直射的發數不增', () => {
    const gb = createGroundBattle(theater as never, () => {})
    const targets = [mortar('red', 0), tank('blue', 900)]
    run(targets, 100, gb)
    // 100 秒約 8 發，加上開場時已經在天上的一兩發
    expect(gb.arcShots).toBeGreaterThanOrEqual(5)
    expect(gb.arcShots).toBeLessThanOrEqual(13)
    // 飛行時間約 18 秒：100 秒時早發的已經落地，不是全部都還在天上
    expect(gb.arcLanded).toBeGreaterThan(0)
    expect(gb.arcLanded).toBeLessThanOrEqual(gb.arcShots)
    expect(gb.shots).toBe(0)
    gb.dispose()
  })

  it('飛行時間之後一定落地：發完最後一發再等一個尾流長度，全部落地', () => {
    const gb = createGroundBattle(theater as never, () => {})
    const m = mortar('red', 0)
    const t = tank('blue', 900)
    // 只讓迫擊砲活 30 秒：之後它不再發，剩下在飛的自己落地
    for (let s = 0; s < 300; s++) gb.update([m, t], s * 0.1, 0.1, flat)
    m.alive = false
    expect(gb.arcShots).toBeGreaterThan(0)
    for (let s = 300; s < 300 + 600; s++) gb.update([m, t], s * 0.1, 0.1, flat)
    expect(gb.arcLanded).toBe(gb.arcShots)
    gb.dispose()
  })

  /** 【開場天上就有彈】戰鬥是從中途開始的：第一幀就有幾發在飛、各自落地一次，不是從一片空天開始 */
  it('開場第一幀就有彈在天上，之後各自落地一次；開場前已經落地的不補', () => {
    const gb = createGroundBattle(theater as never, () => {})
    const targets = [mortar('red', 0), tank('blue', 900)]
    gb.update(targets, 0, 0, flat)
    expect(gb.arcShots).toBeGreaterThanOrEqual(1)
    expect(gb.arcShots).toBeLessThanOrEqual(3)
    expect(gb.arcLanded).toBe(0)
    expect(gb.shots).toBe(0)
    const opening = gb.arcShots
    // 開場那一批 20 秒之內全部落地（1 km 的飛行時間約 19 秒）
    for (let t = 0.1; t < 20; t += 0.1) gb.update(targets, t, 0.1, flat)
    expect(gb.arcLanded).toBeGreaterThanOrEqual(opening)
    gb.dispose()
  })

  it('開場那一批的飛行進度由「開場前多久發的」決定：同一個迫擊砲、同一個時刻，永遠同一組', () => {
    const run = (): number[] => {
      const blasts: number[] = []
      const gb = createGroundBattle(theater as never, () => {}, undefined, (x, _y, z) => { blasts.push(Math.round(x * 10 + z)) })
      const targets = [mortar('red', 0), tank('blue', 900)]
      for (let t = 0; t < 25; t += 0.1) gb.update(targets, t, 0.1, flat)
      gb.dispose()
      return blasts
    }
    expect(run()).toEqual(run())
  })

  it('同隊、太遠、太近、沒列在 shooters 的都不打', () => {
    const cases: [string, ReturnType<typeof createGroundTarget>[], unknown][] = [
      ['同隊', [mortar('red', 0), tank('red', 900)], theater],
      ['太遠', [mortar('red', 0), tank('blue', MORTAR_RANGE_MAX + 200)], theater],
      ['太近', [mortar('red', 0), tank('blue', MORTAR_RANGE_MIN - 50)], theater],
      ['沒列在 shooters', [mortar('red', 0), tank('blue', 900)], { ...theater, shooters: ['tank'] }],
    ]
    for (const [name, targets, th] of cases) {
      const gb = createGroundBattle(th as never, () => {})
      run(targets, 60, gb)
      expect(gb.arcShots, name).toBe(0)
      gb.dispose()
    }
  })

  it('死掉的迫擊砲不打，死掉的目標不挨', () => {
    const dead = createGroundBattle(theater as never, () => {})
    const m = mortar('red', 0)
    m.alive = false
    run([m, tank('blue', 900)], 60, dead)
    expect(dead.arcShots).toBe(0)
    dead.dispose()
    const gone = createGroundBattle(theater as never, () => {})
    const t = tank('blue', 900)
    t.alive = false
    run([mortar('red', 0), t], 60, gone)
    expect(gone.arcShots).toBe(0)
    gone.dispose()
  })

  /** 劇本打掉前的最後一發是直射的砲彈（必中、曳光），迫擊砲的高拋彈不能代打 */
  it('劇本打掉前的最後一發不由迫擊砲補', () => {
    const gb = createGroundBattle({ ...theater, period: 1e6 } as never, () => {})
    const victim = tank('red', 600, 1)
    victim.killAt = 30
    const m = createGroundTarget(0, 'mortar', 'blue', 0, 0, 0)
    for (let t = 0; t < 40; t += 0.1) gb.update([m, victim], t, 0.1, flat)
    expect(gb.shots).toBe(0)
    expect(gb.hitShots).toBe(0)
    gb.dispose()
  })

  it('同一段時間同一組結果：切成大幀或小幀發出的彈數一樣', () => {
    const count = (dt: number): number => {
      const gb = createGroundBattle(theater as never, () => {})
      const targets = [mortar('red', 0), tank('blue', 900)]
      for (let t = 0; t < 60; t += dt) gb.update(targets, t, dt, flat)
      const n = gb.arcShots
      gb.dispose()
      return n
    }
    expect(count(0.05)).toBe(count(0.5))
  })

  /** 落地的爆炸由呼叫端給（炸彈的配方縮小，`main.ts`）：每一發落地呼叫一次，落在目標的散佈半徑之內、貼地 */
  it('每一發落地呼叫一次爆炸回呼，落點在目標周圍 MORTAR_SCATTER 之內', () => {
    const blasts: { x: number; y: number; z: number }[] = []
    const gb = createGroundBattle(theater as never, () => {}, undefined, (x, y, z) => { blasts.push({ x, y, z }) })
    const m = mortar('red', 0)
    const t = tank('blue', 900)
    for (let s = 0; s < 300; s++) gb.update([m, t], s * 0.1, 0.1, flat)
    m.alive = false
    for (let s = 300; s < 900; s++) gb.update([m, t], s * 0.1, 0.1, flat)
    expect(gb.arcShots).toBeGreaterThan(0)
    expect(blasts).toHaveLength(gb.arcLanded)
    expect(blasts).toHaveLength(gb.arcShots)
    for (const b of blasts) {
      expect(Math.hypot(b.x - 900, b.z - 0)).toBeLessThanOrEqual(MORTAR_SCATTER + 1e-6)
      expect(b.y).toBeCloseTo(0, 6)
    }
    gb.dispose()
  })

  it('尾流是場景物件之一，換場清空（含上一場的落點）', () => {
    const gb = createGroundBattle(theater as never, () => {})
    expect(gb.objects.some((o) => o.name === 'groundBattle.arcTrails')).toBe(true)
    run([mortar('red', 0), tank('blue', 900)], 90, gb)
    expect(gb.arcShots).toBeGreaterThan(0)
    expect(gb.arcLanded).toBeGreaterThan(0)
    expect(gb.arcLastLanding.x).not.toBe(0)
    gb.reset()
    expect(gb.arcShots).toBe(0)
    expect(gb.arcLanded).toBe(0)
    expect({ ...gb.arcLastLanding }).toEqual({ x: 0, y: 0, z: 0 })
    gb.dispose()
  })

  /**
   * 【池子要夠大】尾流池滿了會蓋掉還在飛的一發，那一發永遠不落地（沒有爆炸）。最壞情況由卡片算：
   * 每門迫擊砲同時在天上與收尾的彈數 ≤ ⌈(最遠的飛行時間 + 收尾) ÷ 週期⌉ + 1
   */
  it('尾流池的容量夠德 M4 的最壞情況', () => {
    const card = MISSIONS.germany.find((c) => c.id === 'germany-m4') as ReadyMissionCard
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    const targets = b.world.groundTargets
    const sol: ArcShot = { x0: 0, y0: 0, z0: 0, vx: 0, vy: 0, vz: 0, flight: 0 }
    let slots = 0
    for (const m of targets) {
      if (m.unit.id !== 'mortar') continue
      let farthest = 0
      for (const t of targets) {
        if (t.team === m.team) continue
        const d = Math.hypot(t.position.x - m.position.x, t.position.z - m.position.z)
        if (d < MORTAR_RANGE_MIN || d > MORTAR_RANGE_MAX) continue
        if (solveArc(0, 0, 0, d, 0, 0, MORTAR_ELEVATION, sol)) farthest = Math.max(farthest, sol.flight)
      }
      slots += Math.ceil((farthest + ARC_TRAIL_SECONDS) / MORTAR_PERIOD) + 1
    }
    expect(slots).toBeGreaterThan(20)
    expect(slots).toBeLessThanOrEqual(ARC_TRAIL_CAPACITY)
  })
})

describe('挑目標', () => {
  const tank = (i: number, team: 'red' | 'blue', x: number) =>
    createGroundTarget(i, 'tank', team, x, 0, 0)

  it('挑範圍內最近的存活敵方，跳過同隊', () => {
    const ts = [tank(0, 'blue', 0), tank(1, 'blue', 50), tank(2, 'red', 300), tank(3, 'red', 200)]
    expect(nearestEnemy(ts, 0, 1500)).toBe(3)
  })

  it('死的與還沒出現的不挑', () => {
    const ts = [tank(0, 'blue', 0), tank(1, 'red', 100), tank(2, 'red', 200), tank(3, 'red', 400)]
    ts[1]!.alive = false
    ts[2]!.alive = false
    ts[2]!.dormant = true
    expect(nearestEnemy(ts, 0, 1500)).toBe(3)
  })

  it('超出射程回 −1', () => {
    const ts = [tank(0, 'blue', 0), tank(1, 'red', 2000)]
    expect(nearestEnemy(ts, 0, 1500)).toBe(-1)
  })
})
