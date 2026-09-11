import { Euler, Group, type PerspectiveCamera, Quaternion, type Scene, Vector3 } from 'three'
import { buildAircraft, type AircraftModel } from '../render/geometry/buildAircraft'
import { createTracers, type Tracers } from '../render/tracers'
import { createMuzzles, type MuzzleSource, type Muzzles } from '../render/muzzle'
import { createBombs, createTorpedoes, type BombVisuals } from '../render/bombs'
import { Bombs, BOMB_TERMINAL_SPEED, bombDragK } from '../world/bomb'
import { BOMB_SALVO_INTERVAL } from '../weapons/bomb'
import { Projectiles, PROJECTILE_LIFETIME } from '../world/Projectiles'
import { FLASH_SECONDS } from '../world/World'
import { mountDirection } from '../weapons/types'
import { LOADOUT_BY_AIRCRAFT } from '../weapons/stores'
import { maxRollRate } from '../analysis/envelope'
import { DEG } from '../core/math'
import type { AircraftSpec } from '../specs/types'

/**
 * 機庫的展示場 —— 一架飛在海上的飛機，鏡頭繞著它轉。
 *
 * 【它沒有物理】飛行是一條寫死的圓，高度是一個常數，每一幀直接寫進
 * `position.y`。所以這裡不可能失速、不可能撞海，也不需要任何保護。真正
 * 會掉下去的是**鏡頭** —— 玩家把視角拖到飛機底下時，相機會往海面鑽；
 * 那件事由 `SHOWCASE_PITCH_LIMIT` 與距離上界一起擋住（見
 * `showcase.test.ts` 的那一條）。
 *
 * 【為什麼開火與投彈直接借用戰鬥的那幾個池】曳光彈、槍焰、炸彈的外觀必須
 * 與遊戲裡一模一樣 —— 機庫的唯一價值是「讓人看到實際會飛的那一架」，另外
 * 複製一份特效等於讓這一頁說謊。彈道也是同一支（`Projectiles.step`、
 * `Bombs.step`），只是沒有任何命中判定。
 */

/**
 * 展示高度，m。
 *
 * 【為什麼不高】海面細浪網格以相機為中心捲動，離得愈高，網格的邊就愈接近
 * 視線。300 m 時那條邊在 3.4° 俯角，落在地平線裡看不到。
 */
export const SHOWCASE_ALTITUDE = 300
/**
 * 繞行半徑，m。
 *
 * 【為什麼是繞圈而不是直線】直線飛十分鐘會離開地形資料的範圍，海面以外的
 * 東西（島、遠海接縫）就開始出現不該有的樣子。繞一個大圈永遠待在同一片
 * 海上；半徑夠大時看起來仍然是平飛。
 */
export const SHOWCASE_RADIUS = 8000
/** 展示速度，m/s。約 360 km/h —— 九台在這個高度都飛得到 */
export const SHOWCASE_SPEED = 100
/**
 * 鏡頭俯仰的上下限，rad。**它是防止相機鑽進海裡的那道界。**
 *
 * 見檔頭：飛機本身鎖死在 `SHOWCASE_ALTITUDE`，會掉下去的只有相機。
 */
export const SHOWCASE_PITCH_LIMIT = 70 * DEG
/**
 * 鏡頭距離，m。**戰鬥機一個、轟炸機一個，同一類裡不隨機種變。**
 *
 * 【為什麼不照翼展各配一個】那樣每一台都剛好塞滿畫面，於是**看不出誰大誰
 * 小** —— 零戰與地獄貓差 2.1 m 翼展，在畫面上會一樣大。固定值之下同一類
 * 裡的體型差直接讀得出來。
 *
 * 【為什麼兩類不共用一個】翼展從 9.9 m 到 31.6 m 是 3.2 倍。共用一個距離
 * 的話，要嘛戰鬥機小成一個點，要嘛 B-17 兩端都出畫面。跨類的大小本來就
 * 不是這一頁要回答的問題 —— 翼展寫在事實列裡。
 *
 * 【定值怎麼來】該類最大的那一台（F6F-5 的 13.1 m、B-17G 的 31.6 m）在
 * 4:3 的窄螢幕上仍然只佔畫面寬的一半 —— 兩端都留得下邊，而該類最小的那一台
 * 也還看得清楚。`showcase.test.ts` 守這條。
 */
