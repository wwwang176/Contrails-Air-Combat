import type { Vector3 } from 'three'
import type { GroundUnitId } from '../specs/ground'
import type { GroundTarget } from '../world/groundTargets'
import type { AudioEngine } from './engine'
import { CATEGORY, VEHICLE_AUDIO_VOICES } from './catalog'
import { nearestN } from './nearest'

interface VehicleSound {
  readonly drive: string
  readonly roll: string
  readonly idle: string
  /** 主聲音與怠速的車種增益；碎石另外調整。 */
  readonly gainDb: number
  /** 該車種三層一起調整，保留主聲音與碎石的比例。 */
  readonly overallGainDb: number
  /** 混音用滿速基準，m/s；不修改物理或路線速度。 */
  readonly fullSpeed: number
}

const TANK: VehicleSound = {
  drive: 'on-board-military-tank', roll: 'car-tires-rolling-on-gravel',
  idle: 'truck-idling-2', fullSpeed: 10, gainDb: -3.098039,
  overallGainDb: 4.735782,
}
const TRUCK: VehicleSound = {
  drive: 'truck-on-rough-terrain-interior', roll: 'gravel-tire-roll',
  idle: 'truck-idling-1', fullSpeed: 15, gainDb: -5.036239,
  overallGainDb: -4.509661,
}
/** M16 共用卡車素材，音量獨立調整。 */
const M16: VehicleSound = { ...TRUCK, overallGainDb: -1.411621 }
const SOUNDS: Readonly<Partial<Record<GroundUnitId, VehicleSound>>> = {
  tank: TANK, tankDug: TANK, panzer4: TANK, tiger: TANK, usTank: TANK,
  truck: TRUCK, usTruck: TRUCK, usFlakTrack: M16,
}

/** 碎石只補行進質感，怠速比行進引擎安靜一些。 */
const ROLL_DB = -7.478175
const IDLE_DB = -4
const MOVING_SPEED = 0.1

type Vehicle = Pick<GroundTarget, 'index' | 'unit' | 'position' | 'speed' | 'alive' | 'dormant' | 'arrived'>

/** 地面車輛只占自己的循環池；同時取最近八台，避免車隊淹沒飛機與砲聲。 */
export function createGroundVehicleAudio(audio: Pick<AudioEngine, 'assign'>, ear: Vector3) {
  const keys = new Int32Array(VEHICLE_AUDIO_VOICES)
  const positions: Vector3[] = []
  let valid = new Uint8Array(0)

  function update(targets: readonly Vehicle[]): void {
    // 只在車隊規模增加時配置，不能像飛機一樣截斷在前 64 個目標。
    if (valid.length < targets.length) valid = new Uint8Array(targets.length)
    positions.length = targets.length
    const maxDistanceSq = CATEGORY.vehicle.max ** 2
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]!
      positions[i] = t.position
      valid[i] = t.alive && !t.dormant && !t.arrived && SOUNDS[t.unit.id] !== undefined
        && t.position.distanceToSquared(ear) <= maxDistanceSq ? 1 : 0
    }
    const count = nearestN(positions, valid, targets.length, ear.x, ear.y, ear.z, keys)
    for (let i = 0; i < count; i++) {
      const t = targets[keys[i]!]!
      const sound = SOUNDS[t.unit.id]!
      const p = t.position
      const speed = Math.abs(t.speed)
      if (speed <= MOVING_SPEED) {
        audio.assign('vehicleIdle', t.index, sound.idle, p.x, p.y, p.z, 1,
          IDLE_DB + sound.gainDb + sound.overallGainDb)
      } else {
        const rate = Math.min(1.2, 0.8 + 0.4 * speed / sound.fullSpeed)
        // 不另乘都卜勒或隨機音高，保留指定的 0.8～1.2 倍範圍。
        audio.assign('vehicleDrive', t.index, sound.drive, p.x, p.y, p.z, rate,
          sound.gainDb + sound.overallGainDb)
        audio.assign('vehicleRoll', t.index, sound.roll, p.x, p.y, p.z, rate, ROLL_DB + sound.overallGainDb)
      }
      // 三層各自持有聲道：未指派的舊層由引擎淡出，新層淡入並隨機起播。
    }
  }

  return { update }
}
