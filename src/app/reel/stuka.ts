import { Vector3 } from 'three'
import { JU87 } from '../../specs/ju87'
import { hash01 } from '../../core/hash'
import { scatterClouds, type CloudSpec } from '../../render/clouds'
import {
  BOMB_RELEASE_Y, barrage, bombAt, body, bodyUp, edit, propAt, propTravel, timeline, velocityAt,
  type Cut, type Path, type ReelCamera, type ReelEvent, type ReelPlane, type ReelProp, type Shot,
} from './kit'
import { aimBetween, dutch, jolt } from './reelCameraMath'

// ── 斯圖卡俯衝轟炸 ─────────────────────────────────────────
//
// 夏日正午、農地上空。六架 Ju 87 成右梯隊往北飛，一架接一架拉起、翻成腹部朝上、
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
// 【飛法照遊戲 AI（`ai/diveBomb.ts`）】平飛飛過縱隊一小段（約 110 m），翻到顛倒、用正
// 過載把機鼻拉過垂直，機鼻停在往南下方約 77°、回頭對著縱隊：機翼是正的、座艙朝前上方，
// 俯衝中不再滾。投彈後往機背那一側（前上方）拉起，就是繼續往南拉出、往南離場。
// 拉過垂直之前停手的話，機頭還朝北下、機背朝來的方向（南）而且略朝下，座艙在機身下側，
// 等於倒著衝
// 【過載不能碰到 0】機背方向是「加速度 + 重力」的方向；升力降到 0 的那一刻它沒有定義，
// 過了 0 就整個翻面 —— 畫面上是飛機在一幀裡轉 180°。所以俯衝中的過載是走直線所需
// 的九成多（`DIVE_N_FRACTION`），俯衝角一路慢慢變陡，過載始終大於 0

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
/**
 * 翻到顛倒往機背拉、機鼻拉過垂直之後，俯衝角回到這麼淺就鬆桿（rad）；鬆桿那 0.6 秒還會
 * 再帶過去幾度，俯衝角落在約 78°
 */
const PULL_THROUGH_STOP = 84 * Math.PI / 180
/**
 * 俯衝中的過載 = cos(俯衝角) × 這個比例：比剛好走直線的過載小一點，俯衝角一路慢慢變陡。
 * 【不能大於 1】大於 1 的話路徑往機背那一側彎、俯衝角越拉越淺
 */
const DIVE_N_FRACTION = 0.92
/** 俯衝中過載的下限：機背方向要一直有定義（見檔頭【過載不能碰到 0】） */
const DIVE_N_MIN = 0.15
/** 投彈（相對拉起），秒 */
const RELEASE = 13.5
/**
 * 拉出的過載。投彈時已經朝著機背那一側（南）俯衝，鬆開就直接往南拉平，不用先拉過垂直；
 * 過載大的話拉平只掉三百多公尺，底部在離地兩百多公尺，車上仰拍、縱隊南邊低空看拉出
 * 那兩刀就看不到它貼著田飛
 */
const PULL_OUT_G = 4.5
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

/**
 * 標準航跡的取樣間隔與長度，秒。
 * 【間隔要細】Hermite 取值的加速度在每個取樣點折一下；`flightPose` 用二階差分從路徑推
 * 機背方向，折點變成姿態以取樣頻率抖動（0.02 秒時翻身中約 ±0.25°）。鏡頭掛在機身上、
 * 機翼貼在畫面前景時，這一點抖動就看得出來。誤差隨間隔平方縮小
 */
const TABLE_STEP = 0.005
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
/** 拉過垂直、俯衝角回到 `PULL_THROUGH_STOP` 鬆桿的那一刻（相對拉起），秒 */
let pullDoneAt = Infinity
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
      // 機鼻拉過垂直（朝南）、俯衝角回到 `PULL_THROUGH_STOP` 就鬆桿
      if (pullDoneAt === Infinity && tau > PULL_IN_AT && f.z > 0 && -gamma < PULL_THROUGH_STOP) pullDoneAt = tau
      // 每一段照順序往下一段的過載平順混過去，權重都是連續的，過載不會跳
      let n = 1 + 0.45 * bump(tau, 0, PULLUP_END) - 0.35 * bump(tau, ROLL_AT, ROLL_LEN)
      n += (PULL_IN_G - n) * ramp(tau, PULL_IN_AT, 0.5)
      if (pullDoneAt !== Infinity) {
        const dive = Math.max(DIVE_N_MIN, DIVE_N_FRACTION * Math.cos(gamma))
        n += (dive - n) * ramp(tau, pullDoneAt, 0.6)
      }
      n += (PULL_OUT_G - n) * ramp(tau, RELEASE + 0.2, 0.7)
      if (climbAt !== Infinity) {
        const level = Math.cos(gamma) + 0.02
        n += (level - n) * ramp(tau, climbAt, 0.8)
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
 * 【收掉要用 `easeInOut`】smoothstep 的二階導數在收完那一刻跳一下，加速度跟著跳，推回來
 * 的姿態在那一幀轉一下；鏡頭掛在機身上時就是畫面抖一下
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
      const w = 1 - easeInOut(t, m - 3.2, 3.0)
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
 * 俯衝、拉出（不投彈）。側拍長機那一刀（鏡頭在西側）的後景：俯衝時晚 0.3 秒變成落在
 * 長機上方 24～30 m、偏北約 4 m、離鏡頭遠 9 m，畫面上在長機正上方略偏左 —— 兩架連起來
 * 的方向與長機機頭（朝右下）大致一致，讀得出一起往下衝。梯隊裡另外五架彼此隔一秒、
 * 上下差 130 m，任兩架都塞不進同一個側拍的畫面
 * 【`− V0 · WING_DELAY`】晚 0.3 秒在巡航是水平落後，這一項把它抵掉，巡航時才在長機
 * 右後下方。俯衝時它再往北偏的話，畫面上落到長機左上，兩架連線斜向左下、與長機
 * 朝右下的機頭反向，看起來像兩架各衝各的
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
  const w = 1 - easeInOut(t, LEAD_AT + WING_DELAY - 3.2, 3.0)
  out.x += w * 1.0 * Math.sin(0.41 * t + 5.1)
  out.y += w * 1.2 * Math.sin(0.47 * t + 2.3)
  return out
}
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

