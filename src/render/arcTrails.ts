import {
  BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicMaterial,
} from 'three'
import { arcAt, type ArcPoint, type ArcShot } from './arc'
import { ringBasis, tubeIndices, tubeVertexCount, type RingBasis } from './tube'
import { injectVertexAlpha, TRAIL_COLOR } from './vortex'

/**
 * # 迫擊砲彈的白色尾流
 *
 * 用翼尖凝結尾那一套（`vortex.ts` 的掃掠管、逐頂點 alpha、同一個白），畫在一條高拋物線上：
 * 管子跟著彈頭，往後拖一段弧，越往後越淡、越粗（渦會擴散）。落地之後頭端釘在落點，尾端一路
 * 追上來把它收掉。
 *
 * 【環的位置每幀直接從彈道算，不記節點】彈道是時間的解析函數（`arc.ts`），所以尾流的第 j 環
 * 就是 `age − SPAN + SPAN·j/(N−1)` 那一刻的位置。凝結尾要記節點是因為翼尖的路徑是飛行員飛
 * 出來的；這裡路徑本來就知道。
 *
 * 【低面數】4 邊、10 環：遠看是一條線，近看也只是幾段折線。一個 Mesh、一個材質。
 *
 * 【塌掉的環】沒有用到的條整條畫成半徑 0、alpha 0、同一個點 —— 零面積畫不出東西。
 *
 * 【`frustumCulled = false`】包圍球是建立時算的（全部在原點），開著視錐剔除的話相機一離開
 * 原點附近整條管子會消失。與凝結尾、曳光彈同一個坑。
 *
 * 熱路徑：`spawn` 與 `step` 不配置。**全部數值是起始值，由試飛裁定。**
 */

/**
 * 同時最多幾發（在飛的加上落地後正在收的）。**池滿了新的一發蓋掉最舊的，被蓋掉的那一發永遠不落地
 * （沒有爆炸）**，所以要比最壞情況大：德 M4 十門、最遠一發約 25 秒、收尾 4 秒、週期 12 秒，
 * 約 40 條；`ground-battle.test.ts` 由卡片算這個下界
 */
export const ARC_TRAIL_CAPACITY = 64

/** 一條尾流幾環。環越少越像折線 */
export const ARC_TRAIL_RINGS = 10

/** 管的邊數 */
export const ARC_TRAIL_SIDES = 4

/** 尾流往彈頭後面拖多久的弧，s；落地之後也是收掉它所花的時間 */
export const ARC_TRAIL_SECONDS = 4

/**
 * 頭端與尾端的管半徑，m。**從 1.5 km 高處看得見才訂的**：720p、65° 視野下那個距離一個像素約
 * 2.6 m，翼尖凝結尾的 0.2～0.65 m 在這裡是看不見的；再細的話遠看只剩斷續的淡線。
 */
export const ARC_TRAIL_RADIUS_HEAD = 0.7
export const ARC_TRAIL_RADIUS_TAIL = 1.6

/**
 * 頭端的不透明度。管子經 `DoubleSide` 疊兩層，實效是 `1 − (1 − 這個)²`（見 `vortex.ts` 的
 * `TRAIL_ALPHA`）。**淡**：迫擊砲是小口徑，細而透明的一條線才對
 */
export const ARC_TRAIL_ALPHA = 0.28

/** 窗口長到這麼多秒才算拉開：剛發射的那一刻管子是零長度，粗細與濃度從 0 長到滿，不留圓盤 */
const GROW_SECONDS = 1

export interface ArcTrails {
  readonly object: Mesh
  /** 現在有幾條（在飛的加上落地後正在收的） */
  readonly live: number
  /**
   * 加一發。池滿了蓋掉最舊的。
   *
   * @param age 已經飛了幾秒，預設 0。開場時天上已經有的彈從這裡開始，要小於 `flight`（已經落地的不加）
   */
  spawn(shot: ArcShot, age?: number): void
  /**
   * 前進 `dt` 秒並重寫頂點。這一步落地的每一發呼叫一次 `land(x, y, z)`（落點）。
   * **渲染幀率呼叫，不在物理步裡。**
   */
  step(dt: number, land: (x: number, y: number, z: number) => void): void
  /** 全部清空。換一場時呼叫 */
  reset(): void
  dispose(): void
}

const COS = new Float32Array(ARC_TRAIL_SIDES)
const SIN = new Float32Array(ARC_TRAIL_SIDES)
for (let s = 0; s < ARC_TRAIL_SIDES; s++) {
  const a = (s / ARC_TRAIL_SIDES) * Math.PI * 2
  COS[s] = Math.cos(a)
  SIN[s] = Math.sin(a)
}

/** 模組私有的暫存。熱路徑：不配置 */
const BASIS: RingBasis = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0 }
const P: ArcPoint = { x: 0, y: 0, z: 0 }
const RX = new Float64Array(ARC_TRAIL_RINGS)
const RY = new Float64Array(ARC_TRAIL_RINGS)
const RZ = new Float64Array(ARC_TRAIL_RINGS)

