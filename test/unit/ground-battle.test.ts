import { describe, expect, it } from 'vitest'
import {
  BURN_EVERY, BURNS, createGroundBattle, MORTAR_ELEVATION, MORTAR_PERIOD, MORTAR_RANGE_MAX, MORTAR_RANGE_MIN,
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
    const infantry = createGroundTarget(0, 'infantry', 'blue', 0, 0, 0)
    const victim = createGroundTarget(1, 'tank', 'red', 400, 0, 0)
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
