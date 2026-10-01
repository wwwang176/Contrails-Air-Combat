import { Vector3 } from 'three'
import type { AircraftSpec } from '../../specs/types'
import type { TimeOfDay } from '../../world/timeOfDay'
import type { ShipClassId } from '../../world/ships'
import type { MessageKey } from '../../i18n'
import { hash01 } from '../../render/scatter'
import { WRECK_TERMINAL } from '../../render/wrecks'
import { createFlight, flightPose, type Path } from '../reelFlight'

/**
 * 主選單短片的分鏡工具。**每一段都是資料加純函數**：演員的路徑、剪接表、事件表。
 * 五段各一個檔案（`fleet.ts`、`stream.ts`、`dogfight.ts`、`strike.ts`、`home.ts`），
 * 共用的型別與工具都在這裡。
 *
 * 座標是那一段自己的局部座標（公尺，y 是離海面的高度）。執行時整段平移到一塊
 * 開闊的海上，`faceSun` 的段再繞 Y 轉到局部 −Z 朝太陽的方位。
 */

export type { Path }

export interface ReelPlane {
  readonly spec: AircraftSpec
  readonly path: Path
  /** 配角：觸控裝置上不出場 */
  readonly extra?: boolean
}

/** 船：等速直線。`heading` 與 `createShip` 同一個約定：前進方向 (−sin h, 0, −cos h) */
export interface ReelShip {
  readonly cls: ShipClassId
  readonly x: number
  readonly z: number
  readonly heading: number
  readonly speed: number
}

export type ReelEvent =
  /** 這一架的固定機槍連射 `seconds` 秒 */
  | { readonly at: number, readonly kind: 'burst', readonly actor: number, readonly seconds: number }
  /** 這一架開始拖煙，到被擊落或這一段結束 */
  | { readonly at: number, readonly kind: 'smoke', readonly actor: number }
  /** 這一架交給殘骸池。`blast` = 空中爆炸那一團火 */
  | { readonly at: number, readonly kind: 'kill', readonly actor: number, readonly blast: boolean }
  /** 一朵高砲黑雲，局部座標 */
  | { readonly at: number, readonly kind: 'flak', readonly x: number, readonly y: number, readonly z: number }
  /** 這艘船朝這一架打防空曳光 `seconds` 秒；`miss` 是瞄點偏開的公尺數 */
  | {
    readonly at: number, readonly kind: 'aa', readonly ship: number, readonly actor: number,
    readonly seconds: number, readonly miss: number
  }
  /**
   * 這一架的機槍手朝那一架打曳光 `seconds` 秒（轟炸機的砲塔、陸攻的旋回槍）。
   * 從射手機身附近隨機一點打出去，瞄點偏開 `miss` 公尺
   */
  | {
    readonly at: number, readonly kind: 'gunner', readonly actor: number, readonly target: number,
    readonly seconds: number, readonly miss: number
  }

export interface ReelCamera {
  readonly position: Vector3
  readonly target: Vector3
  /** 鏡頭的上方。跟著機身滾轉的鏡頭（肩後、掛在機身上的）會歪，其餘是世界上方 */
  readonly up: Vector3
  /** 垂直視角，度 */
  fov: number
}

export function createReelCamera(): ReelCamera {
  return { position: new Vector3(), target: new Vector3(), up: new Vector3(0, 1, 0), fov: 50 }
}

export type CameraFn = (t: number, out: ReelCamera) => void

/** 剪接表的一刀：從 `from` 秒起換這個鏡頭，直到下一刀 */
export interface Cut {
  readonly from: number
  /** 這個鏡頭拍的是哪一架。`null` = 拍船或殘骸，不檢查 */
  readonly subject: number | null
  /**
   * 鏡頭掛在這一架身上（翼尖、機尾、肩後）。測試對它只查鏡頭不在命中盒裡，
   * 不要求離機身中心 6 m
   */
  readonly mount?: number
  readonly camera: CameraFn
}

export interface Shot {
  readonly id: string
  /** 秒 */
  readonly duration: number
  readonly timeOfDay: TimeOfDay
  /** 右下角的地點與年月 */
  readonly captionKey: MessageKey
  /** 局部 −Z 轉到太陽的水平方位 */
  readonly faceSun: boolean
  /**
   * 整段動作落在哪一個圓裡（局部座標的圓心、半徑 m）。執行時這個圓整個要是開闊的
   * 海 —— 只看原點的話，一路往前飛四公里的纏鬥會把殘骸丟在島上
   */
  readonly clear: { readonly x: number, readonly z: number, readonly radius: number }
  readonly planes: readonly ReelPlane[]
  readonly ships: readonly ReelShip[]
  /** 依 `from` 排序，第一刀從 0 開始 */
  readonly cuts: readonly Cut[]
  /** 照剪接表取這一刻的鏡頭 */
  camera(t: number, out: ReelCamera): void
  /** 依 `at` 排序 */
  readonly events: readonly ReelEvent[]
}

// ── 工具 ───────────────────────────────────────────────────

/**
 * 從 `t0` 起、`d` 秒內由 0 平順加到 `a`（m/s²）的加速度，積分兩次後的位移，m。
 *
 * 【加速度要平順地加上去】路徑的二階導數就是坡度（`flightPose`）。加速度一步跳上去
 * 的話，飛機在那一幀從平飛瞬間翻到 50°。smoothstep 的兩次積分是
 * `a·d²·(u⁴/4 − u⁵/10)`，`d` 之後接等加速度。要讓轉彎或爬升停下來，再減一個
 * 晚幾秒開始的同樣大小的 `rampedOffset`。
 */
