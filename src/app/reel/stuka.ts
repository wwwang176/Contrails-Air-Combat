import { Vector3 } from 'three'
import { JU87 } from '../../specs/ju87'
import { hash01 } from '../../render/scatter'
import {
  BOMB_RELEASE_Y, barrage, bombAt, body, bodyUp, edit, propAt, timeline, velocityAt,
  type Cut, type Path, type ReelCamera, type ReelEvent, type ReelPlane, type ReelProp, type Shot,
} from './kit'

// ── 斯圖卡俯衝轟炸 ─────────────────────────────────────────
//
// 夏日清晨、農地上空。六架 Ju 87 成右梯隊往北飛，一架接一架拉起、翻成腹部朝上、
// 機首往下拉進俯衝，炸路上的蘇軍縱隊（T-34 與卡車），投完彈拉起、往南爬升離開。

const G = 9.81

// ── 俯衝的飛法 ─────────────────────────────────────────────
//
// 六架做的是**同一套動作**，只差起始時刻與隊形位移：先積分一條標準航跡（`canon`），
// 每一架是它平移、延時之後的一份。所以六顆炸彈的落點必定排在一條直線上 —— 路就沿著
// 那條線鋪，縱隊沿著路開。
//
// 標準航跡不是寫位置，是寫操縱：滾轉率與過載（升力 ÷ 重量）照時間給，速度由重力、
// 推力與阻力積分。`flightPose` 從路徑推回來的機背方向就是升力方向，所以推回來的坡度
// 與過載就是這裡給的值。
// 【過載不能碰到 0】機背方向是「加速度 + 重力」的方向；升力降到 0 的那一刻它沒有定義，
// 過了 0 就整個翻面 —— 畫面上是飛機在一幀裡轉 180°。所以俯衝段不是直線，是一路
// 慢慢往垂直拉（`DIVE_G`），拉出時接著往同一側拉過垂直、改出朝南
// 【翻身之後機背朝南】翻成腹部朝上再往下拉，機首往下、機背朝來的方向（南）；俯衝的
// 整段都維持這個朝向，拉出時往機背那一側拉，所以是往南改出

/** 巡航速度，m/s */
const V0 = 85
/** 隊形的巡航高度（長機），m。決定俯衝多長：投彈前要塞得下翻身、看別架脫離與跟拍三段 */
const ALT = 1720
/** 巡航的推力加速度與阻力係數：`THRUST = K_CRUISE · V0²`，平飛等速 */
const K_CRUISE = 5.0e-4
const THRUST = K_CRUISE * V0 * V0
/**
 * 放下俯衝減速板、收油門之後的阻力係數。投彈時約 145 m/s。
 * 【它決定投彈高度】慢一點的話同樣的時間裡掉不了那麼多，投彈與拉出的高度跟著墊高
 */
const K_DIVE = 2.4e-4
/** 誘導阻力：每 (過載 − 1)² 減速多少 m/s² */
const K_INDUCED = 0.2

/** 動作時刻（相對每一架開始拉起的那一刻），秒 */
const PULLUP_END = 0.8
const ROLL_AT = 0.8
const ROLL_LEN = 1.8
const PULL_IN_AT = 2.6
/** 拉進俯衝的過載：翼尖拉得出白線（3 G 起） */
const PULL_IN_G = 4.5
const PULL_IN_HOLD = 0.8
/** 俯衝中往垂直慢慢拉的過載 */
const DIVE_G = 0.12
/** 投彈（相對拉起），秒 */
const RELEASE = 13.5
/** 拉出的過載 */
const PULL_OUT_G = 6.0
/** 拉出到爬升角這麼大就鬆桿 */
const CLIMB_ANGLE = 18 * Math.PI / 180

/** `a` 起 `d` 秒內 0 → 1（smoothstep） */
function ramp(t: number, a: number, d: number): number {
  const u = Math.min(1, Math.max(0, (t - a) / d))
  return u * u * (3 - 2 * u)
}

/**
 * `a` 起 `d` 秒內 0 → 1，起步與收尾都比 smoothstep 更緩（smootherstep：速度與加速度在
 * 兩端都是 0）。鏡頭的抬頭與 zoom 用它 —— smoothstep 的加速度在起點跳一下，讀起來像
 * 機器在動
 */
function easeInOut(t: number, a: number, d: number): number {
  const u = Math.min(1, Math.max(0, (t - a) / d))
  return u * u * u * (u * (u * 6 - 15) + 10)
}

/** `a` 起 `d` 秒內 0 → 1 → 0（sin²） */
function bump(t: number, a: number, d: number): number {
  const u = (t - a) / d
  if (u <= 0 || u >= 1) return 0
  const s = Math.sin(Math.PI * u)
  return s * s
}

/** 標準航跡的取樣間隔與長度，秒 */
const TABLE_STEP = 0.02
const TABLE_LEN = 30
const TABLE_N = Math.round(TABLE_LEN / TABLE_STEP) + 1

/**
 * 標準航跡：第 0 秒在 (0, ALT, 0) 往北（−Z）平飛，接著拉起、翻身、拉進俯衝、投彈、
 * 拉出、爬升。每 `TABLE_STEP` 秒存位置與速度，取值用三次 Hermite（位置與速度都連續）。
 * 積分步長 1/400 秒，載入時跑一次
 */
