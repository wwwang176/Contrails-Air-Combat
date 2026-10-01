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
import type { Path } from './reelFlight'

/**
 * 主選單短片的分鏡。**每一段都是資料加純函數**：演員的路徑、鏡頭、事件表。
 *
 * 座標是這一段自己的局部座標（公尺，y 是離海面的高度）。執行時整段平移到一塊
 * 開闊的海上，`faceSun` 的段再繞 Y 轉到局部 −Z 朝太陽的方位。
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
  /** 垂直視角，度 */
  fov: number
}

export function createReelCamera(): ReelCamera {
  return { position: new Vector3(), target: new Vector3(), fov: 50 }
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
  camera(t: number, out: ReelCamera): void
  /** 依 `at` 排序 */
  readonly events: readonly ReelEvent[]
  /** 主角與它必須在畫面裡的時間窗。測試守這一條 */
  readonly hero: { readonly actor: number, readonly from: number, readonly to: number }
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

/** 0 → 1 的 smoothstep，`u` 夾在 [0, 1] */
function smooth(u: number): number {
  const v = u <= 0 ? 0 : u >= 1 ? 1 : u
  return v * v * (3 - 2 * v)
}

/**
 * 鏡頭剎停：`t` 過了 `t0` 之後，鏡頭讀的時間以 `tau` 為時間常數趨近
 * `t0 + tau`。路徑跟著它走，鏡頭就是平順地慢下來停住，不是急煞。
 */
function glide(t: number, t0: number, tau: number): number {
  return t <= t0 ? t : t0 + tau * (1 - Math.exp(-(t - t0) / tau))
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

/**
 * 一串高砲黑雲：`from`～`to` 秒、平均每秒 `rate` 朵，落在 `centre(t)` 周圍的盒子裡。
 * 離鏡頭不到 `minCam` 公尺的不放 —— 黑雲貼在鏡頭上是一整片黑。
 */
function barrage(
  seed: number, from: number, to: number, rate: number,
  centre: Path, half: { x: number, yLo: number, yHi: number, z: number },
  camera: (t: number, out: ReelCamera) => void, minCam: number,
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
// 拂曉。航艦、巡洋艦與兩艘驅逐艦往太陽開；鏡頭貼在右舷外的海面上，望遠鏡頭
// 把艦隊壓扁成一排。中段四架地獄貓從鏡頭後方低空掠過、飛越航艦後左轉。

const FLEET_SPEED = 9
const fleetCamera = (t: number, out: ReelCamera): void => {
  out.position.set(760 - 5 * t, 12, 640 - 7.6 * t)
  // 看航艦艦橋一帶，略往前帶一點
  out.target.set(0, 22, -FLEET_SPEED * t - 60)
  out.fov = 30
}
const hellcatLead: Path = (t, out) => {
  // 第 13 秒從鏡頭左上方 43 m 掠過，第 21 秒飛越航艦上空，22～28 秒左轉
  const cx = 760 - 5 * 13 - 40
  const cz = 640 - 7.6 * 13
  const ex = 0
  const ez = -FLEET_SPEED * 21 - 120
  const s = (t - 13) / 8
  out.set(cx + (ex - cx) * s, 55, cz + (ez - cz) * s)
  // 加速度都是「加上去再收回來」，坡度與爬升角才會停在一個值，不會一路翻下去
  out.y += rampedOffset(t, 13, 3, 4) - rampedOffset(t, 19, 3, 4)
  out.x -= rampedOffset(t, 22, 2.5, 14) - rampedOffset(t, 26, 2.5, 14)
  return out
}

const FLEET: Shot = {
  id: 'fleet',
  duration: 34,
  timeOfDay: 'dawn',
  captionKey: 'reel.fleet',
  faceSun: true,
  clear: { x: 0, z: -300, radius: 3000 },
  planes: [
    { spec: F6F5, path: hellcatLead },
    { spec: F6F5, path: wingman(hellcatLead, -18, -2, 14, 0.4) },
    { spec: F6F5, path: wingman(hellcatLead, 30, 1, 20, 1.3), extra: true },
    { spec: F6F5, path: wingman(hellcatLead, 48, -1, 34, 2.1), extra: true },
  ],
  ships: [
    { cls: 'essex', x: 0, z: 0, heading: 0, speed: FLEET_SPEED },
    { cls: 'fletcher', x: -420, z: -380, heading: 0, speed: FLEET_SPEED },
    { cls: 'wichita', x: -380, z: 420, heading: 0, speed: FLEET_SPEED },
    { cls: 'fletcher', x: 300, z: -760, heading: 0, speed: FLEET_SPEED },
  ],
  camera: fleetCamera,
  events: [],
  hero: { actor: 0, from: 14, to: 22 },
}

// ── 2. 轟炸機流 ───────────────────────────────────────────
//
// 正午、1,500 m。兩組三機的空中堡壘，兩架野馬在上方左右蛇行。鏡頭在編隊左下方
// 跟著飛，從後面那一組慢慢推到長機。第 6 秒起高砲在四周炸開；後組左翼那一架
// 第 16 秒中彈冒煙，第 23 秒掉隊往左下滑，第 27 秒交給殘骸池。

const STREAM_SPEED = 75
const STREAM_ALT = 1500
const streamLead: Path = (t, out) => out.set(0, STREAM_ALT, -STREAM_SPEED * t)
const STREAM_HIT = 4
const streamCamera = (t: number, out: ReelCamera): void => {
  streamLead(t, S1)
  const s = smooth(t / 34)
  // 一直待在整個編隊的左後下方，只往前推一點；注視點從後組慢慢移到長機
  out.position.set(S1.x - 230 + 40 * s, S1.y - 80 + 25 * s, S1.z + 330 - 160 * s)
  out.target.set(S1.x - 50 + 30 * s, S1.y - 30 + 20 * s, S1.z + 110 - 80 * s)
  out.fov = 40
}
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
  camera: streamCamera,
  events: timeline([
    ...barrage(101, 6, 30, 1.4, (t, out) => streamLead(t, out).add(S3.set(-40, -20, 90)),
      { x: 170, yLo: -70, yHi: 90, z: 220 }, streamCamera, 90),
    { at: 16, kind: 'smoke', actor: STREAM_HIT },
    { at: 27, kind: 'kill', actor: STREAM_HIT, blast: false },
  ]),
  hero: { actor: 0, from: 0, to: 34 },
}

// ── 3. 纏鬥 ───────────────────────────────────────────────
//
// 正午、450 m。野馬左右急轉想甩掉咬在後面 0.75 秒的 109；鏡頭在 109 的右肩後方。
// 三段連射都排在野馬的轉向換邊那一刻（航跡最直、瞄得最準）：第一段打空、
// 第二段打中冒煙、第三段擊墜。109 穿過爆炸後拉起右轉，鏡頭剎停目送殘骸落海。

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
/** 鏡頭的時間在擊墜後 0.5 秒開始剎停 */
const DOGFIGHT_BRAKE = KILL_AT + 0.5
const dogfightCamera = (t: number, out: ReelCamera): void => {
  const tc = glide(t, DOGFIGHT_BRAKE, 1.4)
  messerschmitt(tc - 0.12, S1)
  out.position.set(S1.x + 8, S1.y + 3.5, S1.z + 20)
  // 擊墜前看兩架之間偏野馬那一點；之後轉去看殘骸
  messerschmitt(tc, S1)
  mustang(Math.min(tc, KILL_AT), S2)
  S1.lerp(S2, 0.65)
  wreckAt(KILL_POS, KILL_VEL, Math.max(0, t - KILL_AT), S3)
  out.target.copy(S1).lerp(S3, smooth((t - KILL_AT - 0.3) / 2.5))
  out.fov = 55
}

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
  camera: dogfightCamera,
  events: [
    { at: 5.9, kind: 'burst', actor: 1, seconds: 0.8 },
    { at: 12.2, kind: 'burst', actor: 1, seconds: 0.8 },
    { at: 12.8, kind: 'smoke', actor: 0 },
    { at: 18.4, kind: 'burst', actor: 1, seconds: 0.7 },
    { at: KILL_AT, kind: 'kill', actor: 0, blast: true },
  ],
  hero: { actor: 0, from: 1, to: KILL_AT },
}

// ── 4. 雷擊 ───────────────────────────────────────────────
//
// 黃昏、迎著落日。三架一式陸攻貼海面 30 m 進場，巡洋艦與驅逐艦橫過前方、
// 全艦開火。右翼那一架第 10 秒中彈冒煙、12.5 秒落海。剩下兩架在艦前拉起越過
// 桅杆；鏡頭在長機右後方低空跟著，越過巡洋艦後剎停。

const STRIKE_SPEED = 95
const STRIKE_ALT = 30
const strikeLead: Path = (t, out) => {
  out.set(0, STRIKE_ALT + 1.0 * Math.sin(0.9 * t), -STRIKE_SPEED * t)
  // 15 秒起拉起，21 秒後以約 23° 的爬升角穩住
  out.y += rampedOffset(t, 15, 2, 10) - rampedOffset(t, 19, 2, 10)
  return out
}
const STRIKE_HIT = 2
const strikeCamera = (t: number, out: ReelCamera): void => {
  const tc = glide(t, 21.5, 1.6)
  // 三架都在畫面裡：鏡頭在整組的正後方 220 m、略高
  strikeLead(tc - 0.4, S1)
  out.position.set(S1.x + 15, Math.max(8, S1.y + 4), S1.z + 220)
  strikeLead(tc, S2)
  out.target.set(S2.x - 5, S2.y - 2, S2.z - 300)
  out.fov = 42
}
const strikeCentre: Path = (t, out) => strikeLead(t, out).add(S3.set(0, 20, -280))

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
    { cls: 'wichita', x: -100, z: -1900, heading: -Math.PI / 2, speed: 8 },
    { cls: 'fletcher', x: -700, z: -2350, heading: -Math.PI / 2, speed: 8 },
  ],
  camera: strikeCamera,
  events: timeline([
    ...barrage(211, 4, 19, 2, strikeCentre, { x: 220, yLo: -15, yHi: 110, z: 240 }, strikeCamera, 120),
    { at: 6, kind: 'aa', ship: 0, actor: 0, seconds: 13, miss: 35 },
    { at: 7.5, kind: 'aa', ship: 1, actor: 1, seconds: 10, miss: 45 },
    { at: 10, kind: 'smoke', actor: STRIKE_HIT },
    { at: 12.5, kind: 'kill', actor: STRIKE_HIT, blast: false },
  ]),
  hero: { actor: 0, from: 0, to: 21 },
}

