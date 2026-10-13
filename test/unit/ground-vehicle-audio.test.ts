import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { createGroundVehicleAudio } from '../../src/audio/groundVehicleAudio'
import { CATEGORY, VEHICLE_AUDIO_VOICES } from '../../src/audio/catalog'
import type { GroundUnitId } from '../../src/specs/ground'

function vehicle(id: GroundUnitId, index = 0, speed = 0, x = 0) {
  return {
    index, unit: { id } as never, speed, position: new Vector3(x, 0, 0),
    alive: true, dormant: false, arrived: false,
  }
}

function setup() {
  const assign = vi.fn()
  const ear = new Vector3()
  return { assign, ear, audio: createGroundVehicleAudio({ assign }, ear) }
}

describe('地面車輛循環', () => {
  it.each<GroundUnitId>(['tank', 'tankDug', 'panzer4', 'tiger', 'usTank'])(
    '%s 行進播履帶和小聲碎石，停車只指派坦克怠速，讓舊層淡出', (id) => {
      const { audio, assign } = setup()
      const t = vehicle(id, 5, 10, 30)
      audio.update([t])
      expect(assign.mock.calls).toEqual([
        ['vehicleDrive', 5, 'on-board-military-tank', 30, 0, 0, 1.2, 20 * Math.log10(0.7) + 20 * Math.log10(1.15)],
        ['vehicleRoll', 5, 'car-tires-rolling-on-gravel', 30, 0, 0, 1.2, -11 + 20 * Math.log10(1.5) + 20 * Math.log10(1.15)],
      ])
      assign.mockClear()
      t.speed = 0
      audio.update([t])
      expect(assign.mock.calls).toEqual([['vehicleIdle', 5, 'truck-idling-2', 30, 0, 0, 1,
        -4 + 20 * Math.log10(0.7) + 20 * Math.log10(1.15)]])
    },
  )

  it.each<GroundUnitId>(['truck', 'usTruck', 'usFlakTrack'])(
    '%s 共用卡車行進、碎石與怠速素材', (id) => {
      const { audio, assign } = setup()
      const t = vehicle(id, 9, 15)
      audio.update([t])
      expect(assign.mock.calls.map(c => [c[0], c[2], c[6]])).toEqual([
        ['vehicleDrive', 'truck-on-rough-terrain-interior', 1.2], ['vehicleRoll', 'gravel-tire-roll', 1.2],
      ])
      expect(10 ** (assign.mock.calls[0]![7] / 20)).toBeCloseTo(0.8 * 0.7 * 0.85)
      expect(assign.mock.calls[1]![7]).toBeCloseTo(-11 + 20 * Math.log10(1.5 * 0.85))
      assign.mockClear()
      t.speed = 0
      audio.update([t])
      expect(assign.mock.calls).toEqual([['vehicleIdle', 9, 'truck-idling-1', 0, 0, 0, 1,
        -4 + 20 * Math.log10(0.8 * 0.7) + 20 * Math.log10(0.85)]])
    },
  )

  it.each<GroundUnitId>(['tank', 'truck'])(
    '%s 加速時兩層同步升調，超速也不超過 120%，倒車依速率處理', (id) => {
      const { audio, assign } = setup()
      const t = vehicle(id)
      const max = id === 'tank' ? 10 : 15
      let last = 0
      for (const speed of [0.11, max / 2, max, max * 2]) {
        t.speed = speed
        assign.mockClear()
        audio.update([t])
        const rate = assign.mock.calls[0]![6]
        expect(rate).toBeGreaterThanOrEqual(0.8)
        expect(rate).toBeLessThanOrEqual(1.2)
        expect(rate).toBeGreaterThanOrEqual(last)
        expect(assign.mock.calls[1]![6]).toBe(rate)
        if (speed === max / 2) expect(rate).toBeCloseTo(1)
        last = rate
      }
      t.speed = -max
      assign.mockClear()
      audio.update([t])
      expect(assign.mock.calls[0]![6]).toBe(1.2)
    },
  )

  it('排除未出場、抵達、毀損及非指定車種，包含停放飛機與牽引砲', () => {
    const { audio, assign } = setup()
    audio.update([
      { ...vehicle('tank'), alive: false }, { ...vehicle('truck'), dormant: true },
      { ...vehicle('usFlakTrack'), arrived: true }, vehicle('parkedP51'), vehicle('parkedB17'),
      vehicle('atGun'), vehicle('flakHeavy'), vehicle('infantry'), vehicle('locomotive'),
    ])
    expect(assign).not.toHaveBeenCalled()
  })

  it('超過 64 個目標仍挑最近車輛；聽者移動後重新選取，遠處不占聲道', () => {
    const { audio, assign, ear } = setup()
    const targets = Array.from({ length: 100 }, (_, i) => vehicle('truck', i, 0, (100 - i) * 20))
    audio.update(targets)
    expect(assign.mock.calls.map(c => c[1])).toEqual([99, 98, 97, 96, 95, 94, 93, 92])
    expect(assign).toHaveBeenCalledTimes(VEHICLE_AUDIO_VOICES)
    ear.x = 2000
    assign.mockClear()
    audio.update(targets)
    expect(assign.mock.calls.map(c => c[1])).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    ear.x += CATEGORY.vehicle.max + 1
    assign.mockClear()
    audio.update(targets)
    expect(assign).not.toHaveBeenCalled()
    // 換關後清單縮短，不讀上一關留下的索引。
    audio.update([])
    expect(assign).not.toHaveBeenCalled()
  })
})