const CANON_P = new Float64Array(TABLE_N * 3)
const CANON_V = new Float64Array(TABLE_N * 3)
/** 拉出到鬆桿的那一刻（相對拉起），秒 */
let climbAt = Infinity
{
  const dt = 1 / 400
  const sub = Math.round(TABLE_STEP / dt)
  const p = new Vector3(0, ALT, 0)
  const v = new Vector3(0, 0, -V0)
  const f = new Vector3(0, 0, -1)
  const u = new Vector3(0, 1, 0)
  const acc = new Vector3()
  let speed = V0
  for (let k = 0; k < TABLE_N; k++) {
    CANON_P[k * 3] = p.x
    CANON_P[k * 3 + 1] = p.y
    CANON_P[k * 3 + 2] = p.z
    CANON_V[k * 3] = v.x
    CANON_V[k * 3 + 1] = v.y
    CANON_V[k * 3 + 2] = v.z
    for (let s = 0; s < sub; s++) {
      const tau = (k * sub + s) * dt
      // 滾轉：往左翻 180°（機背轉向 −X 再轉到朝下），滾轉率是 smoothstep 的導數
      const uRoll = (tau - ROLL_AT) / ROLL_LEN
      const rate = uRoll > 0 && uRoll < 1 ? -Math.PI * 6 * uRoll * (1 - uRoll) / ROLL_LEN : 0
      if (rate !== 0) u.applyAxisAngle(f, rate * dt)
      // 過載
      const gamma = Math.asin(Math.max(-1, Math.min(1, f.y)))
      if (climbAt === Infinity && tau > RELEASE + 1 && gamma > CLIMB_ANGLE) climbAt = tau
      let n = 1 + 0.45 * bump(tau, 0, PULLUP_END) - 0.35 * bump(tau, ROLL_AT, ROLL_LEN)
      n += (PULL_IN_G - 1) * ramp(tau, PULL_IN_AT, 0.5)
      n -= (PULL_IN_G - DIVE_G) * ramp(tau, PULL_IN_AT + 0.5 + PULL_IN_HOLD, 0.7)
      n += (PULL_OUT_G - DIVE_G) * ramp(tau, RELEASE + 0.2, 0.7)
      if (climbAt !== Infinity) {
        const level = Math.cos(gamma) + 0.02
        n += (level - PULL_OUT_G) * ramp(tau, climbAt, 0.8)
      }
      // 推力：翻身時收油門，鬆桿後加到爬升出力；減速板跟著放、收
      const thrust = THRUST * (1 - ramp(tau, 2.0, 1.0)) + (climbAt === Infinity ? 0 : 1.3 * THRUST * ramp(tau, climbAt, 1.0))
      const drag = K_CRUISE + (K_DIVE - K_CRUISE) * ramp(tau, 2.0, 1.0)
        - (climbAt === Infinity ? 0 : (K_DIVE - K_CRUISE) * ramp(tau, climbAt, 1.5))
      const along = -G * f.y + thrust - drag * speed * speed - K_INDUCED * (n - 1) * (n - 1)
      acc.copy(u).multiplyScalar(n * G)
      acc.y -= G
      // 沿機首的分量換成上面算的切向加速度
      acc.addScaledVector(f, along - acc.dot(f))
      v.addScaledVector(acc, dt)
      p.addScaledVector(v, dt)
      speed = v.length()
      f.copy(v).multiplyScalar(1 / speed)
      // 機背跟著機首轉，保持垂直
      u.addScaledVector(f, -u.dot(f)).normalize()
    }
  }
}

/**
 * 標準航跡在 `tau`（相對拉起）的位置。拉起之前是往北的等速平飛；表外直線外推
 */
function canon(tau: number, out: Vector3): Vector3 {
  if (tau <= 0) return out.set(0, ALT, -V0 * tau)
  const x = tau / TABLE_STEP
  const k = Math.min(TABLE_N - 2, Math.floor(x))
  if (k >= TABLE_N - 2 && x > TABLE_N - 1) {
    const e = (x - (TABLE_N - 1)) * TABLE_STEP
    const j = (TABLE_N - 1) * 3
    return out.set(CANON_P[j]! + CANON_V[j]! * e, CANON_P[j + 1]! + CANON_V[j + 1]! * e, CANON_P[j + 2]! + CANON_V[j + 2]! * e)
  }
  const s = x - k
  const h00 = 2 * s * s * s - 3 * s * s + 1
  const h10 = (s * s * s - 2 * s * s + s) * TABLE_STEP
  const h01 = -2 * s * s * s + 3 * s * s
  const h11 = (s * s * s - s * s) * TABLE_STEP
  const a = k * 3
  const b = a + 3
  return out.set(
    h00 * CANON_P[a]! + h10 * CANON_V[a]! + h01 * CANON_P[b]! + h11 * CANON_V[b]!,
    h00 * CANON_P[a + 1]! + h10 * CANON_V[a + 1]! + h01 * CANON_P[b + 1]! + h11 * CANON_V[b + 1]!,
    h00 * CANON_P[a + 2]! + h10 * CANON_V[a + 2]! + h01 * CANON_P[b + 2]! + h11 * CANON_V[b + 2]!,
  )
}

// ── 隊形 ───────────────────────────────────────────────────

/** 長機開始拉起的時刻；其餘每隔 `PEEL_GAP` 秒一架 */
const LEAD_AT = 7.0
const PEEL_GAP = 1.0
/** 右梯隊：每一架在前一架的右後下方 */
const SLOT_X = 18
const SLOT_Y = -3
const SLOT_Z = 14
const COUNT = 6

/** 第 `i` 架開始拉起的時刻 */
const peelAt = (i: number): number => LEAD_AT + i * PEEL_GAP

/**
 * 第 `i` 架：標準航跡延後 `peelAt(i)`、平移到它在隊形裡的位置，巡航時再加一點各自的起伏
 * （拉起前三秒慢慢收掉 —— 收得太快，起伏的加速度就是一下明顯的壓坡度）
 */
function stuka(i: number): Path {
  const m = peelAt(i)
  // 巡航時（雙方都還沒拉起）相對長機的位移是 (i·SLOT_X, i·SLOT_Y, i·SLOT_Z)：
  // 它的標準航跡晚 `m − LEAD_AT` 秒開始，那段時間長機往北飛了 V0·(m − LEAD_AT)
  const dx = i * SLOT_X
  const dy = i * SLOT_Y
  const dz = i * SLOT_Z - V0 * (m - LEAD_AT)
  const phase = 1.3 * i + 0.4
  return (t, out) => {
    canon(t - m, out)
    out.x += dx
    out.y += dy
    out.z += dz
    if (i > 0) {
      const w = 1 - ramp(t, m - 3.2, 3.0)
      out.x += w * 1.0 * Math.sin(0.37 * t + phase)
      out.y += w * 1.2 * Math.sin(0.53 * t + phase * 1.7)
    }
    return out
  }
}

/** 第 `i` 架不做動作、一直平飛的話第 `t` 秒在哪（不含起伏）。跟著隊形走的鏡頭架在它上面 */
function cruise(i: number, t: number, out: Vector3): Vector3 {
  return out.set(i * SLOT_X, ALT + i * SLOT_Y, i * SLOT_Z - V0 * (t - LEAD_AT))
}

const PATHS: readonly Path[] = Array.from({ length: COUNT }, (_, i) => stuka(i))
const LEAD = PATHS[0]!

