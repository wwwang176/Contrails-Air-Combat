import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createOrderTelemetry } from '../../src/app/orderTelemetry'
import type { FlightOrder } from '../../src/ai/commandTypes'

function order(kind: FlightOrder['kind'] = 'rally'): FlightOrder {
  return { kind, point: new Vector3(), radius: 300, targetFlight: -1, side: 0, focusIndex: -1 }
}

const position = new Vector3(30, 40, 0)
const noFlights = { flightOf: new Int32Array([-1]), flights: [] }

describe('命令遙測', () => {
  it('同一張命令不重計時，同種類的新物件仍算新命令', () => {
    const telemetry = createOrderTelemetry()
    const first = order('focus')
    telemetry.track(first, 2)
    telemetry.track(first, 8)
    expect(telemetry.label(first, 12, position, 0, noFlights, [])).toBe('focus（第 1 張，已握 10s）')
    const next = order('focus')
    telemetry.track(next, 12)
    expect(telemetry.label(next, 15, position, 0, noFlights, [])).toBe('focus（第 2 張，已握 3s）')
  })

  it('解除或人工接手不增加張數，重新取得同一物件仍重新計時', () => {
    const telemetry = createOrderTelemetry()
    const command = order('flank')
    telemetry.track(command, 2)
    telemetry.track(null, 4)
    expect(telemetry.label(null, 5, position, 0, noFlights, [])).toBe('無')
    telemetry.track(command, 8)
    expect(telemetry.label(command, 10, position, 0, noFlights, [])).toBe('flank（第 2 張，已握 2s）')
  })

  it('換場重設獨立於其他追蹤器，不把舊場張數帶進來', () => {
    const a = createOrderTelemetry(), b = createOrderTelemetry()
    const command = order('focus')
    a.track(command, 2)
    b.track(command, 3)
    a.reset()
    a.track(command, 10)
    expect(a.label(command, 12, position, 0, noFlights, [])).toBe('focus（第 1 張，已握 2s）')
    expect(b.label(command, 12, position, 0, noFlights, [])).toBe('focus（第 1 張，已握 9s）')
  })

  it('集合令分別顯示玩家位置與第一個存活長機的指揮快照，遵守有效成員數', () => {
    const telemetry = createOrderTelemetry()
    const command = order()
    const flight = { count: 2, members: new Int32Array([0, 1, 2]) }
    const flights = { flightOf: new Int32Array([0]), flights: [flight] }
    const units = [
      { alive: false, position: new Vector3(999, 0, 0) },
      { alive: true, position: new Vector3(0, 0, 12) },
      { alive: true, position: new Vector3() },
    ]
    telemetry.track(command, 1)
    expect(telemetry.label(command, 6, position, 0, flights, units))
      .toBe('rally（第 1 張，已握 5s，我離 50 m，長機 #1 離 12 m／判定 300 m）')
    units[1]!.alive = false
    expect(telemetry.label(command, 6, position, 0, flights, units)).toContain('長機 全滅')
    flight.count = 3
    expect(telemetry.label(command, 6, position, 0, flights, units)).toContain('長機 #2 離 0 m')
    expect(position.toArray()).toEqual([30, 40, 0])
  })

  it('換場後讀取新的編制，無編制或缺少快照時提供明確診斷', () => {
    const telemetry = createOrderTelemetry()
    const command = order()
    telemetry.track(command, 0)
    expect(telemetry.label(command, 1, position, 0, noFlights, [])).toContain('長機 無編制')
    const flights = { flightOf: new Int32Array([0]), flights: [{ count: 1, members: new Int32Array([4]) }] }
    expect(telemetry.label(command, 1, position, 0, flights, [])).toContain('長機 全滅')
  })
})