/** 投彈那一刀拍的那一枚：長機的炸彈（第一顆落地的）投下那一刻的機腹點與速度 */
const DROP_AT = releaseAt(0)
const DROP_P = body(LEAD, DROP_AT, 0, BOMB_RELEASE_Y, 0, false, new Vector3())
const DROP_V = velocityAt(LEAD, DROP_AT, new Vector3())
/**
 * 投彈那一刀：鏡頭在長機左翼尖外、往機腹那一側 `-DROP_LOW` m、略後（機身座標），上方跟著
 * 機背 —— 從斜下方看機腹，機身橫在畫面裡、機頭朝左，炸彈在兩支起落架之間的機腹下。
 * 【要低過翼面】跟機腹差不多高的話，左翼與起落架整片擋在機腹前面
 * 投彈那一刻脫鉤：之後順著投彈那一刻的速度
 * 直線往下、上方停在那一刻的機背。飛機拉起往畫面上方離開；炸彈留在鏡頭前，被重力往前
 * （畫面左）、往機腹那一側（畫面下）帶開 —— 看得到它離開機腹往下掉
 * 【左側】機頭朝左，炸彈往前帶開時往畫面中間走；在右側的話它往右緣跑，一下就出畫
 */
const DROP_SIDE = 7
const DROP_LOW = -8
const DROP_BACK = 3
const DROP_FOV = 40
const DROP_CAM = body(LEAD, DROP_AT, -DROP_SIDE, DROP_LOW, DROP_BACK, false, new Vector3())
const DROP_UP = bodyUp(LEAD, DROP_AT, new Vector3())
/** 注視點從「投彈點順著速度走到哪」轉到炸彈本身：投彈後這一段時間裡從一半轉到全跟 */
const DROP_FOLLOW_AT = 0.5
const DROP_FOLLOW = 0.6

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
/** 縱隊的行軍速度，m/s（約 29 km/h）。整段 37.6 秒開 300 m，路兩頭各 7.5 km */
const COLUMN_SPEED = 8
/** 沒挨炸的車偏離路中線多少，m。車寬 3 m：偏 3.6 m 與中線上的殘骸留 0.6 m */
const COLUMN_SIDE = 3.6

/** 路上第 `s` 公尺那一點（從第一個落點量起，往北為正），寫進 `out` */
function onRoad(s: number, side: number, out: Vector3): Vector3 {
  return out.copy(IMPACTS[0]!).addScaledVector(ROAD_DIR, s).addScaledVector(ROAD_RIGHT, side)
}

/**
 * 第一顆炸開那一刻全隊踩煞車，`COLUMN_BRAKE.seconds` 秒內停住、之後原地不動（`propTravel`）
 */
const COLUMN_BRAKE = { at: IMPACT_AT[0]!, seconds: 1.5 }
const COLUMN_MOTION: ReelProp = { id: 'tank', x: 0, z: 0, heading: 0, speed: COLUMN_SPEED, brake: COLUMN_BRAKE }
/**
 * 第 `i` 個落點那一輛第 0 秒在路上第幾公尺：炸彈落地那一刻開到落點（含煞車，所以第三顆
 * 以後的目標是剛好停在落點上）
 * 【出發點要照煞車算】照等速算的話，煞停之後還沒挨炸的目標停在落點前面，後面幾顆炸空
 */
const spawnOnRoad = (i: number): number => i * ROAD_GAP - propTravel(COLUMN_MOTION, IMPACT_AT[i]!)

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
    out.push({ id, x: p.x, z: p.z, heading: COLUMN_HEADING, speed: COLUMN_SPEED, brake: COLUMN_BRAKE })
  }
  return out
})()

/**
 * 交叉剪接（見刀表）各刀的起點：飛行員視角 1.7、戰車 1.3、長機側拍 1.5、卡車 1.0、
 * 駕駛室 1.1 秒，接投彈那一刀。最後兩刀都在地上、一刀比一刀近，收在長機迎面衝下來
 */
const X_PILOT = 13.6
const X_TANK = 15.3
const X_SIDE = 16.6
const X_TRUCK = 18.1
const X_CAB = 19.1
const X_DROP = 20.2
/**
 * 交叉剪接裡架在車上的三刀各架在哪一台：卡車旁、戰車右後方、卡車駕駛室旁。都不是
 * 挨炸的車，也不在 `GROUND_FIRE` 輪流開火的那十台裡 —— 各自另外排一段機槍（`MOUNT_FIRE`），
 * 鏡頭架在上面的那一刀它一定在打
 * 【鏡頭離地下限 1 m】再扣掉車身顛簸（`jostle` 最多 0.08 m）
 */
