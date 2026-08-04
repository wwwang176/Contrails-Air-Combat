import {
  AdditiveBlending, Color, CylinderGeometry, DynamicDrawUsage, InstancedMesh,
  Matrix4, MeshBasicMaterial, Quaternion, Vector3,
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
 * 所以槍焰是**近距離的裝飾**，300 m 上 3.4 px、1 km 上 1.0 px。
 */
export const MUZZLE_LENGTH = 0.6

/** 槍焰底端（貼著槍口那一端）的半徑，m。 */
export const MUZZLE_RADIUS = 0.12

/** 頭端相對底端的半徑比。錐狀讓它讀得出方向。 */
const MUZZLE_TAPER = 0.25

/** 稜柱的側面數。與曳光彈同一個理由：發光的小東西，多面數看不出差別。 */
const RADIAL_SEGMENTS = 5

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
 * 【為什麼是錐而不是廣告板】廣告板恆面向相機，從正側面看槍焰會是一個
 * 圓片而不是一條噴出來的火舌。錐狀在世界座標裡有方向，從哪個角度看都對
 * —— 與 `tracers.ts` 選世界空間幾何而不是線段是同一個判斷。
 *
 * @param aircraftCapacity 最多幾架飛機。實例數是它乘上 `MAX_MOUNTS`
 */
export function createMuzzles(aircraftCapacity: number): Muzzles {
  // 高度取 MUZZLE_LENGTH、半徑烘進幾何；rotateX(π/2) 把軸由 +Y 轉到 +Z，
  // radiusTop 因此落在 +Z 端 —— 所以把細的放在 top，讓粗的那一端貼著槍口。
  const geometry = new CylinderGeometry(
    MUZZLE_RADIUS * MUZZLE_TAPER, MUZZLE_RADIUS, MUZZLE_LENGTH, RADIAL_SEGMENTS, 1, true,
  )
  geometry.rotateX(Math.PI / 2)
  // 幾何以中點為原點，往前推半格讓底面貼在槍口上
  geometry.translate(0, 0, MUZZLE_LENGTH / 2)

  const material = new MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.95,
    depthWrite: false, blending: AdditiveBlending,
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