/**
 * 長機的右僚機：巡航時在長機右後下方 30 m，晚長機 0.3 秒做同一套動作，跟著它一起
 * 俯衝、拉出（不投彈）。側拍長機那一刀（鏡頭在西側）的後景：俯衝時它在長機後上方、
 * 偏南約 12 m，畫面上在長機右上 —— 兩架連起來的方向與長機機頭一致，讀得出一起往
 * 左下衝。梯隊裡另外五架彼此隔一秒、上下差 130 m，任兩架都塞不進同一個側拍的畫面
 * 【俯衝時要在長機南邊】晚 0.3 秒在巡航是水平落後，`− V0 · WING_DELAY` 把它抵掉；
 * 進了俯衝落後變成垂直的，這一項就把它往北推約 18 m。在北邊的話畫面上它在長機左上，
 * 兩架讀成往右下衝、長機的機頭朝左下，看起來像壓過了頭
 * 【這一格】跟每一架整段最近約 19 m（翼展 13.8 m）：第二架拉起、往左翻身時會掃過
 * 梯隊右後方近處
 */
const WING_DELAY = 0.3
const WING_X = 10
const WING_Y = -10
const WING_Z = 30
const WING: Path = (t, out) => {
  canon(t - LEAD_AT - WING_DELAY, out)
  out.x += WING_X
  out.y += WING_Y
  out.z += WING_Z - V0 * WING_DELAY
  const w = 1 - ramp(t, LEAD_AT + WING_DELAY - 3.2, 3.0)
  out.x += w * 1.0 * Math.sin(0.41 * t + 5.1)
  out.y += w * 1.2 * Math.sin(0.47 * t + 2.3)
  return out
}
/** 跟拍俯衝、投彈的那一架：第二架。長機在它下方先投 */
const HERO = 1
const HERO_PATH = PATHS[HERO]!

/** 第 `i` 架投彈的時刻 */
const releaseAt = (i: number): number => peelAt(i) + RELEASE

/**
 * 每一架那一枚炸彈的落點（局部座標，y = 0）與落地時刻。載入時照放映機同一套彈道
 * （`body` 的機腹點、`velocityAt` 的中央差分、`bombAt`）算一次
 */
const IMPACTS: Vector3[] = []
const IMPACT_AT: number[] = []
for (let i = 0; i < COUNT; i++) {
  const at = releaseAt(i)
  const p0 = body(PATHS[i]!, at, 0, BOMB_RELEASE_Y, 0, false, new Vector3())
  const v0 = velocityAt(PATHS[i]!, at, new Vector3())
  const out = new Vector3()
  let lo = 0
  let hi = 20
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2
    if (bombAt(p0, v0, mid, out).y > 0) lo = mid
    else hi = mid
  }
  bombAt(p0, v0, hi, out)
  out.y = 0
  IMPACTS.push(out)
  IMPACT_AT.push(at + hi)
}

/** 跟拍的那一枚：第二架的炸彈投下那一刻的機腹點與速度 */
const FOLLOW_AT = releaseAt(HERO)
const FOLLOW_P = body(HERO_PATH, FOLLOW_AT, 0, BOMB_RELEASE_Y, 0, false, new Vector3())
const FOLLOW_V = velocityAt(HERO_PATH, FOLLOW_AT, new Vector3())
/** 從留在俯衝線上的那一刀切到跟那一枚炸彈：投下 2 秒後 */
const BOMB_CUT = FOLLOW_AT + 2.05
/**
 * 投彈那一刻鏡頭從第二架身上脫鉤：起點是它尾後的那一點、上方是它那一刻的機背，之後
 * 順著它的俯衝速度的 `DETACH_PACE` 倍直線往下。炸彈比鏡頭快、往縱隊掉遠，飛機往機背
 * 那一側拉走 —— 鏡頭跟不上，交代「飛機拉走了，炸彈還在往下」
 */
const DETACH_P = body(HERO_PATH, FOLLOW_AT, 0, 3.0, 13, false, new Vector3())
const DETACH_UP = bodyUp(HERO_PATH, FOLLOW_AT, new Vector3())
const DETACH_PACE = 0.85

// ── 路與縱隊 ───────────────────────────────────────────────
//
// 路沿著六個落點那條線，往兩頭各拉 7.5 km。縱隊沿著路往北開（`COLUMN_SPEED`）：每兩個
// 落點之間三輛，前後各多兩輛。每一顆炸彈都落在一輛車上 —— 那一輛的出發點往回推，炸彈
// 落地那一刻（`IMPACT_AT`）正好開到落點。挨炸的幾輛走路中間，其餘的走左右兩側：炸毀
// 的停在原地，後面的從旁邊開過去，不會穿過殘骸

/** 路的走向（單位向量，往北那一頭）與每兩個落點的間距 */
const ROAD_DIR = IMPACTS[COUNT - 1]!.clone().sub(IMPACTS[0]!).normalize()
const ROAD_GAP = IMPACTS[1]!.distanceTo(IMPACTS[0]!)
/** 路的右手邊（往北看的右邊，東） */
const ROAD_RIGHT = new Vector3(-ROAD_DIR.z, 0, ROAD_DIR.x)
/** 車頭的方向，`ReelProp.heading` 的約定：前進方向 (−sin h, 0, −cos h) */
const COLUMN_HEADING = Math.atan2(-ROAD_DIR.x, -ROAD_DIR.z)
const PER_GAP = 3
const LEAD_IN = 2
/** 縱隊的行軍速度，m/s（約 29 km/h）。整段 35.6 秒開 285 m，路兩頭各 7.5 km */
const COLUMN_SPEED = 8
/** 沒挨炸的車偏離路中線多少，m。車寬 3 m：偏 3.6 m 與中線上的殘骸留 0.6 m */
const COLUMN_SIDE = 3.6

/** 路上第 `s` 公尺那一點（從第一個落點量起，往北為正），寫進 `out` */
function onRoad(s: number, side: number, out: Vector3): Vector3 {
  return out.copy(IMPACTS[0]!).addScaledVector(ROAD_DIR, s).addScaledVector(ROAD_RIGHT, side)
}

/**
 * 第 `i` 個落點那一輛第 0 秒在路上第幾公尺：炸彈落地那一刻開到落點。
 * 落點彼此相隔 `ROAD_GAP`、落地時刻相隔約一秒，所以這幾輛的出發點間距是固定的
 */
const spawnOnRoad = (i: number): number => i * ROAD_GAP - COLUMN_SPEED * IMPACT_AT[i]!