const TRUCK_PROP = 0
const TANK_PROP = 4
const CAB_PROP = 6
/**
 * 卡車那一刀（車身座標：x 右、y 離地、z 車尾，m）：蹲在車尾右後方（命中盒車尾 3.36，外擴
 * 0.3）、比車身頂（2.70）低，往前上方看。注視點從長機偏向車尾頂邊右角（`TRUCK_W`）：篷布
 * 的角在畫面下段，長機在它上方 —— 同一個方位，都落在選單右邊那半
 * 【要貼近、要低】車尾頂邊離鏡頭水平不到 1 m、高 1.6 m，仰角 60° 上下，才跟仰角約 77° 的
 * 長機塞得進同一個長焦畫面；再退後，車身就掉出畫面下緣
 */
const TRUCK_X = 1.1
const TRUCK_Y = 1.1
const TRUCK_Z = 4.1
const TRUCK_EDGE_X = 0.9
const TRUCK_EDGE_Y = 2.7
const TRUCK_EDGE_Z = 3.3
const TRUCK_W = 0.33
const TRUCK_FOV = 26
/**
 * 戰車那一刀：蹲在砲塔左後方（命中盒半寬 1.5，外擴 0.3）、比砲塔低 —— 砲塔與往前伸的砲管
 * 在注視點右邊，落在選單右邊那半。開頭 `TANK_HOLD` 秒注視點
 * 偏向砲管前端那一點（`TANK_W`），砲塔與砲管的剪影在下緣；之後抬到長機、視角從
 * `TANK_FOV0` 收到 `TANK_FOV1`
 */
const TANK_X = -2.4
const TANK_Y = 1.1
const TANK_Z = 3.0
const TANK_GUN_Y = 2.2
const TANK_GUN_Z = -1.5
const TANK_W = 0.5
const TANK_HOLD = 0.35
const TANK_FOV0 = 80
const TANK_FOV1 = 14
/** 駕駛室那一刀：貼著駕駛室右側車門（命中盒半寬 1.21，外擴 0.3）、比車頂低 */
const CAB_X = 1.6
const CAB_Y = 1.7
const CAB_Z = -2.2
const ON_VEHICLE = new Vector3()

/**
 * 投彈那一刀拍到炸彈脫離、飛機拉起，就跳接（`TimeJump`）到縱隊北頭沿路看那一刀：片內
 * `JUMP_FROM` 直接跳到 `JUMP_TO`，炸彈往下掉的那幾秒剪掉，切過去 0.1 秒後第一顆炸開
 * 【跳到落地前】跳過落地那一刻的話，炸彈在地底下才被看到，炸點偏掉
 */
const JUMP_FROM = 21.6
const JUMP_TO = 24.4

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
  propAt(p, t, ON_VEHICLE)
  const c = Math.cos(p.heading)
  const s = Math.sin(p.heading)
  return out.set(ON_VEHICLE.x + x * c + z * s, y, ON_VEHICLE.z - x * s + z * c)
}

const ROAD_FAR = 7500
const ROAD_S = onRoad(-ROAD_FAR, 0, new Vector3())
const ROAD_N = onRoad((COUNT - 1) * ROAD_GAP + ROAD_FAR, 0, new Vector3())
/** 墊面放在路的北段、縱隊外 7 km（見 `STUKA.ground`） */
const PAD_AT = onRoad((COUNT - 1) * ROAD_GAP + 7000, 260, new Vector3())

// ── 鏡頭工具 ───────────────────────────────────────────────

const S1 = new Vector3()
const S2 = new Vector3()

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
/** 燒著的那一段縱隊（前三個落點的中間）：收尾幾刀背景裡的火 */
const BURNING = onRoad(ROAD_GAP, 0, new Vector3())
const LAST = COUNT - 1
/**
 * 第二架座艙罩後上方看長機翻身那一刀（機身座標：x 右、y 上、z 機尾，m）：座艙命中盒頂
 * 1.18、外擴 0.5；垂尾命中盒從往後 3.87 m 起。注視點從長機偏向自己機首正前方 `HERO_W`，
 * 自己的座艙罩與機背落在畫面右下
 */
const HERO = PATHS[1]!
const HERO_CAM_X = 0.4
const HERO_CAM_Y = 1.8
const HERO_CAM_Z = 3.3
const HERO_W = 0.2
const HERO_FOV = 64
/**
 * 第六架機尾後上方看前面幾架翻下去那一刀：垂尾命中盒到往後 7.73 m、頂 1.94，平尾到往後
 * 7.01 m（都外擴 0.5），鏡頭在它們後上方。注視點從第五架偏向自己機首正前方 `TAIL6_W`
 */
const TAIL6 = PATHS[5]!
const TAIL6_Y = 2.3
const TAIL6_Z = 8.8
const TAIL6_W = 0.5
const TAIL6_FOV = 66
/**
 * 第五架後座機槍手位置那一刀：座艙罩後緣右上方（座艙命中盒到往後 2.43 m、頂 1.18，外擴
 * 0.5；垂尾從往後 3.87 m 起），往後看第六架、注視點偏向燒著的縱隊 `GUNNER_W`
 * 【偏右】架在機身中線上的話垂尾是正對鏡頭的一條細線，讀不出是尾翼
 */
