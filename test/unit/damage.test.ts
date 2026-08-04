import { describe, it, expect } from 'vitest'
import {
  createDamageEvents, pushDamage, clearDamage, DAMAGE_STRIDE,
} from '../../src/world/damage'
import { IMPACT_CAPACITY } from '../../src/world/events'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import type { Command, Controller } from '../../src/control/Controller'

describe('DamageEvents', () => {
  it('每筆四個 float：受害者索引 + 來彈方向', () => {
    expect(DAMAGE_STRIDE).toBe(4)
    const e = createDamageEvents(4)
    expect(e.data.length).toBe(4 * DAMAGE_STRIDE)
    expect(e.count).toBe(0)
    expect(e.dropped).toBe(0)
  })

  it('預設容量沿用 IMPACT_CAPACITY —— 每次命中推一筆，與 hitEvents 同數量', () => {
    expect(createDamageEvents().capacity).toBe(IMPACT_CAPACITY)
  })

  it('追加一筆，欄位依序寫入', () => {
    const e = createDamageEvents(4)
    pushDamage(e, 7, 1, 0, 0)
    expect(e.count).toBe(1)
    expect(Array.from(e.data.slice(0, DAMAGE_STRIDE))).toEqual([7, 1, 0, 0])
  })

  it('索引存進 float32 仍然精確', () => {
    // 【為什麼要測】float32 對 2^24 以內的整數精確，而參戰架數是 40。
    // 這條把那個推導釘住，免得日後有人把 victim 換成別的東西。
    const e = createDamageEvents(64)
    for (let i = 0; i < 64; i++) pushDamage(e, i, 0, 0, 1)
    for (let i = 0; i < 64; i++) expect(e.data[i * DAMAGE_STRIDE]).toBe(i)
  })

  it('滿了就丟棄並計數', () => {
    const e = createDamageEvents(2)
    pushDamage(e, 0, 0, 0, 1)
    pushDamage(e, 1, 0, 0, 1)
    pushDamage(e, 2, 0, 0, 1)
    expect(e.count).toBe(2)
    expect(e.dropped).toBe(1)
  })

  it('排空歸零 count，但不動 dropped', () => {
    // 【為什麼 dropped 是累計的】它是給整合測試斷言「從未溢位」用的。
    // 每次排空都歸零的話，溢位會在下一次排空時被抹掉，於是永遠測不到。
    const e = createDamageEvents(1)
    pushDamage(e, 0, 0, 0, 1)
    pushDamage(e, 1, 0, 0, 1)
    clearDamage(e)
    expect(e.count).toBe(0)
    expect(e.dropped).toBe(1)
  })
})

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.7
    out.firing = false
  }
}

/**
 * 藍隊射手（座位 0，擺在 500 m 外）與紅隊受害者（座位 1，擺在原點），原地不動。
 *
 * 【射手為什麼要擺遠】不擺開的話「同隊不推」那條測試裡的彈丸會改打到射手
 * 旁邊那一架敵機，測到的就不是想測的東西了。
 */
function shooterAndVictim(): World {
  const w = new World()
  const at = (x: number, y: number, z: number, team: 'blue' | 'red'): void => {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(x, y, z)
    a.state.velocity.set(0, 0, 0)
    a.prevPosition.copy(a.state.position)
    w.add(a, new Idle(), team, a.state.position.clone(), 4000, 200)
  }
  at(0, 4000, 500, 'blue')
  at(0, 4000, 0, 'red')
  return w
}

describe('World 的受擊事件', () => {
  it('命中就推一筆，方向是彈丸速度的反向', () => {
    // 由 +X 側往 −X 打，橫向穿過機身 —— 來彈方向於是是 +X。
    const w = shooterAndVictim()
    w.projectiles.spawn(50, 4000, 0, -1000, 0, 0, 10, 0)
    w.projectiles.step(0.1)
    w.resolveHits()

    expect(w.damageEvents.count).toBe(1)
    const d = w.damageEvents.data
    expect(d[0]).toBe(1)
    expect(d[1]).toBeCloseTo(1, 5)
    expect(d[2]).toBeCloseTo(0, 5)
    expect(d[3]).toBeCloseTo(0, 5)
  })

  it('方向是單位向量 —— 初速大小不會漏進去', () => {
    // 【為什麼要測】漏掉正規化的話 `markOffAxis` 會是 887 而不是 1，
    // 角度窗直接壞掉，而畫面上看起來只是「紅光有點怪」。
    const w = shooterAndVictim()
    w.projectiles.spawn(30, 4000, 30, -700, 0, -700, 10, 0)
    w.projectiles.step(0.1)
    w.resolveHits()

    expect(w.damageEvents.count).toBe(1)
    const d = w.damageEvents.data
    expect(Math.hypot(d[1]!, d[2]!, d[3]!)).toBeCloseTo(1, 5)
  })

  it('沒打中就不推', () => {
    const w = shooterAndVictim()
    w.projectiles.spawn(50, 5000, 0, -1000, 0, 0, 10, 0)
    w.projectiles.step(0.1)
    w.resolveHits()
    expect(w.damageEvents.count).toBe(0)
  })

  it('同隊的彈丸穿過去，不推', () => {
    // 【為什麼要測】同隊零傷害是一條既有規則；受擊事件推在 applyDamage
    // 旁邊，若位置放錯（例如放到粗篩之後、命中判定之前）就會漏出來。
    // 射手寫 1（紅隊自己），彈丸於是穿過紅隊那一架。
    const w = shooterAndVictim()
    w.projectiles.spawn(50, 4000, 0, -1000, 0, 0, 10, 1)
    w.projectiles.step(0.1)
    w.resolveHits()
    expect(w.damageEvents.count).toBe(0)
  })
})