const PROPS: readonly ReelProp[] = (() => {
  const out: ReelProp[] = []
  const n = (COUNT - 1) * PER_GAP + 1 + 2 * LEAD_IN
  const step = (spawnOnRoad(COUNT - 1) - spawnOnRoad(0)) / ((COUNT - 1) * PER_GAP)
  const p = new Vector3()
  for (let k = 0; k < n; k++) {
    const slot = k - LEAD_IN
    // 落在落點上的那一輛走中線、不偏；其餘沿路前後錯一點、輪流走左右兩側
    const onImpact = slot >= 0 && slot % PER_GAP === 0 && slot / PER_GAP < COUNT
    const jitter = onImpact ? 0 : (((k * 37) % 11) / 10 - 0.5) * 6
    const side = onImpact ? 0 : (k % 2 === 0 ? COLUMN_SIDE : -COLUMN_SIDE)
    // 兩個落點之間照出發點內插；前後多出來的照平均車距外推
    const g = Math.floor(slot / PER_GAP)
    const s = onImpact
      ? spawnOnRoad(slot / PER_GAP)
      : g >= 0 && g < COUNT - 1
        ? spawnOnRoad(g) + (spawnOnRoad(g + 1) - spawnOnRoad(g)) * ((slot - g * PER_GAP) / PER_GAP)
        : spawnOnRoad(0) + slot * step
    onRoad(s + jitter, side, p)
    // 每三輛一輛戰車，其餘卡車；落點上一律放戰車
    const id = onImpact || k % 3 === 1 ? 'tank' : 'truck'
    out.push({ id, x: p.x, z: p.z, heading: COLUMN_HEADING, speed: COLUMN_SPEED })
  }
  return out
})()

/** 車上仰看那一刀跟的車：縱隊最後一台（卡車），沒有挨炸 */
const RIDE = 0
/** 那一刀拍的那一架：第四架，從縱隊上空衝下來、拉出 */
const RIDE_SUBJECT = 3
/**
 * 那一刀鏡頭在車上的位置（車身座標：x 右、y 離地、z 車尾，m）：站在車斗後段、
 * 頭略高過駕駛室頂（車身命中盒頂 2.70，外擴 0.3）。駕駛室頂離鏡頭 3～4 m，只佔畫面下緣
 * 一角 —— 再貼近的話低面數的車身在畫面裡看得出面很粗
 */
const RIDE_X = 1.0
const RIDE_Y = 3.15
const RIDE_Z = 3.0
const RIDE_AT = new Vector3()
/** 那一刀的起訖秒數：長機那一枚（24.5 秒）落地之後、跟拍的那一枚（25.5 秒）落地之前切進來 */
const RIDE_FROM = 25.3
const RIDE_TO = 27.6

/**
 * 路邊看見編隊那一刀：起訖秒數；機位在第 `SPOT_PASS_PROP` 台戰車 `SPOT_PASS_AT` 秒開到的
 * 地方的路東邊 `SPOT_SIDE` m（那台戰車那時從鏡頭旁邊開過去）—— 車開到鏡頭前 `SPOT_LOOK` m
 * 時，鏡頭到車的連線與車頭方向夾 15°，從車的斜前方拍；往上搖的起點與長度；zoom in 的起點
 * （到刀尾收完）；拍路、搖上天、收到編隊上的視角（度）
 */
const SPOT_FROM = 3.2
const SPOT_TO = 6.8
const SPOT_PASS_PROP = 13
const SPOT_PASS_AT = 5.6
const SPOT_LOOK = 30
const SPOT_SIDE = SPOT_LOOK * Math.tan(15 * Math.PI / 180)
const SPOT_TILT_AT = 4.1
const SPOT_TILT_LEN = 1.4
/** 抬頭抬過頭一點再回穩：注視點往編隊那一側多走的比例 */
const SPOT_OVERSHOOT = 0.04
const SPOT_ZOOM_AT = 5.15
const SPOT_FOV_ROAD = 40
const SPOT_FOV_SKY = 22
const SPOT_FOV_ZOOM = 4.5
const SPOT_PASS = propAt(PROPS[SPOT_PASS_PROP]!, SPOT_PASS_AT, new Vector3())
const SPOT_CAM = SPOT_PASS.clone().addScaledVector(ROAD_RIGHT, SPOT_SIDE).setY(6)
/**
 * 拍路時的注視點：沿著路往南 120 m、再往路那一側偏 10° —— 路的消失點落在注視點左邊一點，
 * 開過來的那台車在它右邊十來度，兩者都在主角讓到的畫面右半。注視點擺在路上的話，往遠處
 * 收的那一串車全擠到畫面左半、躲進選單後面；視線與路平行的話，開過來的車一開始就貼在
 * 畫面右緣
 */
const SPOT_ROAD = SPOT_CAM.clone().addScaledVector(ROAD_DIR, -120)
  .addScaledVector(ROAD_RIGHT, -120 * Math.tan(10 * Math.PI / 180)).setY(2)

/**
 * 第 `k` 台車第 `t` 秒車身座標 (x 右、y 上、z 車尾) 那一點的局部座標，寫進 `out`。
 * 車的位置是 `propAt`，車頭朝 (−sin h, 0, −cos h)
 */
function onVehicle(k: number, t: number, x: number, y: number, z: number, out: Vector3): Vector3 {
  const p = PROPS[k]!
  propAt(p, t, RIDE_AT)
  const c = Math.cos(p.heading)
  const s = Math.sin(p.heading)
  return out.set(RIDE_AT.x + x * c + z * s, y, RIDE_AT.z - x * s + z * c)
}

const ROAD_FAR = 7500
const ROAD_S = onRoad(-ROAD_FAR, 0, new Vector3())
const ROAD_N = onRoad((COUNT - 1) * ROAD_GAP + ROAD_FAR, 0, new Vector3())
/** 墊面放在路的北段、縱隊外 7 km（見 `STUKA.ground`） */
const PAD_AT = onRoad((COUNT - 1) * ROAD_GAP + 7000, 260, new Vector3())

// ── 鏡頭工具 ───────────────────────────────────────────────

const S1 = new Vector3()
const S2 = new Vector3()
const S3 = new Vector3()
const UP_AXIS = new Vector3(0, 1, 0)
/** 爬升離場那一刀的鏡頭偏向哪一側（+1 / −1）：後景那一架要落在主角右邊，不躲進選單 */
const CLOSE_SIDE = -1

