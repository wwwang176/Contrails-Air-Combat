import {
  BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4,
  MeshStandardMaterial, Quaternion, Vector3,
} from 'three'
import { coneDirection, hash01 } from './scatter'
import { tumble } from './tumble'
import { DEBRIS_SMOKE_COUNT, DEBRIS_SMOKE_INTERVAL, smokePuffs, smokeTimer } from './smoke'
import { KILL_STRIDE, type KillEvents } from '../world/kills'
import { clearImpacts, createImpacts, pushImpact, type ImpactEvents } from '../world/events'
import type { HeightField } from '../aircraft/crash'

/** 一次擊墜噴幾片。 */
export const DEBRIS_COUNT = 12

/** 最小／最大邊長，m。一架 10 m 的飛機解體，碎片本來就有大有小。 */
export const DEBRIS_SIZE_MIN = 0.8
export const DEBRIS_SIZE_MAX = 2.0

/** 散射的初速，m/s。疊在母機速度之上。 */
export const DEBRIS_SPEED = 20

/** 散射錐的半角。窄到讀得出「往前噴」，寬到不像一束。 */
export const DEBRIS_CONE = 40 * (Math.PI / 180)

/**
 * 指數阻尼，s⁻¹。終端速度 9.80665 / 0.4 = 24.5 m/s。
 *
 * 零件比殘骸輕得多，所以終端速度低得多（24.5 vs 80 m/s）—— 畫面上零件會被
 * 殘骸拋在後面，那是對的（M8 spec §7）。
 */
export const DEBRIS_DRAG = 0.4

/** 三軸角速度的上限，rad/s。±180°/s。 */
export const DEBRIS_SPIN = Math.PI

/** 壽命上限，s。海面網格只有 10 km 見方，飄出去的零件永遠不會入水。 */
export const DEBRIS_MAX_LIFE = 40

/** 池子大小。40 架 × 12 片。 */
export const DEBRIS_CAPACITY = 40 * DEBRIS_COUNT

/** 重力，m/s²。與 `physics/` 用的是同一個值。 */
const G = -9.80665

export interface Debris {
  object: InstancedMesh
  /** 目前還活著幾片。測試與 telemetry 用 */
  readonly live: number
  /**
   * 這一次 `step` 產生的冒煙位置。**每次 `step` 開頭排空** —— 呼叫端在
   * `step` 之後讀，不必自己清。
   */
  readonly smokeEvents: ImpactEvents
  /** 這一次 `step` 產生的入水位置。與 `smokeEvents` 同樣的生命週期。 */
  readonly sprayEvents: ImpactEvents
  /**
   * 依擊墜事件噴一批零件。
   *
   * @param colorOf combatant 索引 → 機身色。渲染層知道機種對應哪個塗裝，
   *                `World` 不需要知道有塗裝這回事
   */
  emit(events: KillEvents, colorOf: (index: number) => number): void
  /** 積分一幀。**在渲染幀率呼叫，不在物理步。** */
  step(dt: number, heightAt: HeightField, time: number): void
  dispose(): void
}

/** 模組私有的暫存。熱路徑：不配置。 */
const M = new Matrix4()
const POS = new Vector3()
const DIR = new Vector3()
const SCALE = new Vector3()
const ROT = new Quaternion()
const IDENTITY = new Quaternion()
const TINT = new Color()
const ZERO = new Vector3(0, 0, 0)

/**
 * 零件 —— **單一** `InstancedMesh` 的環形緩衝。
 *
 * 【為什麼是方塊而不是真的把機體切開】專案負責人裁決「同色的 BOX 模擬就好，
 * 不用太精細」。真正切開程序化機體幾何是另一個量級的工作，而在交戰距離上
 * 一片 1 m 的碎片只有幾個像素（M8 spec §15）。
 *
 * 【為什麼姿態是年齡的函數而不是每幀積分】見 `tumble` 的註解 —— 沒有漂移，
 * 而且測得起來。基準姿態取單位四元數：翻滾本來就是隨機的，一個隨機的起點
 * 疊在隨機的角速度上看不出差別，卻要多存四個陣列。
 */
