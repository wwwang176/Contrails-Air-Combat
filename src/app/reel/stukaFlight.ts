import { Vector3 } from 'three'
import type { Path } from '../reelFlight'
import { bump, easeInOut, ramp } from './reelTiming'

/** 斯圖卡編隊的標準俯衝航跡；初始化時積分，播放時查表。 */
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
export const PULL_IN_AT = 2.6
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
export const COUNT = 6

/** 第 `i` 架開始拉起的時刻 */
export const peelAt = (i: number): number => LEAD_AT + i * PEEL_GAP

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
export function cruise(i: number, t: number, out: Vector3): Vector3 {
  return out.set(i * SLOT_X, ALT + i * SLOT_Y, i * SLOT_Z - V0 * (t - LEAD_AT))
}

export const PATHS: readonly Path[] = Array.from({ length: COUNT }, (_, i) => stuka(i))
export const LEAD = PATHS[0]!

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
export const WING: Path = (t, out) => {
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
export const releaseAt = (i: number): number => peelAt(i) + RELEASE
