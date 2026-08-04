import {
  AdditiveBlending, Color, CylinderGeometry, DynamicDrawUsage, InstancedMesh,
  Matrix4, MeshBasicMaterial, Quaternion, Vector3,
} from 'three'
import { IMPACT_STRIDE, type ImpactEvents } from '../world/events'

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
  dispose(): void
}

/**
 * 32 位元整數雜湊 → [0, 1)。
 *
 * 【為什麼不用 `Math.random()`】與 `battle/setup.ts` 的 `altitudeOffset`
 * 避開亂數同一個理由：亂數要嘛需要一顆種子與一個 PRNG，要嘛就毀掉可
 * 測試性。用索引的雜湊之後 `sparkDirection` 是純函數，「恆在錐內」這一條
 * 才測得起來。
 */
function hash01(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const AXIS = new Vector3()
const TANGENT = new Vector3()
const BITANGENT = new Vector3()

/**
 * 在法線周圍 `SPARK_CONE` 的錐內取一個方向，**由 `index` 決定**。
 *
 * 熱路徑之外（每次命中八次），但仍然不配置。
 */
export function sparkDirection(
  nx: number, ny: number, nz: number, index: number, out: Vector3,
): void {
  AXIS.set(nx, ny, nz)
  const len = AXIS.length()
  // 【零向量的防護】法線理論上不會是零，但 NaN 一旦進入實例矩陣，整批
  // 火花會靜靜地消失而且完全不報錯（與 assess.ts 的防護同一個理由）。
  if (len < 1e-6) AXIS.set(0, 1, 0)
  else AXIS.divideScalar(len)

  // 與 AXIS 最不平行的座標軸，拿來造切線
  const ax = Math.abs(AXIS.x)
  const ay = Math.abs(AXIS.y)
  const az = Math.abs(AXIS.z)
  if (ax <= ay && ax <= az) TANGENT.set(1, 0, 0)
  else if (ay <= az) TANGENT.set(0, 1, 0)
  else TANGENT.set(0, 0, 1)
  TANGENT.cross(AXIS).normalize()
  BITANGENT.copy(AXIS).cross(TANGENT)

  const phi = hash01(index) * Math.PI * 2
  const cosMax = Math.cos(SPARK_CONE)
  // 均勻取在 [cosMax, 1]：立體角上均勻，不會擠在錐心
  const cosT = cosMax + (1 - cosMax) * hash01(index * 2 + 1)
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT))

  out.copy(AXIS).multiplyScalar(cosT)
    .addScaledVector(TANGENT, Math.cos(phi) * sinT)
    .addScaledVector(BITANGENT, Math.sin(phi) * sinT)
  const l = out.length()
  if (l > 1e-9) out.divideScalar(l)
  else out.copy(AXIS)
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
  // 【起始壽命設滿】等於「一出生就是死的」，不必另外一個 alive 陣列
  const age = new Float32Array(capacity).fill(SPARK_LIFE)
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

    dispose(): void {
      geometry.dispose()
      material.dispose()
      object.dispose()
    },
  }
}
