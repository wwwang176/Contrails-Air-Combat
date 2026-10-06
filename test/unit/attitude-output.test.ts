import { expect, it } from 'vitest'
import { Euler, Quaternion } from 'three'
import { attitudeFromOrientation } from '../../src/core/attitude'

it('姿態計算重用指定輸出，完整覆寫前值，且不共享呼叫端的狀態', () => {
  const out = { pitch: 99, roll: 99 }
  const orientation = new Quaternion().setFromEuler(new Euler(0.2, 0.3, -0.4, 'YXZ'))
  const expected = attitudeFromOrientation(orientation)
  expect(attitudeFromOrientation(orientation, out)).toBe(out)
  expect(out).toEqual(expected)
  const other = attitudeFromOrientation(new Quaternion())
  expect(other).toEqual({ pitch: 0, roll: -0 })
  expect(out).toEqual(expected)
  expect(attitudeFromOrientation(new Quaternion(), out)).toBe(out)
  expect(out).toEqual(other)
  expect(other).not.toBe(attitudeFromOrientation(new Quaternion()))
})
