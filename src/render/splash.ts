import {
  BufferGeometry, DynamicDrawUsage, InstancedMesh, LatheGeometry, Matrix4,
  MeshBasicMaterial, Quaternion, Vector2, Vector3,
} from 'three'
import { IMPACT_STRIDE, type ImpactEvents } from '../world/events'
import { hash01 } from './scatter'

/**
 * 水柱的滿高，m。
 *
 * 【推導】1920 px、65° 視野下每像素 5.9e-4 rad（見 `tracers.ts`）。
 * 彈丸壽命 1.2 s × 最快初速 887 m/s = 最多飛 1,064 m，所以射手離水柱恆在
 * 1 km 之內；12 m 的柱子在 1 km 上是 20 px —— 一定讀得到。**因此不需要
 * 距離剔除**（M7 spec §7.2）。
 */
export const SPLASH_HEIGHT = 12

/**
 * 水柱底部的半徑，m。
 *
 * 【人工驗收之後由 4 m × 0.25 m 改成 12 m × 0.8 m】原本讀起來「太小」，
 * 而 4 m 高配 0.25 m 半徑是 8:1 的細針 —— 與槍焰同一個成因：**細長的東西
 * 在畫面上讀起來是一條線，不是一個東西**。現在是 7.5:1，而且上方收緊，
 * 讀起來是一柱噴起來的水而不是一根白棍。
 */
export const SPLASH_RADIUS = 0.8

/**
 * 肩部（圓頭開始的地方）相對底部的半徑比。
 *
 * 【由「頂端半徑」改成「肩部半徑」】初版是一個上方收到 0.2 倍的截頭錐，
 * 讀起來是一根收尖的柱子。專案負責人裁決改成**子彈型 —— 上方要圓潤**：
 * 柱身微收到肩部，再由肩部圓弧收到頂點。見 `bulletProfile`。
 */
export const SPLASH_TOP_RATIO = 0.8

/**
 * 圓頭從幾成高度開始。以下是柱身，以上是圓弧。
 *
 * 0.72：圓頭佔上面 28%，讀得出「圓」又不會變成一顆球。
 */
export const SPLASH_SHOULDER = 0.72

/** 圓頭的分段數。7 段在 12 m 的柱子上已經看不出稜角。 */
const NOSE_SEGMENTS = 7

/**
 * 每根水柱的高度亂數範圍。實際高度 = `SPLASH_HEIGHT × (MIN + h × (MAX−MIN))`。
 *
 * 【為什麼要隨機】一次撞擊生十根，十根一樣高讀起來是一排柵欄而不是一次
 * 撞擊 —— 專案負責人在試驗場上指出來的。
 */
export const SPLASH_HEIGHT_MIN = 0.55
export const SPLASH_HEIGHT_MAX = 1.45

/**
 * 半徑跟著高度變的比例。高的柱子也比較粗 —— 只變高度的話高的會像針。
 *
 * 半徑倍率 = `RADIUS_BASE + h × RADIUS_SPAN`，與高度用**同一個** `h`。
 */
export const SPLASH_RADIUS_BASE = 0.8
export const SPLASH_RADIUS_SPAN = 0.35

/**
 * 抽到滿高要多久，s。12 m / 0.1 s = **120 m/s** —— 出水那一下要夠猛。
 *
 * 【為什麼是秒數不是「佔壽命的比例」】初版把它寫成比例，於是想調下墜速度
 * 就得同時重算總時長與比例兩個數 —— 兩個旋鈕互相牽動。拆成兩段獨立的
 * 秒數之後，「上升快一點」與「下墜慢一點」是兩個互不影響的改動。
 */
export const SPLASH_JET_SECONDS = 0.1

/**
 * 從滿高落回水面要多久，s。12 m / 0.4 s = **30 m/s**。
 *
 * 【為什麼比重力快】12 m 自由落體要 √(2×12/9.81) = 1.56 s。水柱是一塊
 * **實心 mesh**，掉得比重力慢會讀成一根柱子在下沉而不是一團水在塌，所以
 * 這裡刻意取得比自由落體快（3.9 倍）。這是一個看起來對的數字，不是一條
 * 有門檻的規則 —— 純視覺，要調就調。
 */
export const SPLASH_FALL_SECONDS = 0.4

/** 壽命，s。抽起加落下，看得完一個完整動作。 */
export const SPLASH_LIFE = SPLASH_JET_SECONDS + SPLASH_FALL_SECONDS

/**
 * 池子大小。
 *
 * 【256 怎麼來】水柱天然稀有（只有低空纏鬥才出現，見 M7 spec §7.3），
 * 所以這不需要一個精確的上界 —— 環形緩衝覆蓋最舊的，滿了也不會壞。
 */
export const SPLASH_CAPACITY = 256

const RADIAL_SEGMENTS = 8

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
  /** 全部歸零。換一場戰鬥時呼叫 —— 上一場的水柱不該留在新的一場裡 */
  reset(): void
  dispose(): void
}

