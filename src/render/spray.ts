import { Color, NormalBlending, Vector3 } from 'three'
import { createParticles, type Particles } from './particles'
import { coneDirection } from './scatter'
import { IMPACT_STRIDE, type ImpactEvents } from '../world/events'

/**
 * 壽命，s。
 *
 * 【推導】25 m/s 配阻尼 2 s⁻¹，0.6 s 內飛約 10 m —— 與水柱的 12 m 同一個
 * 尺度，兩者一起讀起來才是同一次撞擊而不是兩件事。60 fps 下 36 幀。
 *
 * （M8 spec §12 的總表沒有列這一項，這個值與推導是實作時補上的，見 §17。）
 */
export const SPRAY_LIFE = 0.6

/** 直徑，m。固定不膨脹 —— 水滴不是煙。 */
export const SPRAY_SIZE = 0.4

/** 初速，m/s。 */
export const SPRAY_SPEED = 25

/** 噴射錐的半角。寬到讀得出「四散」，窄到仍然是往上的。 */
export const SPRAY_CONE = 55 * (Math.PI / 180)

/** 指數阻尼，s⁻¹。 */
export const SPRAY_DRAG = 2

/** 重力，m/s²。與 `physics/` 用的是同一個值。 */
export const SPRAY_GRAVITY = -9.80665

/** 出生時的不透明度。水花幾乎不透明，但仍要淡出。 */
export const SPRAY_ALPHA = 0.85

/** 殘骸入水噴幾顆。 */
export const WRECK_SPRAY_COUNT = 24

/** 一片零件入水噴幾顆。比殘骸小一號。 */
export const DEBRIS_SPRAY_COUNT = 6

/** 池子大小。 */
export const SPRAY_CAPACITY = 1024

/** 水花的顏色。 */
export const WATER_COLOR = 0xf2f8ff

/**
 * 噴濺池。**顏色是參數。**
 *
 * 【為什麼顏色不寫死】M8 spec §9.4：之後加地面時要用土色噴射。寫死的話那時
 * 得回來改這個模組；當成參數的話只要在 `main.ts` 多建一個實例，代價是多一個
 * draw call。地面本身不在這份計畫的範圍內。
 */
export function createSpray(color: number, capacity: number = SPRAY_CAPACITY): Particles {
  const tint = new Color(color)
  return createParticles({
    capacity,
    blending: NormalBlending,
    life: SPRAY_LIFE,
    sizeFrom: SPRAY_SIZE,
    sizeTo: SPRAY_SIZE,
    gravity: SPRAY_GRAVITY,
    drag: SPRAY_DRAG,
    alphaFrom: SPRAY_ALPHA,
    color: (_t, out) => { out.copy(tint) },
  })
}

/** 模組私有的暫存。熱路徑：不配置。 */
const DIR = new Vector3()

/**
 * 依接觸事件噴一叢水花。
 *
 * **錐軸是世界 +Y 而不是事件裡的法線** —— 水面的法線幾乎恆為向上（Gerstner
 * 波的坡度很小），而向上正是水花該去的方向。命中飛機的火花才需要真正的表面
 * 法線，因為機身的朝向什麼都可能（M8 spec §9.2）。事件的法線欄位在這裡被
 * 忽略，留著是為了與 `ImpactEvents` 共型。
 *
 * @param count 這一筆事件噴幾顆。殘骸用 `WRECK_SPRAY_COUNT`、零件用
 *              `DEBRIS_SPRAY_COUNT` —— 同一個池子，兩種規模
 */
export function emitSpray(pool: Particles, events: ImpactEvents, count: number): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * IMPACT_STRIDE
    const x = d[o]!
    const y = d[o + 1]!
    const z = d[o + 2]!
    for (let k = 0; k < count; k++) {
      coneDirection(0, 1, 0, SPRAY_CONE, e * count + k, DIR)
      pool.emit(
        x, y, z,
        DIR.x * SPRAY_SPEED, DIR.y * SPRAY_SPEED, DIR.z * SPRAY_SPEED,
      )
    }
  }
}