const GUNNER5 = PATHS[4]!
const GUNNER_X = 0.9
const GUNNER_Y = 1.9
const GUNNER_Z = 3.2
const GUNNER_W = 0.25
const GUNNER_FOV = 62

/** 第 `i` 架那一枚炸彈落在哪一台車上（落點上那一台，見 `PROPS`） */
const targetProp = (i: number): number => LEAD_IN + i * PER_GAP

/**
 * 飛行員視角：鏡頭在長機座艙罩後上方（機身座標 y `PILOT_UP`、往後 `PILOT_BACK` m），長焦
 * 對準縱隊，整刀從 `fov0` 收到 `fov1`（對著目標衝過去）。上方跟著機背，路在畫面裡上下走
 * 向；長焦下看不到自己的機身
 * 【長焦】縱隊在一公里外，從上往下看一台車只有 3 × 6.7 m：視角 15° 時是十來個像素的
 * 小點，畫面上讀起來只有田與路
 * 【要高過槳盤】槳盤半徑約 1.7 m；視線穿過槳盤的話，整個長焦畫面蒙上一層半透明的灰
 * 【垂尾】命中盒從往後 3.87 m 起（外擴 0.5），鏡頭在它前面
 */
const PILOT_UP = 2.8
const PILOT_BACK = 3.2
const PILOT_FOV0 = 7
const PILOT_FOV1 = 5
/** `w` = 注視點從縱隊中段（前兩個落點的中間）偏向長機那一枚目標的比例 */
function pilotView(t: number, from: number, to: number, fov0: number, fov1: number, w: number, out: ReelCamera): void {
  body(LEAD, t, 0, PILOT_UP, PILOT_BACK, false, out.position)
  propAt(PROPS[targetProp(0)]!, t, S1)
  propAt(PROPS[targetProp(1)]!, t, S2)
  out.target.copy(S2).lerp(S1, 0.5 + 0.5 * w)
  bodyUp(LEAD, t, out.up)
  out.fov = fov0 + (fov1 - fov0) * Math.min(1, Math.max(0, (t - from) / (to - from)))
  shake(t, 0.15 * out.fov / 16, 27, out)
}

/** 車在開：鏡頭跟著車身慢晃加一點顛，疊進 `p` */
function jostle(t: number, p: Vector3): void {
  p.y += 0.05 * Math.sin(2 * Math.PI * 2.3 * t) + 0.03 * Math.sin(2 * Math.PI * 3.7 * t + 1)
}

/**
 * 車上往上看長機：注視點介於長機與車頭前方 200 m 的路面之間（`w` = 偏向路面的比例），
 * 加手持晃動（長焦下照視角收小）
 */
function lookUpAtLead(t: number, k: number, w: number, seed: number, out: ReelCamera): void {
  LEAD(t, S1)
  onVehicle(k, t, 0, 0, -200, S2)
  aimBetween(out.position, S1, S2, w, out.target)
  shake(t, 0.35 * Math.pow(out.fov / 40, 0.6), seed, out)
}
/** 駕駛室那一刀：注視點偏向路面的比例與視角（度） */
const CAB_W = 0
const CAB_FOV = 6

/**
 * 沿路炸過來那一刀：到第 `WALK_TO` 秒為止注視點從路上第 `WALK_AIM0` 個落點間距移到第
 * `WALK_AIM1` 個（第一顆落在 0、最後一顆落在 5）
 */
const WALK_TO = 29.6
const WALK_AIM0 = 0.8
const WALK_AIM1 = 4.0
/**
 * 善後那一刀：起訖秒數；縱隊北頭再往北 `AFTER_NORTH` m、路西邊 `AFTER_WEST` m、離地
 * `AFTER_HIGH` m，往東南看燒著的那一段：六個落點各冒一根煙柱（地面的火，見
 * `render/groundFires.ts`），往南爬升的飛機落在縱隊右後方的天上
 * 【要高過樹籬】這一帶每隔一兩百公尺就是一排樹籬，鏡頭低了前景整片樹冠、縱隊被擋住
 */
const AFTER_FROM = 33.6
const AFTER_TO = 37.6
const AFTER_NORTH = 450
const AFTER_WEST = 420
const AFTER_HIGH = 100
const AFTER_FOV = 30
const AFTER_CAM = onRoad((COUNT - 1) * ROAD_GAP + AFTER_NORTH, -AFTER_WEST, new Vector3()).setY(AFTER_HIGH)
const AFTER_AIM = onRoad(2.5 * ROAD_GAP, 0, new Vector3()).setY(25)

/**
 * 側拍長機那一刀裡曳光瞄長機時偏開多少，m。偏移是每一軸各自 ±這麼多，最遠約 1.7 倍
 * （12 m），在長機四周散開往上竄
 * 【不能再大】鏡頭在長機西側 13 → 11.5 m；往西偏 7 m 的那一發離鏡頭還有 4 m，再大就有
 * 曳光從鏡頭上穿過去，整個畫面一道白
 */
const CROSSFIRE_MISS = 7

