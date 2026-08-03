import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World, type Combatant } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'
import {
  createHitResult, hitAircraft, segmentPointDistanceSq, PART_MULTIPLIER, type HitPart,
} from '../../src/world/hit'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

/** 什麼都不做的控制器。等價測試只關心命中判定。 */
class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
  }
}

/**
 * 決定性的偽亂數（mulberry32）。
 *
 * 【為什麼不用 Math.random】等價測試失敗時必須能重現。種子寫在測試裡，
 * 紅燈就能原樣再跑一次。
 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 暴力法的參考實作：對每一發彈丸掃過**全部**存活的敵機，取最近的。
 *
 * 這一份刻意寫成最笨的形式，與 World 裡的排序掃描沒有共用任何一行 —— 兩份
 * 各自算出答案才叫等價驗證。用的是同一組低階原語（hitAircraft、
 * segmentPointDistanceSq），因為要驗的是**候選集合**，不是命中盒數學。
 */
function referenceDamage(w: World): Map<number, number> {
  const hit = createHitResult()
  const s0 = new Vector3()
  const s1 = new Vector3()
  const out = new Map<number, number>()
  const p = w.projectiles

  for (let i = 0; i < p.capacity; i++) {
    const owner = p.owner[i]!
    if (owner === -1) continue
    const ax = p.sx[i]!, ay = p.sy[i]!, az = p.sz[i]!
    const bx = p.x[i]!, by = p.y[i]!, bz = p.z[i]!
    const shooter = w.combatants[owner]

    let bestT = Infinity
    let victim: Combatant | null = null
    let part: HitPart = 'fuselage'
    for (const c of w.combatants) {
      if (!c.alive) continue
      if (c.index === owner) continue
      if (shooter !== undefined && c.team === shooter.team) continue
      const pos = c.aircraft.state.position
      if (segmentPointDistanceSq(ax, ay, az, bx, by, bz, pos.x, pos.y, pos.z)
        > c.hitRadius * c.hitRadius) continue
      s0.set(ax, ay, az)
      s1.set(bx, by, bz)
      if (!hitAircraft(
        c.aircraft.spec.hitBoxes, pos, c.aircraft.state.orientation, s0, s1, hit,
      )) continue
      if (hit.t >= bestT) continue
      bestT = hit.t
      victim = c
      part = hit.part
    }
    if (!victim) continue
    out.set(victim.index, (out.get(victim.index) ?? 0) + PART_MULTIPLIER[part] * p.damage[i]!)
  }
  return out
}

/** 隨機擺 n 架飛機、隨機發射 shots 發彈丸，回傳世界。 */
function scenario(seed: number, n: number, shots: number): World {
  const r = rng(seed)
  const w = new World()
  for (let i = 0; i < n; i++) {
    const spec = i % 2 === 0 ? P51D : BF109G6
    const ac = new Aircraft(spec, 4000, 200)
    ac.state.position.set((r() - 0.5) * 600, 4000 + (r() - 0.5) * 300, (r() - 0.5) * 600)
    // 【隨機姿態用四個分量正規化，不要用 Euler 角】Euler 角在極點附近分布
    // 不均，某些姿態幾乎抽不到——而命中盒是長條形的，姿態分布不均等於
    // 有一整類幾何從來沒被這條等價測試走過
    ac.state.orientation.set(r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5).normalize()
    ac.prevPosition.copy(ac.state.position)
    const c = w.add(ac, new Idle(), i % 2 === 0 ? 'blue' : 'red', ac.state.position.clone())
    c.respawnOnDestroy = false
  }

  // 彈丸：線段長度取一個物理步的位移（240 Hz 下 .50 走 3.7 m）。
  //
  // 【七成瞄著某一架、三成純隨機】純隨機的話幾乎打不到人——飛機散在 600 m
  // 的範圍裡而包圍球只有 6 m，等價比對會退化成「兩邊都是 0 命中」而看起來
  // 全綠。這正是下面那條「至少要真的打中一些人」在守的東西：它第一次跑就
  // 紅了，逼出了這個設計。
  //
  // 三成的純隨機也不能省：它們是**窗外**的彈丸，用來驗證滑動視窗沒有把
  // 該排除的算進來（那會是效能問題而不是正確性問題，但一樣要看得到）。
  for (let k = 0; k < shots; k++) {
    const shooter = Math.floor(r() * n)
    let cx: number, cy: number, cz: number
    if (r() < 0.7) {
      // 瞄著某一架：中心落在該機重心附近 ±8 m，於是有命中也有擦邊
      const aim = w.combatants[Math.floor(r() * n)]!.aircraft.state.position
      cx = aim.x + (r() - 0.5) * 16
      cy = aim.y + (r() - 0.5) * 16
      cz = aim.z + (r() - 0.5) * 16
    } else {
      const o = w.combatants[shooter]!.aircraft.state.position
      cx = o.x + (r() - 0.5) * 400
      cy = o.y + (r() - 0.5) * 400
      cz = o.z + (r() - 0.5) * 400
    }
    // 隨機方向的線段，長度 3.7 m，以 (cx, cy, cz) 為中點
    const ux = r() - 0.5, uy = r() - 0.5, uz = r() - 0.5
    const len = Math.hypot(ux, uy, uz) || 1
    const hx = (ux / len) * 1.85, hy = (uy / len) * 1.85, hz = (uz / len) * 1.85

    const idx = w.projectiles.spawn(cx - hx, cy - hy, cz - hz, 0, 0, 0, 6, shooter)
    w.projectiles.sx[idx] = cx - hx
    w.projectiles.sy[idx] = cy - hy
    w.projectiles.sz[idx] = cz - hz
    w.projectiles.x[idx] = cx + hx
    w.projectiles.y[idx] = cy + hy
    w.projectiles.z[idx] = cz + hz
  }
  return w
}

describe('排序掃描與暴力全掃描等價', () => {
  it('40 架 × 2,000 發 × 8 組種子，逐架傷害完全相同', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const expected = referenceDamage(scenario(seed, 40, 2000))

      const w = scenario(seed, 40, 2000)
      const before = w.combatants.map((c) => c.hp)
      w.resolveHits()
      const actual = new Map<number, number>()
      for (const c of w.combatants) {
        const d = before[c.index]! - c.hp
        if (d !== 0) actual.set(c.index, d)
      }

      expect(actual.size, `種子 ${seed} 的受害者架數`).toBe(expected.size)
      for (const [index, damage] of expected) {
        expect(actual.get(index), `種子 ${seed} 的第 ${index} 架`).toBeCloseTo(damage, 6)
      }
    }
  })

  it('至少要真的打中一些人，否則這條測試是空的', () => {
    const w = scenario(1, 40, 2000)
    const before = w.combatants.map((c) => c.hp)
    w.resolveHits()
    const hurt = w.combatants.filter((c) => c.hp < before[c.index]!).length
    expect(hurt).toBeGreaterThan(3)
  })
})
