import { Vector3 } from 'three'
import type { AircraftSpec } from '../specs/types'
import type { TimeOfDay } from '../world/timeOfDay'
import type { ShipClassId } from '../world/ships'
import type { MessageKey } from '../i18n'
import { P51D } from '../specs/p51d'
import { BF109K4 } from '../specs/bf109k4'
import { B17G } from '../specs/b17g'
import { F6F5 } from '../specs/f6f5'
import { G4M } from '../specs/g4m'
import { KI84 } from '../specs/ki84'
import { A6M5 } from '../specs/a6m5'
import { hash01 } from '../render/scatter'
import { WRECK_TERMINAL } from '../render/wrecks'
import { createFlight, flightPose, type Path } from './reelFlight'

/**
 * 主選單短片的分鏡。**每一段都是資料加純函數**：演員的路徑、剪接表、事件表。
 *
 * 座標是這一段自己的局部座標（公尺，y 是離海面的高度）。執行時整段平移到一塊
 * 開闊的海上，`faceSun` 的段再繞 Y 轉到局部 −Z 朝太陽的方位。
 *
 * 【一段裡要換好幾個鏡頭】一個鏡位從頭拍到尾是監視器，不是電影：特寫、肩後、
 * 迎面、海面上的固定機位輪著切，每一刀切在動作的節拍上（開火、中彈、掠過）。
 */

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

export interface ReelCamera {
  readonly position: Vector3
  readonly target: Vector3
  /** 鏡頭的上方。跟著機身滾轉的鏡頭（肩後、槍口）會歪，其餘是世界上方 */
  readonly up: Vector3
  /** 垂直視角，度 */
  fov: number
}

export function createReelCamera(): ReelCamera {
  return { position: new Vector3(), target: new Vector3(), up: new Vector3(0, 1, 0), fov: 50 }
}

type CameraFn = (t: number, out: ReelCamera) => void