// ── 5. 歸航 ───────────────────────────────────────────────
//
// 黃昏。三架貼著海面 40 m 往夕陽飛。鏡頭架在海面上 25 m、航線右側 120 m：
// 先迎著它們來（逆光在鏡頭背後，機身是金色的），從頭頂掠過後轉身目送它們飛進夕陽。

const HOME_SPEED = 110
const homeLead: Path = (t, out) => out.set(0, 40 + 1.5 * Math.sin(0.6 * t), 1000 - HOME_SPEED * t)
const homeCamera = (t: number, out: ReelCamera): void => {
  // 【鏡頭不能再低】海面網格在鏡頭前是幾十公尺一格的平面，貼得太低時一格一格的
  // 反光看得出是方塊
  out.position.set(120, 25, 0)
  homeLead(t, S1)
  out.target.set(S1.x, S1.y - 10, S1.z)
  out.fov = 40
}

/** 歸航那一段飛疾風或零戰，每次進主選單抽一次 */
function homeShot(spec: AircraftSpec): Shot {
  return {
    id: 'home',
    duration: 30,
    timeOfDay: 'dusk',
    captionKey: spec === KI84 ? 'reel.homeKi84' : 'reel.homeA6m5',
    faceSun: true,
    clear: { x: 0, z: -600, radius: 2600 },
    planes: [
      { spec, path: homeLead },
      { spec, path: wingman(homeLead, -32, 3, 26, 0.5) },
      { spec, path: wingman(homeLead, 34, -2, 30, 1.9), extra: true },
    ],
    ships: [],
    camera: homeCamera,
    events: [],
    hero: { actor: 0, from: 2, to: 28 },
  }
}

/**
 * 一輪的分鏡。`pick` 是 0～1 的抽籤值，決定歸航那一段飛哪一台。
 */
export function reelShots(pick: number): readonly Shot[] {
  return [FLEET, STREAM, DOGFIGHT, STRIKE, homeShot(pick < 0.5 ? KI84 : A6M5)]
}
