import { Vector3 } from 'three'
import type { AircraftSpec } from '../../specs/types'
import type { TimeOfDay } from '../../world/timeOfDay'
import type { ShipClassId } from '../../world/ships'
import type { GroundUnitId } from '../../render/geometry/ground'
import type { DecorKind } from '../../render/geometry/ground/plantDecor'
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

export type { Path, GroundUnitId }

export interface ReelPlane {
  readonly spec: AircraftSpec
  readonly path: Path
  /** 配角：觸控裝置上不出場 */
  readonly extra?: boolean
}

/**
 * 地上的物件：油廠的油槽／冷卻塔／鍋爐房、機場停放的飛機與油桶堆、高砲陣地、火車、
 * 戰車卡車……（`GroundUnitId`，模型開場就載好了）。局部座標，執行時落在地形上；
 * `heading` 與船同一個約定。**只放在陸地上** —— `'island'` 的段測試會查。
 * 炸彈落在它旁邊（命中盒外擴 15 m）就炸毀：換殘骸、爆一團、起火；也可以用 `destroy` 事件指定
 */
export interface ReelProp {
  readonly id: GroundUnitId
  readonly x: number
  readonly z: number
  readonly heading: number
  /**
   * 往前開的速度，m/s（省略 = 停著）。方向與船同一個約定 (−sin h, 0, −cos h)，
   * 位置是 `propAt`。**炸毀就停在那一點** —— 瞄炸彈要用落地那一刻的 `propAt`
   */
  readonly speed?: number
  /**
   * 從第 `brake.at` 秒起踩煞車，`brake.seconds` 秒內平順停住（速度照 smoothstep 降到 0），
   * 之後停在原地。省略 = 一直開
   */
  readonly brake?: { readonly at: number, readonly seconds: number }
}

/**
 * 開了多遠，m：等速 `speed` 開到 `brake.at`，之後 `brake.seconds` 秒內煞停（多開
 * `speed · seconds / 2`）。放映機與 `propAt` 都用它 —— 兩邊不一致的話炸彈會炸空
 */
export function propTravel(p: ReelProp, t: number): number {
  const s = p.speed ?? 0
  if (p.brake === undefined || t <= p.brake.at) return s * t
  const d = Math.max(1e-6, p.brake.seconds)
  const u = Math.min(1, (t - p.brake.at) / d)
  return s * p.brake.at + s * d * (u - u * u * u + u * u * u * u / 2)
}

/** 地面物件在第 `t` 秒的速度，m/s（煞車時照 smoothstep 降到 0） */
export function propSpeedAt(p: ReelProp, t: number): number {
  const s = p.speed ?? 0
  if (p.brake === undefined || t <= p.brake.at) return s
  const u = Math.min(1, (t - p.brake.at) / Math.max(1e-6, p.brake.seconds))
  return s * (1 - u * u * (3 - 2 * u))
}

/** 地面物件在第 `t` 秒的位置（局部座標，y = 0；還沒炸毀的話） */
export function propAt(p: ReelProp, t: number, out: Vector3): Vector3 {
  const d = propTravel(p, t)
  return out.set(p.x - Math.sin(p.heading) * d, 0, p.z - Math.cos(p.heading) * d)
}

/**
 * 佈景建築（廠房、倉庫、辦公樓、管架、小槽組）：**不是目標、沒有命中盒**，整批合併成
 * 一顆網格，所以件數可以上百。局部座標，落在地形上；`heading` 與 `ReelProp` 同一個約定。
 * 尺寸省略時用 `DECOR_DEFAULT`（`pipeRack` 的 `d` 是長度）。炸彈落在它旁邊會燒黑起火
 */
export interface ReelDecor {
  readonly kind: DecorKind
  readonly x: number
  readonly z: number
  readonly heading: number
  readonly w?: number
  readonly d?: number
  readonly h?: number
}

/** 短片可以用的地形 */
export type ReelTerrainKind = 'archipelago' | 'farmland' | 'autumnFarmland'

/** 局部座標的軸對齊矩形，m */
export interface ReelRect {
  readonly x0: number
  readonly z0: number
  readonly x1: number
  readonly z1: number
}

/** 局部座標的一點 */
export interface ReelPoint {
  readonly x: number
  readonly z: number
}

