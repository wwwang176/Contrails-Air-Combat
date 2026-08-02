import {
  BufferAttribute, BufferGeometry, DynamicDrawUsage, LineBasicMaterial, LineSegments,
} from 'three'
import { PROJECTILE_CAPACITY, type Projectiles } from '../world/Projectiles'

/**
 * 曳光彈的視覺長度，m。
 *
 * 240 Hz 下 .50 一步走 3.7 m，所以 14 m 大約是四個物理步的距離——短到
 * 讀得出「一條一條」，長到高速掠過時不會變成點狀閃爍。
 */
export const TRACER_LENGTH = 14

export interface Tracers {
  object: LineSegments
  update(p: Projectiles): void
  dispose(): void
}

/**
 * 曳光彈 —— **單一** `LineSegments`，逐幀更新頂點（spec §10）。
 *
 * 【為什麼不是一發一個物件】4,000 發就是 4,000 次 draw call。那不是
 * 「慢一點」，那是掉到個位數 FPS。整池共用一個緩衝、一次上傳，
 * 空槽位收成退化線段（頭尾同一點）——畫不出東西，也不必另外剔除。
 */
export function createTracers(capacity: number = PROJECTILE_CAPACITY): Tracers {
  const array = new Float32Array(capacity * 2 * 3)
  const attribute = new BufferAttribute(array, 3)
  // 逐幀重寫整個緩衝，明示給驅動程式
  attribute.setUsage(DynamicDrawUsage)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', attribute)

  const material = new LineBasicMaterial({
    color: 0xffe28a, transparent: true, opacity: 0.9, depthWrite: false,
  })

  const object = new LineSegments(geometry, material)
  // 包圍盒是建立時算的（全部在原點），開著視錐剔除的話相機一離開原點附近，
  // 整條曳光彈會整批消失。
  object.frustumCulled = false

  return {
    object,

    update(p: Projectiles): void {
      const n = Math.min(capacity, p.capacity)
      for (let i = 0; i < n; i++) {
        const o = i * 6
        const x = p.x[i]!
        const y = p.y[i]!
        const z = p.z[i]!

        if (p.owner[i] === -1) {
          // 退化線段：頭尾同一點，畫不出東西
          array[o] = x; array[o + 1] = y; array[o + 2] = z
          array[o + 3] = x; array[o + 4] = y; array[o + 5] = z
          continue
        }

        const vx = p.vx[i]!
        const vy = p.vy[i]!
        const vz = p.vz[i]!
        const speed = Math.hypot(vx, vy, vz)
        // 速度為 0 時 s 取 0：尾巴收到頭上，不會產生 NaN
        const s = speed > 1e-6 ? TRACER_LENGTH / speed : 0

        array[o] = x - vx * s
        array[o + 1] = y - vy * s
        array[o + 2] = z - vz * s
        array[o + 3] = x
        array[o + 4] = y
        array[o + 5] = z
      }
      attribute.needsUpdate = true
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
