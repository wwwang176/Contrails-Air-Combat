import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage,
  InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3,
} from 'three'
import { MAX_MOUNTS, mountDirection } from '../weapons/types'
import { MAX_TURRETS, turretMuzzle, wobbleBasis } from '../weapons/turret'
import { BARREL_SPACING, TURRET_FLASH_SECONDS } from '../world/turrets'
import { FLASH_SECONDS } from '../world/World'
import type { Combatant } from '../world/World'

/**
 * 槍焰的長度，m。
 *
 * 【按真實比例，不加螢幕尺寸下限】（M7 spec §8.1）像素下限那個手法
 * （`contacts.ts` 的目標框有 `BOX_MIN = 9 px`）在這裡不需要：遠距離的
 * 「有人在開槍」已經由曳光彈扛著，一條曳光彈在 1 km 上仍有 24 px 長。
 * 兩個訊號回答同一個問題正是要避免的事。
 *
 * 所以槍焰是**近距離的裝飾**：1.2 m 長在 300 m 上是 6.8 px、1 km 上 2.0 px。
 */
export const MUZZLE_LENGTH = 1.2

/**
 * 十字的半寬（**外端**，離槍口最遠的那一端），m。整個跨度是它的兩倍。
 *
 * 【為什麼這麼寬】0.12 m 半徑的錐讀起來像一根細針：第三人稱距離（約 30 m）
 * 上 0.6 m 長是 38 px，而 0.12 m 半徑只有 8 px 寬 —— **「太小」的成因是
 * 寬度不是長度**。
 */
export const MUZZLE_HALF_WIDTH = 0.45

/**
 * 根部（貼著槍口那一端）相對外端的寬度比。
 *
 * 【根部窄、外端寬】反過來（根部寬、外端收尖）讀起來像一團火從空中
 * 往槍口收回去 —— 方向感是反的。火焰是從槍管噴出來的氣體，**愈遠愈開**
 * 才對。收尖本身仍然保留（讀得出方向，也像火舌不像木板），只是換一端。
 */
const MUZZLE_ROOT_RATIO = 0.15

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
 * 十字火焰：兩片互相垂直、都包含槍管軸（+Z）的梯形，**窄的那一端貼在
 * 槍口、往外張開**。
 *
 * 【為什麼是十字而不是錐，也不是廣告板】
 * - **廣告板**恆面向相機，從正側面看槍焰會是一個圓片而不是一條火舌。
 * - **錐**在世界座標裡有方向，但它的橫截面是圓的，寬度受限於半徑，
 *   讀起來「太小」，而根源是**寬**不是長 —— 0.12 m 半徑在第三人稱距離
 *   只有 8 px。
 * - **十字**正面看是一個十字閃、側面看是一片火舌，**沒有任何角度會退化成
 *   一個圓片或一條線** —— 廣告板做不到這一條。而且寬度可以自由加大，
 *   不必把整個東西吹成一顆球。
 *
 * 兩片 × 兩個三角形 = 4 個三角形，滿編 40 架 × 8 管是 1,280 個 —— 與曳光彈
 * 同一個量級。材質是 `DoubleSide`，因為梯形是平的、兩面都要看得見。
 */
