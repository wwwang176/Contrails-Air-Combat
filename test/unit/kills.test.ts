import { describe, it, expect } from 'vitest'
import { createKills, pushKill, clearKills, KILL_STRIDE } from '../../src/world/kills'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import type { Command, Controller } from '../../src/control/Controller'

describe('KillEvents', () => {
  it('每筆八個 float：位置、速度、combatant 索引、兇手索引', () => {
    expect(KILL_STRIDE).toBe(8)
    const e = createKills(4)
    expect(e.data.length).toBe(4 * KILL_STRIDE)
    expect(e.count).toBe(0)
    expect(e.dropped).toBe(0)
  })

  it('追加一筆，欄位依序寫入', () => {
    const e = createKills(4)
    pushKill(e, 1, 2, 3, 10, 20, 30, 7)
    expect(e.count).toBe(1)
    expect(Array.from(e.data.slice(0, KILL_STRIDE))).toEqual([1, 2, 3, 10, 20, 30, 7, -1])
  })

  it('第八欄是兇手的座位索引，省略時是 −1', () => {
    // 【為什麼要有「省略時是 −1」】撞海與自摔走的是不帶兇手的那條路徑。
    // 預設值若是 0，每一次自摔都會變成第 0 座位的擊墜。
    const e = createKills(2)
    pushKill(e, 1, 2, 3, 10, 20, 30, 7, 4)
    pushKill(e, 0, 0, 0, 0, 0, 0, 1)
    expect(e.data[7]).toBe(4)
    expect(e.data[KILL_STRIDE + 7]).toBe(-1)
  })

  it('索引存進 float32 仍然精確', () => {
    // 【為什麼要測】float32 對 2^24 以內的整數精確，而參戰架數是 40。
    // 這條測試是把那個推導釘住，免得日後有人把 index 換成別的東西。
    const e = createKills(64)
    for (let i = 0; i < 64; i++) pushKill(e, 0, 0, 0, 0, 0, 0, i)
    for (let i = 0; i < 64; i++) {
      expect(e.data[i * KILL_STRIDE + 6]).toBe(i)
    }
  })

  it('滿了就丟棄並計數', () => {
    const e = createKills(2)
    pushKill(e, 0, 0, 0, 0, 0, 0, 0)
    pushKill(e, 0, 0, 0, 0, 0, 0, 1)
    pushKill(e, 0, 0, 0, 0, 0, 0, 2)
    expect(e.count).toBe(2)
    expect(e.dropped).toBe(1)
  })

  it('排空歸零 count，但不動 dropped', () => {
    // 【為什麼 dropped 是累計的】它是給整合測試斷言「從未溢位」用的。
    // 每次排空都歸零的話，溢位會在下一次排空時被抹掉，於是永遠測不到。
    const e = createKills(1)
    pushKill(e, 0, 0, 0, 0, 0, 0, 0)
    pushKill(e, 0, 0, 0, 0, 0, 0, 1)
    clearKills(e)
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

function oneWorld(n: number): World {
  const w = new World()
  for (let i = 0; i < n; i++) {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(i * 100, 4000, 0)
    a.prevPosition.copy(a.state.position)
    w.add(a, new Idle(), 'blue', a.state.position.clone(), 4000, 200)
  }
  return w
}

describe('World 的擊墜事件', () => {
  it('容量跟著參戰架數長', () => {
    const w = oneWorld(5)
    expect(w.killEvents.capacity).toBe(5)
  })

  it('destroy 推一筆，帶著位置、速度與索引', () => {
    const w = oneWorld(2)
    const c = w.combatants[1]!
    c.aircraft.state.velocity.set(120, -3, -40)
    w.destroy(c)
    expect(w.killEvents.count).toBe(1)
    const d = w.killEvents.data
    expect(d[0]).toBeCloseTo(100, 4)
    expect(d[3]).toBeCloseTo(120, 4)
    expect(d[4]).toBeCloseTo(-3, 4)
    expect(d[5]).toBeCloseTo(-40, 4)
    expect(d[6]).toBe(1)
  })

  it('自動重生的靶機不算擊墜', () => {
    // 【為什麼】respawnOnDestroy 是 M2 靶機用的：被打爆就滿血回到出生點。
    // 那不是一次擊墜，不該生爆炸與殘骸。
    const w = oneWorld(1)
    const c = w.combatants[0]!
    c.respawnOnDestroy = true
    w.destroy(c)
    expect(w.killEvents.count).toBe(0)
    expect(c.alive).toBe(true)
  })

  it('全員陣亡也不溢位', () => {
    const w = oneWorld(40)
    for (const c of w.combatants) w.destroy(c)
    expect(w.killEvents.count).toBe(40)
    expect(w.killEvents.dropped).toBe(0)
  })
})