const AIM_A = new Vector3()
const AIM_B = new Vector3()
/**
 * 從 `from` 看出去、介於 `a` 與 `b` 兩個方向之間的注視點（`w` = 偏向 `b` 的比例）。
 * 混的是方向不是位置 —— 一個在 20 m、一個在 600 m 的話，位置的內插幾乎就是遠的那一點
 */
function aimBetween(from: Vector3, a: Vector3, b: Vector3, w: number, out: Vector3): Vector3 {
  AIM_A.subVectors(a, from).normalize().multiplyScalar(100 * (1 - w))
  AIM_B.subVectors(b, from).normalize().multiplyScalar(100 * w)
  return out.copy(from).add(AIM_A).add(AIM_B)
}

/**
 * 手持／機上的慢晃（與 raid 同一支）：注視點繞著鏡頭偏一個小角度，頻率 0.3～1.1 Hz 互質
 * 的正弦疊起來。指向的晃動 RMS 約 0.7 × `deg` 度。偏的是角度不是公尺 —— 注視點在 5 m 與
 * 300 m 的刀，同一個 `deg` 晃得一樣多。在注視點設好之後呼叫。
 * 【要慢】快過 1.5 Hz 的話讀起來是抖，不是手持
 */
function shake(t: number, deg: number, seed: number, out: ReelCamera): void {
  const d = out.target.distanceTo(out.position) * deg * (Math.PI / 180)
  out.target.x += d * (0.6 * Math.sin(2.1 * t + seed) + 0.4 * Math.sin(4.9 * t + 2.1 * seed))
  out.target.y += d * (0.6 * Math.sin(2.9 * t + 1.3 * seed) + 0.4 * Math.sin(6.7 * t + seed))
  out.target.z += d * (0.5 * Math.sin(2.5 * t + 0.7 * seed) + 0.5 * Math.sin(4.3 * t + 1.9 * seed))
}

/**
 * 衝擊的一震：`t0` 起 4～5 Hz、0.18 秒衰減一半多的快抖，0.6 秒後歸零，疊進 `out`。
 * 只給炸彈落地的那幾下 —— 一直抖的話觀眾看的是鏡頭不是飛機
 */
function jolt(t: number, t0: number, amp: number, out: Vector3): Vector3 {
  const u = t - t0
  if (u < 0 || u > 0.6) return out
  const k = amp * Math.exp(-u / 0.18)
  out.x += k * Math.sin(2 * Math.PI * 5.3 * u)
  out.y += k * Math.sin(2 * Math.PI * 4.1 * u + 1)
  return out
}

const DUTCH_F = new Vector3()
const DUTCH_R = new Vector3()
/**
 * 荷蘭角：把鏡頭的上方繞著視線轉 `deg` 度（正值 = 上方倒向畫面右邊，地平線左低右高）。
 * 在 `position`、`target`、`up` 都設好之後呼叫
 */
function dutch(out: ReelCamera, deg: number): void {
  DUTCH_F.subVectors(out.target, out.position).normalize()
  DUTCH_R.crossVectors(DUTCH_F, out.up).normalize()
  out.up.copy(DUTCH_R).cross(DUTCH_F)
  const a = (deg * Math.PI) / 180
  out.up.multiplyScalar(Math.cos(a)).addScaledVector(DUTCH_R, Math.sin(a))
}

/** 燒著的那一段縱隊（前三個落點的中間）：收尾幾刀背景裡的火 */
const BURNING = onRoad(ROAD_GAP, 0, new Vector3())
const LAST = COUNT - 1

/** 側拍長機、曳光從畫面中間穿過的那一刀（見刀表） */
const CROSSFIRE_FROM = 15.8
const CROSSFIRE_TO = 20.0
/**
 * 那一刀裡曳光瞄長機時偏開多少，m。偏移是每一軸各自 ±這麼多，最遠約 1.7 倍（7 m）；
 * 鏡頭在長機西側 13 m 推到 10 m，彈道碰不到鏡頭，貼著長機往上竄
 */
const CROSSFIRE_MISS = 4

/**
 * 縱隊朝俯衝的斯圖卡打的機槍：每隔一台（十台）輪流打，每 6 秒打一段 2.8～3.2 秒，
 * 各車的起點錯開，同一時間約五道。從 10.5 秒（長機拉進俯衝）打到 31.5 秒（最後一架
 * 拉出），每一段挑那時正在俯衝或拉出的一架打，瞄點偏開 25～45 m，曳光從飛機旁邊擦過去。
 * 側拍長機那一刀裡全部改瞄長機、偏開 `CROSSFIRE_MISS`。炸毀的車自己停火
 * 【曳光只飛 1.2 秒】850 m/s 打不到一公里外：俯衝的前半段，曳光是往上竄、在半空熄掉
 */
const GROUND_FIRE: ReelEvent[] = (() => {
  const out: ReelEvent[] = []
  const from = 10.5
  const to = 31.5
  for (let k = 1; k < PROPS.length; k += 2) {
    // 十台的起點均勻錯開在一個 6 秒的週期裡，同一時間才穩定在五道上下
    let at = from + ((k - 1) / 2) * 0.6
    for (let j = 0; at < to; j++) {
      const seconds = Math.min(2.8 + hash01(k * 17 + j + 5) * 0.4, to - at)
      const mid = at + seconds / 2
      // 那一刻在俯衝線上的：拉進俯衝之後、拉出到一半之前
      const live: number[] = []
      for (let i = 0; i < COUNT; i++) if (mid > peelAt(i) + PULL_IN_AT && mid < releaseAt(i) + 4.5) live.push(i)
      const cross = mid > CROSSFIRE_FROM && mid < CROSSFIRE_TO
      if (cross || live.length > 0) {
        out.push({
          at, kind: 'groundFire', prop: k, actor: cross ? 0 : live[(k + j) % live.length]!, seconds,
          miss: cross ? CROSSFIRE_MISS : 25 + hash01(k * 29 + j + 11) * 20,
        })
      }
      at += 6.0
    }
  }
  return out
})()

