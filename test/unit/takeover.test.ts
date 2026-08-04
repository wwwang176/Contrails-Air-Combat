import { describe, it, expect } from 'vitest'
import { pickTakeover, TAKEOVER_DELAY } from '../../src/battle/takeover'
import { createFlights, SCHWARM_SIZE } from '../../src/battle/flights'
import type { Team } from '../../src/world/World'

/** 造 n 架藍、n 架紅的假座位，並依此建編制。玩家釘在座位 0。 */
function scene(bluePerSide: number, redPerSide: number) {
  const seats: { index: number; team: Team; alive: boolean }[] = []
  for (let i = 0; i < bluePerSide; i++) {
    seats.push({ index: seats.length, team: 'blue', alive: true })
  }
  for (let i = 0; i < redPerSide; i++) {
    seats.push({ index: seats.length, team: 'red', alive: true })
  }
  const flights = createFlights(seats, 0)
  return { seats, flights }
}

describe('pickTakeover（M9 spec §7.1）', () => {
  it('同分隊還有僚機時接他', () => {
    const { seats, flights } = scene(8, 8)
    expect(pickTakeover(flights, seats, 0)).toBe(1)
  })

  it('同分隊的僚機死光了就往同分隊後面找', () => {
    const { seats, flights } = scene(8, 8)
    seats[1]!.alive = false
    expect(pickTakeover(flights, seats, 0)).toBe(2)
  })

  it('整個分隊只剩玩家時，接別的分隊', () => {
    const { seats, flights } = scene(8, 8)
    for (let i = 1; i < SCHWARM_SIZE; i++) seats[i]!.alive = false
    expect(pickTakeover(flights, seats, 0)).toBe(SCHWARM_SIZE)
  })

  it('絕不回傳敵方的座位', () => {
    const { seats, flights } = scene(4, 4)
    for (let i = 1; i < 4; i++) seats[i]!.alive = false
    expect(pickTakeover(flights, seats, 0)).toBe(-1)
  })

  it('絕不回傳玩家自己', () => {
    const { seats, flights } = scene(4, 4)
    for (let i = 1; i < 4; i++) seats[i]!.alive = false
    // 玩家自己標成還活著也一樣
    seats[0]!.alive = true
    expect(pickTakeover(flights, seats, 0)).toBe(-1)
  })

  it('只剩玩家一架時回傳 −1', () => {
    const { seats, flights } = scene(1, 4)
    expect(pickTakeover(flights, seats, 0)).toBe(-1)
  })

  it('不會挑已經陣亡的', () => {
    const { seats, flights } = scene(8, 8)
    seats[1]!.alive = false
    seats[2]!.alive = false
    expect(pickTakeover(flights, seats, 0)).toBe(3)
  })

  it('延遲是 2 秒', () => {
    expect(TAKEOVER_DELAY).toBe(2)
  })
})