export const FIGHTER_DISTANCE = 17
export const BOMBER_DISTANCE = 40

/** 相機最遠會離飛機多遠。護欄用它掃「相機會不會鑽進海裡」 */
export const SHOWCASE_MAX_DISTANCE = BOMBER_DISTANCE

export const showcaseDistance = (role: AircraftSpec['role']): number =>
  (role === 'bomber' ? BOMBER_DISTANCE : FIGHTER_DISTANCE)

/** 展示機的姿態。角度單位 rad */
export interface FlightPose {
  /** 飛機真正在哪 —— 平均航跡加上起伏與左右的偏移 */
  readonly position: Vector3
  /**
   * 平均航跡上的那一點：那個圓、平均高度、沒有任何偏移。
   *
   * 【相機看的是它，不是 `position`】相機若盯著飛機，飛機的每一個偏移都
   * 會被相機同步跟掉 —— 起伏與左右擺就完全看不到（見 `ALT_WOBBLE`）。
   */
  readonly centre: Vector3
  /** 機首方向：(−sin yaw, 0, −cos yaw)，與 `world/` 同一套約定 */
  yaw: number
  /** 正值 = 左翼下沉（轉彎那一側） */
  bank: number
  pitch: number
}

export function createFlightPose(): FlightPose {
  return { position: new Vector3(), centre: new Vector3(), yaw: 0, bank: 0, pitch: 0 }
}

/**
 * 協調轉彎的滾轉角，rad。`atan(v² / (r·g))`。
 *
 * 【為什麼要算它而不是直接給一個好看的角度】機身往轉彎的外側傾就是錯的，
 * 而那個錯誤在慢速繞圈時只差幾度，看不出來也說不出哪裡怪。
 */
const TURN_BANK = Math.atan((SHOWCASE_SPEED * SHOWCASE_SPEED) / (SHOWCASE_RADIUS * 9.81))
/** 左右晃的幅度。整體的傾角因此在 `TURN_BANK ± ROLL_WOBBLE` 之間走 */
export const ROLL_WOBBLE = 5 * DEG

/**
 * 上下起伏的**上界**（m）與基頻（rad/s）。
 *
 * 【它是看得見的那一個】相機的注視高度釘在 `SHOWCASE_ALTITUDE`（不是跟著
 * 飛機跑），所以這一段是飛機在畫面裡真的上下移動。相機若跟著飛機一起上下，
 * 這一項會被完全抵消，畫面上什麼都看不到。
 */
export const ALT_WOBBLE = 0.375
const ALT_RATE = 1.14

/**
 * 左右飄移的**上界**（m）與基頻（rad/s）。與起伏同一種波形，只是換一個
 * 方向、換一組頻率與相位。
 *
 * 【為什麼比起伏大一倍】畫面的寬是高的兩倍左右，同樣的公尺數橫著看只有
 * 一半的視覺量。0.75 m 與 0.375 m 的起伏在畫面上大約等量。
 */
export const DRIFT_WOBBLE = 0.75
const DRIFT_RATE = 0.82
const DRIFT_PHASE = 0.9

/**
 * 黃金比例。起伏是三條正弦相加，頻率照它遞增。
 *
 * 【為什麼要三條而不是一條】單一正弦有固定週期，看久了會發現它在數拍子。
 * 頻率比是無理數時三條永遠對不回同一個相位，合起來讀起來就是「風裡的
 * 起伏」而不是一台節拍器 —— 而它仍然是純函數，沒有亂數種子要管。
 *
 * 【除以 `BOB_NORM`】三條的振幅和，用它正規化之後合成值必定落在 ±1，
 * `ALT_WOBBLE` 才真的是上界。
 */
const PHI = 1.618033988749895
const WAVE_NORM = 1 + 0.6 + 0.35
/** 三條的起始相位。不錯開的話，開頭幾秒三條同時過零，看起來就是一條 */
const WAVE_PHASE_2 = 1.7
const WAVE_PHASE_3 = 4.1
/** 上下起伏與左右擺動各用一條，錯開相位 —— 同步的話兩者會像同一個動作 */
const ROLL_PHASE = 2.4

