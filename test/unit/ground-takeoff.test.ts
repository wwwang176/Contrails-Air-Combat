import { expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { createTakeoffRoll, GEAR_CLEARANCE, ROLL_SECONDS } from '../../src/control/takeoffRoll'
import { createGroundTarget } from '../../src/world/groundTargets'
import { stepGroundTaxi, type TakeoffSeat } from '../../src/world/groundTakeoff'

function fixture(x: number, index: number) {
  const target = createGroundTarget(0, 'parkedP51', 'red', x, 100, 0)
  target.position.y = 15
  target.hp = 47
  target.departedAs = 0
  const roll = createTakeoffRoll(x, 100, 0, 15)
  roll.elapsed = ROLL_SECONDS
  target.taxi = roll
  const seat: TakeoffSeat = {
    index, hp: 100, alive: false, retired: true, takeoff: null,
    aircraft: {
      state: { position: new Vector3(), velocity: new Vector3(), orientation: new Quaternion(), angularVelocity: new Vector3(1, 2, 3) },
      prevPosition: new Vector3(), prevOrientation: new Quaternion(),
    },
  }
  return { target, seat, roll }
}

it('離地交接同步血量、速度、插值姿態與起飛事件，交錯更新不串用上一架的位置', () => {
  const first = fixture(100, 7)
  const second = fixture(900, 11)
  const liftoffs = [3]
  for (const { target, seat, roll } of [first, second]) {
    const x = target.position.x
    stepGroundTaxi(target, 1 / 240, [seat], liftoffs)
    expect(target.taxi).toBeNull()
    expect(target.rolling).toBe(false)
    expect(target.speed).toBe(0)
    expect(target.alive).toBe(false)
    expect(target.departed).toBe(true)
    expect(seat.takeoff).toBe(roll)
    expect(seat.hp).toBe(47)
    expect(seat.alive).toBe(true)
    expect(seat.retired).toBe(false)
    expect(seat.aircraft.state.position.x).toBe(x)
    expect(seat.aircraft.state.position.y - target.position.y).toBeCloseTo(GEAR_CLEARANCE, 12)
    expect(seat.aircraft.state.velocity.length()).toBeGreaterThan(49)
    expect(seat.aircraft.state.angularVelocity.toArray()).toEqual([0, 0, 0])
    expect(seat.aircraft.prevPosition).toEqual(seat.aircraft.state.position)
    expect(seat.aircraft.prevOrientation).toEqual(seat.aircraft.state.orientation)
  }
  expect(first.seat.aircraft.state.position.x).toBe(100)
  expect(liftoffs).toEqual([3, 7, 11])
})

it('地面飛機已被擊毀時清除腳本，不啟用空中席位、不新增起飛事件', () => {
  const { target, seat, roll } = fixture(100, 7)
  target.alive = false
  target.rolling = true
  const liftoffs: number[] = []
  stepGroundTaxi(target, 1 / 240, [seat], liftoffs)
  expect(target.taxi).toBeNull()
  expect(target.rolling).toBe(false)
  expect(target.departed).toBe(false)
  expect(roll.elapsed).toBe(ROLL_SECONDS)
  expect(seat.alive).toBe(false)
  expect(seat.takeoff).toBeNull()
  expect(liftoffs).toEqual([])
})