function crossFlare(): BufferGeometry {
  /** 外端的半寬 */
  const w = MUZZLE_HALF_WIDTH
  /** 根部的半寬。窄的那一端貼著槍口 —— 見 `MUZZLE_ROOT_RATIO` */
  const r = w * MUZZLE_ROOT_RATIO
  const l = MUZZLE_LENGTH
  // 每片兩個三角形；非索引，12 個頂點
  const v = new Float32Array([
    // 片一：XZ 平面
    -r, 0, 0, r, 0, 0, w, 0, l,
    -r, 0, 0, w, 0, l, -w, 0, l,
    // 片二：YZ 平面
    0, -r, 0, 0, r, 0, 0, w, l,
    0, -r, 0, 0, w, l, 0, -w, l,
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
/** 砲塔槍焰的側偏基底。與 `DIR` 分開 —— 兩者在同一次迭代裡都活著。 */
const E1 = new Vector3()
const E2 = new Vector3()

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
  // 一發都還沒開就不必畫。InstancedMesh 建立時 count 等於容量
  object.count = 0

  /**
   * 上一幀這一格在 GPU 上是不是有東西。
   *
   * 【它在擋什麼】沒開火的槽位矩陣本來就是零，每幀再寫一次零是白工 —— 而對
   * 正在被 GPU 讀的緩衝呼叫 `bufferSubData` 會強迫管線同步。
   */
  const wasLive = new Uint8Array(capacity)

  return {
    object,

    update(
      combatants: readonly Combatant[],
      positions: readonly Vector3[],
      quaternions: readonly Quaternion[],
    ): void {
      let slot = 0
      let touched = false
      let lo = capacity
      let up = -1
      let hiLive = -1
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
            if (wasLive[slot] === 1) {
              M.compose(ZERO, ROT.identity(), ZERO)
              object.setMatrixAt(slot, M)
              object.setColorAt(slot, TINT.setRGB(0, 0, 0))
              wasLive[slot] = 0
              touched = true
              if (slot < lo) lo = slot
              if (slot > up) up = slot
            }
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
          wasLive[slot] = 1
          hiLive = slot
          touched = true
          if (slot < lo) lo = slot
          if (slot > up) up = slot
          slot++
        }
      }
      for (; slot < capacity; slot++) {
        if (wasLive[slot] === 0) continue
        M.compose(ZERO, ROT.identity(), ZERO)
        object.setMatrixAt(slot, M)
        wasLive[slot] = 0
        touched = true
        if (slot < lo) lo = slot
        if (slot > up) up = slot
      }
      // 【尾巴上的空槽連歸零都不必】它們在 count 之外，頂點著色器不會碰到
      object.count = hiLive + 1
      if (touched) {
        // 單位是型別化陣列的元素，不是 byte。矩陣 stride 16、顏色 stride 3
        object.instanceMatrix.addUpdateRange(lo * 16, (up - lo + 1) * 16)
        object.instanceMatrix.needsUpdate = true
        if (object.instanceColor) {
          object.instanceColor.addUpdateRange(lo * 3, (up - lo + 1) * 3)
          object.instanceColor.needsUpdate = true
        }
      }
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
      object.dispose()
    },
  }
}

/**
 * 砲塔的槍焰 —— 與 `createMuzzles` 共用 `crossFlare()` 與同一份材質設定。
 *
 * 【為什麼是另一個池而不是把容量加大】固定槍的池容量是
 * `架數 × MAX_MOUNTS`，砲塔是 `架數 × MAX_TURRETS`。硬塞進同一個池要嘛
 * 讓兩邊共用一個更大的每架上界（浪費），要嘛讓槽位計算同時依賴兩個常數
 * （改一個就會靜靜地畫錯）。兩個池各自單純。
 *
 * 【槍焰要畫在剛剛發射的那一根管口上】雙聯砲塔的彈丸在兩根之間輪替
 * （見 `world/turrets.ts` 的 `lastBarrel`）。槍焰若固定畫在 `turret.position`，
 * 它會停在兩根管子**中間** —— 彈丸從管口出、火光在中間，一眼就看得出不對。
 *
 * @param aircraftCapacity 最多幾架飛機。實例數是它乘上 `MAX_TURRETS`
 */