/** 三條頻率成黃金比例的正弦相加。**值域 ±1**，所以振幅由呼叫端全權決定 */
function goldenWave(x: number, phase: number): number {
  return (
    Math.sin(x + phase)
    + 0.6 * Math.sin(x * PHI + phase + WAVE_PHASE_2)
    + 0.35 * Math.sin(x * PHI * PHI + phase + WAVE_PHASE_3)
  ) / WAVE_NORM
}

/** `goldenWave` 對 x 的導數。上下起伏要用它算機首的俯仰 */
function goldenWaveSlope(x: number, phase: number): number {
  return (
    Math.cos(x + phase)
    + 0.6 * PHI * Math.cos(x * PHI + phase + WAVE_PHASE_2)
    + 0.35 * PHI * PHI * Math.cos(x * PHI * PHI + phase + WAVE_PHASE_3)
  ) / WAVE_NORM
}

/**
 * 這一台左右擺動的基頻，rad/s。**每台不一樣** —— 零戰晃得比 B-17 快。
 *
 * 【為什麼取平方根而不是照比例】滿舵滾轉率在展示場的條件下（300 m、100 m/s）
 * 從 B-17G 的 11°/s 到 A6M5 的 89°/s，差 8 倍。照比例配的話 B-17 是 100 秒
 * 一個來回，畫面上讀起來像停著。平方根把 8 倍壓成 2.8 倍（基頻週期 4.5 秒
 * 對 12.6 秒），**順序一格都沒變** —— 而那個順序才是「每台的滾轉速度不同」
 * 要傳達的東西。
 *
 * 【`ROLL_OMEGA_GAIN` 的單位】它吸收了平方根留下的單位，數值由「最快的那台
 * 約 4.5 秒一個來回」定出來。
 */
const ROLL_OMEGA_GAIN = 1.12
export function showcaseRollOmega(spec: AircraftSpec): number {
  return ROLL_OMEGA_GAIN * Math.sqrt(maxRollRate(spec, SHOWCASE_ALTITUDE, SHOWCASE_SPEED))
}

/**
 * 展示機這一刻在哪、什麼姿態。**純函數。**
 *
 * 【高度只在 `SHOWCASE_ALTITUDE` 上下 `ALT_WOBBLE` 之間走】它是一條正弦，
 * 不是模擬出來的 —— 所以飛機不可能愈掉愈低，也就不必有任何保護。
 */
export function showcaseFlight(elapsed: number, rollOmega: number, out: FlightPose): void {
  const theta = (elapsed * SHOWCASE_SPEED) / SHOWCASE_RADIUS
  const bob = elapsed * ALT_RATE
  const height = goldenWave(bob, 0)
  /** 高度對**時間**的變化率，m/s per ALT_WOBBLE */
  const rate = goldenWaveSlope(bob, 0) * ALT_RATE
  const drift = elapsed * DRIFT_RATE
  const side = goldenWave(drift, DRIFT_PHASE)
  const sideRate = goldenWaveSlope(drift, DRIFT_PHASE) * DRIFT_RATE

  // 【yaw = θ − π/2】圓上的速度方向是 (cos θ, 0, −sin θ)，而機首方向的
  // 定義是 (−sin yaw, 0, −cos yaw)；兩者相等就解出這一項。差 π/2 的話飛機
  // 會側著飛，而且因為它仍然在動，讀起來像「飄移」而不像「轉錯」。
  const base = theta - Math.PI / 2
  out.centre.set(Math.sin(theta) * SHOWCASE_RADIUS, SHOWCASE_ALTITUDE, Math.cos(theta) * SHOWCASE_RADIUS)
  // 【右方向】機首 × 上 = (cos yaw, 0, −sin yaw)。左右的偏移沿著它走
  out.position.set(
    out.centre.x + Math.cos(base) * side * DRIFT_WOBBLE,
    out.centre.y + height * ALT_WOBBLE,
    out.centre.z - Math.sin(base) * side * DRIFT_WOBBLE,
  )
  // 【機首也跟著往那一邊帶】側向的速度除以空速就是航跡偏了幾度。不帶的話
  // 飛機是平移的 —— 機頭朝前、身體往旁邊滑，那是側滑不是飄移。
  // **減號**：yaw 變大是往左轉（見上面的機首定義），而正的偏移是往右
  out.yaw = base - Math.asin((DRIFT_WOBBLE * sideRate) / SHOWCASE_SPEED)
  out.bank = TURN_BANK + goldenWave(elapsed * rollOmega, ROLL_PHASE) * ROLL_WOBBLE
  // 【機首跟著起伏抬頭低頭】爬升率就是高度那條曲線的導數，除以空速得到
  // 航跡角。機首朝向與上下的動向分家的話，看起來會像被一隻手托著平移
  out.pitch = Math.asin((ALT_WOBBLE * rate) / SHOWCASE_SPEED)
}