/** 地上畫的廠區，見 `Shot.ground`。顏色是 0xRRGGBB */
export interface ReelGround {
  /** 水泥墊面 */
  readonly pad: ReelRect
  /** 壓在墊面上的鋪面：調車場的碴石、空地的裸土 */
  readonly patches?: readonly (ReelRect & { readonly hex: number })[]
  /** 墊面外一圈不長樹，m */
  readonly treeClear?: number
  /** 道路折線；一路延伸出去的話端點拉遠一點，畫面上才不會斷在田中間 */
  readonly roads?: readonly (readonly ReelPoint[])[]
  readonly roadWidth?: number
  /** 鐵路折線（碴石帶） */
  readonly rails?: readonly (readonly ReelPoint[])[]
  readonly railWidth?: number
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
  /**
   * 這一架的固定機槍連射 `seconds` 秒。**曳光一律沿機槍的實際方向打出去，放映機不修正。**
   * `target` 宣告這一段連射要打中哪一架：`reel-shots.test.ts` 要求開火的每一刻，機首正前方
   * 那條線都穿過目標的機身（離目標中心不超過它半翼展的三分之一、目標在前方）—— 要打中就得把
   * 飛機飛到正確的射擊位置上，不是讓彈道去轉彎
   */
  | {
    readonly at: number, readonly kind: 'burst', readonly actor: number, readonly seconds: number,
    readonly target?: number
  }
  /**
   * 這一架開始拖煙，到被擊落或這一段結束。`engine` 是第幾具發動機冒（預設第一具）；
   * `fire` 同時冒火 —— 發動機起火的近景要它，只有煙的話看不出是在燒
   */
  | {
    readonly at: number, readonly kind: 'smoke', readonly actor: number,
    readonly engine?: number, readonly fire?: boolean
  }
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
  /**
   * 這一架投一串炸彈：`count` 枚、每隔 `interval` 秒一枚。落到地面或海面就爆
   * （陸上揚土起火、海上掀水柱）。彈道是 `bombAt`
   */
  | {
    readonly at: number, readonly kind: 'bomb', readonly actor: number,
    readonly count: number, readonly interval: number
  }
  /**
   * 這一架投一枚魚雷，入水後朝 `aim`（局部座標的海面一點）直跑。`hit` = 跑到那一點時
   * 炸起水柱（打中船）；否則就是跑過去。軌跡是 `torpedoAt`，`interceptShip` 算得出瞄點
   */
  | {
    readonly at: number, readonly kind: 'torpedo', readonly actor: number,
    readonly aim: { readonly x: number, readonly z: number }, readonly hit: boolean
  }
  /**
   * 第 `prop` 個地面物件朝這一架打機槍曳光 `seconds` 秒：從車頂上方隨機一點、朝目標的
   * 前置點打，瞄點偏開 `miss` 公尺。跟著車走，車炸毀就停
   */
  | {
    readonly at: number, readonly kind: 'groundFire', readonly prop: number, readonly actor: number,
    readonly seconds: number, readonly miss: number
  }
  /** 第 `prop` 個地面物件在這一刻炸毀（換殘骸、爆一團、起火） */
  | { readonly at: number, readonly kind: 'destroy', readonly prop: number }
  /**
   * 導演指定的一團爆炸：局部座標 (x, z)、離地 `y` m，`size` 是相對一枚炸彈的線性倍率
   * （1 = 一枚炸彈的火球，3 = 三倍直徑）。陸上的配方，帶閃光、碎片、火星與 `size` 處地面火。
   * 二次爆炸、油槽殉爆這種「比炸彈還大」的畫面用它；不會炸毀任何物件（要炸毀用 `destroy`）
   */
  | {
    readonly at: number, readonly kind: 'blast',
    readonly x: number, readonly y: number, readonly z: number, readonly size: number
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
  /**
   * 鏡頭架在第幾台地面物件上（車斗、砲塔後方）。測試對這一刀要求離地 1 m 以上、
   * 離那台車（`propAt`）不超過 20 m、不在它的命中盒裡
   */
  readonly groundMount?: number
  readonly camera: CameraFn
}

/**
 * 變速的一段：片內時間 `from`～`to` 秒用 `rate` 倍速播放（0.3 = 慢動作），進出各花 `ease`
 * 秒平順過渡（落在 `from`～`to` 裡面）。**路徑、鏡頭、事件都照片內時間寫**，變速只改片內
 * 時間走多快，所以慢動作裡的手持晃動、煙、火也一起慢
 */
export interface SpeedRamp {
  readonly from: number
  readonly to: number
  readonly rate: number
  readonly ease: number
}

/** 片內時間 `t` 的播放倍速（沒有落在任何一段裡就是 1） */
export function speedAt(ramps: readonly SpeedRamp[] | undefined, t: number): number {
  if (ramps === undefined) return 1
  for (const r of ramps) {
    if (t <= r.from || t >= r.to) continue
    const e = Math.max(1e-6, r.ease)
    const into = Math.min(1, (t - r.from) / e, (r.to - t) / e)
    const k = into * into * (3 - 2 * into)
    return 1 + (r.rate - 1) * k
  }
  return 1
}

/**
 * 跳接：片內時間走到 `from` 秒時直接跳到 `to` 秒，中間那一段不播 —— 剪接時把「炸彈往下掉
 * 的幾秒」這種等待剪掉。路徑、鏡頭、事件照樣照片內時間寫：跳過去的那段裡的事件在跳的那一刻
 * 一次補放，地面物件、炸彈直接出現在 `to` 那一刻的位置。共用特效池（曳光、拖煙、白線、
 * 高砲黑雲）在跳的那一刻清空
 * 【要配一刀切換】跳的那一刻畫面上的東西整批換位置；`from` 要落在剪接點上，否則同一個鏡頭
 * 裡東西憑空瞬移
 * 【不能跳過炸彈落地】炸彈照時間算位置，跳過落地那一刻的話它在地底下才被看到，炸點偏掉
 */
export interface TimeJump {
  readonly from: number
  readonly to: number
}

/** 片內時間 `t` 落在哪一段跳接裡（`from` ≤ t < `to`）；沒有就是 `undefined` */
export function jumpAt(jumps: readonly TimeJump[] | undefined, t: number): TimeJump | undefined {
  if (jumps === undefined) return undefined
  for (const j of jumps) if (t >= j.from && t < j.to) return j
  return undefined
}

export interface Shot {
  readonly id: string
  /** 秒（片內時間；有變速的段，實際播放比這個長或短） */
  readonly duration: number
  /** 變速（省略 = 全段等速）。見 `SpeedRamp` */
  readonly speed?: readonly SpeedRamp[]
  /** 跳接（省略 = 不跳）。見 `TimeJump` */
  readonly jumps?: readonly TimeJump[]
  readonly timeOfDay: TimeOfDay
  /** 局部 −Z 轉到太陽的水平方位 */
  readonly faceSun: boolean
  /**
   * 取景在哪：`'sea'`（預設）找一塊開闊的海；`'island'` 把局部原點放在群島最大那座島
   * （`pickIsland`）的島心，局部座標就是相對島心 —— 轟炸島上目標的段用它。
   * 島的地形高度由 `createArchipelago()` 的 `field.sample` 給，測試照它查鏡頭與飛機離地多高
   */
  readonly site?: 'sea' | 'island'
  /**
   * 這一段用哪一張地形。省略 = 群島（`'archipelago'`）。內陸的段給 `'farmland'`（夏季）或
   * `'autumnFarmland'`（晚秋，配 `novemberNoon`）：兩張是同一個高度場、只有色盤不同。
   * 換景的暗場裡重建地形（約半秒到一秒，藏在黑畫面裡），`clear` 圓躲的是那張地形的山丘
   */
  readonly terrain?: ReelTerrainKind
  /**
   * 地上畫一塊廠區（只有農地的段用得到）：水泥墊面、碴石／裸土的鋪面、道路、
   * 鐵路，墊面外一圈不長樹。全部是**局部座標**，執行時跟著原點與 `yaw` 轉到世界。
   * 它是地形著色器畫的，不是模型 —— 換地形的暗場裡一起建好
   */
  readonly ground?: ReelGround
  /**
   * 整段動作落在哪一個圓裡（局部座標的圓心、半徑 m）。`'sea'` 的段，執行時這個圓整個
   * 要是開闊的海 —— 只看原點的話，一路往前飛四公里的纏鬥會把殘骸丟在島上。
   * `'island'` 的段不檢查有沒有島（本來就在島上）
   */
  readonly clear: { readonly x: number, readonly z: number, readonly radius: number }
  readonly planes: readonly ReelPlane[]
  readonly ships: readonly ReelShip[]
  /** 地上的物件（省略 = 沒有）。見 `ReelProp` */
  readonly props?: readonly ReelProp[]
  /** 地上的佈景建築（省略 = 沒有）。見 `ReelDecor` */
  readonly decor?: readonly ReelDecor[]
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

/**
 * 線性阻力加重力的拋體，從 `p`、`v` 出發 `tau` 秒後在哪（解析解）。`terminal` 是終端速度。
 * 不夾在地面 —— 呼叫端自己判斷落地。
 */
export function ballisticAt(
  p: Vector3, v: Vector3, tau: number, terminal: number, out: Vector3,
): Vector3 {
  const k = 9.81 / terminal
  const e = (1 - Math.exp(-k * tau)) / k
  return out.set(
    p.x + v.x * e,
    p.y - terminal * tau + (v.y + terminal) * e,
    p.z + v.z * e,
  )
}

/**
 * 殘骸交出去 `tau` 秒後在哪。`render/wrecks.ts` 的積分是線性阻力加重力，
 * 這是它的解析解 —— 鏡頭拿它追殘骸，不必讀殘骸池的狀態。
 * `p`、`v` 是交出去那一刻的位置與速度（`velocityAt` 算得出來）。
 */
export function wreckAt(p: Vector3, v: Vector3, tau: number, out: Vector3): Vector3 {
  ballisticAt(p, v, tau, WRECK_TERMINAL, out)
  if (out.y < 0) out.y = 0
  return out
}

/** 炸彈的終端速度，m/s。短片裡的炸彈走 `bombAt`，不走遊戲的二次阻力 */
export const BOMB_TERMINAL = 260
/** 炸彈從機腹哪裡掉出來：機體座標 */
export const BOMB_RELEASE_Y = -1.5

/** 投下 `tau` 秒後的炸彈位置。`p`、`v` 是投下那一刻（機腹的點與飛機的速度） */
export function bombAt(p: Vector3, v: Vector3, tau: number, out: Vector3): Vector3 {
  return ballisticAt(p, v, tau, BOMB_TERMINAL, out)
}

/** 魚雷在空中的終端速度（幾乎不受阻），水中的航速 m/s，跑的深度 m */
const TORPEDO_AIR_TERMINAL = 400
export const TORPEDO_SPEED = 22
export const TORPEDO_DEPTH = -1

const ENTRY = new Vector3()

/** 魚雷投下後幾秒入水：空中那一段的 y 降到 0 的時刻（二分法） */
export function torpedoEntry(p: Vector3, v: Vector3): number {
  let lo = 0
  let hi = 30
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    if (ballisticAt(p, v, mid, TORPEDO_AIR_TERMINAL, ENTRY).y > 0) lo = mid
    else hi = mid
  }
  return hi
}

/**
 * 魚雷投下 `tau` 秒後在哪，寫進 `out`。回傳階段：0 空中、1 水中、2 已經跑到 `aim`。
 * 入水之後朝 `aim` 直線跑，深度 `TORPEDO_DEPTH`、航速 `TORPEDO_SPEED`。
 * `entry` 是 `torpedoEntry(p, v)` —— 呼叫端算一次存著，不要每幀二分。
 */
export function torpedoAt(
  p: Vector3, v: Vector3, entry: number, aim: { readonly x: number, readonly z: number },
  tau: number, out: Vector3,
): 0 | 1 | 2 {
  if (tau < entry) {
    ballisticAt(p, v, tau, TORPEDO_AIR_TERMINAL, out)
    return 0
  }
  ballisticAt(p, v, entry, TORPEDO_AIR_TERMINAL, ENTRY)
  const dx = aim.x - ENTRY.x
  const dz = aim.z - ENTRY.z
  const len = Math.hypot(dx, dz)
  const run = (tau - entry) * TORPEDO_SPEED
  if (len < 1e-6 || run >= len) {
    out.set(aim.x, TORPEDO_DEPTH, aim.z)
    return 2
  }
  return (out.set(ENTRY.x + (dx / len) * run, TORPEDO_DEPTH, ENTRY.z + (dz / len) * run), 1)
}

/**
 * 魚雷要瞄哪一點才會跟船撞上：從 `from`（入水點）、`t0`（入水的秒數）出發，
 * 照船的航速與魚雷航速解前置點，寫進 `out`（y = 0）。疊代幾次就收斂
 */
export function interceptShip(s: ReelShip, from: Vector3, t0: number, out: Vector3): Vector3 {
  shipAt(s, t0, out)
  for (let k = 0; k < 8; k++) {
    const run = Math.hypot(out.x - from.x, out.z - from.z) / TORPEDO_SPEED
    shipAt(s, t0 + run, out)
  }
  return out
}

/**
 * `'island'` 的段把原點放在哪一座島：群島裡最大的那一座。執行時與測試都用這一支，
 * 兩邊才是同一座
 */
export function pickIsland<T extends { readonly outerRadius: number }>(islands: readonly T[]): T | null {
  let best: T | null = null
  for (const s of islands) if (best === null || s.outerRadius > best.outerRadius) best = s
  return best
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