/**
 * 地面機槍的節奏：每台每 `FIRE_PERIOD` 秒打一段 `FIRE_BURST`～`FIRE_BURST + FIRE_BURST_SPREAD`
 * 秒的短點放。十台錯開，同一時間約三道
 * 【點放不連發】一道曳光每秒十幾發（放映機的射速），連打兩三秒、五道一起，讀起來是一片
 * 掃不完的光網，像射速過高
 */
const FIRE_PERIOD = 4.5
const FIRE_BURST = 0.9
const FIRE_BURST_SPREAD = 0.6

/**
 * 縱隊朝俯衝的斯圖卡打的機槍：每隔一台（十台）輪流點放（`FIRE_*`），各車的起點錯開。
 * 從 10.5 秒（長機拉進俯衝）打到 31.5 秒（最後一架
 * 拉出），每一段挑那時正在俯衝或拉出的一架打，瞄點偏開 25～45 m，曳光從飛機旁邊擦過去。
 * 跨到側拍長機那一刀的段改瞄長機、偏開 `CROSSFIRE_MISS`。炸毀的車自己停火
 * 【曳光只飛 1.2 秒】850 m/s 打不到一公里外：俯衝的前半段，曳光是往上竄、在半空熄掉
 */
const GROUND_FIRE: ReelEvent[] = (() => {
  const out: ReelEvent[] = []
  const from = 10.5
  const to = 31.5
  const push = (k: number, j: number, at: number, seconds: number): void => {
    if (seconds < 0.3) return
    const mid = at + seconds / 2
    // 那一刻在俯衝線上的：拉進俯衝之後、拉出到一半之前
    const live: number[] = []
    for (let i = 0; i < COUNT; i++) if (mid > peelAt(i) + PULL_IN_AT && mid < releaseAt(i) + 4.5) live.push(i)
    const cross = at < X_TRUCK && at + seconds > X_SIDE
    if (!cross && live.length === 0) return
    out.push({
      at, kind: 'groundFire', prop: k, actor: cross ? 0 : live[(k + j) % live.length]!, seconds,
      miss: cross ? CROSSFIRE_MISS : 25 + hash01(k * 29 + j + 11) * 20,
    })
  }
  for (let k = 1; k < PROPS.length; k += 2) {
    // 十台的起點均勻錯開在一個週期裡，同一時間的道數才穩定
    let at = from + ((k - 1) / 2) * (FIRE_PERIOD / 10)
    for (let j = 0; at < to; j++) {
      push(k, j, at, Math.min(FIRE_BURST + hash01(k * 17 + j + 5) * FIRE_BURST_SPREAD, to - at))
      at += FIRE_PERIOD
    }
  }
  return out
})()

/**
 * 交叉剪接裡鏡頭架著的三台車各點放一段，瞄長機、偏開 20 m：從切進來前 `MOUNT_LEAD` 秒
 * 打到那一刀結束，那一刀裡曳光從鏡頭旁邊往上竄向畫面裡的長機。都在寧靜那一刀之前打完
 */
const MOUNT_LEAD = 0.3
/**
 * 側拍長機那一刀的交叉火網：另外三台輪流點放瞄長機、偏開 `CROSSFIRE_MISS`，曳光在那一刀
 * 的後段一陣一陣竄到長機身邊
 * 【照刀尾排】那一刀裡長機離縱隊 1150 → 950 m，曳光只飛 1.2 秒（1020 m），刀尾半秒才
 * 打得到它身邊；三段都排在刀尾往前推 1 秒多開打，前段只看得到曳光從下面竄上來
 */
const CROSS_FIRE: ReelEvent[] = [
  { at: X_TRUCK - 1.7, kind: 'groundFire', prop: 8, actor: 0, seconds: 0.6, miss: CROSSFIRE_MISS },
  { at: X_TRUCK - 1.2, kind: 'groundFire', prop: 10, actor: 0, seconds: 0.6, miss: CROSSFIRE_MISS },
  { at: X_TRUCK - 0.8, kind: 'groundFire', prop: 12, actor: 0, seconds: 0.5, miss: CROSSFIRE_MISS },
]
const MOUNT_FIRE: ReelEvent[] = [
  { at: X_TANK - MOUNT_LEAD, kind: 'groundFire', prop: TANK_PROP, actor: 0, seconds: X_SIDE - X_TANK + MOUNT_LEAD, miss: 20 },
  { at: X_TRUCK - MOUNT_LEAD, kind: 'groundFire', prop: TRUCK_PROP, actor: 0, seconds: X_CAB - X_TRUCK + MOUNT_LEAD, miss: 20 },
  { at: X_CAB - MOUNT_LEAD, kind: 'groundFire', prop: CAB_PROP, actor: 0, seconds: X_DROP - X_CAB + MOUNT_LEAD, miss: 20 },
]