export function createTurretMuzzles(aircraftCapacity: number): Muzzles {
  const geometry = crossFlare()

  const material = new MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.95,
    depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
  })

  const capacity = aircraftCapacity * MAX_TURRETS
  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  // 見 createMuzzles：包圍球是建立時算的，開著視錐剔除會整批消失
  object.frustumCulled = false

  M.compose(ZERO, ROT.identity(), ZERO)
  for (let i = 0; i < capacity; i++) {
    object.setMatrixAt(i, M)
    object.setColorAt(i, TINT.setRGB(0, 0, 0))
  }
  object.instanceMatrix.needsUpdate = true
  if (object.instanceColor) object.instanceColor.needsUpdate = true
  // 一發都還沒開就不必畫。InstancedMesh 建立時 count 等於容量
  object.count = 0

  /**
   * 上一幀這一格在 GPU 上是不是有東西。
   *
   * 【它在擋什麼】沒開火的槽位矩陣本來就是零，每幀再寫一次零是白工 —— 而對
   * 正在被 GPU 讀的緩衝呼叫 `bufferSubData` 會強迫管線同步。
   */
  const wasLive = new Uint8Array(capacity)

  return {
    object,

    update(
      combatants: readonly Combatant[],
      positions: readonly Vector3[],
      quaternions: readonly Quaternion[],
    ): void {
      let slot = 0
      let touched = false
      let lo = capacity
      let up = -1
      let hiLive = -1
      for (let k = 0; k < combatants.length; k++) {
        const c = combatants[k]!
        const turrets = c.aircraft.spec.turrets
        const p = positions[c.index]
        const q = quaternions[c.index]

        for (let i = 0; i < MAX_TURRETS; i++) {
          if (slot >= capacity) break
          const t = i < turrets.length ? turrets[i]! : undefined
          const st = i < c.turretStates.length ? c.turretStates[i] : undefined
          const f = t !== undefined && st !== undefined && c.alive
            && p !== undefined && q !== undefined
            ? st.flash / TURRET_FLASH_SECONDS
            : 0
          if (f <= 0 || t === undefined || st === undefined
            || p === undefined || q === undefined) {
            if (wasLive[slot] === 1) {
              M.compose(ZERO, ROT.identity(), ZERO)
              object.setMatrixAt(slot, M)
              object.setColorAt(slot, TINT.setRGB(0, 0, 0))
              wasLive[slot] = 0
              touched = true
              if (slot < lo) lo = slot
              if (slot > up) up = slot
            }
            slot++
            continue
          }

          // 側偏到剛剛發射的那一根管口 —— 與 stepTurrets 生彈丸、
          // turretBarrels 畫管子用的是同一組基底與同一個 BARREL_SPACING
          wobbleBasis(st.aim, E1, E2)
          const side = t.guns > 1 ? (st.lastBarrel === 0 ? -1 : 1) : 0
          // 【槍口跟著 aim 掃】與彈丸、槍管共用 turretMuzzle —— 三處各寫
          // 一份的話遲早有一份沒改到
          turretMuzzle(t, st.aim, POS).addScaledVector(E1, side * BARREL_SPACING)
            .applyQuaternion(q).add(p)
          DIR.copy(st.aim).applyQuaternion(q)
          ROT.setFromUnitVectors(UNIT_Z, DIR)
          SCALE.set(f, f, f)
          M.compose(POS, ROT, SCALE)
          object.setMatrixAt(slot, M)
          TINT.setRGB(f, f * 0.8, f * 0.45)
          object.setColorAt(slot, TINT)
          wasLive[slot] = 1
          hiLive = slot
          touched = true
          if (slot < lo) lo = slot
          if (slot > up) up = slot
          slot++
        }
      }
      for (; slot < capacity; slot++) {
        if (wasLive[slot] === 0) continue
        M.compose(ZERO, ROT.identity(), ZERO)
        object.setMatrixAt(slot, M)
        wasLive[slot] = 0
        touched = true
        if (slot < lo) lo = slot
        if (slot > up) up = slot
      }
      // 【尾巴上的空槽連歸零都不必】它們在 count 之外，頂點著色器不會碰到
      object.count = hiLive + 1
      if (touched) {
        // 單位是型別化陣列的元素，不是 byte。矩陣 stride 16、顏色 stride 3
        object.instanceMatrix.addUpdateRange(lo * 16, (up - lo + 1) * 16)
        object.instanceMatrix.needsUpdate = true
        if (object.instanceColor) {
          object.instanceColor.addUpdateRange(lo * 3, (up - lo + 1) * 3)
          object.instanceColor.needsUpdate = true
        }
      }
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
      object.dispose()
    },
  }
}
