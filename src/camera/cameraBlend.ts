import { Quaternion, Vector3, type PerspectiveCamera } from 'three'
import { makeScratch } from '../core/pool'

const S = makeScratch(0, 1)

/**
 * G 進出上帝視角的過渡時間，s。
 *
 * 【0.8 s 怎麼來】自機到上帝進場點是 800 m 的垂直距離加 45° 的俯仰；比這
 * 短會像瞬移，比這長時玩家已經在等鏡頭。兩個方向共用同一個值，來回才對稱。
 */
export const GOD_BLEND_SECONDS = 0.8

/**
 * 一段進行中的鏡頭過渡：記住起點姿態，每一幀把「這一幀算出來的目的姿態」
 * 往起點拉回一部分。
 *
 * 【為什麼記起點、不記終點】終點會動 —— 上帝鏡頭進場之後玩家立刻就能
 * WASD，第三人稱的相機更是每幀跟著飛機走。起點是固定的，終點交給呼叫端
 * 每幀重算，過渡只負責兩者之間的比例。
 */
export interface CameraBlend {
  active: boolean
  /** 已經走了幾秒 */
  elapsed: number
  duration: number
  fromPos: Vector3
  fromQuat: Quaternion
  fromFov: number
}

export function createCameraBlend(duration = GOD_BLEND_SECONDS): CameraBlend {
  return {
    active: false,
    elapsed: 0,
    duration,
    fromPos: new Vector3(),
    fromQuat: new Quaternion(),
    fromFov: 0,
  }
}

/** smoothstep：兩端斜率為零，起步與到位都不是硬切 */
export function blendWeight(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * 從相機**現在**的姿態開始一段過渡。過渡中再呼叫就是從現在這個位置接著走
 * —— 中途按 G 回頭不會跳回舊起點。
 */
export function startBlend(b: CameraBlend, camera: PerspectiveCamera): void {
  b.fromPos.copy(camera.position)
  b.fromQuat.copy(camera.quaternion)
  b.fromFov = camera.fov
  b.elapsed = 0
  b.active = true
}

/**
 * 呼叫端先把相機放到這一幀的目的姿態，再呼叫這一支：它把姿態往起點拉回
 * `1 − w` 的比例。過渡走完就把自己關掉，之後呼叫什麼都不做。
 *
 * 熱路徑，不配置記憶體：四元數 slerp 需要一份目的姿態的拷貝，走 scratch。
 */
export function applyBlend(b: CameraBlend, camera: PerspectiveCamera, dt: number): void {
  if (!b.active) return
  b.elapsed += dt
  const w = blendWeight(b.elapsed / b.duration)
  if (w >= 1) {
    b.active = false
    return
  }
  camera.position.lerpVectors(b.fromPos, camera.position, w)
  const to = S.q[0]!.copy(camera.quaternion)
  camera.quaternion.copy(b.fromQuat).slerp(to, w)
  const fov = b.fromFov + (camera.fov - b.fromFov) * w
  if (fov !== camera.fov) {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }
}