// ── 刀表 ───────────────────────────────────────────────────
//
//   0.0–3.2   編隊裡：鏡頭在長機正後方、比隊形快一點往前滑，從第二架左邊 14 m 掠過，鏡頭
//             跟著它轉、慢慢滾轉；長機在左前方，後面一整排梯隊往右後方排開，底下是田
//   3.2–6.8   路邊固定機位從車的斜前方拍：縱隊揚著塵迎面開來、從鏡頭旁開過；鏡頭往上抬到
//             高空的梯隊，zoom in 到六架讀得出來 —— 地面看見了他們
//   6.8–10.2  第二架座艙罩後上方：自己的左翼在前景，長機在左前方拉起、翻成腹部朝上、拉進
//             俯衝往下掉；8.8 秒自己也跟著翻，地平線跟著轉
//   10.2–13.6 第六架機尾後上方順著機背往前看：自己的垂尾、座艙罩與左翼在右下，前方第四、
//             五架一架接一架翻下去，12.8 秒自己也開始翻
//   ── 交叉剪接：空中、地面輪流；飛行員往下看與車上往上看互為對照，最後兩刀在地上 ──
//   13.6–15.3 飛行員視角：長機上長焦對準路上的縱隊，一台台車讀得出來，一邊收窄
//   15.3–16.6 砲塔左後方低角度：砲塔與砲管的剪影在右下、自己的機槍曳光往上竄；急著往上
//             抬、收長焦，刀尾一串斯圖卡迎面衝下來
//   16.6–18.1 長機西側 13 → 11.5 m 機身特寫：機頭朝右下往下衝，後上方是僚機，刀尾曳光
//             一陣一陣竄到它身邊
//   18.1–19.1 卡車車尾右後方往上看：篷布的角在下段，曳光從它後面竄出，上方一串斯圖卡
//   19.1–20.2 卡車駕駛室旁往正上方看（超長焦）：長機與僚機迎面衝下來，倒鷗翼與起落架
//             佔滿畫面
//   ──
//   20.2–21.6 長機左下方看機腹：炸彈掛在兩支起落架之間，20.5 秒脫離機腹，飛機拉起往上
//             離開、炸彈往下掉開
//   21.6–29.6 跳接（片內 21.6 直接跳到 24.4，炸彈往下掉的幾秒剪掉）到縱隊北頭往南沿著路看：
//             0.1 秒後路的盡頭第一顆炸開、全隊煞停，六顆一顆接一顆沿路往鏡頭炸過來
//   29.6–31.8 縱隊南邊 230 m 低空往北看：燒著的縱隊在路的盡頭，最後一架從右邊貼著田拉出來
//   31.8–33.6 第五架後座機槍手的位置往後看：自己的垂尾與平尾在右下，第六架剛貼著田拉出來
//             爬升追上來，再後面是路上燒著的縱隊
//   33.6–37.6 善後：縱隊北邊遠處、高過樹籬，幾乎不動地看著燒著的縱隊冒起六根煙柱，飛機
//             是南邊天上的一串小點

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
    from: 6.8, subject: 0, mount: 1,
    camera(t, out) {
      // 第二架座艙罩後上方往左前方看：自己的座艙罩與機背在畫面右下，長機在左前方 7.0 秒
      // 拉起一下、7.8 秒往左翻成腹部朝上、9.6 秒拉進俯衝往下掉；8.8 秒自己也跟著翻，地平線
      // 跟著轉 —— 下一個就輪到我。上方跟著機身
      body(HERO, t, HERO_CAM_X, HERO_CAM_Y, HERO_CAM_Z, false, out.position)
      LEAD(t, S1)
      body(HERO, t, 0, 0, -300, false, S2)
      aimBetween(out.position, S1, S2, HERO_W, out.target)
      bodyUp(HERO, t, out.up)
      shake(t, 0.12, 5, out)
      out.fov = HERO_FOV
    },
  },
  {
    from: 10.2, subject: 4, mount: 5,
    camera(t, out) {
      // 第六架機尾後上方順著機背往前看：自己的垂尾、平尾與座艙罩在畫面下段，左前方的第四架
      // 10.8 秒、第五架 11.8 秒一架接一架翻成腹部朝上、拉進俯衝、翼尖拉出白線往下掉；12.8 秒
      // 自己也開始翻，整個畫面跟著轉。上方跟著機身
      // 【跟上一刀分開】上一刀是座艙罩後面看左翼外的長機；這一刀從機尾看，前景是垂尾
      body(TAIL6, t, 0, TAIL6_Y, TAIL6_Z, false, out.position)
      PATHS[4]!(t, S1)
      body(TAIL6, t, 0, 0, -300, false, S2)
      aimBetween(out.position, S1, S2, TAIL6_W, out.target)
      bodyUp(TAIL6, t, out.up)
      shake(t, 0.1, 9, out)
      out.fov = TAIL6_FOV
    },
  },
  {
    from: X_PILOT, subject: null, mount: 0,
    camera(t, out) {
      // 飛行員視角：長機座艙罩後上方，長焦對準路上的縱隊，一邊往前衝一邊收窄。地面的機槍
      // 曳光從下面往上竄
      pilotView(t, X_PILOT, X_TANK, PILOT_FOV0, PILOT_FOV1, 0, out)
    },
  },
  {
    from: X_TANK, subject: 0, groundMount: TANK_PROP,
    camera(t, out) {
      // 砲塔左後方、蹲得比砲塔低：開頭砲塔與砲管的剪影在畫面右下、長機在上緣；鏡頭急著
      // 往上抬、收長焦，刀尾長機在畫面中間、讀得出倒鷗翼。自己這台的機槍曳光往上竄
      // 【長機一直在畫面裡】抬頭的起點就把它放在上緣，不是從砲塔搖上去才出現
      onVehicle(TANK_PROP, t, TANK_X, TANK_Y, TANK_Z, out.position)
      jostle(t, out.position)
      const k = easeInOut(t, X_TANK + TANK_HOLD, X_SIDE - X_TANK - TANK_HOLD)
      LEAD(t, S1)
      onVehicle(TANK_PROP, t, 0, TANK_GUN_Y, TANK_GUN_Z, S2)
      aimBetween(out.position, S1, S2, TANK_W * (1 - k), out.target)
      out.fov = TANK_FOV0 + (TANK_FOV1 - TANK_FOV0) * k
      shake(t, 0.35 * Math.pow(out.fov / 40, 0.6), 2, out)
    },
  },
  {
    from: X_SIDE, subject: 0,
    camera(t, out) {
      // 長機西側 13 m 跟拍、往東看，幾乎是機身特寫，鏡頭正立不歪（上方是世界的上方），
      // 手持晃得很兇：前景的長機機首朝下往畫面下方衝，後景是它的右僚機，在它上方約 25 m
      // （畫面上方）一起衝下來。縱隊從南邊（畫面右下）打上來的曳光貼著長機往上竄。鏡頭跟著
      // 長機往下掉、慢慢推近到 11.5 m
      // 【鏡頭在西側】往南俯衝約 77°，從西側看南邊在畫面右邊，機頭朝右下偏離垂直約 13°，
      // 座艙罩朝畫面右上，看得出是正著衝
      // 【彈道碰不到鏡頭】曳光從南邊下方打上來、瞄點往鏡頭這側最多偏 7 m（`CROSSFIRE_MISS`），
      // 鏡頭在 11.5 m 外的側面
      // 【交叉剪接的後段才放它】離縱隊一公里以內曳光才打得到長機身邊（見 `CROSS_FIRE`）
      const u = t - X_SIDE
      LEAD(t, out.position).add(S1.set(-(13 - u), -2, 2))
      LEAD(t, S1)
      WING(t, S2)
      aimBetween(out.position, S1, S2, 0.4, out.target)
      shake(t, 0.6, 22, out)
      out.fov = 70
    },
  },
  {
    from: X_TRUCK, subject: 0, groundMount: TRUCK_PROP,
    camera(t, out) {
      // 卡車車尾右後方、比車身低，往前上方看：車尾篷布的角在畫面下段，自己這台的機槍曳光
      // 從它後面往上竄，長機與後面幾架排成一串衝下來。車在開：慢晃加一點顛
      onVehicle(TRUCK_PROP, t, TRUCK_X, TRUCK_Y, TRUCK_Z, out.position)
      jostle(t, out.position)
      LEAD(t, S1)
      onVehicle(TRUCK_PROP, t, TRUCK_EDGE_X, TRUCK_EDGE_Y, TRUCK_EDGE_Z, S2)
      aimBetween(out.position, S1, S2, TRUCK_W, out.target)
      out.fov = TRUCK_FOV
      shake(t, 0.25 * Math.pow(out.fov / 40, 0.6), 1, out)
    },
  },
  {
    from: X_CAB, subject: 0, groundMount: CAB_PROP,
    camera(t, out) {
      // 卡車駕駛室右側車門旁往正上方看（超長焦）：自己這台的機槍曳光往上竄，長機與僚機
      // 迎面衝下來，倒鷗翼與起落架佔滿畫面
      onVehicle(CAB_PROP, t, CAB_X, CAB_Y, CAB_Z, out.position)
      jostle(t, out.position)
      out.fov = CAB_FOV
      lookUpAtLead(t, CAB_PROP, CAB_W, 3, out)
    },
  },
  {
    from: X_DROP, subject: null,
    camera(t, out) {
      // 長機左下方看機腹：機身橫在畫面裡、機頭朝左。20.5 秒炸彈脫離機腹，
      // 長機 4.5 G 拉起、翼尖拖著白線往畫面上方離開；鏡頭脫鉤（`DROP_CAM`），炸彈往左下
      // 掉開、注視點轉去跟它；1.1 秒後剪到爆炸那一刀（炸彈往下掉的幾秒剪掉，見 `JUMP_*`）。
      // 拉起那一下氣流掃過，震一下
      if (t < DROP_AT) {
        body(LEAD, t, -DROP_SIDE, DROP_LOW, DROP_BACK, false, out.position)
        body(LEAD, t, 0, BOMB_RELEASE_Y, 0, false, out.target)
        bodyUp(LEAD, t, out.up)
      } else {
        const u = t - DROP_AT
        out.position.copy(DROP_CAM).addScaledVector(DROP_V, u)
        S1.copy(DROP_P).addScaledVector(DROP_V, u)
        bombAt(DROP_P, DROP_V, u, S2)
        out.target.copy(S1).lerp(S2, 0.5 + 0.5 * ramp(t, DROP_AT + DROP_FOLLOW_AT, DROP_FOLLOW))
        out.up.copy(DROP_UP)
      }
      shake(t, 0.1, 23, out)
      jolt(t, DROP_AT + 0.4, 1.0, out.target)
      out.fov = DROP_FOV
    },
  },
  {
    from: JUMP_FROM, subject: null,
    camera(t, out) {
      // 跳接進來（片內 21.6 → 24.4）：縱隊北頭外 150 m、路東邊 50 m、離地 30 m 往南沿著路看。
      // 0.1 秒後路的盡頭第一顆炸開、全隊煞停，之後一顆接一顆沿路往鏡頭這邊炸過來。注視點
      // 跟著炸點慢慢往近處移，每一下都震一下
      onRoad((COUNT - 1) * ROAD_GAP + 150, 50, out.position)
      out.position.y = 30
      const w = Math.min(1, Math.max(0, (t - JUMP_TO) / (WALK_TO - JUMP_TO)))
      onRoad((WALK_AIM0 + (WALK_AIM1 - WALK_AIM0) * w) * ROAD_GAP, 0, out.target)
      out.target.y = 12
      shake(t, 0.1, 16, out)
      for (let k = 0; k < COUNT; k++) jolt(t, IMPACT_AT[k]!, 0.3 + 0.25 * k, out.target)
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
    from: 31.8, subject: LAST, mount: 4,
    camera(t, out) {
      // 後座機槍手的位置：第五架座艙罩後緣上方往後看，自己的機背與垂尾在畫面下緣，跟在
      // 後面下方的第六架剛貼著田拉出來、爬升追上來，再後面是冒煙的縱隊。上方跟著機身
      body(GUNNER5, t, GUNNER_X, GUNNER_Y, GUNNER_Z, false, out.position)
      PATHS[LAST]!(t, S1)
      aimBetween(out.position, S1, BURNING, GUNNER_W, out.target)
      bodyUp(GUNNER5, t, out.up)
      shake(t, 0.12, 23, out)
      out.fov = GUNNER_FOV
    },
  },
  {
    from: AFTER_FROM, subject: null,
    camera(t, out) {
      // 善後：遠處離地 `AFTER_CAM.y` m 幾乎不動地看著燒著的縱隊，幾道煙柱往上飄，飛機已經
      // 是南邊天上的小點。只慢慢推一點點，讓觀眾喘口氣
      const u = (t - AFTER_FROM) / (AFTER_TO - AFTER_FROM)
      out.position.copy(AFTER_CAM).lerp(AFTER_AIM, 0.03 * u)
      out.target.copy(AFTER_AIM)
      shake(t, 0.03, 35, out)
      out.fov = AFTER_FOV
    },
  },
]

