import { beforeAll, expect, it } from 'vitest'
import { Mesh, Quaternion, Vector3 } from 'three'
import { loadGlbTemplatesForNode } from '../fixtures/glb'
import { createGroundModels } from '../../src/render/groundTargets'
import { PARKED_OFFSET_KEY } from '../../src/render/geometry/ground/parked'
import { createGroundTarget } from '../../src/world/groundTargets'
import { stepGroundTaxi, type TakeoffSeat } from '../../src/world/groundTakeoff'
import { createTakeoffRoll, ROLL_SECONDS } from '../../src/control/takeoffRoll'
import { PARKED_TAIL_DOWN } from '../../src/specs/ground'
import { airframePose } from '../../src/world/groundAirframe'
import { P51D } from '../../src/specs/p51d'

beforeAll(loadGlbTemplatesForNode)

it('加速邊界維持抬頭與機首位置；離地時畫面、命中姿態和飛行姿態連續', () => {
  const target = createGroundTarget(0, 'parkedP51', 'red', 0, 0, 0)
  target.airframe = P51D
  target.departedAs = 0
  const roll = createTakeoffRoll(0, -8, 0, 0, 1, {
    path: [{ x: 0, z: 0 }, { x: 0, z: -8 }], startHeading: 0,
  })
  target.taxi = roll
  const seat: TakeoffSeat = {
    index: 0, hp: 1000, alive: false, retired: true, takeoff: null,
    aircraft: {
      state: { position: new Vector3(), orientation: new Quaternion(), velocity: new Vector3(), angularVelocity: new Vector3() },
      prevPosition: new Vector3(), prevOrientation: new Quaternion(),
    },
  }
  const models = createGroundModels([target])
  const mesh = models.object.children[0] as Mesh
  const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), PARKED_TAIL_DOWN)
  const offset = mesh.geometry.userData[PARKED_OFFSET_KEY] as { x: number; y: number; z: number }
  const localNose = new Vector3(0, 0, -4).applyQuaternion(tilt).add(new Vector3(offset.x, offset.y, offset.z))
  const nose = () => localNose.clone().applyMatrix4(mesh.matrixWorld)
  const pos = new Vector3()
  const quat = new Quaternion()
  const sample = (time: number) => {
    roll.elapsed = time
    stepGroundTaxi(target, 0, [seat], [])
    models.update([target], new Vector3(0, 10, -20))
    models.object.updateMatrixWorld(true)
  }
  try {
    sample(1 - 0.0001)
    const before = nose()
    sample(1 + 0.0001)
    expect(nose().distanceTo(before)).toBeLessThan(0.003)
    for (const time of [1.1, 6, 1 + ROLL_SECONDS - 0.0001]) {
      sample(time)
      const orientation = mesh.quaternion.clone().multiply(tilt)
      expect(new Vector3(0, 0, -1).applyQuaternion(orientation).y).toBeCloseTo(Math.sin(PARKED_TAIL_DOWN), 8)
      airframePose(target, pos, quat)
      expect(quat.angleTo(orientation)).toBeLessThan(1e-7)
    }
    const lastGroundNose = nose()
    const lastHitNose = new Vector3(0, 0, -4).applyQuaternion(quat).add(pos)
    sample(1 + ROLL_SECONDS)
    expect(seat.alive).toBe(true)
    expect(mesh.visible).toBe(false)
    const state = seat.aircraft.state
    const airNose = new Vector3(0, 0, -4).applyQuaternion(state.orientation).add(state.position)
    expect(airNose.distanceTo(lastGroundNose)).toBeLessThan(0.01)
    expect(airNose.distanceTo(lastHitNose)).toBeLessThan(0.01)
  } finally {
    models.dispose()
  }
})
