import { Euler, Quaternion, Vector3 } from 'three'
import { maxRollRate } from '../analysis/envelope'
import { DEG } from '../core/math'
import type { AircraftSpec } from '../specs/types'

/** 機庫展示的飛行軌跡與鏡頭運動；不依賴 DOM、模型或武器特效。 */
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
 * 飛機本身維持在 `SHOWCASE_ALTITUDE`，會掉下去的只有相機。
 */
export const SHOWCASE_PITCH_LIMIT = 70 * DEG
/**
 * 鏡頭距離，m。**戰鬥機一個、轟炸機一個，同一類裡不隨機種變**（體型與戰鬥機同級的 Ju 87 除外，
 * 見 `FIGHTER_SIZED`）。
 *
 * 【為什麼不照翼展各配一個】那樣每一台都剛好塞滿畫面，於是**看不出誰大誰
 * 小** —— 零戰與地獄貓差 2.1 m 翼展，在畫面上會一樣大。固定值之下同一類
 * 裡的體型差直接讀得出來。
 *
 * 【為什麼兩類不共用一個】翼展從 9.9 m 到 31.6 m 是 3.2 倍。共用一個距離
 * 的話，要嘛戰鬥機小成一個點，要嘛 B-17 兩端都出畫面。跨類的大小本來就
 * 不是這一頁要回答的問題 —— 翼展寫在事實列裡。
 *
 * 【定值怎麼來】該類最大的那一台（Ju 87 的 13.8 m、B-17G 的 31.6 m）在
 * 4:3 的窄螢幕上仍然只佔畫面寬的一半 —— 兩端都留得下邊，而該類最小的那一台
 * 也還看得清楚。`showcase.test.ts` 守這條。
 */
export const FIGHTER_DISTANCE = 17
export const BOMBER_DISTANCE = 40

/** 相機最遠會離飛機多遠。護欄用它掃「相機會不會鑽進海裡」 */
export const SHOWCASE_MAX_DISTANCE = BOMBER_DISTANCE

/**
 * 歸在轟炸機、體型卻與戰鬥機同級的機種，鏡頭用戰鬥機的距離。Ju 87 的翼展 13.8 m，比 F6F-5 的 13.1 m 只大
 * 一點；拉到轟炸機的 40 m，它只佔畫面寬的 20%，小得不像話。
 */
const FIGHTER_SIZED: ReadonlySet<string> = new Set(['ju87'])

export const showcaseDistance = (spec: Pick<AircraftSpec, 'id' | 'role'>): number =>
  (spec.role === 'bomber' && !FIGHTER_SIZED.has(spec.id) ? BOMBER_DISTANCE : FIGHTER_DISTANCE)

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
 * 【除以 `WAVE_NORM`】三條的振幅和，用它正規化之後合成值必定落在 ±1，
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
 * 鏡頭自己繞的角速度，rad/s。**86 秒一圈**，也就是 4.2°/s。
 *
 * 【為什麼要一直轉】停著不動的話，同一台飛機永遠只有一個角度看得到；轉起來
 * 才會輪流露出機背、機腹與側面。慢到「看得出在動、但讀資料時不會分心」是
 * 這個數字的全部要求。
 *
 * 【拖曳時停】拖到一半時視角還自己爬的話，手放著不動畫面卻在走，會覺得
 * 是自己拖歪了。
 */
export const AUTO_SPIN = (Math.PI * 2) / 86

/** 進場時的視角：機首左前方 40°、略高一點 */
const DEFAULT_ORBIT_YAW = Math.PI + 40 * DEG
const DEFAULT_ORBIT_PITCH = 12 * DEG
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
 * 40…90 ms。不夾的話**那一幀就把整段轉場走完** —— 而換機種正是唯一要看到
 * 轉場的時候，玩家看到的會是跳過去。
 *
 * 【分頁切回來那一幀】`main.ts` 在源頭就把幀夾到 `MAX_FRAME_SECONDS`，送到
 * 這裡的最長是 0.25 秒；這個上限再把鏡頭壓到 1/30，轉場才不會被那 0.25 秒
 * 一次走掉九成五。自轉與追隨都吃它，理由見 `stepOrbit`。
 *
 * 只壓鏡頭：飛行本身吃 `main.ts` 給的時間 —— 海面吃的也是那一個，飛行另外
 * 壓到 1/30 的話，卡一下之後飛機的位置會與海面的捲動對不上。
 */
export const FOLLOW_DT_CAP = 1 / 30

/** 機庫鏡頭的角度與距離。拖曳寫 `want*`，畫面上的鏡頭每幀追過去 */
export interface OrbitState {
  wantYaw: number
  wantPitch: number
  orbitYaw: number
  orbitPitch: number
  /** 拉到一半時畫面上的距離；`wantDistance` 是這一台該停在哪 */
  distance: number
  wantDistance: number
}

export function createOrbitState(): OrbitState {
  return {
    wantYaw: DEFAULT_ORBIT_YAW,
    wantPitch: DEFAULT_ORBIT_PITCH,
    orbitYaw: DEFAULT_ORBIT_YAW,
    orbitPitch: DEFAULT_ORBIT_PITCH,
    distance: FIGHTER_DISTANCE,
    wantDistance: FIGHTER_DISTANCE,
  }
}

/**
 * 鏡頭的一幀：自轉，然後追上拖曳與距離。
 *
 * 【自轉寫進 `wantYaw`】拖曳寫的是同一個值，所以兩者自然疊加，而且都吃
 * 同一條平滑。
 *
 * 【自轉也要吃夾過的 dt】只夾平滑不夾自轉的話，一幀很長時 `wantYaw` 會先衝
 * 出去，而夾過的平滑接著花好幾幀把它追完 —— 畫面上是鏡頭在快速轉。`main.ts`
 * 已經把幀夾到 `MAX_FRAME_SECONDS`，但這支不靠呼叫端夾也要成立。
 */
export function stepOrbit(s: OrbitState, frameSeconds: number, dragging: boolean): void {
  const followDt = frameSeconds > FOLLOW_DT_CAP ? FOLLOW_DT_CAP : frameSeconds
  if (!dragging) s.wantYaw += AUTO_SPIN * followDt
  const follow = 1 - Math.exp(-ORBIT_FOLLOW * followDt)
  s.orbitYaw += (s.wantYaw - s.orbitYaw) * follow
  s.orbitPitch += (s.wantPitch - s.orbitPitch) * follow
  s.distance += (s.wantDistance - s.distance) * (1 - Math.exp(-DISTANCE_FOLLOW * followDt))
}

const SCRATCH_EULER = new Euler(0, 0, 0, 'YXZ')