/**
 * 靜止的雲（局部座標的雲底中心與水平半徑）：給飛機一個參照物，讀得出速度與往下衝。
 * 巡航那一層的雲底比隊形（1720 m）低二、三十公尺，雲頂與飛機同高
 * 【不擋主角】每一朵都放在鏡頭路徑旁邊、主角後面；鏡頭也不鑽進雲裡（測試會查）
 */
const CLOUDS: readonly CloudSpec[] = [
  // 編隊右前方：第一刀隊形從它旁邊飛過
  { x: 170, y: 1690, z: 250, radius: 70 },
  // 長機翻身處的西邊：第二架座艙罩後面看長機翻身時在左前方
  { x: -170, y: 1690, z: -170, radius: 75 },
  // 隊形前方（北）：第二架與第六架看前面幾架翻下去時的後景
  { x: -60, y: 1695, z: -520, radius: 90 },
  // 俯衝線東邊 160 m、1000 m 高：側拍長機時在後景往上掠過；地面仰看時在飛機旁邊
  { x: 150, y: 1000, z: -230, radius: 60 },
  // 俯衝線西邊、760 m 高：地面仰看的廣角裡多一朵
  { x: -160, y: 760, z: -150, radius: 70 },
  // 縱隊東邊上空、1300 m 高：地面仰看與路邊拍車時天上的雲
  { x: 220, y: 1300, z: -60, radius: 110 },
  // 編隊右邊遠處：第一刀地平線上、隊形後面
  { x: 280, y: 1690, z: 470, radius: 90 },
  // 遠景：鏡頭離圓心最遠約 0.75 km，圓環從 1.5 km 起
  ...scatterClouds({ x: 50, z: -200, inner: 1500, outer: 6500, yMin: 1100, yMax: 2100, rMin: 70, rMax: 150, count: 50, seed: 1 }),
]

