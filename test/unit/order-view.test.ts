import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { fillOrderView, type OrderSink } from '../../src/battle/orderView'
import type { FlightOrder } from '../../src/ai/command'
import type { Team } from '../../src/world/World'

interface Drawn {
  team: Team
  px: number, py: number, pz: number
  radius: number
  lx: number, ly: number, lz: number
}

/** 錄下每一筆 `add` 的接收端 */
function recorder(): OrderSink & { drawn: Drawn[], begins: number, ends: number } {
  const drawn: Drawn[] = []
  return {
    drawn,
    begins: 0,
    ends: 0,
    begin(): void { this.begins++; drawn.length = 0 },
    add(team, px, py, pz, radius, lx, ly, lz): void {
      drawn.push({ team, px, py, pz, radius, lx, ly, lz })
    },
    end(): void { this.ends++ },
  }
}

function order(over: Partial<FlightOrder> = {}): FlightOrder {
  return {
    kind: over.kind ?? 'rally',
    point: over.point ?? new Vector3(1000, 5000, -2000),
    radius: over.radius ?? 300,
    targetFlight: over.targetFlight ?? -1,
    side: over.side ?? 0,
    focusIndex: over.focusIndex ?? -1,
  }
}

function scene() {
  const b = createBattle(new AiController(), battleConfigFrom(DEFAULT_SKIRMISH), 20260813)
  // 清乾淨 —— 開場本來就沒有命令，但不依賴那件事
  b.blueCommand.orders.fill(null)
  b.redCommand.orders.fill(null)
  return b
}

/** 第一個藍隊分隊 / 第一個紅隊分隊的全域索引 */
function firstOf(b: ReturnType<typeof scene>, team: Team): number {
  return b.flights.flights.findIndex((f) => f.team === team)
}

describe('fillOrderView', () => {
  it('沒有命令時什麼都不畫，但 begin/end 照樣成對', () => {
    const b = scene()
    const r = recorder()
    fillOrderView(b, r)
    expect(r.drawn.length).toBe(0)
    expect(r.begins).toBe(1)
    expect(r.ends).toBe(1)
  })

  it('一張集合令 → 一顆球，球心與半徑照命令走', () => {
    const b = scene()
    const f = firstOf(b, 'blue')
    b.blueCommand.orders[f] = order({ point: new Vector3(1234, 5678, -910), radius: 450 })
    const r = recorder()
    fillOrderView(b, r)
    expect(r.drawn.length).toBe(1)
    const d = r.drawn[0]!
    expect([d.px, d.py, d.pz]).toEqual([1234, 5678, -910])
    expect(d.radius).toBe(450)
    expect(d.team).toBe('blue')
  })

  /**
   * 【線的起點必須是長機】判定用的是 `leaderDistance`（分隊裡第一個存活
   * 成員），畫出來的線若拉到別人身上，這個工具就在說謊 —— 而它存在的唯一
   * 理由就是看那條距離。
   */
  it('線的起點是分隊第一個存活成員', () => {
    const b = scene()
    const f = firstOf(b, 'blue')
    b.blueCommand.orders[f] = order()
    const leader = b.world.combatants[b.flights.flights[f]!.members[0]!]!
    leader.aircraft.state.position.set(77, 4321, -55)
    const r = recorder()
    fillOrderView(b, r)
    expect([r.drawn[0]!.lx, r.drawn[0]!.ly, r.drawn[0]!.lz]).toEqual([77, 4321, -55])
  })

  it('長機陣亡 → 線改拉到繼位的那一架', () => {
    const b = scene()
    const f = firstOf(b, 'blue')
    b.blueCommand.orders[f] = order()
    const members = b.flights.flights[f]!.members
    b.world.combatants[members[0]!]!.alive = false
    b.world.combatants[members[1]!]!.aircraft.state.position.set(-9, 3000, 12)
    const r = recorder()
    fillOrderView(b, r)
    expect([r.drawn[0]!.lx, r.drawn[0]!.ly, r.drawn[0]!.lz]).toEqual([-9, 3000, 12])
  })

  it('整隊陣亡 → 不畫', () => {
    const b = scene()
    const f = firstOf(b, 'blue')
    b.blueCommand.orders[f] = order()
    const flight = b.flights.flights[f]!
    for (let i = 0; i < flight.count; i++) {
      b.world.combatants[flight.members[i]!]!.alive = false
    }
    const r = recorder()
    fillOrderView(b, r)
    expect(r.drawn.length).toBe(0)
  })

  /**
   * 【`focus` 的 `point` 恆為零向量】它不用點。少了這個過濾，畫面上會多
   * 一顆黏在世界原點海面的球，而那看起來會像個 bug。
   */
  it('集火令不畫', () => {
    const b = scene()
    const f = firstOf(b, 'blue')
    b.blueCommand.orders[f] = order({ kind: 'focus', point: new Vector3(), radius: 0 })
    const r = recorder()
    fillOrderView(b, r)
    expect(r.drawn.length).toBe(0)
  })

  it('側翼令不畫', () => {
    const b = scene()
    const f = firstOf(b, 'blue')
    b.blueCommand.orders[f] = order({ kind: 'flank' })
    const r = recorder()
    fillOrderView(b, r)
    expect(r.drawn.length).toBe(0)
  })

  /**
   * 【隊伍要查對的那一份 state】兩份 `CommandState` 都開滿全域分隊長度、
   * 各自只填自己那幾格。查錯一份的症狀是「紅隊的球畫不出來」，而那在
   * 遊戲裡會被誤讀成「紅隊沒收到命令」。
   */
  it('紅隊的命令查 redCommand，顏色也是紅', () => {
    const b = scene()
    const f = firstOf(b, 'red')
    b.redCommand.orders[f] = order({ point: new Vector3(-500, 4000, 800) })
    // 同一個索引在 blueCommand 是 null，所以查錯就什麼都畫不出來
    const r = recorder()
    fillOrderView(b, r)
    expect(r.drawn.length).toBe(1)
    expect(r.drawn[0]!.team).toBe('red')
    expect([r.drawn[0]!.px, r.drawn[0]!.py, r.drawn[0]!.pz]).toEqual([-500, 4000, 800])
  })

  it('兩隊同時有命令 → 兩顆球', () => {
    const b = scene()
    b.blueCommand.orders[firstOf(b, 'blue')] = order()
    b.redCommand.orders[firstOf(b, 'red')] = order()
    const r = recorder()
    fillOrderView(b, r)
    expect(r.drawn.length).toBe(2)
    expect(new Set(r.drawn.map((d) => d.team))).toEqual(new Set(['blue', 'red']))
  })
})
