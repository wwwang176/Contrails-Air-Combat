import {
  CylinderGeometry, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial,
  Quaternion, Vector3,
} from 'three'
import { PROJECTILE_CAPACITY, type Projectiles } from '../world/Projectiles'

/**
 * 曳光彈的視覺長度，m。
 *
 * 240 Hz 下 .50 一步走 3.7 m，所以 14 m 大約是四個物理步的距離——短到
 * 讀得出「一條一條」，長到高速掠過時不會變成點狀閃爍。
 */
export const TRACER_LENGTH = 14

/**
 * 曳光彈頭端的半徑，m。
 *
 * 【為什麼需要一個世界單位的半徑】`LineBasicMaterial` 的 `linewidth` 在所有
 * WebGL 實作上都被忽略（ANGLE 與 OpenGL core profile 把線寬鎖在 1 個裝置
 * 像素）：長度有正確的透視縮短，粗細卻永遠是 1 px —— 3 km 外和 30 m 外
 * 一樣粗。世界單位的幾何讓透視自然成立。
 *
 * 【0.12 m 怎麼來的】1920 px 寬、65° 視野下每像素約 5.9e-4 rad。在 M2 的
 * 實戰有效射程 400 m 上，1 px 對應 0.24 m —— 取直徑 0.24 m（半徑 0.12 m），
 * 400 m 處剛好一個像素寬（與舊的線寬一致），100 m 處四個像素，1,600 m 外
 * 淡出到次像素。也就是說：**在該看得清楚的距離上維持舊的可讀性，只把
 * 「近的該更粗、遠的該更細」補回來。**
 */
export const TRACER_RADIUS = 0.12

/** 尾端相對頭端的半徑比。錐狀讓它讀得出方向，而不是一根棍子。 */
export const TRACER_TAPER = 0.3

/**
 * 稜柱的側面數。
 *
 * 4 面 = 8 個三角形，滿載 4,000 發是 32,000 個三角形 —— 與整個場景的機體
 * 幾何同一個量級（瀏覽器實測 40 架時全場 84,303）。曳光彈是發光的細線，
 * 再多面數在畫面上看不出差別。
 */
const RADIAL_SEGMENTS = 4

export interface Tracers {
  object: InstancedMesh
  update(p: Projectiles): void
  dispose(): void
}

const UNIT_Z = new Vector3(0, 0, 1)
/** 熱路徑的暫存。模組私有、每幀重用（熱路徑零配置） */
const M = new Matrix4()
const POS = new Vector3()
const DIR = new Vector3()
const SCALE = new Vector3()
const ROT = new Quaternion()
const ZERO = new Vector3(0, 0, 0)

/**
 * 曳光彈 —— **單一** `InstancedMesh`，逐幀更新每個實例的變換矩陣。
 *
 * 【為什麼不是一發一個物件】4,000 發就是 4,000 次 draw call。那不是
 * 「慢一點」，那是掉到個位數 FPS。整池共用一份幾何與一份實例矩陣緩衝、
 * 一次上傳，空槽位縮放到 0——畫不出東西，也不必另外剔除。
 *
 * 【從 LineSegments 換成 InstancedMesh 的代價】每幀要寫 16 個 float 而不是
 * 6 個，並多出 32,000 個三角形。draw call 仍然是 1。換到的是正確的透視粗細
 * （見 `TRACER_RADIUS`）。
 */
export function createTracers(capacity: number = PROJECTILE_CAPACITY): Tracers {
  // 【高度取 1、半徑烘進幾何】長度由每個實例的 Z 縮放給，粗細不跟著被拉長。
  //
  // CylinderGeometry 的軸沿 +Y，rotateX(π/2) 把它轉到 +Z：較粗的
  // radiusTop 因此落在 +Z 端。把 +Z 對齊「由尾指向頭」就得到頭粗尾細。
  const geometry = new CylinderGeometry(
    TRACER_RADIUS, TRACER_RADIUS * TRACER_TAPER, 1, RADIAL_SEGMENTS, 1, true,
  )
  geometry.rotateX(Math.PI / 2)

  const material = new MeshBasicMaterial({
    color: 0xffe28a, transparent: true, opacity: 0.9, depthWrite: false,
  })

  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  // 包圍球是建立時算的（全部在原點），開著視錐剔除的話相機一離開原點附近，
  // 整批曳光彈會一起消失。
  object.frustumCulled = false

  // 建立時全部收成 0，避免第一幀在原點出現一叢
  M.compose(ZERO, ROT.identity(), ZERO)
  for (let i = 0; i < capacity; i++) object.setMatrixAt(i, M)
  object.instanceMatrix.needsUpdate = true
  // 一發都還沒射就不必畫。InstancedMesh 建立時 count 等於容量，不明寫的話
  // 頂點著色器一開場就跑滿四千個實例
  object.count = 0

  /**
   * 上一幀這一格在 GPU 上是不是有東西。
   *
   * 【它在擋什麼】死格的矩陣本來就是零，每幀再寫一次零是白工。只有「上一幀
   * 有、這一幀沒有」那一刻才要寫。
   */
  const wasLive = new Uint8Array(capacity)

  return {
    object,

    update(p: Projectiles): void {
      const n = Math.min(capacity, p.capacity)
      let touched = false
      let lo = capacity
      let up = -1
      let hiLive = -1
      for (let i = 0; i < n; i++) {
        const x = p.x[i]!
        const y = p.y[i]!
        const z = p.z[i]!

        const vx = p.vx[i]!
        const vy = p.vy[i]!
        const vz = p.vz[i]!
        const speed = p.owner[i] === -1 ? 0 : Math.hypot(vx, vy, vz)
        // 【尾巴不可以長過它實際飛過的距離】固定 14 m 的話，剛出膛的第一發
        // 就是一整條 14 m——尾端會落在槍口後方，也就是穿進自己的機身、一路
        // 拖到機尾外面去。實測看起來像機尾在噴火。
        //
        // 走過的距離是 speed × age，所以長度取 min(14, speed × age)：出膛
        // 瞬間為 0，飛了 14 m 之後才長到全長，之後維持不變。
        const length = speed > 1e-6 ? Math.min(TRACER_LENGTH, speed * p.age[i]!) : 0

        if (length <= 0) {
          // 空槽位與剛出膛的那一格：縮放到 0，畫不出東西
          if (wasLive[i] === 0) continue
          POS.set(x, y, z)
          M.compose(POS, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          wasLive[i] = 0
          touched = true
          if (i < lo) lo = i
          if (i > up) up = i
          continue
        }

        // 由尾指向頭的單位向量 = 速度方向
        DIR.set(vx / speed, vy / speed, vz / speed)
        ROT.setFromUnitVectors(UNIT_Z, DIR)
        // 幾何以原點為中心，所以實例要擺在頭尾的中點
        const half = length * 0.5
        POS.set(x - DIR.x * half, y - DIR.y * half, z - DIR.z * half)
        SCALE.set(1, 1, length)
        M.compose(POS, ROT, SCALE)
        object.setMatrixAt(i, M)
        wasLive[i] = 1
        hiLive = i
        touched = true
        if (i < lo) lo = i
        if (i > up) up = i
      }
      // 【尾巴上的死格連歸零都不必】它們在 count 之外，頂點著色器不會碰到
      object.count = hiLive + 1
      if (touched) {
        // 單位是型別化陣列的元素，不是 byte。矩陣的 stride 是 16
        object.instanceMatrix.addUpdateRange(lo * 16, (up - lo + 1) * 16)
        object.instanceMatrix.needsUpdate = true
      }
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
      object.dispose()
    },
  }
}
