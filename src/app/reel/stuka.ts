import { Vector3 } from 'three'
import { JU87 } from '../../specs/ju87'
import { hash01 } from '../../render/scatter'
import {
  BOMB_RELEASE_Y, barrage, bombAt, body, bodyUp, edit, propAt, timeline, velocityAt,
  type Cut, type Path, type ReelCamera, type ReelEvent, type ReelPlane, type ReelProp, type Shot,
} from './kit'

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
  const w = 1 - ramp(t, LEAD_AT + WING_DELAY - 3.2, 3.0)
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

/** 慢動作那一刀拍的那一枚：長機的炸彈（第一顆落地的）投下那一刻的機腹點與速度 */
const DROP_AT = releaseAt(0)
const DROP_P = body(LEAD, DROP_AT, 0, BOMB_RELEASE_Y, 0, false, new Vector3())
const DROP_V = velocityAt(LEAD, DROP_AT, new Vector3())
/**
 * 投彈那一刻鏡頭從長機身上脫鉤：投彈前掛在它尾後上方那一點、上方跟著它的機背；投彈
 * 之後從那一點順著它的俯衝速度直線往下，速度在半秒內收到 `DETACH_PACE` 倍，上方停在
 * 投彈那一刻的機背。炸彈比鏡頭快、往縱隊掉遠，飛機往機背那一側拉走 —— 鏡頭跟不上，
 * 交代「飛機拉走了，炸彈還在往下」
 * 【速度要漸收】一下從 1 倍跳到 0.85 倍，慢動作裡看得出鏡頭頓一下
 */
const DETACH_BACK = 13
const DETACH_UPWARD = 3.0
const DETACH_P = body(LEAD, DROP_AT, 0, DETACH_UPWARD, DETACH_BACK, false, new Vector3())
const DETACH_UP = bodyUp(LEAD, DROP_AT, new Vector3())
const DETACH_PACE = 0.85
const DETACH_EASE = 0.5
/** 投彈後 `u` 秒鏡頭順著俯衝速度走了幾秒份（速度從 1 倍線性收到 `DETACH_PACE` 倍） */
function detachRun(u: number): number {
  const k = 1 - DETACH_PACE
  return u <= DETACH_EASE ? u - k * u * u / (2 * DETACH_EASE) : u - k * (u - DETACH_EASE / 2)
}

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

/**
 * 交叉剪接（見刀表）各刀的起點：空中、地面輪流，一刀比一刀短（2.0、1.5、1.2、0.9、
 * 0.6、0.4 秒），接投彈那一刀
 */
const X_PILOT = 13.6
const X_TANK = 15.6
const X_PILOT2 = 17.1
const X_BED = 18.3
const X_SIDE = 19.2
const X_CAB = 19.8
const X_DROP = 20.2
/**
 * 交叉剪接裡架在車上的三刀各架在哪一台：戰車後方、卡車車斗、卡車駕駛室旁。都不是
 * 挨炸的車，也不在 `GROUND_FIRE` 輪流開火的那十台裡 —— 各自另外排一段機槍（`MOUNT_FIRE`），
 * 鏡頭架在上面的那一刀它一定在打
 */
const BED_PROP = 0
const TANK_PROP = 4
const CAB_PROP = 6
/**
 * 車斗那一刀鏡頭在車上的位置（車身座標：x 右、y 離地、z 車尾，m）：站在車斗後段、
 * 頭略高過車身命中盒頂（2.70，外擴 0.3）
 */
const BED_X = 1.0
const BED_Y = 3.15
const BED_Z = 3.0
/**
 * 戰車那一刀：蹲在車尾後方（命中盒車尾 3.55，外擴 0.3）、比砲塔頂低，往前上方看，車尾
 * 引擎蓋與砲塔的剪影在畫面下緣
 * 【高度】鏡頭離地下限 1 m，再扣掉車身顛簸（`jostle` 最多 0.08 m）
 */