/**
 * 年齡 → 高度係數 0..1。`SPLASH_JET_SECONDS` 抽到滿高，再花
 * `SPLASH_FALL_SECONDS` 線性落回 0。
 *
 * 【為什麼抽成純函數】繪製函數進不了單元測試，而「先漲後落」是一條有實際
 * 行為的規則 —— 與 `edgeIndicatorPosition`、`minimapSymbol`、`countdownLabel`
 * 是同一個做法。
 */
export function splashScale(age: number): number {
  if (age < 0 || age >= SPLASH_LIFE) return 0
  if (age <= SPLASH_JET_SECONDS) {
    return SPLASH_JET_SECONDS > 0 ? age / SPLASH_JET_SECONDS : 1
  }
  return 1 - (age - SPLASH_JET_SECONDS) / SPLASH_FALL_SECONDS
}

/**
 * 子彈型的旋轉剖面：柱身微收到肩部，再由肩部以四分之一橢圓收到頂點。
 *
 * 【為什麼是 `LatheGeometry` 而不是圓柱】圓柱只能做出「收尖」或「平頂」，
 * 兩者都不是水柱的樣子。專案負責人裁決要**上方圓潤的子彈型** —— 那需要
 * 一段曲線，而旋轉剖面是描述它最直接的方式。
 *
 * **以底面為原點**：以中心為原點的話，縮放 Y 會讓柱子從中間往兩邊長，
 * 下半截埋進水裡。
 *
 * 【為什麼剖面點另外抽成 `bulletPoints`】`LatheGeometry` **只在剖面點上
 * 產生頂點** —— 柱身那一整段中間一個頂點也沒有。想從網格頂點反推形狀就會
 * 踩到空箱子（實作時真的踩到了）。剖面才是這個形狀的定義，測它才對。
 */
export function bulletPoints(): Vector2[] {
  const shoulderY = SPLASH_HEIGHT * SPLASH_SHOULDER
  const shoulderR = SPLASH_RADIUS * SPLASH_TOP_RATIO
  const noseH = SPLASH_HEIGHT - shoulderY

  const points: Vector2[] = [
    new Vector2(SPLASH_RADIUS, 0),
    new Vector2(shoulderR, shoulderY),
  ]
  // 四分之一橢圓：t 從 0（肩部）到 1（頂點）
  for (let i = 1; i <= NOSE_SEGMENTS; i++) {
    const t = (i / NOSE_SEGMENTS) * (Math.PI / 2)
    points.push(new Vector2(shoulderR * Math.cos(t), shoulderY + noseH * Math.sin(t)))
  }
  return points
}

export function bulletProfile(): BufferGeometry {
  return new LatheGeometry(bulletPoints(), RADIAL_SEGMENTS)
}

/**
 * 池格索引 → 這根柱子的高度與半徑倍率。
 *
 * 【為什麼由索引決定而不是發射時擲一次亂數】與 `coneDirection` 同一個理由：
 * 純函數才測得起來，而且同一格恆得同一個尺寸，重播可重現。
 */
export function splashSize(slot: number): { height: number; radius: number } {
  const h = hash01(slot * 2654435761)
  return {
    height: SPLASH_HEIGHT_MIN + h * (SPLASH_HEIGHT_MAX - SPLASH_HEIGHT_MIN),
    radius: SPLASH_RADIUS_BASE + h * SPLASH_RADIUS_SPAN,
  }
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
 * alpha，逐實例透明度要自訂著色器。而高度曲線（12 m → 0）本身就完成了
 * 消失 —— 再加一層透明度只是把同一件事做兩次。
 */
export function createSplashes(capacity: number = SPLASH_CAPACITY): Splashes {
  const px = new Float32Array(capacity)
  const py = new Float32Array(capacity)
  const pz = new Float32Array(capacity)
  // 【死掉的格子填 Infinity 而不是 SPLASH_LIFE】`age` 是 float32 而
  // SPLASH_LIFE 是兩個 float64 的和 —— 例如 0.1 + 2.0 = 2.1 存進 float32
  // 會變成 2.09999990，於是「age >= SPLASH_LIFE」在一開始就是 false，整池
  // 被當成活的。Infinity 沒有這個問題，而且意思更直接：這一格從未用過。
  const age = new Float32Array(capacity).fill(Infinity)
  let next = 0
  let live = 0

  const geometry = bulletProfile()

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
        // 【柱子恆為垂直，不隨任何東西旋轉】高度另外乘上這一格的亂數倍率
        // ——一次撞擊生十根，十根一樣高讀起來是一排柵欄
        const sz = splashSize(i)
        SCALE.set(sz.radius, s * sz.height, sz.radius)
        M.compose(POS, ROT.identity(), SCALE)
        object.setMatrixAt(i, M)
      }
      object.instanceMatrix.needsUpdate = true
    },

    reset(): void {
      age.fill(Infinity)
      live = 0
      next = 0
      M.compose(ZERO, ROT.identity(), ZERO)
      for (let i = 0; i < capacity; i++) object.setMatrixAt(i, M)
      object.instanceMatrix.needsUpdate = true
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
      object.dispose()
    },
  }
}
