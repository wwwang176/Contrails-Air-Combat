import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage,
  InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3,
} from 'three'
import { MAX_MOUNTS, mountDirection } from '../weapons/types'
import { FLASH_SECONDS } from '../world/World'
import type { Combatant } from '../world/World'

/**
 * 槍焰的長度，m。
 *
 * 【按真實比例，不加螢幕尺寸下限】專案負責人裁決（M7 spec §8.1）。
 * 曾考慮為它加一個像素下限（`contacts.ts` 的目標框就有 `BOX_MIN = 9 px`
 * 的先例），推翻的理由是那個訊號已經有人扛了：一條曳光彈在 1 km 上仍有
 * 24 px 長。兩個訊號回答同一個問題正是要避免的事。
 *
 * 所以槍焰是**近距離的裝飾**：1.2 m 長在 300 m 上是 6.8 px、1 km 上 2.0 px。
 */
export const MUZZLE_LENGTH = 1.2

/**
 * 十字的半寬（貼著槍口那一端），m。整個十字跨度是它的兩倍。
 *
 * 【人工驗收之後由 0.12 m 半徑的錐改成 0.45 m 半寬的十字】原本讀起來像
 * 一根細針。在第三人稱距離（約 30 m）上，0.6 m 長是 38 px 而 0.12 m 半徑
 * 只有 8 px 寬 —— **「太小」的成因是寬度不是長度**。
 */
export const MUZZLE_HALF_WIDTH = 0.45

/** 尖端相對根部的寬度比。收尖讓它讀得出方向，也讓它像火舌而不是木板。 */
const MUZZLE_TIP_RATIO = 0.15

export interface Muzzles {
  object: InstancedMesh
  /**
   * 寫入這一幀的實例矩陣。
   *
   * @param positions   依 `c.index` 索引的**內插後**位置
   * @param quaternions 依 `c.index` 索引的**內插後**姿態
   */
  update(
    combatants: readonly Combatant[],
    positions: readonly Vector3[],
    quaternions: readonly Quaternion[],
  ): void
  dispose(): void
}

/**
 * 十字火焰：兩片互相垂直、都包含槍管軸（+Z）的梯形，根部貼在槍口。
 *
 * 【為什麼是十字而不是錐，也不是廣告板】
 * - **廣告板**恆面向相機，從正側面看槍焰會是一個圓片而不是一條火舌。
 * - **錐**（M7 初版）在世界座標裡有方向，但它的橫截面是圓的，寬度受限於
 *   半徑；人工驗收的回饋是「太小」，而根源是**寬**不是長 —— 0.12 m 半徑
 *   在第三人稱距離只有 8 px。
 * - **十字**正面看是一個十字閃、側面看是一片火舌，**沒有任何角度會退化成
 *   一個圓片或一條線**。那正是當初否決廣告板的理由，十字比錐更徹底地
 *   滿足它，而且寬度可以自由加大而不必把整個東西吹成一顆球。
 *
 * 兩片 × 兩個三角形 = 4 個三角形，滿編 40 架 × 8 管是 1,280 個 —— 與曳光彈
 * 同一個量級。材質是 `DoubleSide`，因為梯形是平的、兩面都要看得見。
 */
function crossFlare(): BufferGeometry {
  const w = MUZZLE_HALF_WIDTH
  const t = w * MUZZLE_TIP_RATIO
  const l = MUZZLE_LENGTH
  // 每片兩個三角形；非索引，12 個頂點
  const v = new Float32Array([
    // 片一：XZ 平面
    -w, 0, 0, w, 0, 0, t, 0, l,
    -w, 0, 0, t, 0, l, -t, 0, l,
    // 片二：YZ 平面
    0, -w, 0, 0, w, 0, 0, t, l,
    0, -w, 0, 0, t, l, 0, -t, l,
  ])
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(v, 3))
  return g
}

const UNIT_Z = new Vector3(0, 0, 1)
/** 熱路徑的暫存。模組私有、每幀重用（熱路徑零配置） */
const M = new Matrix4()
const POS = new Vector3()
const DIR = new Vector3()
const SCALE = new Vector3()
const ROT = new Quaternion()
const TINT = new Color()
const ZERO = new Vector3(0, 0, 0)

/**
 * 槍焰 —— **單一** `InstancedMesh`，每個掛架一個實例。
 *
 * 【為什麼位置在這裡重算而不是由事件帶過來】事件會帶著**物理子步**的
 * 位置，而畫面上的飛機畫在**內插後**的位置 —— 200 m/s 下差 0.83 m，
 * 槍焰會相對機身前後抖動接近一個機身長度（M7 spec §2.1）。
 *
 * 【幾何是十字而不是廣告板或錐】見 `crossFlare` 的註解。
 *
 * @param aircraftCapacity 最多幾架飛機。實例數是它乘上 `MAX_MOUNTS`
 */
export function createMuzzles(aircraftCapacity: number): Muzzles {
  const geometry = crossFlare()

  const material = new MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.95,
    depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
  })

  const capacity = aircraftCapacity * MAX_MOUNTS
  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  // 包圍球是建立時算的（全部在原點），開著視錐剔除的話相機一離開原點
  // 附近整批槍焰會一起消失 —— 與曳光彈同一個坑。
  object.frustumCulled = false

  M.compose(ZERO, ROT.identity(), ZERO)
  for (let i = 0; i < capacity; i++) {
    object.setMatrixAt(i, M)
    object.setColorAt(i, TINT.setRGB(0, 0, 0))
  }
  object.instanceMatrix.needsUpdate = true
  if (object.instanceColor) object.instanceColor.needsUpdate = true

  return {
    object,

    update(
      combatants: readonly Combatant[],
      positions: readonly Vector3[],
      quaternions: readonly Quaternion[],
    ): void {
      let slot = 0
      for (let k = 0; k < combatants.length; k++) {
        const c = combatants[k]!
        const battery = c.aircraft.spec.battery
        const flash = c.muzzleFlash
        const p = positions[c.index]
        const q = quaternions[c.index]

        for (let i = 0; i < MAX_MOUNTS; i++) {
          if (slot >= capacity) break
          const t = i < flash.length && c.alive && p !== undefined && q !== undefined
            ? flash[i]! / FLASH_SECONDS
            : 0
          if (t <= 0 || p === undefined || q === undefined) {
            M.compose(ZERO, ROT.identity(), ZERO)
            object.setMatrixAt(slot, M)
            object.setColorAt(slot, TINT.setRGB(0, 0, 0))
            slot++
            continue
          }

          // 槍口的世界位置 = 掛架的機體座標 套上內插姿態 再加內插位置
          POS.copy(battery.mounts[i]!.position).applyQuaternion(q).add(p)
          // 朝向沿用匯聚幾何算好的射向，不另外定義一份
          mountDirection(battery, i, DIR).applyQuaternion(q)
          ROT.setFromUnitVectors(UNIT_Z, DIR)
          SCALE.set(t, t, t)
          M.compose(POS, ROT, SCALE)
          object.setMatrixAt(slot, M)
          // 加法混合：顏色淡到黑就等於淡出，不必逐實例透明度
          TINT.setRGB(t, t * 0.8, t * 0.45)
          object.setColorAt(slot, TINT)
          slot++
        }
      }
      for (; slot < capacity; slot++) {
        M.compose(ZERO, ROT.identity(), ZERO)
        object.setMatrixAt(slot, M)
      }
      object.instanceMatrix.needsUpdate = true
      if (object.instanceColor) object.instanceColor.needsUpdate = true
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
      object.dispose()
    },
  }
}