export function rampedOffset(t: number, t0: number, d: number, a: number): number {
  const tau = t - t0
  if (tau <= 0) return 0
  if (tau < d) {
    const u = tau / d
    return a * d * d * (u * u * u * u / 4 - u * u * u * u * u / 10)
  }
  const r = tau - d
  return a * d * d * 0.15 + a * d * 0.5 * r + 0.5 * a * r * r
}

/** 殘骸的線性阻力係數，1/s。與 `render/wrecks.ts` 同一條式子 */
const WRECK_K = 9.81 / WRECK_TERMINAL

/**
 * 殘骸交出去 `tau` 秒後在哪。`render/wrecks.ts` 的積分是線性阻力加重力，
 * 這是它的解析解 —— 鏡頭拿它追殘骸，不必讀殘骸池的狀態。
 * `p`、`v` 是交出去那一刻的位置與速度（`velocityAt` 算得出來）。
 */
export function wreckAt(p: Vector3, v: Vector3, tau: number, out: Vector3): Vector3 {
  const e = (1 - Math.exp(-WRECK_K * tau)) / WRECK_K
  const vt = 9.81 / WRECK_K
  out.set(
    p.x + v.x * e,
    p.y - vt * tau + (v.y + vt) * e,
    p.z + v.z * e,
  )
  if (out.y < 0) out.y = 0
  return out
}

/** 路徑在 `t` 的速度（中央差分），寫進 `out` */
export function velocityAt(path: Path, t: number, out: Vector3): Vector3 {
  path(t + 0.05, out)
  const x = out.x
  const y = out.y
  const z = out.z
  path(t - 0.05, out)
  return out.set((x - out.x) * 10, (y - out.y) * 10, (z - out.z) * 10)
}

/** 同一架長機、一組固定的隊形位移，再加一點各自的起伏 */
export function wingman(lead: Path, dx: number, dy: number, dz: number, phase: number): Path {
  return (t, out) => {
    lead(t, out)
    out.x += dx + 1.2 * Math.sin(0.37 * t + phase)
    out.y += dy + 1.5 * Math.sin(0.53 * t + phase * 1.7)
    out.z += dz
    return out
  }
}

const POSE = createFlight()
const WORLD_UP = new Vector3(0, 1, 0)

/**
 * 這架飛機機體座標裡的一點（x 右、y 上、z 後；機首 −Z），寫進 `out`。
 *
 * `level` = 只跟航向、不跟滾轉與俯仰。架在旁邊或後面的跟拍鏡頭用它 —— 跟著滾轉的
 * 話，飛機一壓坡度鏡頭就甩一大圈。肩後與掛在機身上的鏡頭才跟著整個機身走
 * （再配 `bodyUp` 當鏡頭的上方）。
 */
export function body(
  path: Path, t: number, x: number, y: number, z: number, level: boolean, out: Vector3,
): Vector3 {
  flightPose(path, t, POSE)
  if (level) {
    const yaw = Math.atan2(-POSE.velocity.x, -POSE.velocity.z)
    out.set(x, y, z).applyAxisAngle(WORLD_UP, yaw)
  } else {
    out.set(x, y, z).applyQuaternion(POSE.quaternion)
  }
  return out.add(POSE.position)
}

/** 這架飛機機體的上方（世界座標）。跟著機身滾轉的鏡頭拿它當鏡頭的上方 */
export function bodyUp(path: Path, t: number, out: Vector3): Vector3 {
  flightPose(path, t, POSE)
  return out.set(0, 1, 0).applyQuaternion(POSE.quaternion)
}

/** 船在第 `t` 秒的位置 */
export function shipAt(s: ReelShip, t: number, out: Vector3): Vector3 {
  return out.set(s.x - Math.sin(s.heading) * s.speed * t, 0, s.z - Math.cos(s.heading) * s.speed * t)
}

/** 剪接表 → 鏡頭函式：取 `from` 不超過 `t` 的最後一刀 */
export function edit(cuts: readonly Cut[]): CameraFn {
  return (t, out) => {
    let pick = cuts[0]!
    for (const c of cuts) if (c.from <= t) pick = c
    out.up.set(0, 1, 0)
    pick.camera(t, out)
  }
}

/**
 * 一串高砲黑雲：`from`～`to` 秒、平均每秒 `rate` 朵，落在 `centre(t)` 周圍的盒子裡。
 * 離鏡頭不到 `minCam` 公尺的不放 —— 黑雲貼在鏡頭上是一整片黑。
 */
export function barrage(
  seed: number, from: number, to: number, rate: number,
  centre: Path, half: { x: number, yLo: number, yHi: number, z: number },
  camera: CameraFn, minCam: number,
): ReelEvent[] {
  const out: ReelEvent[] = []
  const c = new Vector3()
  const cam = createReelCamera()
  const n = Math.round((to - from) * rate)
  for (let k = 0; k < n; k++) {
    const at = from + ((k + hash01(seed + k * 7)) / n) * (to - from)
    centre(at, c)
    const x = c.x + (hash01(seed + k * 7 + 1) * 2 - 1) * half.x
    const y = c.y + half.yLo + hash01(seed + k * 7 + 2) * (half.yHi - half.yLo)
    const z = c.z + (hash01(seed + k * 7 + 3) * 2 - 1) * half.z
    camera(at, cam)
    if (Math.hypot(x - cam.position.x, y - cam.position.y, z - cam.position.z) < minCam) continue
    out.push({ at, kind: 'flak', x, y, z })
  }
  return out
}

/** 事件表照時間排好 */
export const timeline = (events: ReelEvent[]): ReelEvent[] => events.sort((a, b) => a.at - b.at)