export function createDebris(capacity: number = DEBRIS_CAPACITY): Debris {
  const px = new Float32Array(capacity)
  const py = new Float32Array(capacity)
  const pz = new Float32Array(capacity)
  const vx = new Float32Array(capacity)
  const vy = new Float32Array(capacity)
  const vz = new Float32Array(capacity)
  const rx = new Float32Array(capacity)
  const ry = new Float32Array(capacity)
  const rz = new Float32Array(capacity)
  const size = new Float32Array(capacity)
  const timer = new Float32Array(capacity)
  const smokes = new Uint8Array(capacity)
  const age = new Float32Array(capacity).fill(DEBRIS_MAX_LIFE)
  let next = 0
  let live = 0

  const geometry = new BoxGeometry(1, 1, 1)
  // 【與機體同一種材質】零件是機體掉下來的，光照不一致會讓它看起來像貼紙
  const material = new MeshStandardMaterial({ flatShading: true, roughness: 0.75 })

  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  object.frustumCulled = false

  M.compose(ZERO, IDENTITY, ZERO)
  for (let i = 0; i < capacity; i++) {
    object.setMatrixAt(i, M)
    object.setColorAt(i, TINT.setRGB(1, 1, 1))
  }
  object.instanceMatrix.needsUpdate = true
  if (object.instanceColor) object.instanceColor.needsUpdate = true

  const smokeEvents = createImpacts(capacity)
  const sprayEvents = createImpacts(capacity)

  /** 讓某一格退場並縮成 0。 */
  function kill(i: number): void {
    age[i] = DEBRIS_MAX_LIFE
    M.compose(ZERO, IDENTITY, ZERO)
    object.setMatrixAt(i, M)
  }

  return {
    object,
    smokeEvents,
    sprayEvents,
    get live() { return live },

    emit(events: KillEvents, colorOf: (index: number) => number): void {
      const d = events.data
      const mid = (DEBRIS_SIZE_MIN + DEBRIS_SIZE_MAX) / 2
      for (let e = 0; e < events.count; e++) {
        const o = e * KILL_STRIDE
        const x = d[o]!
        const y = d[o + 1]!
        const z = d[o + 2]!
        const pvx = d[o + 3]!
        const pvy = d[o + 4]!
        const pvz = d[o + 5]!
        TINT.set(colorOf(d[o + 6]!))
        // 飛行方向：速度的單位向量。速度為零時退回 +Z，散射仍然成立
        const speed = Math.hypot(pvx, pvy, pvz)
        const fx = speed > 1e-6 ? pvx / speed : 0
        const fy = speed > 1e-6 ? pvy / speed : 0
        const fz = speed > 1e-6 ? pvz / speed : 1

        for (let k = 0; k < DEBRIS_COUNT; k++) {
          const i = next
          next = next + 1 >= capacity ? 0 : next + 1
          if (age[i]! >= DEBRIS_MAX_LIFE) live++
          const seed = e * DEBRIS_COUNT + k

          // 【沿飛行方向散射】繼承母機速度，再疊一個朝前的錐 —— 一架
          // 150 m/s 的飛機解體，碎片的動量本來就還在（M8 spec §7）
          coneDirection(fx, fy, fz, DEBRIS_CONE, seed, DIR)
          px[i] = x
          py[i] = y
          pz[i] = z
          vx[i] = pvx + DIR.x * DEBRIS_SPEED
          vy[i] = pvy + DIR.y * DEBRIS_SPEED
          vz[i] = pvz + DIR.z * DEBRIS_SPEED

          rx[i] = (hash01(seed * 3) * 2 - 1) * DEBRIS_SPIN
          ry[i] = (hash01(seed * 3 + 1) * 2 - 1) * DEBRIS_SPIN
          rz[i] = (hash01(seed * 3 + 2) * 2 - 1) * DEBRIS_SPIN

          // 【前幾片是大的，而且只有它們冒煙】12 條煙會糊成一團，讀不出
          // 「零件在散開」（M8 spec §6.1）
          const big = k < DEBRIS_SMOKE_COUNT
          const h = hash01(seed * 5 + 4)
          size[i] = big
            ? mid + (DEBRIS_SIZE_MAX - mid) * h
            : DEBRIS_SIZE_MIN + (mid - DEBRIS_SIZE_MIN) * h
          smokes[i] = big ? 1 : 0
          timer[i] = 0
          age[i] = 0
          object.setColorAt(i, TINT)
        }
      }
      if (object.instanceColor) object.instanceColor.needsUpdate = true
    },

    step(dt: number, heightAt: HeightField, time: number): void {
      // 【每次 step 開頭排空】呼叫端在 step 之後讀就好，不必記得清
      clearImpacts(smokeEvents)
      clearImpacts(sprayEvents)
      const damp = Math.exp(-DEBRIS_DRAG * dt)
      live = 0
      for (let i = 0; i < capacity; i++) {
        const old = age[i]!
        if (old >= DEBRIS_MAX_LIFE) continue
        const na = old + dt
        age[i] = na
        if (na >= DEBRIS_MAX_LIFE) {
          kill(i)
          continue
        }

        const nvx = vx[i]! * damp
        const nvy = vy[i]! * damp + G * dt
        const nvz = vz[i]! * damp
        vx[i] = nvx
        vy[i] = nvy
        vz[i] = nvz
        const nx = px[i]! + nvx * dt
        const ny = py[i]! + nvy * dt
        const nz = pz[i]! + nvz * dt
        px[i] = nx
        py[i] = ny
        pz[i] = nz

        // 【用中心點判定入水】一片零件最大 2 m，用中心與用角點的差距在半片
        // 零件之內。角點的解析式（`lowestPoint`）是為翼展 11 m 的翻滾整機
        // 而存在的（M8 spec §7）
        const surface = heightAt(nx, nz, time)
        if (ny <= surface) {
          pushImpact(sprayEvents, nx, surface, nz, 0, 1, 0)
          kill(i)
          continue
        }

        live++
        if (smokes[i] === 1) {
          const t = timer[i]!
          const puffs = smokePuffs(t, dt, DEBRIS_SMOKE_INTERVAL)
          timer[i] = smokeTimer(t, dt, DEBRIS_SMOKE_INTERVAL)
          for (let k = 0; k < puffs; k++) pushImpact(smokeEvents, nx, ny, nz, 0, 1, 0)
        }

        tumble(rx[i]!, ry[i]!, rz[i]!, na, IDENTITY, ROT)
        POS.set(nx, ny, nz)
        const s = size[i]!
        SCALE.set(s, s, s)
        M.compose(POS, ROT, SCALE)
        object.setMatrixAt(i, M)
      }
      object.instanceMatrix.needsUpdate = true
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
      object.dispose()
    },
  }
}
