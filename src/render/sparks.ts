import {
  AdditiveBlending, Color, CylinderGeometry, DynamicDrawUsage, InstancedMesh,
  Matrix4, MeshBasicMaterial, Quaternion, Vector3,
} from 'three'
import { IMPACT_STRIDE, type ImpactEvents } from '../world/events'
import { coneDirection } from './scatter'

/** 一次命中噴幾顆。少於 4 讀不出「噴開」，多於 16 在密集命中時變成一團。 */
export const SPARKS_PER_HIT = 8

/** 初速，m/s。壽命 0.2 s 內飛約 3 m —— 與機身尺度同量級，看得出是從表面噴出來的。 */
export const SPARK_SPEED = 25

/** 噴射錐的半角。窄到讀得出法線方向，寬到不像一根針。 */
export const SPARK_CONE = 35 * (Math.PI / 180)

/** 壽命，s。60 fps 下 12 幀，看得完一次噴射。 */
export const SPARK_LIFE = 0.2

/**
 * 速度的指數阻尼，s⁻¹。
 *
 * 時間常數 1/6 = 0.17 s 與壽命 0.2 s 同量級 —— 火星在死掉之前速度掉到
 * 約 1/e，看起來是「噴出去然後慢下來」而不是「等速飛走然後消失」。
 */
export const SPARK_DRAG = 6

/**
 * 超過這個距離的命中事件不發射，m。
 *
 * 【推導】1920 px、65° 視野下每像素 5.9e-4 rad（見 `tracers.ts`），
 * 800 m 上 1 px = 0.47 m，而火星只有 0.3 m 長 —— **0.64 px，次像素**。
 * 模擬看不見的粒子是純浪費（M7 spec §6.4）。
 */
export const SPARK_CULL = 800

/** 火星拉長的長度與半徑，m。與曳光彈同一種幾何。 */
export const SPARK_LENGTH = 0.3
export const SPARK_RADIUS = 0.02

/**
 * 池子大小。
 *
 * 【512 怎麼來】密集交火時約 40 次命中/s × 0.2 s 壽命 × 8 顆 = 64 顆
 * 同時在場。512 是它的 8 倍。
 */
export const SPARK_CAPACITY = 512

/** 重力，m/s²。與 `physics/` 用的是同一個值。 */
const G = -9.80665

const RADIAL_SEGMENTS = 3

export interface Sparks {
  object: InstancedMesh
  /** 目前還活著幾顆。測試與 telemetry 用 */
  readonly live: number
  /**
   * 依命中事件發射。**距離剔除在這裡做** —— 只有渲染層知道相機在哪裡，
   * `World` 不需要知道有相機這回事（M7 spec §6.4）。
   */
  emit(events: ImpactEvents, cameraX: number, cameraY: number, cameraZ: number): void
  /** 積分一幀並寫入實例矩陣。**在渲染幀率呼叫，不在物理步。** */
  step(dt: number): void
  /** 全部歸零。換一場戰鬥時呼叫 —— 上一場的火花不該留在新的一場裡 */
  reset(): void
  dispose(): void
}

/**
 * 在法線周圍 `SPARK_CONE` 的錐內取一個方向，**由 `index` 決定**。
 *
 * 【為什麼還留著這個包裝】它把「火花的半角是 `SPARK_CONE`」這件事釘在火花
 * 自己的模組裡，呼叫端不必知道那個常數。實作在 `scatter.ts` —— 火花、火球、
 * 零件、噴濺要的都是同一件事，只有半角與軸不同，四份副本就是只有一份會被
 * 修好的那種危險。
 *
 * 熱路徑之外（每次命中八次），但仍然不配置。
 */
export function sparkDirection(
  nx: number, ny: number, nz: number, index: number, out: Vector3,
): void {
  coneDirection(nx, ny, nz, SPARK_CONE, index, out)
}

const UNIT_Z = new Vector3(0, 0, 1)
const M = new Matrix4()
const POS = new Vector3()
const DIR = new Vector3()
const SCALE = new Vector3()
const ROT = new Quaternion()
const TINT = new Color()
const ZERO = new Vector3(0, 0, 0)