// ── 刀表 ───────────────────────────────────────────────────
//
//   0.0–3.2   編隊裡：鏡頭在長機正後方、比隊形快一點往前滑，從第二架左邊 14 m 掠過，鏡頭
//             跟著它轉、慢慢滾轉；長機在左前方，後面一整排梯隊往右後方排開，底下是田
//   3.2–6.8   路邊固定機位從車的斜前方拍：縱隊揚著塵迎面開來、從鏡頭旁開過；鏡頭往上抬到
//             高空的梯隊，zoom in 到六架讀得出來 —— 地面看見了他們
//   6.8–10.2  長機右後上方往下看：它拉起一下、往左翻成腹部朝上，田在它底下，拉進俯衝往下掉開
//   10.2–13.8 編隊西側 95 m 跟著隊形飛：第四、五、六架一架接一架往這一側翻過來，前一架
//             已經拉進俯衝、翼尖拉出白線往下掉
//   13.8–15.8 第六架左肩後上方：接它翻到一半，自己的座艙罩與左翼在下緣，跟著它翻過去、
//             往下拉，前幾架在機首前方已經往下衝
//   15.8–20.0 長機西側 13 → 10 m 跟拍，幾乎是機身特寫、手持晃得很兇：前景是機頭朝左下往下
//             衝的長機，後面上方是它的右僚機，縱隊打上來的曳光貼著長機往上竄
//   20.0–21.5 第二架尾巴後方順著機首往下看：長機在下方、路上的縱隊在正前方越來越大；
//             長機 20.5 秒投彈、拉出白線改出
//   21.5–23.6 第二架投彈，鏡頭留在俯衝線上繼續往下：炸彈往縱隊掉遠，它拉起往畫面上方甩出去
//   23.6–25.3 跟著第二架那一枚往下掉：完好的縱隊在下面越來越大，長機那一枚 24.5 秒先炸開
//   25.3–27.6 縱隊最後一台卡車的車斗上仰看：第四架從前上方衝下來、拉出白線，旁邊的車往上
//             打，前面的戰車一台接一台挨炸（25.5、26.5、27.5 秒）
//   27.6–29.6 縱隊北頭往南沿著路看：最後兩顆沿路往鏡頭炸過來
//   29.6–31.8 縱隊南邊 230 m 低空往北看：燒著的縱隊在路的盡頭，最後一架從右邊貼著田拉出來
//   31.8–33.6 第五架前方 21 m 往後看：整架迎面往南爬升離場，後景是剛拉出來的第六架
//   33.6–35.6 最後一架左後下方：它與前面幾架往南爬升，越來越遠

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: 1,
    camera(t, out) {
      // 鏡頭當成編隊裡的一架，在長機正後方、第二架左邊 14 m，每秒比隊形快 9 m 往前滑，
      // 2.9 秒從第二架身旁掠過，長機在左前方。注視點一路釘在它後方一點，鏡頭跟著往右轉，
      // 它背後整排梯隊往右後方排開。上方從左倒 10° 慢慢滾到右倒 8°
      // 【注視點在它後方】主角讓到畫面右邊；注視點在它前方的話，往右前看時它落在注視點
      // 右邊，被推出畫面
      cruise(0, t, out.position).add(S1.set(4, -1.5 + 0.4 * t, 40 - 9 * t))
      PATHS[1]!(t, out.target).add(S1.set(-2, 0, 8))
      out.fov = 55
      dutch(out, -10 + 5.6 * t)
      shake(t, 0.12, 1, out)
    },
  },
  {
    from: SPOT_FROM, subject: null,
    camera(t, out) {
      // 地面看見了上面的飛機：路東邊 8 m、離地 6 m 的固定機位，從車的斜前方（與路夾 15°）
      // 往南看。縱隊迎面開過來、車尾揚著塵，最前面那台 T-34 從 20 m 外開到鏡頭旁、越來越大，
      // 4.1 秒前後從畫面右緣開出去；
      // 4.1 秒起鏡頭往上抬（手持的人抬頭：起步慢、中段快、抬過頭一點再回穩），抬到高空正從
      // 同一個方向飛來的整個梯隊，抬到八成時開始 zoom in，收到最後慢慢停住，六架的機身與
      // 倒鷗翼讀得出來。下一刀長機就拉起翻身
      // 【斜前方往南看】編隊也從南邊來，車與飛機在同一個方向，往上一抬就到
      // 【拍路時不動】只有車在動，看得出縱隊在開；鏡頭跟著車搖的話讀不出車的速度
      // 【抬到八成才收】一邊抬一邊收長焦的話，編隊還沒到畫面中央就被收出畫外
      // 【長焦下的手持】以角度計的晃動在長焦下會被放大；照視角收小，但收得比視角慢，
      // 收到最後仍看得出是手持
      out.position.copy(SPOT_CAM)
      cruise(2.5, t, S2)
      const tilt = easeInOut(t, SPOT_TILT_AT, SPOT_TILT_LEN) + SPOT_OVERSHOOT * bump(t, SPOT_TILT_AT + 0.75 * SPOT_TILT_LEN, 0.9)
      aimBetween(out.position, SPOT_ROAD, S2, tilt, out.target)
      const lift = Math.min(1, tilt)
      const zoom = easeInOut(t, SPOT_ZOOM_AT, SPOT_TO - SPOT_ZOOM_AT)
      out.fov = SPOT_FOV_ROAD + (SPOT_FOV_SKY - SPOT_FOV_ROAD) * lift + (SPOT_FOV_ZOOM - SPOT_FOV_SKY) * zoom
      shake(t, 0.3 * Math.pow(out.fov / SPOT_FOV_ROAD, 0.6), 3, out)
    },
  },
  {
    from: 6.8, subject: 0,
    camera(t, out) {
      // 長機右後上方 35 m 往下看（跟著它原本的平飛航線走，慢慢推近）：7.0 秒它拉起一下，
      // 7.8 秒起往左翻、翻成腹部朝上，田在它底下；9.6 秒它拉進俯衝，往下掉開時切
      const u = t - 6.8
      cruise(0, t, out.position).add(S1.set(10 - 1.2 * u, 24 - 1.5 * u, 22 - 2.5 * u))
      LEAD(t, out.target)
      shake(t, 0.12, 5, out)
      out.fov = 48
    },
  },
  {
    from: 10.2, subject: 4,
    camera(t, out) {
      // 編隊西側 95 m、與第五架同高，跟著隊形往北飛、慢慢往前帶：第四架 10.8 秒、第五架
      // 11.8 秒、第六架 12.8 秒一架接一架往這一側翻過來，翻成腹部朝上之後拉進俯衝、翼尖
      // 拉出白線，從畫面下緣掉出去。注視點慢慢壓低，往下掉的那一架多留在畫面裡一下
      const u = t - 10.2
      cruise(4, t, out.position).add(S1.set(-95, 4, -20 - 3 * u))
      cruise(4, t, out.target).add(S1.set(-10, -6 - 8 * u, -5))
      shake(t, 0.1, 9, out)
      out.fov = 42
    },
  },
  {
    from: 13.8, subject: 4, mount: 5,
    camera(t, out) {
      // 第六架左肩後上方、座艙罩後面（垂尾 |x| 0.37，外擴 0.5）：接上一刀它翻到一半，自己的
      // 座艙罩與左翼在畫面下緣，跟著它翻過去、拉進俯衝，前一架在機首前下方已經往下衝。
      // 上方跟著機身
      body(PATHS[5]!, t, -1.5, 2.3, 6.0, false, out.position)
      PATHS[4]!(t, S1)
      body(PATHS[5]!, t, 0, -40, -300, false, S2)
      aimBetween(out.position, S1, S2, 0.4 + 0.2 * Math.min(1, Math.max(0, (t - 15.4) / 1.0)), out.target)
      bodyUp(PATHS[5]!, t, out.up)
      out.fov = 70
    },
  },
  {
    from: CROSSFIRE_FROM, subject: 0,
    camera(t, out) {
      // 長機西側 13 m 跟拍、往東看，幾乎是機身特寫，鏡頭正立不歪（上方是世界的上方），
      // 手持晃得很兇：前景的長機機首朝下往畫面下方衝，後景是它的右僚機，在它後上方、偏南
      // 約 12 m（畫面右上）一起衝下來。縱隊從北邊（畫面左下）打上來的曳光貼著長機往上竄。鏡頭跟著
      // 長機往下掉、慢慢推近到 10 m
      // 【鏡頭在西側】往北俯衝 74～80°，從西側看北邊在畫面左邊，機頭朝左下偏離垂直 10～16°；
      // 從東側看是朝右下
      // 【彈道碰不到鏡頭】曳光從北邊下方打上來、瞄點離長機最遠約 7 m（`CROSSFIRE_MISS`），
      // 鏡頭在 10 m 外的側面
      const u = t - CROSSFIRE_FROM
      LEAD(t, out.position).add(S1.set(-(13 - 0.75 * u), -2, 2))
      LEAD(t, S1)
      WING(t, S2)
      aimBetween(out.position, S1, S2, 0.4, out.target)
      shake(t, 0.6, 22, out)
      out.fov = 70
    },
  },
  {
    from: CROSSFIRE_TO, subject: 0, mount: HERO,
    camera(t, out) {
      // 第二架尾巴後方 13 m、機背那一側 3 m，順著機首往下看：長機在下方，縱隊在正前方
      // 越來越大，地面的機槍曳光往上竄。長機 20.5 秒投彈、拉起；21.5 秒自己投彈時切
      body(HERO_PATH, t, 0, 3.0, 13, false, out.position)
      LEAD(t, S1)
      body(HERO_PATH, t, 0, 0, -300, false, S2)
      aimBetween(out.position, S1, S2, 0.55, out.target)
      shake(t, 0.4, 24, out)
      bodyUp(HERO_PATH, t, out.up)
      out.fov = 56
    },
  },
  {
    from: FOLLOW_AT, subject: null,
    camera(t, out) {
      // 鏡頭留在俯衝線上（`DETACH_P`）：炸彈從第二架的機腹脫落、跑在鏡頭前面往縱隊掉；
      // 第二架 6 G 拉起、翼尖拖著白線往畫面上方甩出去。上方固定在投彈那一刻的機背，
      // 不跟著機身翻。拉起那一下氣流掃過，震一下。飛機出畫之後慢慢收窄，炸彈與路上的
      // 縱隊才不會縮成小點
      const u = t - FOLLOW_AT
      out.position.copy(DETACH_P).addScaledVector(FOLLOW_V, DETACH_PACE * u)
      bombAt(FOLLOW_P, FOLLOW_V, u, S1)
      aimBetween(out.position, S1, IMPACTS[HERO]!, 0.3, out.target)
      shake(t, 0.1, 23, out)
      jolt(t, FOLLOW_AT + 0.4, 1.0, out.target)
      out.up.copy(DETACH_UP)
      out.fov = 60 - 18 * ramp(t, FOLLOW_AT + 1.0, 1.0)
    },
  },
  {
    from: BOMB_CUT, subject: null,
    camera(t, out) {
      // 跟著第二架那一枚往下掉（投下 2 秒後接上）：鏡頭在它上方幾公尺，完好的縱隊在下面
      // 越來越大，長機那一枚 24.5 秒先在前面一點的戰車上炸開。這一枚落地前 0.2 秒、還在
      // 三十公尺高時切到車上，在那裡看它炸開。
      // 【鏡頭在炸彈北側】第二架往機背那一側（南）拉出，鏡頭架在南側會貼到它身上
      bombAt(FOLLOW_P, FOLLOW_V, t - FOLLOW_AT, S1)
      out.position.copy(S1).add(S2.set(2.5, 3.5, -4.0))
      aimBetween(out.position, S1, IMPACTS[HERO]!, 0.3, out.target)
      shake(t, 0.08, 13, out)
      out.fov = 60
    },
  },
  {
    from: RIDE_FROM, subject: RIDE_SUBJECT, groundMount: RIDE,
    camera(t, out) {
      // 縱隊最後一台卡車的車斗後段（離地 3.15 m）跟著車往北開、往前上方仰看：自己的駕駛室頂
      // 在畫面下緣，前面一台戰車在路上，再前面是 45 m 外燒著的那一台與更前面的車。第四架從前上方衝下來、
      // 拉出白線，旁邊的車往上打機槍；跟拍的那一枚 25.5 秒、第三架那一枚 26.5 秒、第四架
      // 那一枚 27.5 秒在前面一台接一台炸開，每一下都震一下。車在開：慢晃加一點顛
      // 【跟最後一台、24.5 秒之後才切進來】長機那一枚落在前面 45 m 的戰車上，火球在這個
      // 距離大到看得出低面數的稜角；在跟炸彈那一刀裡從上面看它炸。之後的炸點都在 110 m 外
      onVehicle(RIDE, t, RIDE_X, RIDE_Y, RIDE_Z, out.position)
      out.position.y += 0.05 * Math.sin(2 * Math.PI * 2.3 * t) + 0.03 * Math.sin(2 * Math.PI * 3.7 * t + 1)
      PATHS[RIDE_SUBJECT]!(t, S1)
      onVehicle(RIDE, t, 0, 0, -120, S2)
      // 開頭多看前面的路與自己的車頭，飛機越飛越高、注視點跟著慢慢往上抬
      const lift = Math.min(1, Math.max(0, (t - RIDE_FROM) / (RIDE_TO - RIDE_FROM)))
      aimBetween(out.position, S1, S2, 0.62 - 0.2 * lift, out.target)
      shake(t, 0.3, 14, out)
      for (let k = 1; k < 4; k++) jolt(t, IMPACT_AT[k]!, 1.2 - 0.25 * k, out.target)
      out.fov = 84
    },
  },
  {
    from: RIDE_TO, subject: null,
    camera(t, out) {
      // 縱隊北頭外 150 m、路東邊 50 m、離地 30 m 往南沿著路看：最後兩顆一顆接一顆沿路往
      // 鏡頭這邊炸過來，後面幾輛已經在燒。注視點跟著炸點慢慢往近處移
      onRoad((COUNT - 1) * ROAD_GAP + 150, 50, out.position)
      out.position.y = 30
      const w = Math.min(1, Math.max(0, (t - RIDE_TO) / 2.0))
      onRoad((2.5 + 1.5 * w) * ROAD_GAP, 0, out.target)
      out.target.y = 12
      shake(t, 0.1, 16, out)
      for (let k = 3; k < COUNT; k++) jolt(t, IMPACT_AT[k]!, 0.6 + 0.4 * (k - 3), out.target)
      out.fov = 50
    },
  },
  {
    from: 29.6, subject: LAST,
    camera(t, out) {
      // 縱隊南邊 230 m、路東邊 50 m、離地 22 m 往北看：燒著的縱隊在路的盡頭，最後一架從
      // 右前方貼著田拉出來、往南飛過。注視點從燒著的縱隊慢慢轉到它身上
      onRoad(-230, 50, out.position)
      out.position.y = 22
      PATHS[LAST]!(t - 0.1, S1)
      const w = 0.45 * (1 - Math.min(1, Math.max(0, (t - 29.6) / 1.8)))
      aimBetween(out.position, S1, BURNING, w, out.target)
      shake(t, 0.15, 18, out)
      out.fov = 58
    },
  },
  {
    from: 31.8, subject: 4,
    camera(t, out) {
      // 第五架前方偏右 21 m 往後看：整架在畫面裡迎面爬升離場；後景是跟在它後面下方
      // 160 m、剛貼著田拉出來的第六架（翼尖還拖著白線），再後面是燒著的縱隊。鏡頭慢慢推近、
      // 往旁邊帶開。地平線水平
      // 【不貼近】低面數的模型貼到幾公尺內看得出面數，整架入鏡的距離剛好
      const u = t - 31.8
      PATHS[4]!(t, S1)
      PATHS[LAST]!(t, S2)
      // 架在「第六架 → 第五架」那條線的延長線上、往旁邊偏開：兩架在畫面裡一前一後疊著
      S3.subVectors(S1, S2).normalize()
      out.position.copy(S1).addScaledVector(S3, 20 - 1.5 * u)
      S3.cross(UP_AXIS).normalize()
      out.position.addScaledVector(S3, CLOSE_SIDE * (8 + 1 * u))
      out.position.y += 2
      aimBetween(out.position, S1, S2, 0.22, out.target)
      shake(t, 0.1, 23, out)
      out.fov = 50
    },
  },
  {
    from: 33.6, subject: LAST,
    camera(t, out) {
      // 最後一架左後下方、慢慢落後：它與前面幾架往南爬升，越來越遠
      const u = t - 33.6
      body(PATHS[LAST]!, t, -14, -22, 50 + 18 * u, true, out.position)
      body(PATHS[LAST]!, t, -4, 2, -20, true, out.target)
      shake(t, 0.1, 20, out)
      out.fov = 46
    },
  },
]