/**
 * 姿態 → 四元數。**與機首方向的約定綁在一起**（Euler 的順序是 YXZ：先滾轉、
 * 再俯仰、最後偏航），所以算繪與測試用同一支，不會各自組一份。
 */
export function showcaseQuaternion(flight: FlightPose, out: Quaternion): Quaternion {
  SCRATCH_EULER.set(flight.pitch, flight.yaw, flight.bank)
  return out.setFromEuler(SCRATCH_EULER)
}

/**
 * 鏡頭擺位。`orbitYaw` 是**相對機首**的角度 —— 拖曳轉的是視角，飛機在
 * 畫面上的朝向因此不會被它自己的轉彎慢慢帶走。
 *
 * `orbitYaw = 0` 是正後方、`π` 是正前方。
 */
export function showcaseCamera(
  flight: FlightPose, orbitYaw: number, orbitPitch: number, distance: number,
  out: { position: Vector3; target: Vector3 },
): void {
  const yaw = flight.yaw + orbitYaw
  const flat = Math.cos(orbitPitch) * distance
  // 【看的是平均航跡，不是飛機本身】盯著飛機的話，起伏與左右飄移都會被
  // 相機同步跟掉，畫面上一動也不動（見 `ALT_WOBBLE`）。而平均航跡仍然
  // 繞著那個圓走，所以飛機不會飛出畫面
  out.target.copy(flight.centre)
  out.position.set(
    out.target.x + Math.sin(yaw) * flat,
    out.target.y + Math.sin(orbitPitch) * distance,
    out.target.z + Math.cos(yaw) * flat,
  )
}

/**
 * 主體在畫面上的水平位置，0.5 = 正中央。**量不到版面時的落點。**
 *
 * 【為什麼不是置中】左半邊是卷宗。相機看的是飛機，所以飛機預設就落在畫面
 * 正中央 —— 也就是紙的背面，整頁看起來像沒有飛機。
 *
 * 【為什麼是平移相機而不是挪注視點】挪注視點會讓相機轉一個角度，那等於
 * 偷偷改掉玩家拖出來的視角；平移是純位移，角度一格都不動。
 */
const DEFAULT_SUBJECT_X = 0.7

/**
 * 鏡頭自己繞的角速度，rad/s。**86 秒一圈**，也就是 4.2°/s。
 *
 * 【為什麼要一直轉】停著不動的話，同一台飛機永遠只有一個角度看得到；轉起來
 * 才會輪流露出機背、機腹與側面。慢到「看得出在動、但讀資料時不會分心」是
 * 這個數字的全部要求。
 *
 * 【拖曳時停】拖到一半時視角還自己爬的話，手放著不動畫面卻在走，會覺得
 * 是自己拖歪了。
 */
const AUTO_SPIN = (Math.PI * 2) / 86

/** 進場時的視角：機首左前方 40°、略高一點 */
const DEFAULT_ORBIT_YAW = Math.PI + 40 * DEG
const DEFAULT_ORBIT_PITCH = 12 * DEG
/** 拖曳靈敏度，rad/px */
const DRAG_RATE = 0.006
/**
 * 視角追上拖曳的速率，1/s。
 *
 * 【為什麼要跟丟一點】滑鼠的位移是一格一格跳的，直接寫進角度時，畫面會
 * 跟著滑鼠的抖動一起抖。追過去的寫法是 `1 - exp(-k·dt)` 而不是固定比例
 * ——固定比例在不同幀率下的手感不一樣（144 Hz 的機器會轉得比 60 Hz 快
 * 一倍多）。
 *
 * 12 /s ≈ 追到一半要 58 ms：拖起來仍然跟手，放手時會輕輕滑一下停住。
 */