/** 剪接表的一刀：從 `from` 秒起換這個鏡頭，直到下一刀 */
export interface Cut {
  readonly from: number
  /** 這個鏡頭拍的是哪一架。`null` = 拍船或殘骸，不檢查 */
  readonly subject: number | null
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

// ── 小工具 ─────────────────────────────────────────────────

/**
 * 從 `t0` 起、`d` 秒內由 0 平順加到 `a`（m/s²）的加速度，積分兩次後的位移，m。
 *
 * 【加速度要平順地加上去】路徑的二階導數就是坡度（`flightPose`）。加速度一步跳上去
 * 的話，飛機在那一幀從平飛瞬間翻到 50°。smoothstep 的兩次積分是
 * `a·d²·(u⁴/4 − u⁵/10)`，`d` 之後接等加速度。
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
 */
function wreckAt(p: Vector3, v: Vector3, tau: number, out: Vector3): Vector3 {
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

/** 同一架長機、一組固定的隊形位移，再加一點各自的起伏 */
function wingman(lead: Path, dx: number, dy: number, dz: number, phase: number): Path {
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
 * 話，飛機一壓坡度鏡頭就甩一大圈。肩後與槍口的鏡頭才跟著整個機身走。
 */
function body(path: Path, t: number, x: number, y: number, z: number, level: boolean, out: Vector3): Vector3 {
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
function bodyUp(path: Path, t: number, out: Vector3): Vector3 {
  flightPose(path, t, POSE)
  return out.set(0, 1, 0).applyQuaternion(POSE.quaternion)
}

/** 船在第 `t` 秒的位置 */
function shipAt(s: ReelShip, t: number, out: Vector3): Vector3 {
  return out.set(s.x - Math.sin(s.heading) * s.speed * t, 0, s.z - Math.cos(s.heading) * s.speed * t)
}

/** 剪接表 → 鏡頭函式：取 `from` 不超過 `t` 的最後一刀 */
function edit(cuts: readonly Cut[]): CameraFn {
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
function barrage(
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
const timeline = (events: ReelEvent[]): ReelEvent[] => events.sort((a, b) => a.at - b.at)

const S1 = new Vector3()
const S2 = new Vector3()
const S3 = new Vector3()

// ── 1. 艦隊 ───────────────────────────────────────────────
//
// 拂曉，艦隊往太陽開。
//   0–9   航艦艦艏劈浪，鏡頭在右舷前方貼著海面
//   9–17  驅逐艦的側舷，航艦在它後面
//   17–25 航艦舷側的海面上仰拍：四架地獄貓從艦尾方向低空飛越
//   25–34 跟在長機後面左轉，艦隊在下方

const FLEET_SPEED = 9
const ESSEX: ReelShip = { cls: 'essex', x: 0, z: 0, heading: 0, speed: FLEET_SPEED }
const FLEET_DD: ReelShip = { cls: 'fletcher', x: -420, z: -380, heading: 0, speed: FLEET_SPEED }
const hellcatLead: Path = (t, out) => {
  // 第 20 秒飛越航艦（x −30、70 m），23 秒起左轉、22 秒起爬升
  out.set(-30, 70, 2820 - 150 * t)
  out.y += rampedOffset(t, 22, 2, 4) - rampedOffset(t, 27, 2, 4)
  out.x -= rampedOffset(t, 23, 2, 18) - rampedOffset(t, 29, 2, 18)
  return out
}

const FLEET_CUTS: readonly Cut[] = [
  {
    from: 0, subject: null,
    camera(t, out) {
      shipAt(ESSEX, t, S1)
      out.position.set(S1.x + 120, 13, S1.z - 330 + 3 * t)
      out.target.set(S1.x, 16, S1.z - 105)
      out.fov = 38
    },
  },
  {
    from: 9, subject: null,
    camera(t, out) {
      shipAt(FLEET_DD, t, S1)
      out.position.set(S1.x - 110, 9, S1.z + 45 - 2 * (t - 9))
      out.target.set(S1.x, 10, S1.z - 10)
      out.fov = 42
    },
  },
  {
    from: 17, subject: 0,
    camera(t, out) {
      shipAt(ESSEX, t, S1)
      out.position.set(S1.x - 75, 12, S1.z + 40)
      hellcatLead(t, out.target)
      out.fov = 45
    },
  },
  {
    from: 25, subject: 0,
    camera(t, out) {
      // 架在四機隊形的正後上方 —— 偏一邊的話會貼到那一側的僚機
      body(hellcatLead, t - 0.15, 4, 9, 40, true, out.position)
      body(hellcatLead, t, 0, -8, -150, true, out.target)
      out.fov = 48
    },
  },
]

const FLEET: Shot = {
  id: 'fleet',
  duration: 34,
  timeOfDay: 'dawn',
  captionKey: 'reel.fleet',
  faceSun: true,
  clear: { x: 0, z: 200, radius: 3000 },
  planes: [
    { spec: F6F5, path: hellcatLead },
    { spec: F6F5, path: wingman(hellcatLead, -18, -2, 14, 0.4) },
    { spec: F6F5, path: wingman(hellcatLead, 30, 1, 20, 1.3), extra: true },
    { spec: F6F5, path: wingman(hellcatLead, 48, -1, 34, 2.1), extra: true },
  ],
  ships: [
    ESSEX,
    FLEET_DD,
    { cls: 'wichita', x: -380, z: 420, heading: 0, speed: FLEET_SPEED },
    { cls: 'fletcher', x: 300, z: -760, heading: 0, speed: FLEET_SPEED },
  ],
  cuts: FLEET_CUTS,
  camera: edit(FLEET_CUTS),
  events: [],
}

// ── 2. 轟炸機流 ───────────────────────────────────────────
//
// 正午、1,500 m。
//   0–8   長機左翼尖外的特寫，機首與四具發動機
//   8–16  編隊正下方仰拍，高砲在四周炸開
//   16–25 後組左翼那一架中彈冒煙，鏡頭貼在它右後方；23 秒掉隊往左下滑
//   25–34 編隊後下方的遠鏡頭：編隊飛遠，殘骸拖著煙往下掉

const STREAM_SPEED = 75
const STREAM_ALT = 1500
const streamLead: Path = (t, out) => out.set(0, STREAM_ALT, -STREAM_SPEED * t)
const STREAM_HIT = 4
const stragglerBase = wingman(streamLead, -105, -51, 150, 2.6)
const straggler: Path = (t, out) => {
  stragglerBase(t, out)
  out.x -= rampedOffset(t, 23, 3, 6)
  out.y -= rampedOffset(t, 23, 3, 9)
  return out
}
const escort = (dx: number, dy: number, dz: number, phase: number): Path => (t, out) => {
  streamLead(t, out)
  out.x += dx + 110 * Math.sin(0.33 * t + phase)
  out.y += dy + 14 * Math.sin(0.47 * t + phase)
  out.z += dz
  return out
}

const STREAM_CUTS: readonly Cut[] = [
  {
    from: 0, subject: 0,
    camera(t, out) {
      // 左前方斜看：機首、座艙與左翼兩具發動機都在畫面裡，機身往右後方延伸
      body(streamLead, t, -30, 3, -24 + 0.6 * t, true, out.position)
      body(streamLead, t, -3, 0, 3, true, out.target)
      out.fov = 45
    },
  },
  {
    from: 8, subject: 0,
    camera(t, out) {
      streamLead(t, S1)
      out.position.set(S1.x - 40, S1.y - 200, S1.z + 150 - 4 * (t - 8))
      out.target.set(S1.x - 35, S1.y - 22, S1.z + 75)
      out.fov = 52
    },
  },
  {
    from: 16, subject: STREAM_HIT,
    camera(t, out) {
      body(straggler, t - 0.2, 26, 7, 48, true, out.position)
      body(straggler, t, 0, 0, -10, true, out.target)
      out.fov = 42
    },
  },
  {
    from: 25, subject: 0,
    camera(t, out) {
      streamLead(25, S1)
      out.position.set(S1.x - 160, S1.y - 120, S1.z + 420)
      streamLead(t, S2)
      out.target.set(S2.x - 50, S2.y - 70, S2.z + 120)
      out.fov = 40
    },
  },
]

const STREAM: Shot = {
  id: 'stream',
  duration: 34,
  timeOfDay: 'noon',
  captionKey: 'reel.stream',
  faceSun: false,
  clear: { x: 0, z: -1300, radius: 3000 },
  planes: [
    { spec: B17G, path: streamLead },
    { spec: B17G, path: wingman(streamLead, -35, -6, 30, 0.9) },
    { spec: B17G, path: wingman(streamLead, 35, 6, 30, 1.7) },
    { spec: B17G, path: wingman(streamLead, -70, -45, 120, 0.3), extra: true },
    { spec: B17G, path: straggler },
    { spec: B17G, path: wingman(streamLead, -35, -39, 150, 3.4), extra: true },
    { spec: P51D, path: escort(70, 120, -40, 0) },
    { spec: P51D, path: escort(-90, 140, -90, Math.PI), extra: true },
  ],
  ships: [],
  cuts: STREAM_CUTS,
  camera: edit(STREAM_CUTS),
  events: timeline([
    ...barrage(101, 6, 30, 1.4, (t, out) => streamLead(t, out).add(S3.set(-40, -20, 90)),
      { x: 170, yLo: -70, yHi: 90, z: 220 }, edit(STREAM_CUTS), 70),
    { at: 16, kind: 'smoke', actor: STREAM_HIT },
    { at: 27, kind: 'kill', actor: STREAM_HIT, blast: false },
  ]),
}

// ── 3. 纏鬥 ───────────────────────────────────────────────
//
// 正午、450 m。野馬左右急轉想甩掉咬在後面 0.75 秒的 109。三段連射都排在野馬
// 轉向換邊那一刻（航跡最直、瞄得最準）。
//   0–6    兩架的右後上方，109 咬在野馬後面
//   6–12   109 飛行員的肩後：地平線跟著機身歪，第一段連射打空
//   12–20  野馬正前方迎著拍：曳光從它身邊掠過、中彈冒煙、19 秒在鏡頭前爆開
//   20–32  鏡頭跟著殘骸一起往下掉，看它拖著火落海

const DOGFIGHT_ALT = 450
const DOGFIGHT_SPEED = 135
const WEAVE = 0.5
const LAG = 0.75
const KILL_AT = 19
const mustang: Path = (t, out) => out.set(
  130 * Math.sin(WEAVE * t),
  DOGFIGHT_ALT + 30 * Math.sin(0.3 * t + 1),
  -DOGFIGHT_SPEED * t,
)
const messerschmitt: Path = (t, out) => {
  mustang(t - LAG, out)
  // 【不能壓在野馬的航跡上】野馬中彈後拖的煙就鋪在那條線上，109 跟著鑽的話
  // 鏡頭從後面看過去是一整串貼臉的黑煙
  out.x += 8
  out.y += 12
  out.x += rampedOffset(t, KILL_AT + 1.3, 1.5, 14) - rampedOffset(t, KILL_AT + 4.5, 1.5, 14)
  out.y += rampedOffset(t, KILL_AT + 1.3, 1.5, 16) - rampedOffset(t, KILL_AT + 4.5, 1.5, 16)
  return out
}
const KILL_POS = mustang(KILL_AT, new Vector3())
const KILL_VEL = mustang(KILL_AT + 0.05, new Vector3()).sub(mustang(KILL_AT - 0.05, new Vector3())).multiplyScalar(10)

const DOGFIGHT_CUTS: readonly Cut[] = [
  {
    from: 0, subject: 0,
    camera(t, out) {
      // 從兩架的右後上方：109 在近處、野馬在它前方，兩架排在同一條視線上。
      // 架在側面的話兩架橫著攤開，主角讓到右邊之後後面那一架會落到選單後面
      body(messerschmitt, t, 26, 13, 42, true, out.position)
      mustang(t, S1)
      messerschmitt(t, S2)
      out.target.copy(S1).lerp(S2, 0.3)
      out.fov = 46
    },
  },
  {
    from: 6, subject: 0,
    camera(t, out) {
      body(messerschmitt, t, 1.1, 2.0, 7, false, out.position)
      mustang(t, out.target)
      bodyUp(messerschmitt, t, out.up)
      out.fov = 40
    },
  },
  {
    from: 12, subject: 0,
    camera(t, out) {
      // 擊墜之後鏡頭照原速再飛 1 秒才切 —— 殘骸帶著 135 m/s 往鏡頭衝，鏡頭一停就穿過去
      body(mustang, Math.min(t, KILL_AT), -16, 5, -55 - DOGFIGHT_SPEED * Math.max(0, t - KILL_AT), true, out.position)
      mustang(Math.min(t, KILL_AT), out.target)
      if (t > KILL_AT) wreckAt(KILL_POS, KILL_VEL, t - KILL_AT, out.target)
      out.fov = 46
    },
  },
  {
    from: 20.2, subject: null,
    camera(t, out) {
      // 跟著殘骸一起往下掉，一直在它左後上方約 130 m；最後停在海面上看它落海。
      // 架在海面上仰拍的話，前幾秒殘骸還在 400 m 高，畫面只剩天空
      wreckAt(KILL_POS, KILL_VEL, t - KILL_AT, out.target)
      out.position.set(out.target.x - 110, Math.max(15, out.target.y + 35), out.target.z + 60)
      out.fov = 42
    },
  },
]

const DOGFIGHT: Shot = {
  id: 'dogfight',
  duration: 32,
  timeOfDay: 'noon',
  captionKey: 'reel.dogfight',
  faceSun: false,
  clear: { x: 0, z: -2200, radius: 3000 },
  planes: [
    { spec: P51D, path: mustang },
    { spec: BF109K4, path: messerschmitt },
  ],
  ships: [],
  cuts: DOGFIGHT_CUTS,
  camera: edit(DOGFIGHT_CUTS),
  events: [
    { at: 6.2, kind: 'burst', actor: 1, seconds: 0.8 },
    { at: 12.2, kind: 'burst', actor: 1, seconds: 0.8 },
    { at: 12.8, kind: 'smoke', actor: 0 },
    { at: 18.4, kind: 'burst', actor: 1, seconds: 0.7 },
    { at: KILL_AT, kind: 'kill', actor: 0, blast: true },
  ],
}

// ── 4. 雷擊 ───────────────────────────────────────────────
//
// 黃昏、迎著落日。三架一式陸攻貼海面 30 m 進場，巡洋艦與驅逐艦橫過前方、全艦開火。
//   0–7    長機右前方的貼身跟拍，海面往後飛
//   7–14   巡洋艦舷外的海面上：陸攻迎面衝來，右翼那一架 12.5 秒落海
//   14–21  長機後上方，拉起越過巡洋艦的桅杆
//   21–30  海面上的固定機位：剩下兩架爬升飛向夕陽

const STRIKE_SPEED = 95
const STRIKE_ALT = 30
const strikeLead: Path = (t, out) => {
  out.set(0, STRIKE_ALT + 1.0 * Math.sin(0.9 * t), -STRIKE_SPEED * t)
  // 15 秒起拉起，21 秒後以約 23° 的爬升角穩住
  out.y += rampedOffset(t, 15, 2, 10) - rampedOffset(t, 19, 2, 10)
  return out
}
const STRIKE_HIT = 2
const WICHITA: ReelShip = { cls: 'wichita', x: -100, z: -1900, heading: -Math.PI / 2, speed: 8 }
const strikeCentre: Path = (t, out) => strikeLead(t, out).add(S3.set(0, 20, -180))

const STRIKE_CUTS: readonly Cut[] = [
  {
    from: 0, subject: 0,
    camera(t, out) {
      // 右前方斜看回來：機首、兩具發動機與座艙都在畫面裡，機身往後收進畫面深處。
      // 正側面的話機尾會伸進左邊的選單後面
      body(strikeLead, t, 24, 3, -26, true, out.position)
      body(strikeLead, t, 0, 0, 4, true, out.target)
      out.fov = 44
    },
  },
  {
    from: 7, subject: 0,
    camera(t, out) {
      shipAt(WICHITA, t, S1)
      out.position.set(S1.x + 30, 12, S1.z + 60)
      strikeLead(t, out.target)
      // 望遠：陸攻還在七八百公尺外，壓縮之後三架與周圍的黑雲擠在一起
      out.fov = 20
    },
  },
  {
    from: 14, subject: 0,
    camera(t, out) {
      body(strikeLead, t - 0.2, 8, 7, 42, true, out.position)
      body(strikeLead, t, 0, -4, -150, true, out.target)
      out.fov = 55
    },
  },
  {
    from: 21, subject: 0,
    camera(t, out) {
      shipAt(WICHITA, 21, S1)
      out.position.set(S1.x + 140, 14, S1.z + 260)
      strikeLead(t, out.target)
      out.fov = 40
    },
  },
]

const STRIKE: Shot = {
  id: 'strike',
  duration: 30,
  timeOfDay: 'dusk',
  captionKey: 'reel.strike',
  faceSun: true,
  clear: { x: 0, z: -1500, radius: 3000 },
  planes: [
    { spec: G4M, path: strikeLead },
    { spec: G4M, path: wingman(strikeLead, -55, 2, 60, 0.7) },
    { spec: G4M, path: wingman(strikeLead, 55, -1, 60, 2.2) },
  ],
  ships: [
    // 往 +X 開，橫過陸攻的航線
    WICHITA,
    { cls: 'fletcher', x: -700, z: -2350, heading: -Math.PI / 2, speed: 8 },
  ],
  cuts: STRIKE_CUTS,
  camera: edit(STRIKE_CUTS),
  events: timeline([
    ...barrage(211, 4, 19, 2, strikeCentre, { x: 200, yLo: -10, yHi: 110, z: 200 }, edit(STRIKE_CUTS), 80),
    { at: 6, kind: 'aa', ship: 0, actor: 0, seconds: 13, miss: 35 },
    { at: 7.5, kind: 'aa', ship: 1, actor: 1, seconds: 10, miss: 45 },
    { at: 10, kind: 'smoke', actor: STRIKE_HIT },
    { at: 12.5, kind: 'kill', actor: STRIKE_HIT, blast: false },
  ]),
}

// ── 5. 歸航 ───────────────────────────────────────────────
//
// 黃昏，三架貼著海面 40 m 往夕陽飛。
//   0–7    長機右側的貼身跟拍，夕陽在機首前方
//   7–14   僚機飛行員的肩後看長機，地平線跟著機身歪
//   14–22  海面上的固定機位：三架從頭頂掠過，鏡頭轉身目送
//   22–30  長機後方，三架飛進夕陽

const HOME_SPEED = 110
const homeLead: Path = (t, out) => out.set(0, 40 + 1.5 * Math.sin(0.6 * t), 1870 - HOME_SPEED * t)
const homeWing = wingman(homeLead, -32, 3, 26, 0.5)

const HOME_CUTS: readonly Cut[] = [
  {
    from: 0, subject: 0,
    camera(t, out) {
      body(homeLead, t, 13, 2, 5, true, out.position)
      body(homeLead, t, 0, 0.5, -3, true, out.target)
      out.fov = 44
    },
  },
  {
    from: 7, subject: 0,
    camera(t, out) {
      body(homeWing, t, 0.9, 1.9, 6.5, false, out.position)
      homeLead(t, out.target)
      bodyUp(homeWing, t, out.up)
      out.fov = 42
    },
  },
  {
    from: 14, subject: 0,
    camera(t, out) {
      out.position.set(70, 18, -40)
      homeLead(t, S1)
      out.target.set(S1.x, S1.y - 4, S1.z)
      out.fov = 45
    },
  },
  {
    from: 22, subject: 0,
    camera(t, out) {
      body(homeLead, t - 0.2, 10, 6, 60, true, out.position)
      body(homeLead, t, 0, -2, -200, true, out.target)
      out.fov = 42
    },
  },
]

/** 歸航那一段飛疾風或零戰，每次進主選單抽一次 */
function homeShot(spec: AircraftSpec): Shot {
  return {
    id: 'home',
    duration: 30,
    timeOfDay: 'dusk',
    captionKey: spec === KI84 ? 'reel.homeKi84' : 'reel.homeA6m5',
    faceSun: true,
    clear: { x: 0, z: 220, radius: 2600 },
    planes: [
      { spec, path: homeLead },
      { spec, path: homeWing },
      { spec, path: wingman(homeLead, 34, -2, 30, 1.9), extra: true },
    ],
    ships: [],
    cuts: HOME_CUTS,
    camera: edit(HOME_CUTS),
    events: [],
  }
}

/**
 * 一輪的分鏡。`pick` 是 0～1 的抽籤值，決定歸航那一段飛哪一台。
 */
export function reelShots(pick: number): readonly Shot[] {
  return [FLEET, STREAM, DOGFIGHT, STRIKE, homeShot(pick < 0.5 ? KI84 : A6M5)]
}