/**
 * 命中火花 —— **單一** `InstancedMesh` 的粒子池。
 *
 * 【環形緩衝、滿了覆蓋最舊的】最舊的正好是最淡的那一顆，覆蓋看不出來；
 * 丟棄新的則會在密集命中時整批不見 —— 而那正是最該看到火花的時候。
 */
export function createSparks(capacity: number = SPARK_CAPACITY): Sparks {
  const px = new Float32Array(capacity)
  const py = new Float32Array(capacity)
  const pz = new Float32Array(capacity)
  const vx = new Float32Array(capacity)
  const vy = new Float32Array(capacity)
  const vz = new Float32Array(capacity)
  // 【起始年齡設無限大】等於「一出生就是死的」，不必另外一個 alive 陣列。
  //
  // 【為什麼是 Infinity 而不是 SPARK_LIFE】float32 存不下的常數在來回轉換
  // 之後可能比它自己小，於是 `age >= SPARK_LIFE` 一開始就是 false，整池被
  // 當成活的（`splash.ts` 的註解記著這個坑）。0.2 剛好轉上去所以現況正確，
  // 但那是巧合 —— Infinity 沒有這個問題。
  const age = new Float32Array(capacity).fill(Infinity)
  let next = 0
  let live = 0

  const geometry = new CylinderGeometry(
    SPARK_RADIUS, SPARK_RADIUS, 1, RADIAL_SEGMENTS, 1, true,
  )
  geometry.rotateX(Math.PI / 2)

  const material = new MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.9,
    depthWrite: false, blending: AdditiveBlending,
  })

  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  // 包圍球是建立時算的（全部在原點）—— 開著視錐剔除，相機一離開原點附近
  // 整批火花會一起消失。與曳光彈同一個坑。
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
    get live() { return live },

    emit(events: ImpactEvents, cameraX: number, cameraY: number, cameraZ: number): void {
      const d = events.data
      const cull2 = SPARK_CULL * SPARK_CULL
      for (let e = 0; e < events.count; e++) {
        const o = e * IMPACT_STRIDE
        const x = d[o]!
        const y = d[o + 1]!
        const z = d[o + 2]!
        const ex = x - cameraX
        const ey = y - cameraY
        const ez = z - cameraZ
        if (ex * ex + ey * ey + ez * ez > cull2) continue

        const nx = d[o + 3]!
        const ny = d[o + 4]!
        const nz = d[o + 5]!
        for (let k = 0; k < SPARKS_PER_HIT; k++) {
          const i = next
          next = next + 1 >= capacity ? 0 : next + 1
          if (age[i]! >= SPARK_LIFE) live++
          sparkDirection(nx, ny, nz, i, DIR)
          px[i] = x
          py[i] = y
          pz[i] = z
          vx[i] = DIR.x * SPARK_SPEED
          vy[i] = DIR.y * SPARK_SPEED
          vz[i] = DIR.z * SPARK_SPEED
          age[i] = 0
        }
      }
    },

    step(dt: number): void {
      const damp = Math.exp(-SPARK_DRAG * dt)
      live = 0
      for (let i = 0; i < capacity; i++) {
        const a = age[i]!
        if (a >= SPARK_LIFE) {
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          continue
        }
        const na = a + dt
        age[i] = na
        if (na >= SPARK_LIFE) {
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          object.setColorAt(i, TINT.setRGB(0, 0, 0))
          continue
        }
        live++

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

        const speed = Math.hypot(nvx, nvy, nvz)
        if (speed > 1e-6) {
          DIR.set(nvx / speed, nvy / speed, nvz / speed)
          ROT.setFromUnitVectors(UNIT_Z, DIR)
        } else {
          ROT.identity()
        }
        POS.set(nx, ny, nz)
        SCALE.set(1, 1, SPARK_LENGTH)
        M.compose(POS, ROT, SCALE)
        object.setMatrixAt(i, M)

        // 加法混合下顏色淡到黑就等於淡出 —— 不需要逐實例透明度
        const f = 1 - na / SPARK_LIFE
        TINT.setRGB(f, f * 0.75, f * 0.35)
        object.setColorAt(i, TINT)
      }
      object.instanceMatrix.needsUpdate = true
      if (object.instanceColor) object.instanceColor.needsUpdate = true
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