export function createArcTrails(capacity: number = ARC_TRAIL_CAPACITY): ArcTrails {
  const shots: ArcShot[] = []
  for (let i = 0; i < capacity; i++) shots.push({ x0: 0, y0: 0, z0: 0, vx: 0, vy: 0, vz: 0, flight: 0 })
  const age = new Float64Array(capacity)
  const live = new Uint8Array(capacity)
  /** 這一條的頂點已經是空的（不必每幀再寫一次） */
  const blank = new Uint8Array(capacity).fill(1)
  let cursor = 0
  let liveCount = 0

  const vertexCount = tubeVertexCount(capacity, ARC_TRAIL_RINGS, ARC_TRAIL_SIDES)
  const position = new BufferAttribute(new Float32Array(vertexCount * 3), 3)
  const alpha = new BufferAttribute(new Float32Array(vertexCount), 1)
  position.setUsage(DynamicDrawUsage)
  alpha.setUsage(DynamicDrawUsage)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', position)
  geometry.setAttribute('aAlpha', alpha)
  geometry.setIndex(new BufferAttribute(tubeIndices(capacity, ARC_TRAIL_RINGS, ARC_TRAIL_SIDES), 1))

  const material = new MeshBasicMaterial({
    color: TRAIL_COLOR, transparent: true, depthWrite: false, side: DoubleSide,
  })
  material.onBeforeCompile = injectVertexAlpha

  const object = new Mesh(geometry, material)
  object.name = 'groundBattle.arcTrails'
  object.frustumCulled = false

  const pos = position.array as Float32Array
  const alp = alpha.array as Float32Array

  const writeBlank = (slot: number): void => {
    const v0 = slot * ARC_TRAIL_RINGS * ARC_TRAIL_SIDES
    pos.fill(0, v0 * 3, (v0 + ARC_TRAIL_RINGS * ARC_TRAIL_SIDES) * 3)
    alp.fill(0, v0, v0 + ARC_TRAIL_RINGS * ARC_TRAIL_SIDES)
    blank[slot] = 1
  }

  const writeTrail = (slot: number): void => {
    const s = shots[slot]!
    const a = age[slot]!
    const head = Math.min(a, s.flight)
    // 尾端不會越過頭端：`a` 到 `flight + SPAN` 這條就空出來，不會走到這裡
    const tail = Math.max(0, a - ARC_TRAIL_SECONDS)
    // 落地之後整條逐漸淡掉；窗口還沒拉開（剛發射）時從 0 長出來
    const fade = a <= s.flight ? 1 : Math.max(0, 1 - (a - s.flight) / ARC_TRAIL_SECONDS)
    const grow = Math.min(1, (head - tail) / GROW_SECONDS)
    const gain = fade * grow
    const last = ARC_TRAIL_RINGS - 1
    for (let j = 0; j < ARC_TRAIL_RINGS; j++) {
      arcAt(s, tail + ((head - tail) * j) / last, P)
      RX[j] = P.x
      RY[j] = P.y
      RZ[j] = P.z
    }
    const v0 = slot * ARC_TRAIL_RINGS * ARC_TRAIL_SIDES
    for (let j = 0; j < ARC_TRAIL_RINGS; j++) {
      // 0 = 尾端、1 = 頭端
      const u = j / last
      const radius = (ARC_TRAIL_RADIUS_HEAD + (ARC_TRAIL_RADIUS_TAIL - ARC_TRAIL_RADIUS_HEAD) * (1 - u)) * grow
      const p = j > 0 ? j - 1 : j
      const q = j < last ? j + 1 : j
      ringBasis(RX[q]! - RX[p]!, RY[q]! - RY[p]!, RZ[q]! - RZ[p]!, BASIS)
      for (let k = 0; k < ARC_TRAIL_SIDES; k++) {
        const co = COS[k]! * radius
        const si = SIN[k]! * radius
        const v = v0 + j * ARC_TRAIL_SIDES + k
        pos[v * 3] = RX[j]! + BASIS.ax * co + BASIS.bx * si
        pos[v * 3 + 1] = RY[j]! + BASIS.ay * co + BASIS.by * si
        pos[v * 3 + 2] = RZ[j]! + BASIS.az * co + BASIS.bz * si
        alp[v] = ARC_TRAIL_ALPHA * u * gain
      }
    }
    blank[slot] = 0
  }

  return {
    object,
    get live() { return liveCount },

    spawn(shot, flown = 0) {
      const i = cursor
      cursor = (i + 1) % capacity
      const s = shots[i]!
      s.x0 = shot.x0
      s.y0 = shot.y0
      s.z0 = shot.z0
      s.vx = shot.vx
      s.vy = shot.vy
      s.vz = shot.vz
      s.flight = shot.flight
      age[i] = flown
      if (live[i] === 0) liveCount++
      live[i] = 1
    },

    step(dt, land) {
      let touched = false
      for (let i = 0; i < capacity; i++) {
        if (live[i] === 0) {
          if (blank[i] === 0) { writeBlank(i); touched = true }
          continue
        }
        const s = shots[i]!
        const before = age[i]!
        const now = before + dt
        age[i] = now
        if (before < s.flight && now >= s.flight) {
          arcAt(s, s.flight, P)
          land(P.x, P.y, P.z)
        }
        if (now >= s.flight + ARC_TRAIL_SECONDS) {
          live[i] = 0
          liveCount--
          writeBlank(i)
        } else {
          writeTrail(i)
        }
        touched = true
      }
      if (touched) {
        position.needsUpdate = true
        alpha.needsUpdate = true
      }
    },

    reset() {
      live.fill(0)
      liveCount = 0
      cursor = 0
      for (let i = 0; i < capacity; i++) if (blank[i] === 0) writeBlank(i)
      position.needsUpdate = true
      alpha.needsUpdate = true
    },

    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
