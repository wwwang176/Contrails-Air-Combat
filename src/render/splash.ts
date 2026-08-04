import {
  CylinderGeometry, DynamicDrawUsage, InstancedMesh, Matrix4,
  MeshBasicMaterial, Quaternion, Vector3,
} from 'three'
import { IMPACT_STRIDE, type ImpactEvents } from '../world/events'

/**
 * 水柱的滿高，m。
 *
 * 【推導】1920 px、65° 視野下每像素 5.9e-4 rad（見 `tracers.ts`）。
 * 彈丸壽命 1.2 s × 最快初速 887 m/s = 最多飛 1,064 m，所以射手離水柱恆在
 * 1 km 之內；4 m 的柱子在 1 km 上是 6.8 px —— 一定讀得到。**因此不需要
 * 距離剔除**（M7 spec §7.2）。
 */
export const SPLASH_HEIGHT = 4

/** 水柱的半徑，m。 */
export const SPLASH_RADIUS = 0.25

/** 壽命，s。抽起加落下，看得完一個完整動作。 */
export const SPLASH_LIFE = 0.5

/** 抽到滿高要花掉多少比例的壽命。前 30% 抽起、後 70% 落回 —— 噴出來的東西。 */
export const SPLASH_RISE = 0.3

/**
 * 池子大小。
 *
 * 【256 怎麼來】水柱天然稀有（只有低空纏鬥才出現，見 M7 spec §7.3），
 * 所以這不需要一個精確的上界 —— 環形緩衝覆蓋最舊的，滿了也不會壞。
 */
export const SPLASH_CAPACITY = 256

const RADIAL_SEGMENTS = 6

export interface Splashes {
  object: InstancedMesh
  /** 目前還活著幾根。測試與 telemetry 用 */
  readonly live: number
  /**
   * 依入海事件生水柱。
   *
   * @param heightAt 浪高場。**每根柱子只取樣一次** —— `World` 的偵測用的是
   *                 平面 `y = 0`，真實浪高只在這裡取（M7 spec §4.2）
   * @param time     取樣時間，餵給 `heightAt`
   */
  emit(
    events: ImpactEvents,
    heightAt: (x: number, z: number, t: number) => number,
    time: number,
  ): void
  step(dt: number): void
  dispose(): void
}

/**
 * 年齡 → 高度係數 0..1。前 `SPLASH_RISE` 抽到滿高，之後線性落回 0。
 *
 * 【為什麼抽成純函數】繪製函數進不了單元測試，而「先漲後落」是一條有實際
 * 行為的規則 —— 與 `edgeIndicatorPosition`、`minimapSymbol`、`countdownLabel`
 * 是同一個做法。
 */
export function splashScale(age: number): number {
  if (age < 0 || age >= SPLASH_LIFE) return 0
  const peak = SPLASH_LIFE * SPLASH_RISE
  if (age <= peak) return peak > 0 ? age / peak : 1
  return 1 - (age - peak) / (SPLASH_LIFE - peak)
}

const M = new Matrix4()
const POS = new Vector3()
const SCALE = new Vector3()
const ROT = new Quaternion()
const ZERO = new Vector3(0, 0, 0)

/**
 * 入海水柱 —— **單一** `InstancedMesh` 的環形緩衝。
 *
 * 【為什麼不做逐實例透明度】`InstancedMesh` 的逐實例顏色只有 RGB 沒有
 * alpha，逐實例透明度要自訂著色器。而高度曲線（4 m → 0）本身就完成了
 * 消失 —— 再加一層透明度只是把同一件事做兩次。
 */
export function createSplashes(capacity: number = SPLASH_CAPACITY): Splashes {
  const px = new Float32Array(capacity)
  const py = new Float32Array(capacity)
  const pz = new Float32Array(capacity)
  const age = new Float32Array(capacity).fill(SPLASH_LIFE)
  let next = 0
  let live = 0

  // 【以底面為原點】以中心為原點的話，縮放 Y 會讓柱子從中間往兩邊長，
  // 下半截埋進水裡。
  const geometry = new CylinderGeometry(
    SPLASH_RADIUS, SPLASH_RADIUS, SPLASH_HEIGHT, RADIAL_SEGMENTS, 1, true,
  )
  geometry.translate(0, SPLASH_HEIGHT / 2, 0)

  const material = new MeshBasicMaterial({
    color: 0xdfefff, transparent: true, opacity: 0.75,
    depthWrite: false,
  })

  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  object.frustumCulled = false

  M.compose(ZERO, ROT.identity(), ZERO)
  for (let i = 0; i < capacity; i++) object.setMatrixAt(i, M)
  object.instanceMatrix.needsUpdate = true

  return {
    object,
    get live() { return live },

    emit(
      events: ImpactEvents,
      heightAt: (x: number, z: number, t: number) => number,
      time: number,
    ): void {
      const d = events.data
      for (let e = 0; e < events.count; e++) {
        const o = e * IMPACT_STRIDE
        const x = d[o]!
        const z = d[o + 2]!
        const i = next
        next = next + 1 >= capacity ? 0 : next + 1
        if (age[i]! >= SPLASH_LIFE) live++
        px[i] = x
        py[i] = heightAt(x, z, time)
        pz[i] = z
        age[i] = 0
      }
    },

    step(dt: number): void {
      live = 0
      for (let i = 0; i < capacity; i++) {
        const a = age[i]!
        if (a >= SPLASH_LIFE) {
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          continue
        }
        const na = a + dt
        age[i] = na
        const s = splashScale(na)
        if (s <= 0) {
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          continue
        }
        live++
        POS.set(px[i]!, py[i]!, pz[i]!)
        // 【只縮放 Y】柱子恆為垂直，不隨任何東西旋轉
        SCALE.set(1, s, 1)
        M.compose(POS, ROT.identity(), SCALE)
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