const ORBIT_FOLLOW = 12

/**
 * 鏡頭拉遠拉近的速率，1/s。**兩類的體型差就是靠它讀出來的。**
 *
 * 【為什麼不瞬間換距離】戰鬥機與轟炸機各有一個固定距離，直接跳的話兩張
 * 畫面上的飛機一樣大，換過去只覺得「換了一台」，看不出 B-17 比零戰大三倍。
 * 保持前一台的距離再拉過去，轟炸機就會先塞滿畫面、鏡頭再退開 —— 退開這
 * 件事本身就是「這台大到要退這麼遠才裝得下」。
 *
 * 比視角慢一截（4 /s ≈ 追到一半 173 ms、九成 580 ms）：拉得太快就又變成
 * 瞬間跳了。
 */
const DISTANCE_FOLLOW = 4

/**
 * 餵給追隨的 dt 上限，秒。
 *
 * 【為什麼要夾】換機種那一幀要建整台幾何、還要填一次轉彎率的高度表，實測
 * 40…90 ms；分頁被瀏覽器節流時更是一秒一幀。不夾的話**那一幀就把整段轉場
 * 走完** —— 而換機種正是唯一要看到轉場的時候，玩家看到的會是跳過去。
 *
 * 只夾追隨這一項：飛行本身仍然吃真正的時間，否則卡一下之後飛機的位置會
 * 與海面的捲動對不上。
 */
const FOLLOW_DT_CAP = 1 / 30

/** 連射週期與長度，秒。中間要有夠長的空檔，否則整頁都在閃 */
const BURST_PERIOD = 5
const BURST_SECONDS = 0.8
/**
 * 投完一整串之後歇多久，秒。
 *
 * 【整串投完才算一輪】B-17G 掛十枚，一次只丟一枚看起來像故障。串內的
 * 間隔用戰鬥裡的 `BOMB_SALVO_INTERVAL`，不另外定一個 —— 彈著間距是那一個
 * 數字決定的，展示場跟著它才是同一台飛機。
 */
const BOMB_PERIOD = 6
/** 螺旋槳轉速，rad/s。與戰鬥裡全油門同一個量級（`main.ts` 的 `propRotation`） */
const PROP_SPIN = 55

/** 彈丸池只放這一架自己的連射。0.8 秒 × 六挺 × 13 發/秒 ＝ 63 發 */
const SHOWCASE_PROJECTILES = 128
/**
 * 炸彈池。
 *
 * 【要放得下整串】B-17G 一串十枚、0.35 秒一枚共 3.2 秒撒完，而從 300 m
 * 落到海面要 8 秒 —— 十枚會同時在空中。池子小於這個數的話環狀指標會繞回來
 * 覆寫最舊的那一枚，症狀是**串頭那幾枚在半空中憑空消失**。
 */
const SHOWCASE_BOMBS = 16

/**
 * 投彈點，機體座標。
 *
 * 【為什麼不用 `model.bombPoint`】那一個是**投彈瞄具的眼點**，在機首的玻璃
 * 裡；炸彈從那裡長出來看起來像從駕駛臉上掉下去。戰鬥裡的投放點就是機體
 * 座標原點（`World.dropBomb` 收的是飛機的位置），這裡只往下挪一點讓它
 * 離開機腹。
 */
const BOMB_RELEASE = new Vector3(0, -1.2, 0)

const SCRATCH_POS = new Vector3()
const SCRATCH_DIR = new Vector3()
const SCRATCH_VEL = new Vector3()
const SCRATCH_EULER = new Euler(0, 0, 0, 'YXZ')
const CAMERA_POSE = { position: new Vector3(), target: new Vector3() }

export interface Showcase {
  /** 換一架。舊的那一架連同它的彈都清掉 */
  setAircraft(spec: AircraftSpec): void
  /** 推進一幀並擺好相機。`camera` 會被就地改寫 */
  update(frameSeconds: number, camera: PerspectiveCamera): void
  dispose(): void
}

