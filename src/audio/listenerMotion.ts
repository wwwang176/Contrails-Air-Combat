import { Vector3 } from 'three'

/** 超過此速度視為鏡頭瞬移，避免切視角、重生與換場造成多普勒音高跳動，m/s。 */
const TELEPORT_SPEED = 400
/** 速度平滑時間常數，s。鏡頭晃動不應直接變成音高抖動。 */
const VELOCITY_TAU = 0.05

/** 每幀在鏡頭定位後更新。向量只在建立時配置，velocity 保持同一個物件。 */
export function createListenerMotion() {
  const previous = new Vector3()
  const velocity = new Vector3()
  const delta = new Vector3()
  let valid = false

  function reset(): void {
    valid = false
    velocity.set(0, 0, 0)
  }

  function update(position: Vector3, dt: number): void {
    if (!valid || dt <= 0) {
      previous.copy(position)
      velocity.set(0, 0, 0)
      valid = true
      return
    }
    delta.subVectors(position, previous)
    previous.copy(position)
    if (delta.length() / dt > TELEPORT_SPEED) {
      velocity.set(0, 0, 0)
      return
    }
    velocity.lerp(delta.divideScalar(dt), 1 - Math.exp(-dt / VELOCITY_TAU))
  }

  return { velocity, reset, update }
}