const PLANES: readonly ReelPlane[] = [
  ...PATHS.map((path) => ({ spec: JU87, path })),
  { spec: JU87, path: WING, extra: true },
]

export const STUKA: Shot = {
  id: 'stuka',
  duration: 35.6,
  // 夏日清晨：太陽在西南、仰角約 7°，地面拖著長影。編隊往北飛，太陽在它左後方
  timeOfDay: 'dawn',
  faceSun: false,
  terrain: 'farmland',
  // 只要那一條路。`ground` 一定要有墊面，而墊面的不規則邊往矩形外鋪 180 m、上面是
  // 一格格的鋪面髒污 —— 放在縱隊那裡是田中間一大塊方格斑。所以墊面丟到北邊 7 km 外的
  // 路旁（鏡頭拍不到的地平線下），鋪成犁過的田色，遠遠看到也只是一塊田
  ground: {
    pad: { x0: PAD_AT.x - 20, z0: PAD_AT.z - 20, x1: PAD_AT.x + 20, z1: PAD_AT.z + 20 },
    patches: [{ x0: PAD_AT.x - 220, z0: PAD_AT.z - 220, x1: PAD_AT.x + 220, z1: PAD_AT.z + 220, hex: 0x615242 }],
    roads: [[{ x: ROAD_S.x, z: ROAD_S.z }, { x: ROAD_N.x, z: ROAD_N.z }]],
  },
  // 半徑決定執行時落在農地的哪裡（`openSeaOrigin` 躲山丘）：3,500 m 落在 (12124, 7000)。
  // 圓心決定縱隊落在哪一塊田上：這裡縱隊每一輛車 40 m 內沒有樹籬與樹林，東邊 1 km 是
  // 一個村子。改了半徑或圓心，車就可能長在樹林裡、低空的鏡頭被樹擋住
  clear: { x: 279, z: -1561, radius: 3500 },
  planes: PLANES,
  props: PROPS,
  ships: [],
  cuts: CUTS,
  camera: edit(CUTS),
  events: timeline([
    // 俯衝線上零星幾朵高砲黑雲（縱隊上空 400～1300 m）；主角是地面的機槍曳光
    ...barrage(601, 13.0, 24.0, 0.7, (_t, out) => out.copy(BURNING).setY(850),
      { x: 260, yLo: -400, yHi: 450, z: 300 }, edit(CUTS), 70),
    // 一架兩枚、隔 0.06 秒：落點相差不到 3 m，疊成一團比單枚大的爆炸（一枚 500 kg）。
    // 用 `blast` 疊大火球的話，150 m 外就看得出低面數火球的稜角，冷卻時像一顆暗紅的石頭
    ...PATHS.map((_, i) => ({ at: releaseAt(i), kind: 'bomb' as const, actor: i, count: 2, interval: 0.06 })),
    ...GROUND_FIRE,
  ]),
}