const TANK_Y = 1.1
const TANK_Z = 4.0
/** 駕駛室那一刀：貼著駕駛室右側車門（命中盒半寬 1.21，外擴 0.3）、比車頂低 */
const CAB_X = 1.6
const CAB_Y = 1.7
const CAB_Z = -2.2
const ON_VEHICLE = new Vector3()

/**
 * 投彈那一刀的慢動作：0.3 秒內慢到 0.3 倍速，正好在長機投彈（20.5 秒）時慢到底，炸彈脫離
 * 機腹、飛機開始拉起的 0.7 秒用 0.3 倍速，再 0.3 秒回到常速。炸彈落地（24.5 秒起）都是常速
 */
const SLOW_FROM = X_DROP
const SLOW_TO = 21.5
const SLOW_RATE = 0.3
const SLOW_EASE = 0.3

/**
 * 暴風雨前的寧靜：第一顆炸彈落地前的安靜低角度鏡頭從這一秒起，到落地前一點點硬切到
 * 爆炸。這段時間縱隊停火（`GROUND_FIRE` 讓開）、高砲也停
 */
const QUIET_FROM = 22.4
const BLAST_CUT = IMPACT_AT[0]! - 0.03

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
/** 第 `i` 架那一枚炸彈落在哪一台車上（落點上那一台，見 `PROPS`） */
const targetProp = (i: number): number => LEAD_IN + i * PER_GAP

/**
 * 飛行員視角：鏡頭在長機座艙罩後上方（機身座標 y `up`、往後 `back` m），注視點介於
 * 它那一枚的目標車與螺旋槳轂之間（`PILOT_W` = 偏向槳轂的比例）—— 目標在機首線偏機腹
 * 那一側一兩度，機頭在畫面下緣、目標在它上方。上方跟著機背
 * 【垂尾】命中盒頂 1.94、外擴 0.5：鏡頭在它前後範圍裡時要高過 2.44
 */