const PLANES: readonly ReelPlane[] = [
  ...PATHS.map((path) => ({ spec: JU87, path })),
  { spec: JU87, path: WING, extra: true },
]

export const STUKA: Shot = {
  id: 'stuka',
  duration: AFTER_TO,
  jumps: [{ from: JUMP_FROM, to: JUMP_TO }],
  clouds: CLOUDS,
  // 夏日正午：太陽在西南、仰角約 60°。編隊往北飛，太陽在它左後方
  timeOfDay: 'noon',
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
  // 【跟著炸點走】炸點（也就是縱隊）在局部座標裡移了多少，圓心就移多少，縱隊才落在同一塊田上
  clear: { x: 331.5, z: -860.4, radius: 3500 },
  planes: PLANES,
  props: PROPS,
  ships: [],
  cuts: CUTS,
  camera: edit(CUTS),
  events: timeline([
    // 俯衝線上零星幾朵高砲黑雲（縱隊上空 400～1300 m）；主角是地面的機槍曳光
    ...barrage(601, 13.0, 24.0, 0.7, (_t, out) => out.copy(BURNING).setY(850),
      { x: 260, yLo: -400, yHi: 450, z: 300 }, edit(CUTS), 70),
    // 一架一枚（500 kg）。投彈那一刀從機腹下近看，兩枚前後只差幾公尺會疊成一團讀不清
    ...PATHS.map((_, i) => ({ at: releaseAt(i), kind: 'bomb' as const, actor: i, count: 1, interval: 0 })),
    ...GROUND_FIRE,
    ...MOUNT_FIRE,
    ...CROSS_FIRE,
  ]),
}
