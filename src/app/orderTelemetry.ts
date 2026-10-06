import type { Vector3 } from 'three'
import type { CommandUnit, FlightOrder } from '../ai/commandTypes'
import type { Flight } from '../battle/flights'

interface TelemetryFlights {
  readonly flightOf: ArrayLike<number>
  readonly flights: readonly Readonly<Pick<Flight, 'count' | 'members'>>[]
}

type TelemetryUnits = readonly Readonly<Pick<CommandUnit, 'alive' | 'position'>>[]

/**
 * 玩家命令的遙測歷史。比較物件身分才能區分「同一張令一直未解除」與「同種類反覆重發」。
 * 每幀只追蹤參考；字串與距離只在呼叫 label 時產生，不參與指揮或抵達判定。
 */
export function createOrderTelemetry() {
  let orderRef: FlightOrder | null = null
  let orderSince = 0
  let orderCount = 0

  function track(order: FlightOrder | null, elapsed: number): void {
    if (order === orderRef) return
    orderRef = order
    orderSince = elapsed
    if (order !== null) orderCount++
  }

  function reset(): void {
    orderRef = null
    orderSince = 0
    orderCount = 0
  }

  function label(
    order: FlightOrder | null, elapsed: number, playerPosition: Pick<Vector3, 'distanceTo'>,
    playerIndex: number, flights: TelemetryFlights, units: TelemetryUnits,
  ): string {
    if (order === null) return '無'
    const held = (elapsed - orderSince).toFixed(0)
    const base = `${order.kind}（第 ${orderCount} 張，已握 ${held}s`
    if (order.kind !== 'rally') return base + '）'
    const d = playerPosition.distanceTo(order.point)
    return `${base}，我離 ${d.toFixed(0)} m，${leaderLabel(order.point, playerIndex, flights, units)}`
      + `／判定 ${order.radius.toFixed(0)} m）`
  }

  return { track, reset, label }
}

/**
 * 刻意讀指揮層快照的第一個存活成員，而非飛機本體。與「我離」不同時，
 * 能分辨是編制或快照不同步；遙測不應要求指揮模組公開內部的抵達判定函式。
 */
function leaderLabel(point: Vector3, playerIndex: number, flights: TelemetryFlights, units: TelemetryUnits): string {
  const f = flights.flightOf[playerIndex] ?? -1
  const flight = f >= 0 ? flights.flights[f] : undefined
  if (flight === undefined) return '長機 無編制'
  for (let i = 0; i < flight.count; i++) {
    const idx = flight.members[i]!
    const u = units[idx]
    if (u === undefined || !u.alive) continue
    const d = Math.hypot(u.position.x - point.x, u.position.y - point.y, u.position.z - point.z)
    return `長機 #${idx} 離 ${d.toFixed(0)} m`
  }
  return '長機 全滅'
}