const PILOT_W = 0.3
const PILOT_UP = 2.5
const PILOT_BACK = 4.0
const PILOT_FOV = 36
const PILOT2_UP = 2.0
const PILOT2_BACK = 3.2
const PILOT2_FOV = 26
function pilotView(t: number, up: number, back: number, fov: number, out: ReelCamera): void {
  body(LEAD, t, 0, up, back, false, out.position)
  propAt(PROPS[targetProp(0)]!, t, S1)
  body(LEAD, t, 0, 0, -4.5, false, S2)
  aimBetween(out.position, S1, S2, PILOT_W, out.target)
  bodyUp(LEAD, t, out.up)
  shake(t, 0.12, 27, out)
  out.fov = fov
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
/** 戰車、車斗、駕駛室三刀：注視點偏向路面的比例與視角（度）。長機一刀比一刀大 */
const TANK_W = 0.32
const TANK_FOV = 66
const BED_W = 0
const BED_FOV = 15
const CAB_W = 0
const CAB_FOV = 6

/**
 * 寧靜那一刀：路東邊 `QUIET_SIDE` m、離地 1.3 m，往路上第一個落點南邊 `QUIET_LOOK` m 看
 * （長機那一枚的目標 23.9 秒開到那裡，落地時再往右開出幾公尺）。長焦、注視點貼地，畫面
 * 上緣的仰角約 10°：拉出的飛機都在那之上
 */
const QUIET_SIDE = 24
const QUIET_LOOK = 3
const QUIET_FOV = 40
const QUIET_CAM = onRoad(-QUIET_LOOK, QUIET_SIDE, new Vector3()).setY(1.1)
const QUIET_AIM = onRoad(-QUIET_LOOK, 0, new Vector3()).setY(1.8)
/**
 * 爆炸那一刀：路東邊 `BLAST_SIDE` m、離地 6 m，廣角對著前兩個落點之間偏南的一點（第一個
 * 落點在左、第二個在右），兩個都在選單右邊的畫面裡
 * 【不能再往外】路東邊 120～140 m 是一排樹籬（再過去 320 m 又一排、比鏡頭高），鏡頭放進去
 * 畫面是一片樹幹與樹冠
 * 【廣角】兩枚疊成的火球在一百多公尺內看得出低面數的稜角；畫面裡小一點就不顯
 */
const BLAST_SIDE = 110
const BLAST_FOV = 66
const BLAST_CAM = onRoad(0.36 * ROAD_GAP, BLAST_SIDE, new Vector3()).setY(6)
const BLAST_AIM = onRoad(0.36 * ROAD_GAP, 0, new Vector3()).setY(10)
/** 沿路炸過來那一刀的起點 */
const WALK_FROM = 26.4
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
 * （7 m）；鏡頭在長機西側 13 m，彈道碰不到鏡頭，貼著長機往上竄
 */
const CROSSFIRE_MISS = 4
/** 寧靜那一刀之前多久停火：最後一發曳光要在切進來之前飛出畫面 */
const LULL_LEAD = 0.3

/**
 * 縱隊朝俯衝的斯圖卡打的機槍：每隔一台（十台）輪流打，每 6 秒打一段 2.8～3.2 秒，
 * 各車的起點錯開，同一時間約五道。從 10.5 秒（長機拉進俯衝）打到 31.5 秒（最後一架
 * 拉出），每一段挑那時正在俯衝或拉出的一架打，瞄點偏開 25～45 m，曳光從飛機旁邊擦過去。
 * 跨到側拍長機那一刀的段改瞄長機、偏開 `CROSSFIRE_MISS`。炸毀的車自己停火
 * 【寧靜那一刀全部停火】跨進 `QUIET_FROM − LULL_LEAD` 到第一顆落地之間的段，中間那一截
 * 切掉、前後照打；那一刀裡有一道曳光，「安靜」就不成立
 * 【曳光只飛 1.2 秒】850 m/s 打不到一公里外：俯衝的前半段，曳光是往上竄、在半空熄掉
 */
const GROUND_FIRE: ReelEvent[] = (() => {
  const out: ReelEvent[] = []
  const from = 10.5
  const to = 31.5
  const lullFrom = QUIET_FROM - LULL_LEAD
  const lullTo = IMPACT_AT[0]!
  const push = (k: number, j: number, at: number, seconds: number): void => {
    if (seconds < 0.5) return
    const mid = at + seconds / 2
    // 那一刻在俯衝線上的：拉進俯衝之後、拉出到一半之前
    const live: number[] = []
    for (let i = 0; i < COUNT; i++) if (mid > peelAt(i) + PULL_IN_AT && mid < releaseAt(i) + 4.5) live.push(i)
    const cross = at < X_CAB && at + seconds > X_SIDE
    if (!cross && live.length === 0) return
    out.push({
      at, kind: 'groundFire', prop: k, actor: cross ? 0 : live[(k + j) % live.length]!, seconds,
      miss: cross ? CROSSFIRE_MISS : 25 + hash01(k * 29 + j + 11) * 20,
    })
  }
  for (let k = 1; k < PROPS.length; k += 2) {
    // 十台的起點均勻錯開在一個 6 秒的週期裡，同一時間才穩定在五道上下
    let at = from + ((k - 1) / 2) * 0.6
    for (let j = 0; at < to; j++) {
      const seconds = Math.min(2.8 + hash01(k * 17 + j + 5) * 0.4, to - at)
      const end = at + seconds
      if (end <= lullFrom || at >= lullTo) {
        push(k, j, at, seconds)
      } else {
        push(k, j, at, lullFrom - at)
        push(k, j, lullTo, end - lullTo)
      }
      at += 6.0
    }
  }
  return out
})()

/**
 * 交叉剪接裡鏡頭架著的三台車各打一段，瞄長機、偏開 20 m：那一刀裡曳光從鏡頭旁邊往上
 * 竄向畫面裡的長機。都在寧靜那一刀之前打完
 */
const MOUNT_FIRE: ReelEvent[] = [
  { at: X_BED - 0.6, kind: 'groundFire', prop: BED_PROP, actor: 0, seconds: 2.6, miss: 20 },
  { at: X_TANK - 0.6, kind: 'groundFire', prop: TANK_PROP, actor: 0, seconds: 2.0, miss: 20 },
  { at: X_CAB - 0.6, kind: 'groundFire', prop: CAB_PROP, actor: 0, seconds: 2.0, miss: 20 },
]

// ── 刀表 ───────────────────────────────────────────────────
//
//   0.0–3.2   編隊裡：鏡頭在長機正後方、比隊形快一點往前滑，從第二架左邊 14 m 掠過，鏡頭
//             跟著它轉、慢慢滾轉；長機在左前方，後面一整排梯隊往右後方排開，底下是田
//   3.2–6.8   路邊固定機位從車的斜前方拍：縱隊揚著塵迎面開來、從鏡頭旁開過；鏡頭往上抬到
//             高空的梯隊，zoom in 到六架讀得出來 —— 地面看見了他們
//   6.8–10.2  長機右後上方往下看：它拉起一下、往左翻成腹部朝上，田在它底下，拉進俯衝往下掉開
//   10.2–13.6 編隊西側 95 m 跟著隊形飛：第四、五、六架一架接一架往這一側翻過來，前一架
//             已經拉進俯衝、翼尖拉出白線往下掉
//   ── 交叉剪接：空中、地面輪流，一刀比一刀短；飛行員往下看與車上往上看互為對照 ──
//   13.6–15.6 長機座艙後上方越過機頭往下看：路上的縱隊在機頭前方，曳光從下面往上竄
//   15.6–17.1 戰車車尾後方往前上方看：砲塔的剪影在下緣，自己的機槍曳光往上竄，高處一串
//             斯圖卡衝下來
//   17.1–18.3 長機座艙後上方、焦段更長：縱隊大了一圈
//   18.3–19.2 卡車車斗上往正上方看（長焦）：長機與後面幾架迎面排成一串，大了一圈
//   19.2–19.8 長機西側 13 m 機身特寫：機頭朝右下往下衝，曳光貼著它往上竄
//   19.8–20.2 卡車駕駛室旁往正上方看（超長焦）：長機與僚機迎面衝下來，倒鷗翼與起落架
//             佔滿畫面
//   ──
//   20.2–22.4 長機尾後上方：20.5 秒炸彈脫離機腹（0.3 倍速慢動作，實際約 4.3 秒），它拉起
//             甩出畫面，鏡頭留在俯衝線上，炸彈往縱隊掉遠
//   22.4–24.5 路東邊 24 m 貼地往路上看：縱隊照常開、揚著塵，長機那一枚的目標開進畫面；
//             沒有曳光、沒有飛機 —— 落地前一點點硬切到爆炸
//   24.5–26.4 路東邊 110 m：長機那一枚在畫面左邊的戰車上炸開，第二枚接著在右邊炸開
//   26.4–29.6 縱隊北頭往南沿著路看：後面幾顆一顆接一顆沿路往鏡頭炸過來
//   29.6–31.8 縱隊南邊 230 m 低空往北看：燒著的縱隊在路的盡頭，最後一架從右邊貼著田拉出來
//   31.8–33.6 第五架前方 21 m 往後看：整架迎面往南爬升離場，後景是剛拉出來的第六架
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
    from: X_PILOT, subject: null, mount: 0,
    camera(t, out) {
      // 飛行員視角：長機座艙罩後上方（座艙命中盒頂 1.18，外擴 0.5），越過機頭往下看。
      // 機頭在畫面下緣，路上的縱隊在機頭前方，地面的機槍曳光從下面往上竄。上方跟著機身
      pilotView(t, PILOT_UP, PILOT_BACK, PILOT_FOV, out)
    },
  },
  {
    from: X_TANK, subject: 0, groundMount: TANK_PROP,
    camera(t, out) {
      // 戰車車尾後方、比砲塔頂低，往前上方看（廣角）：砲塔頂與艙蓋的剪影在畫面下緣，自己
      // 這台的機槍曳光往上竄，高處一串斯圖卡排成一線衝下來
      onVehicle(TANK_PROP, t, 0.4, TANK_Y, TANK_Z, out.position)
      jostle(t, out.position)
      out.fov = TANK_FOV
      lookUpAtLead(t, TANK_PROP, TANK_W, 2, out)
    },
  },
  {
    from: X_PILOT2, subject: null, mount: 0,
    camera(t, out) {
      // 飛行員視角再一次：鏡頭往前挪、焦段更長，縱隊比上一次大了一圈
      pilotView(t, PILOT2_UP, PILOT2_BACK, PILOT2_FOV, out)
    },
  },
  {
    from: X_BED, subject: 0, groundMount: BED_PROP,
    camera(t, out) {
      // 卡車車斗上往正上方看（長焦）：自己這台的機槍曳光從鏡頭旁往上竄，長機與後面幾架
      // 排成一串衝下來，比戰車那一刀大得多。車在開：慢晃加一點顛
      onVehicle(BED_PROP, t, BED_X, BED_Y, BED_Z, out.position)
      jostle(t, out.position)
      out.fov = BED_FOV
      lookUpAtLead(t, BED_PROP, BED_W, 1, out)
    },
  },
  {
    from: X_SIDE, subject: 0,
    camera(t, out) {
      // 長機西側 13 m 跟拍、往東看，幾乎是機身特寫，鏡頭正立不歪（上方是世界的上方），
      // 手持晃得很兇：前景的長機機首朝下往畫面下方衝，後景是它的右僚機，在它上方約 25 m
      // （畫面上方）一起衝下來。縱隊從南邊（畫面右下）打上來的曳光貼著長機往上竄
      // 【鏡頭在西側】往南俯衝約 77°，從西側看南邊在畫面右邊，機頭朝右下偏離垂直約 13°，
      // 座艙罩朝畫面右上，看得出是正著衝
      // 【彈道碰不到鏡頭】曳光從南邊下方打上來、瞄點離長機最遠約 7 m（`CROSSFIRE_MISS`），
      // 鏡頭在 13 m 外的側面
      // 【交叉剪接的後段才放它】離縱隊一公里以內曳光才打得到長機身邊（見 `GROUND_FIRE`）
      LEAD(t, out.position).add(S1.set(-13, -2, 2))
      LEAD(t, S1)
      WING(t, S2)
      aimBetween(out.position, S1, S2, 0.4, out.target)
      shake(t, 0.6, 22, out)
      out.fov = 70
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
      // 長機尾後 13 m、機背那一側 3 m，順著機首往下看：20.5 秒炸彈脫離機腹（慢動作，
      // `SLOW_*`），長機 4.5 G 拉起、翼尖拖著白線往畫面上方甩出去；鏡頭留在俯衝線上
      // （`DETACH_P`），炸彈跑在鏡頭前面往縱隊掉。投彈前上方跟著機背，之後停在投彈那一刻
      // 的機背，不跟著機身翻。拉起那一下氣流掃過，震一下。飛機出畫之後慢慢收窄，炸彈與
      // 路上的縱隊才不會縮成小點
      if (t < DROP_AT) {
        body(LEAD, t, 0, DETACH_UPWARD, DETACH_BACK, false, out.position)
        body(LEAD, t, 0, BOMB_RELEASE_Y, 0, false, S1)
        bodyUp(LEAD, t, out.up)
      } else {
        out.position.copy(DETACH_P).addScaledVector(DROP_V, detachRun(t - DROP_AT))
        bombAt(DROP_P, DROP_V, t - DROP_AT, S1)
        out.up.copy(DETACH_UP)
      }
      aimBetween(out.position, S1, IMPACTS[0]!, 0.3, out.target)
      shake(t, 0.1, 23, out)
      jolt(t, DROP_AT + 0.4, 1.0, out.target)
      out.fov = 60 - 18 * ramp(t, DROP_AT + 1.0, 1.0)
    },
  },
  {
    from: QUIET_FROM, subject: null,
    camera(t, out) {
      // 暴風雨前的寧靜：路東邊 `QUIET_SIDE` m、離地 1.3 m 的固定機位，長焦往路上看。
      // 縱隊照常往右開、揚著塵，長機那一枚的目標正開進畫面；沒有曳光、沒有飛機（停火見
      // `GROUND_FIRE`；拉出的飛機仰角都在畫面上緣之上）。目標挨炸前一點點硬切到爆炸
      out.position.copy(QUIET_CAM)
      out.target.copy(QUIET_AIM)
      shake(t, 0.05, 31, out)
      out.fov = QUIET_FOV
    },
  },
  {
    from: BLAST_CUT, subject: null,
    camera(t, out) {
      // 路東邊 110 m、離地 6 m：長機那一枚在畫面左邊的戰車上炸開（硬切進來就炸），第二枚
      // 25.5 秒接著在右邊炸開，每一下都震一下
      out.position.copy(BLAST_CAM)
      out.target.copy(BLAST_AIM)
      shake(t, 0.08, 33, out)
      for (let k = 0; k < 2; k++) jolt(t, IMPACT_AT[k]!, 1.6 - 0.4 * k, out.target)
      out.fov = BLAST_FOV
    },
  },
  {
    from: WALK_FROM, subject: null,
    camera(t, out) {
      // 縱隊北頭外 150 m、路東邊 50 m、離地 30 m 往南沿著路看：後面幾顆一顆接一顆沿路往
      // 鏡頭這邊炸過來，前面幾輛已經在燒。注視點跟著炸點慢慢往近處移
      onRoad((COUNT - 1) * ROAD_GAP + 150, 50, out.position)
      out.position.y = 30
      const w = Math.min(1, Math.max(0, (t - WALK_FROM) / 3.2))
      onRoad((2.0 + 2.0 * w) * ROAD_GAP, 0, out.target)
      out.target.y = 12
      shake(t, 0.1, 16, out)
      for (let k = 2; k < COUNT; k++) jolt(t, IMPACT_AT[k]!, 0.4 + 0.4 * (k - 2), out.target)
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

const PLANES: readonly ReelPlane[] = [
  ...PATHS.map((path) => ({ spec: JU87, path })),
  { spec: JU87, path: WING, extra: true },
]

export const STUKA: Shot = {
  id: 'stuka',
  duration: AFTER_TO,
  speed: [{ from: SLOW_FROM, to: SLOW_TO, rate: SLOW_RATE, ease: SLOW_EASE }],
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
    // 俯衝線上零星幾朵高砲黑雲（縱隊上空 400～1300 m）；主角是地面的機槍曳光。寧靜那一刀
    // 之前停
    ...barrage(601, 13.0, QUIET_FROM - LULL_LEAD, 0.7, (_t, out) => out.copy(BURNING).setY(850),
      { x: 260, yLo: -400, yHi: 450, z: 300 }, edit(CUTS), 70),
    // 一架兩枚、隔 0.06 秒：落點相差不到 3 m，疊成一團比單枚大的爆炸（一枚 500 kg）。
    // 用 `blast` 疊大火球的話，150 m 外就看得出低面數火球的稜角，冷卻時像一顆暗紅的石頭
    ...PATHS.map((_, i) => ({ at: releaseAt(i), kind: 'bomb' as const, actor: i, count: 2, interval: 0.06 })),
    ...GROUND_FIRE,
    ...MOUNT_FIRE,
  ]),
}