/**
 * @param view  吃拖曳的那一塊 DOM。展示場自己掛監聽器，也自己拆
 * @param stage 飛機要站在哪 —— 版面上留給它的那個空格子，只量不畫。
 *              **給它而不是給一個比例**：版面有最大寬度，寬螢幕上整條
 *              內容帶會置中，飛機得跟著帶子走而不是跟著視窗走
 */
export function createShowcase(scene: Scene, view: HTMLElement, stage: HTMLElement): Showcase {
  const group = new Group()
  scene.add(group)

  const tracers: Tracers = createTracers(SHOWCASE_PROJECTILES)
  group.add(tracers.object)
  const muzzles: Muzzles<MuzzleSource> = createMuzzles(1)
  group.add(muzzles.object)
  const bombVisuals: BombVisuals = createBombs()
  group.add(bombVisuals.object)
  const torpedoVisuals: BombVisuals = createTorpedoes()
  group.add(torpedoVisuals.object)

  const projectiles = new Projectiles(SHOWCASE_PROJECTILES)
  const bombs = new Bombs(SHOWCASE_BOMBS)
  const bombDrag = bombDragK(BOMB_TERMINAL_SPEED)
  /** 海面就是平的。展示場沒有陸地 */
  const seaLevel = (): number => 0
  const noImpact = (): void => {}

  const flight = createFlightPose()
  const quaternion = new Quaternion()
  /** `muzzles.update` 依 `index` 取位置與姿態，所以兩個陣列都只有一格 */
  const positions = [new Vector3()]
  const quaternions = [quaternion]

  let model: AircraftModel | null = null
  let spec: AircraftSpec | null = null
  let ordnance: BombVisuals = bombVisuals
  /** 每個掛架的射擊時鐘與槍焰餘秒。長度隨機種變，見 `World.setSpec` */
  let cooldowns = new Float32Array(0)
  let muzzleFlash = new Float32Array(0)
  /**
   * 餵給槍焰池的那一架。**還沒選機種時是空陣列** —— 池子讀不到任何一格，
   * 也就什麼都不畫。
   */
  const sources: MuzzleSource[] = []

  let elapsed = 0
  /** 拖曳寫的是這一組，畫面上的鏡頭每幀追過去（見 `ORBIT_FOLLOW`） */
  let wantYaw = DEFAULT_ORBIT_YAW
  let wantPitch = DEFAULT_ORBIT_PITCH
  let orbitYaw = DEFAULT_ORBIT_YAW
  let orbitPitch = DEFAULT_ORBIT_PITCH
  /** 拉到一半時畫面上的距離；`wantDistance` 是這一台該停在哪 */
  let distance = FIGHTER_DISTANCE
  let wantDistance = FIGHTER_DISTANCE
  /** 這一台的左右擺動有多快。每台不同，見 `showcaseRollOmega` */
  let rollOmega = 0.5
  let propRotation = 0
  let burstTimer = 1.5
  let burstLeft = 0
  let bombTimer = 2
  /** 這一串還剩幾枚沒投。歸零就歇 `BOMB_PERIOD` 再排下一串 */
  let stickLeft = 0

  /**
   * 飛機落在畫面寬度的第幾成。
   *
   * 【為什麼快取而不是每幀量】`getBoundingClientRect` 會逼瀏覽器把版面算完；
   * 一幀一次不貴，但它只在視窗尺寸或卷宗寬度變了才會變。
   *
   * 【量到 0 就不動】畫面藏起來的時候元素沒有盒子，rect 全是 0 —— 寫進去
   * 的話飛機會被推到畫面最左邊，而那一幀正好是回到機庫的第一幀。
   */
  let subjectX = DEFAULT_SUBJECT_X
  function measureStage(): void {
    const rect = stage.getBoundingClientRect()
    if (rect.width <= 0 || window.innerWidth <= 0) return
    subjectX = (rect.left + rect.width / 2) / window.innerWidth
  }
  measureStage()
  window.addEventListener('resize', measureStage)

  function clearShots(): void {
    projectiles.clear()
    bombs.clear()
    // 【兩個池都要推一次空的】切換機種時另一個池留著上一架的彈，而那些
    // 實例矩陣沒人再寫 —— 畫面上會留下一串停在半空的炸彈
    bombVisuals.update(bombs)
    torpedoVisuals.update(bombs)
    tracers.update(projectiles)
  }

  function setAircraft(next: AircraftSpec): void {
    // 【第一台不拉】進機庫的第一幀沒有「前一台」可以對比，從預設距離拉
    // 過去只是開場莫名其妙推一次鏡頭
    const first = spec === null
    if (model !== null) {
      group.remove(model.group)
      model.dispose()
    }
    spec = next
    model = buildAircraft(next)
    group.add(model.group)
    wantDistance = showcaseDistance(next.role)
    if (first) distance = wantDistance
    rollOmega = showcaseRollOmega(next)
    // 【換機種也量一次】卷宗的內容長度會變，而它撐著版面 —— 建立時量的那
    // 一次是上一台的版面
    measureStage()
    cooldowns = new Float32Array(next.battery.mounts.length)
    muzzleFlash = new Float32Array(next.battery.mounts.length)
    sources[0] = { index: 0, alive: true, muzzleFlash, aircraft: { spec: { battery: next.battery } } }
    const load = LOADOUT_BY_AIRCRAFT[next.id]
    ordnance = load !== undefined && load.kind === 'torpedo' ? torpedoVisuals : bombVisuals
    burstLeft = 0
    burstTimer = 1.5
    bombTimer = 2
    stickLeft = load?.count ?? 0
    clearShots()
  }

  /** 連射：到時間就開一段，開火期間各掛架照自己的射速輪流吐 */
  function stepGuns(dt: number): void {
    if (spec === null) return
    const mounts = spec.battery.mounts
    burstTimer -= dt
    if (burstTimer <= 0) {
      burstTimer = BURST_PERIOD
      burstLeft = BURST_SECONDS
    }
    const firing = burstLeft > 0
    if (firing) burstLeft -= dt

    for (let i = 0; i < mounts.length; i++) {
      const flash = muzzleFlash[i]! - dt
      muzzleFlash[i] = flash > 0 ? flash : 0
      const left = cooldowns[i]! - dt
      if (!firing) {
        cooldowns[i] = left > 0 ? left : 0
        continue
      }
      if (left > 0) {
        cooldowns[i] = left
        continue
      }
      const weapon = mounts[i]!.weapon
      cooldowns[i] = 60 / weapon.roundsPerMinute
      muzzleFlash[i] = FLASH_SECONDS
      SCRATCH_POS.copy(mounts[i]!.position).applyQuaternion(quaternion).add(flight.position)
      mountDirection(spec.battery, i, SCRATCH_DIR).applyQuaternion(quaternion)
      // 【要加上機速】槍口初速是相對飛機的。少了這一項，曳光彈離機的速度
      // 就比實際慢一個機速，而那正是畫面上唯一讀得出來的東西
      SCRATCH_VEL.copy(SCRATCH_DIR).multiplyScalar(weapon.muzzleVelocity)
      SCRATCH_VEL.x -= Math.sin(flight.yaw) * SHOWCASE_SPEED
      SCRATCH_VEL.z -= Math.cos(flight.yaw) * SHOWCASE_SPEED
      projectiles.spawn(
        SCRATCH_POS.x, SCRATCH_POS.y, SCRATCH_POS.z,
        SCRATCH_VEL.x, SCRATCH_VEL.y, SCRATCH_VEL.z,
        weapon.damage, 0, 0, PROJECTILE_LIFETIME, weapon.caliber,
      )
    }
  }

  /** 投彈：固定間隔放一顆，彈道與遊戲裡同一支，落到海面就回收 */
  function stepOrdnance(dt: number): void {
    if (spec === null) return
    const load = LOADOUT_BY_AIRCRAFT[spec.id]
    if (load !== undefined && spec.role === 'bomber') {
      bombTimer -= dt
      if (bombTimer <= 0) {
        SCRATCH_POS.copy(BOMB_RELEASE).applyQuaternion(quaternion).add(flight.position)
        bombs.spawn(
          SCRATCH_POS.x, SCRATCH_POS.y, SCRATCH_POS.z,
          -Math.sin(flight.yaw) * SHOWCASE_SPEED, 0, -Math.cos(flight.yaw) * SHOWCASE_SPEED,
          load.damage,
        )
        // 【串投完才重排下一串】掛十枚就要看到十枚一枚接一枚掉出去
        stickLeft -= 1
        if (stickLeft > 0) {
          bombTimer = BOMB_SALVO_INTERVAL
        } else {
          bombTimer = BOMB_PERIOD
          stickLeft = load.count
        }
      }
    }
    bombs.step(dt, bombDrag, seaLevel, noImpact)
    ordnance.update(bombs)
  }

  /**
   * 拖曳中。
   *
   * 【按下在 view 上，移動與放開掛在 window 上】滑鼠拖到畫面外或拖過卷宗
   * 時，事件不會再送到 `view` —— 只掛在它身上的話，視角會在半路卡住，而且
   * 放開之後還以為使用者還按著。
   */
  let dragging = false
  function onPointerDown(): void {
    dragging = true
  }
  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return
    wantYaw -= e.movementX * DRAG_RATE
    const pitch = wantPitch + e.movementY * DRAG_RATE
    wantPitch = pitch > SHOWCASE_PITCH_LIMIT ? SHOWCASE_PITCH_LIMIT
      : pitch < -SHOWCASE_PITCH_LIMIT ? -SHOWCASE_PITCH_LIMIT : pitch
  }
  function onPointerUp(): void {
    dragging = false
  }
  view.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)

  return {
    setAircraft,

    update(frameSeconds: number, camera: PerspectiveCamera): void {
      elapsed += frameSeconds
      // 【追上拖曳】指數逼近，與幀率無關，見 `ORBIT_FOLLOW`
      // 【自轉寫進 `wantYaw`】拖曳寫的是同一個值，所以兩者自然疊加，
      // 而且都吃同一條平滑
      if (!dragging) wantYaw += AUTO_SPIN * frameSeconds
      // 【夾過的 dt】見 `FOLLOW_DT_CAP`：換機種那一幀很長，不夾就跳過去
      const followDt = frameSeconds > FOLLOW_DT_CAP ? FOLLOW_DT_CAP : frameSeconds
      const follow = 1 - Math.exp(-ORBIT_FOLLOW * followDt)
      orbitYaw += (wantYaw - orbitYaw) * follow
      orbitPitch += (wantPitch - orbitPitch) * follow
      // 【換一類時鏡頭是拉的不是跳的】見 `DISTANCE_FOLLOW`
      distance += (wantDistance - distance) * (1 - Math.exp(-DISTANCE_FOLLOW * followDt))
      showcaseFlight(elapsed, rollOmega, flight)
      showcaseQuaternion(flight, quaternion)
      positions[0]!.copy(flight.position)

      if (model !== null) {
        model.group.position.copy(flight.position)
        model.group.quaternion.copy(quaternion)
        propRotation += frameSeconds * PROP_SPIN
        model.setPropSpin(propRotation, true)
      }

      if (spec !== null && spec.role === 'fighter') stepGuns(frameSeconds)
      projectiles.step(frameSeconds)
      tracers.update(projectiles)
      muzzles.update(sources, positions, quaternions)
      stepOrdnance(frameSeconds)

      showcaseCamera(flight, orbitYaw, orbitPitch, distance, CAMERA_POSE)
      camera.position.copy(CAMERA_POSE.position)
      camera.up.set(0, 1, 0)
      camera.lookAt(CAMERA_POSE.target)
      // 【先看好再平移】`translateX` 走的是相機自己的右方向，所以這一行只
      // 改位置不改朝向。半寬要用相機當下的 fov 與長寬比算，換視窗大小才跟著變
      const halfWidth = Math.tan(camera.fov * DEG * 0.5) * distance * camera.aspect
      camera.translateX(-(subjectX - 0.5) * 2 * halfWidth)
    },

    dispose(): void {
      window.removeEventListener('resize', measureStage)
      view.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      if (model !== null) model.dispose()
      tracers.dispose()
      muzzles.dispose()
      bombVisuals.dispose()
      torpedoVisuals.dispose()
      scene.remove(group)
      group.clear()
      model = null
      spec = null
    },
  }
}
