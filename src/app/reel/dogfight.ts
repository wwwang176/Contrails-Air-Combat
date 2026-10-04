import { Vector3 } from 'three'
import { P51D } from '../../specs/p51d'
import { BF109K4 } from '../../specs/bf109k4'
import {
  body, bodyUp, edit, timeline, type Cut, type Path, type ReelCamera, type ReelEvent, type Shot,
} from './kit'

// ── 纏鬥 ───────────────────────────────────────────────────
//
// 正午、北海上空 650 m。野馬雙機（主角 #0、僚機 #3）與 109 雙機（長機 #1、僚機 #2）對頭，
// 主角打爆 109 僚機。109 長機翻筋斗繞回來從上方壓下，與急轉的主角打剪刀，咬上之後擊落主角；
// 野馬僚機從高空翻滾切入、一路追到低空打下它，再拉起做勝利滾轉。四周還有三組在互咬、
// 一架冒煙的 109 在遠處盤旋下降。
//   0–2       釘在野馬雙機航線前下方：兩架迎面壓過來
//   2–3.75    主角座艙後上方往前看：對頭，曳光收進 109 僚機，它起火
//   3.75–5.4  交會點旁的半空：109 長機與起火的僚機掠過，長機在眼前拉起；4.5 秒僚機爆開
//   5.4–7.6   主角右翼尖：8 g 左轉，地平線豎起來
//   7.6–9.6   筋斗頂點上方俯拍：109 長機垂直爬上來、倒飛翻過頂
//   9.6–11.7  109 長機後上方跟著俯衝：壓向底下急轉的主角，11 秒那串打在前面
//   11.7–13.5 主角座艙回頭看：109 衝過頭，12.4 秒主角反向急滾
//   13.5–15.6 主角前方 30 m 回看：剪刀機動，左右急滾反向，109 切過它的航跡
//   15.6–17.6 109 長機左肩後：主角拉成直線爬升，109 滑進它正後方
//   17.6–18.8 主角右前側 14 m：17.85 秒後方的 109 開火，18 秒起火，18.4 秒爆開，鏡頭不追殘骸
//   18.8–20.7 野馬僚機座艙後上方：翻滾切入、往下衝
//   20.7–22.6 109 俯衝線側下方仰拍：109 斜衝下去，野馬咬在後面
//   22.6–24.2 野馬僚機右肩後：23.3 秒開火，23.7 秒 109 起火
//   24.2–25.4 109 左前方回看：25 秒爆開
//   25.4–28   爆炸點下方仰拍：野馬從頭頂掠過、拉起
//   28–31     野馬右後側跟拍：爬升中的勝利滾轉

// ── 飛行模擬：模組載入時積分一次，之後查表 ──────────────────
//
// 主線四架的航跡不是手寫的曲線，而是照「滾轉率＋過載」積分出來的：機體上方就是升力方向，
// `flightPose` 從路徑二階差分推回來的坡度與這裡積分的滾轉一致。追擊者用追蹤導引律
// 自己飛，機首真的指著目標 —— 放映機的曳光一律沿機首直直打出去，標了目標的連射只排在
// 機首那條線穿過目標機身的時段（導引收斂之後）。

const G = 9.81
/** 模擬的時間範圍，秒。前後各多一截：`flightPose` 與鏡頭會取到片頭片尾外面一點 */
const SIM_FROM = -1
const SIM_TO = 34
const SIM_DT = 1 / 400
/** 每幾步存一個樣本。樣本之間用三次 Hermite（位置＋速度）內插 */
const STEPS_PER_SAMPLE = 8
const SAMPLE = SIM_DT * STEPS_PER_SAMPLE
/** 坡度追蹤的增益（1/s）與最大滾轉率（rad/s） */
const ROLL_GAIN = 5
const ROLL_MAX = 2.8
/** 滾轉率與過載的一階延遲，秒 —— 一步跳上去的話姿態在一幀裡甩過去 */
const ROLL_LAG = 0.12
const LOAD_LAG = 0.3
/** 速度往指令速度收斂的速率（1/s）與每 g² 的誘導阻力減速（m/s²） */
const SPEED_GAIN = 0.25
const INDUCED = 0.06

interface Craft {
  readonly p: Vector3
  /** 機首方向（單位向量） */
  readonly f: Vector3
  /** 機體上方 = 升力方向（單位向量，⊥ f） */
  readonly u: Vector3
  v: number
  /** 實際的過載，g */
  n: number
  /** 實際的滾轉率，rad/s */
  roll: number
  /** 追擊導引的上一步誤差 */
  readonly e: Vector3
  primed: boolean
}

/** 飛行員這一步的指令 */
interface Order {
  /** 0 = 不滾轉、1 = 把機體上方轉到 `up`、2 = 照 `roll` 的滾轉率滾 */
  mode: 0 | 1 | 2
  readonly up: Vector3
  roll: number
  n: number
  speed: number
}

type Pilot = (t: number, me: Craft, all: readonly Craft[], order: Order) => void

const WORLD_UP = new Vector3(0, 1, 0)
const T1 = new Vector3()
const T2 = new Vector3()
const T3 = new Vector3()
const T4 = new Vector3()
const T5 = new Vector3()

/** 照坡度（右壓為正，rad）算機體上方該在哪；接近垂直時坡度沒有意義，回傳 false */
function bankUp(f: Vector3, bank: number, out: Vector3): boolean {
  if (Math.abs(f.y) > 0.85) return false
  T1.crossVectors(f, WORLD_UP).normalize()
  T2.crossVectors(T1, f)
  out.copy(T2).multiplyScalar(Math.cos(bank)).addScaledVector(T1, Math.sin(bank))
  return true
}

/**
 * 照時間表飛：每一步 `[秒, 坡度°|null, 滾轉率°/s|null, 過載 g, 速度 m/s, 爬升角°?]`。
 * 坡度給了就壓到那個坡度（垂直時保持不滾）；滾轉率給了就照它滾；兩個都 null 就不滾、只拉。
 *
 * 給了爬升角的話照飛行員的做法守住它：坡度 0 時調過載；坡度不是 0 時過載固定、
 * 坡度只取左右，深淺由「這個過載下要守住爬升角」決定（想爬就少壓一點）。
 * 轉彎中改過載來守高度的話，坡度 80° 時升力的鉛垂分量只剩兩成，一修正過載就整個不轉了
 */
type Step = readonly [number, number | null, number | null, number, number, number?]
function script(steps: readonly Step[]): Pilot {
  return (t, me, _all, order) => {
    let s = steps[0]!
    for (const x of steps) if (x[0] <= t) s = x
    order.n = s[3]
    order.speed = s[4]
    if (s[2] !== null) {
      order.mode = 2
      order.roll = (s[2] * Math.PI) / 180
      return
    }
    if (s[1] === null) {
      order.mode = 0
      return
    }
    let bank = (s[1] * Math.PI) / 180
    const gamma = s[5]
    if (gamma !== undefined) {
      // 鉛垂面內要的法向加速度 = v·γ̇ + g·cos γ
      const now = Math.asin(Math.max(-1, Math.min(1, me.f.y)))
      const need = me.v * 0.8 * ((gamma * Math.PI) / 180 - now) + G * Math.cos(now)
      if (Math.abs(bank) < 0.02) order.n = Math.max(0.6, Math.min(s[3], need / G))
      else bank = Math.sign(bank) * Math.acos(Math.max(-0.7, Math.min(0.98, need / (s[3] * G))))
    }
    order.mode = bankUp(me.f, bank, order.up) ? 1 : 0
  }
}

interface Chase {
  /** 速度調到保持這個距離，m */
  readonly range: number
  /** 過載上限，g */
  readonly nMax: number
  readonly vLo: number
  readonly vHi: number
  /** 瞄點抬高的公尺數：還不想咬上去、先佔高度的時候用 */
  readonly above?: number
  /** 導引增益，1/s。越大機首收得越緊，太大會在目標反向時來回甩 */
  readonly gain?: number
}

/**
 * 純追蹤：機首指向目標中心。開火時曳光沿機首直直打出去，所以機首要壓在目標機身上。
 *
 * 【要補視線的轉動】只照誤差修正的話，目標在轉彎（或對頭時從旁邊掠過）時視線一直在轉，
 * 機首永遠落後一個固定的角度 —— 100 m 外差 3° 就是 5 m，曳光從機身旁飛過去。
 * 所以先照視線的角速度 Ω = (r × v相對)/r² 轉，誤差項只負責收掉殘差
 */
function pursue(target: number, c: Chase): Pilot {
  const above = c.above ?? 0
  const gain = c.gain ?? 3.2
  return (_t, me, all, order) => {
    const tg = all[target]!
    const r = T1.subVectors(tg.p, me.p).length()
    // 視線角速度的前饋：法向加速度 v·(Ω × f)
    T4.copy(tg.f).multiplyScalar(tg.v).addScaledVector(me.f, -me.v)
    T5.crossVectors(T1, T4).multiplyScalar(1 / (r * r))
    T4.crossVectors(T5, me.f).multiplyScalar(T1.dot(me.f) > 0 ? me.v : 0)
    T1.y += above
    T1.normalize()
    // 誤差 = 瞄點方向垂直於機首的分量；目標在背後時取滿量
    T2.copy(T1).addScaledVector(me.f, -T1.dot(me.f))
    if (T1.dot(me.f) < 0 && T2.lengthSq() > 1e-9) T2.normalize()
    if (!me.primed) {
      me.e.copy(T2)
      me.primed = true
    }
    T3.subVectors(T2, me.e).multiplyScalar(1 / SIM_DT)
    me.e.copy(T2)
    // 要的法向加速度 + 抵掉重力的法向分量 = 升力
    order.up.copy(T2).multiplyScalar(gain).addScaledVector(T3, 0.5 * gain).multiplyScalar(me.v).add(T4)
    order.up.y += G
    order.up.addScaledVector(me.f, -order.up.dot(me.f))
    const lift = order.up.length()
    order.n = Math.min(c.nMax, Math.max(0.6, lift / G))
    if (lift < 0.3 * G) order.mode = 0
    else {
      order.up.multiplyScalar(1 / lift)
      order.mode = 1
    }
    order.speed = Math.min(c.vHi, Math.max(c.vLo, tg.v + 0.6 * (r - c.range)))
  }
}

/** 照時間換飛行員：`[起始秒, 飛行員]` */
function phases(list: readonly (readonly [number, Pilot])[]): Pilot {
  let current = -1
  return (t, me, all, order) => {
    let k = 0
    for (let i = 0; i < list.length; i++) if (list[i]![0] <= t) k = i
    // 換飛行員時導引的微分項重新起算，不然第一步的誤差差分是一個尖峰
    if (k !== current) {
      me.primed = false
      current = k
    }
    list[k]![1](t, me, all, order)
  }
}

interface Start { readonly x: number, readonly y: number, readonly z: number, readonly heading: number, readonly v: number }

/** 把所有參與模擬的飛機一起積分，回傳每一架的樣本表（位置、速度交錯存放） */
function simulate(starts: readonly Start[], pilots: readonly Pilot[]): Float64Array[] {
  const crafts: Craft[] = starts.map((s) => {
    const f = new Vector3(-Math.sin(s.heading), 0, -Math.cos(s.heading))
    // 從 0 秒的位置倒推回模擬起點：之前一直平飛
    const p = new Vector3(s.x, s.y, s.z).addScaledVector(f, s.v * SIM_FROM)
    return { p, f, u: new Vector3(0, 1, 0), v: s.v, n: 1, roll: 0, e: new Vector3(), primed: false }
  })
  const samples = Math.round((SIM_TO - SIM_FROM) / SAMPLE) + 1
  const tables = crafts.map(() => new Float64Array(samples * 6))
  const order: Order = { mode: 0, up: new Vector3(), roll: 0, n: 1, speed: 0 }
  const a = new Vector3()
  const record = (k: number): void => {
    crafts.forEach((c, i) => {
      const tb = tables[i]!
      tb[k * 6] = c.p.x
      tb[k * 6 + 1] = c.p.y
      tb[k * 6 + 2] = c.p.z
      tb[k * 6 + 3] = c.f.x * c.v
      tb[k * 6 + 4] = c.f.y * c.v
      tb[k * 6 + 5] = c.f.z * c.v
    })
  }
  record(0)
  for (let k = 1; k < samples; k++) {
    for (let s = 0; s < STEPS_PER_SAMPLE; s++) {
      const t = SIM_FROM + ((k - 1) * STEPS_PER_SAMPLE + s) * SIM_DT
      crafts.forEach((c, i) => {
        // 每一種飛行員每一步都會寫 mode：沒寫的話會沿用上一架的指令
        pilots[i]!(t, c, crafts, order)
        let want = 0
        let nWant = order.n
        if (order.mode === 2) want = order.roll
        else if (order.mode === 1) {
          const err = Math.atan2(T1.crossVectors(c.u, order.up).dot(c.f), c.u.dot(order.up))
          want = Math.max(-ROLL_MAX, Math.min(ROLL_MAX, ROLL_GAIN * err))
          // 升力方向還沒轉到位就先少拉一點
          nWant = Math.max(0.6, nWant * Math.max(0.3, Math.cos(err)))
        }
        c.roll += (want - c.roll) * Math.min(1, SIM_DT / ROLL_LAG)
        c.n += (nWant - c.n) * Math.min(1, SIM_DT / LOAD_LAG)
        // 繞機首轉 roll·dt：u' = u cos + (f × u) sin
        const ang = c.roll * SIM_DT
        T1.crossVectors(c.f, c.u)
        c.u.multiplyScalar(Math.cos(ang)).addScaledVector(T1, Math.sin(ang))
        // 法向加速度 = 升力 − 重力的法向分量
        a.copy(c.u).multiplyScalar(c.n * G)
        a.y -= G
        a.addScaledVector(c.f, G * c.f.y)
        c.v += (-G * c.f.y + SPEED_GAIN * (order.speed - c.v) - INDUCED * (c.n * c.n - 1)) * SIM_DT
        if (c.v < 60) c.v = 60
        c.f.addScaledVector(a, SIM_DT / c.v).normalize()
        c.u.addScaledVector(c.f, -c.u.dot(c.f)).normalize()
        c.p.addScaledVector(c.f, c.v * SIM_DT)
      })
    }
    record(k)
  }
  return tables
}

/** 樣本表 → 路徑：樣本之間三次 Hermite，表外沿兩端的速度直線外推 */
function track(tb: Float64Array): Path {
  const last = tb.length / 6 - 1
  return (t, out) => {
    const x = (t - SIM_FROM) / SAMPLE
    if (x <= 0 || x >= last) {
      const k = x <= 0 ? 0 : last
      const dt = t - (SIM_FROM + k * SAMPLE)
      return out.set(tb[k * 6]! + tb[k * 6 + 3]! * dt, tb[k * 6 + 1]! + tb[k * 6 + 4]! * dt, tb[k * 6 + 2]! + tb[k * 6 + 5]! * dt)
    }
    const k = Math.floor(x)
    const s = x - k
    const s2 = s * s
    const s3 = s2 * s
    const h00 = 2 * s3 - 3 * s2 + 1
    const h10 = (s3 - 2 * s2 + s) * SAMPLE
    const h01 = -2 * s3 + 3 * s2
    const h11 = (s3 - s2) * SAMPLE
    const i = k * 6
    const j = i + 6
    return out.set(
      h00 * tb[i]! + h10 * tb[i + 3]! + h01 * tb[j]! + h11 * tb[j + 3]!,
      h00 * tb[i + 1]! + h10 * tb[i + 4]! + h01 * tb[j + 1]! + h11 * tb[j + 4]!,
      h00 * tb[i + 2]! + h10 * tb[i + 5]! + h01 * tb[j + 2]! + h11 * tb[j + 5]!,
    )
  }
}

// ── 主線 ──
//
// #0 野馬（主角）、#1 109 長機、#2 109 僚機、#3 野馬僚機。

const M1 = 0
const G1 = 1
const G2 = 2
const M2 = 3

const PASS_ALT = 650
const V = 120
const G2_KILL = 4.5
const M1_KILL = 18.4
const G1_KILL = 25
const STARTS: readonly Start[] = [
  { x: 0, y: PASS_ALT, z: 0, heading: 0, v: V },
  { x: -15, y: PASS_ALT + 7, z: -960, heading: Math.PI, v: V },
  { x: 12, y: PASS_ALT - 9, z: -940, heading: Math.PI, v: V },
  { x: -32, y: PASS_ALT + 12, z: 30, heading: 0, v: V },
  // 背景：A 組左下方左轉兜圈、B 組右上方右轉兜圈、C 組低空由右往左橫過、
  // 一架冒煙的 109 從高空盤旋下降。追的那一架起點在被追的那一架後方 130 m
  { x: -370, y: 520, z: -1100, heading: 0, v: 110 },
  { x: -370, y: 528, z: -970, heading: 0, v: 110 },
  { x: -30, y: 1250, z: -600, heading: 0, v: 110 },
  { x: -30, y: 1258, z: -470, heading: 0, v: 110 },
  { x: 1200, y: 380, z: -500, heading: Math.PI / 2, v: 115 },
  { x: 1330, y: 388, z: -500, heading: Math.PI / 2, v: 115 },
  { x: -1400, y: 1350, z: -2600, heading: -Math.PI / 2, v: 100 },
]

/**
 * 主角的劇本：對頭後 8 g 左轉、剪刀兩次反向，最後被咬上時拉成直線爬升 ——
 * 被咬住的那一段要飛直線，曲線上咬在同一條航跡後面的人機首永遠指著弦外側，對不準
 */
const HERO = script([
  [-1, 0, null, 1, V, 0],
  // 對頭開完火拉起，從起火的 109 僚機上方錯過去
  [2.9, 0, null, 3.5, V],
  [3.7, 0, null, 1, V, 6],
  [4.2, -90, null, 8, V, 8],
  [12.4, 90, null, 7, 105, -5],
  [14.0, -90, null, 7, 105, -5],
  [14.8, 0, null, 4, 110, 20],
])

const BG_A = 4
const BG_B = 6
const BG_C = 8
const BG_FALL = 10

const PILOTS: readonly Pilot[] = [
  // 野馬（主角）
  phases([
    [-1, HERO],
    // 對頭時機首壓到 109 僚機上開火，2.9 秒放開、拉起從它上方錯過去
    [0.3, pursue(G2, { range: 0, nMax: 3, vLo: V, vHi: V, gain: 4 })],
    [2.9, HERO],
  ]),
  // 109 長機
  phases([
    [-1, script([[-1, 0, null, 1, V, 0], [4.3, 0, null, 7.5, V, 85]])],
    [7.0, pursue(M1, { range: 120, nMax: 7.5, vLo: 100, vHi: 150 })],
    [12.5, pursue(M1, { range: 120, nMax: 8, vLo: 95, vHi: 125, gain: 5 })],
    [14.0, pursue(M1, { range: 95, nMax: 7, vLo: 90, vHi: 135, gain: 3 })],
    [M1_KILL, script([
      [M1_KILL, 0, null, 2, 110, 0],
      [18.8, 180, null, 1.5, 120],
      [20.0, null, null, 5, 140],
      [20.7, 0, null, 6, 150, -35],
      [21.9, 70, null, 5, 150, -12],
      [22.7, 0, null, 2, 150, -8],
    ])],
  ]),
  // 109 僚機
  script([[-1, 0, null, 1, V, 0]]),
  // 野馬僚機
  phases([
    [-1, script([[-1, 0, null, 1, V, 0], [4.4, -20, null, 4, V, 30]])],
    [8.5, pursue(G1, { range: 320, nMax: 5, vLo: 100, vHi: 140, above: 300 })],
    [18.6, pursue(G1, { range: 90, nMax: 8, vLo: 100, vHi: 180, gain: 5 })],
    [G1_KILL, script([[G1_KILL, 0, null, 7, 130, 70], [27.8, null, 220, 2, 110], [29.6, 0, null, 3, 110, 40]])],
  ]),
  // 背景
  script([[-1, -75, null, 3.9, 110, 0]]),
  pursue(BG_A, { range: 130, nMax: 6, vLo: 95, vHi: 140, gain: 7 }),
  script([[-1, 75, null, 3.9, 110, 0]]),
  pursue(BG_B, { range: 130, nMax: 6, vLo: 95, vHi: 140, gain: 7 }),
  script([[-1, 30, null, 1.6, 115, 0], [4, -30, null, 1.6, 115, 0], [9, 35, null, 1.8, 115, 0], [14, -30, null, 1.6, 115, 0],
    [19, 30, null, 1.6, 115, 0], [24, -35, null, 1.8, 115, 0], [29, 30, null, 1.6, 115, 0]]),
  pursue(BG_C, { range: 130, nMax: 6, vLo: 100, vHi: 145, gain: 7 }),
  script([[-1, -30, null, 1.3, 100, -9]]),
]

const TABLES = simulate(STARTS, PILOTS)
const mustang = track(TABLES[M1]!)
const messerschmitt = track(TABLES[G1]!)
const wing109 = track(TABLES[G2]!)
const rescuer = track(TABLES[M2]!)

// ── 鏡頭工具 ──

const S1 = new Vector3()
const S2 = new Vector3()
const AIM_A = new Vector3()
const AIM_B = new Vector3()

const SH_F = new Vector3()
const SH_R = new Vector3()
const SH_U = new Vector3()
/** 三條正弦（權重 0.6／0.3／0.1）兩軸合起來的 RMS 是 0.68，除掉它 `deg` 就是 RMS 角度 */
const SHAKE_NORM = 1 / 0.68
const DEG = Math.PI / 180

/**
 * 手持搖晃：把注視點沿畫面的左右、上下推開，晃的是**角度**（RMS 約 `deg` 度），不是公尺 ——
 * 同樣 1 m 的位移，貼著機身 8 m 的鏡頭是 7°、500 m 外的遠景看不出來，照公尺定的話
 * 近景會抖到看不清飛機。頻率 0.3～1.4 Hz，讀起來是手持或機上的慢晃。
 *
 * `kickAt` 給了的話，那一刻（爆炸、擦身而過）再疊一下約 1° 的快抖，0.4 秒內衰減掉。
 * 要在 position 與 target 都算好之後呼叫
 */
function shake(t: number, deg: number, seed: number, out: ReelCamera, kickAt = -1): void {
  SH_F.subVectors(out.target, out.position)
  const dist = SH_F.length()
  SH_F.multiplyScalar(1 / dist)
  SH_R.crossVectors(SH_F, out.up)
  if (SH_R.lengthSq() < 1e-6) SH_R.set(1, 0, 0)
  SH_R.normalize()
  SH_U.crossVectors(SH_R, SH_F)
  const s = dist * deg * DEG * SHAKE_NORM
  let a = s * (0.6 * Math.sin(2.3 * t + seed) + 0.3 * Math.sin(5.3 * t + 2.1 * seed) + 0.1 * Math.sin(8.9 * t + seed))
  let b = s * (0.6 * Math.sin(1.9 * t + 1.3 * seed) + 0.3 * Math.sin(4.7 * t + seed) + 0.1 * Math.sin(7.7 * t + 0.4 * seed))
  if (kickAt >= 0 && t >= kickAt) {
    const k = dist * DEG * 1.4 * Math.exp(-(t - kickAt) / 0.15)
    a += k * Math.sin(29 * (t - kickAt) + seed)
    b += k * Math.sin(23 * (t - kickAt) + 2 * seed)
  }
  out.target.addScaledVector(SH_R, a).addScaledVector(SH_U, b)
}

/**
 * 從 `from` 看出去、介於 `a` 與 `b` 兩個方向之間的注視點（`w` = 偏向 `b` 的比例）。
 * 混的是方向不是位置 —— 一個在 20 m、一個在 300 m 的話，位置的內插幾乎就是遠的那一點
 */
function aimBetween(from: Vector3, a: Vector3, b: Vector3, w: number, out: Vector3): Vector3 {
  AIM_A.subVectors(a, from).normalize().multiplyScalar(100 * (1 - w))
  AIM_B.subVectors(b, from).normalize().multiplyScalar(100 * w)
  return out.copy(from).add(AIM_A).add(AIM_B)
}

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: M1,
    camera(t, out) {
      // 釘在半空、野馬雙機的航線前下方：兩架迎面壓過來，2 秒時長機只剩 30 m
      // 緊張的迎面，手持 0.3°；注視點晚 0.12 秒，長機壓近時在畫面裡往上漂
      out.position.set(16, PASS_ALT - 18, -262)
      mustang(t - 0.12, out.target)
      shake(t, 0.3, 1, out)
      out.fov = 42
    },
  },
  {
    from: 2.0, subject: G2, mount: M1,
    camera(t, out) {
      // 主角座艙後上方，越過機鼻往前看：曳光從兩翼收向迎面的 109 僚機，它起火
      // 掛在機上：機身不會抖，只留 0.1° 讓畫面活著
      body(mustang, t, 0.9, 1.9, 3.2, false, out.position)
      wing109(t, S1)
      body(mustang, t, 0, 0.6, -60, false, S2)
      aimBetween(out.position, S2, S1, 0.75, out.target)
      bodyUp(mustang, t, out.up)
      shake(t, 0.1, 2, out)
      out.fov = 40
    },
  },
  {
    from: 3.75, subject: G1,
    camera(t, out) {
      // 釘在交會點旁的半空：109 長機與起火的僚機迎面掠過，長機就在眼前拉起；鏡頭轉身追它
      // 0.3° 手持，4.5 秒僚機在旁邊爆開時震一下
      out.position.set(-46, PASS_ALT + 2, -415)
      messerschmitt(t - 0.1, out.target)
      shake(t, 0.3, 3, out, G2_KILL)
      out.fov = 52
    },
  },
  {
    from: 5.4, subject: M1, mount: M1,
    camera(t, out) {
      // 主角右翼尖外、往左下看過座艙：8 g 左轉，右翼朝天，背景是一整片傾斜的海
      // 掛在翼尖：地平線自己在轉，鏡頭幾乎不晃（0.08°）
      body(mustang, t, 6.6, 1.1, 3.2, false, out.position)
      body(mustang, t, -3, -0.8, -10, false, out.target)
      bodyUp(mustang, t, out.up)
      shake(t, 0.08, 4, out)
      out.fov = 62
    },
  },
  {
    from: 7.6, subject: G1,
    camera(t, out) {
      // 釘在 109 長機翻筋斗的頂點上方往下俯拍：它垂直爬上來、在鏡頭底下倒飛翻過頂，
      // 背景是海與底下急轉的野馬
      // 長鏡頭俯拍，0.15°：畫角窄，晃多了 109 會在畫面裡亂跳
      out.position.set(-95, PASS_ALT + 360, -235)
      messerschmitt(t - 0.06, out.target)
      shake(t, 0.15, 5, out)
      out.fov = 40
    },
  },
  {
    from: 9.6, subject: G1,
    camera(t, out) {
      // 109 長機後上方跟著往下衝：越過它看得到底下急轉的野馬與海面，11 秒那串曳光打在前面
      // 跟拍機的俯衝追逐，0.35°
      messerschmitt(t - 0.3, out.position)
      out.position.y += 7
      messerschmitt(t, S1)
      mustang(t, S2)
      aimBetween(out.position, S1, S2, 0.3, out.target)
      shake(t, 0.35, 6, out)
      out.fov = 50
    },
  },
  {
    from: 11.7, subject: G1, mount: M1,
    camera(t, out) {
      // 主角座艙右後方回頭看：109 從後上方壓下來又衝過頭，12.4 秒主角反向急滾
      // 掛在機上，0.1°；急滾反向本身就是畫面的動作
      body(mustang, t, 1.5, 1.5, -1.4, false, out.position)
      messerschmitt(t - 0.1, S1)
      body(mustang, t, 0, 0.9, 1.3, false, S2)
      aimBetween(out.position, S2, S1, 0.72, out.target)
      bodyUp(mustang, t, out.up)
      shake(t, 0.1, 7, out)
      out.fov = 56
    },
  },
  {
    from: 13.5, subject: M1,
    camera(t, out) {
      // 主角前方 30 m 回看：它左右急滾反向，後下方的 109 跟著切過它的航跡
      // 跟拍機在它前面倒著飛，剪刀最緊張的一段，0.4°；注視點晚半拍，跟不太上急滾
      body(mustang, t, 9, 3, -30, true, out.position)
      mustang(t - 0.08, S1)
      messerschmitt(t - 0.2, S2)
      aimBetween(out.position, S1, S2, 0.45, out.target)
      shake(t, 0.4, 8, out)
      out.fov = 60
    },
  },
  {
    from: 15.6, subject: M1, mount: G1,
    camera(t, out) {
      // 109 長機左肩後：它滾轉、滑進直線爬升的主角正後方 80 m。掛在機上，0.1°
      body(messerschmitt, t, -1.0, 1.75, 3.6, false, out.position)
      mustang(t, out.target)
      bodyUp(messerschmitt, t, out.up)
      shake(t, 0.1, 10, out)
      out.fov = 42
    },
  },
  {
    from: 17.6, subject: M1,
    camera(t, out) {
      // 主角右前側 14 m：後方的 109 打來一串，主角起火，18.4 秒爆開。鏡頭照它原本的航線
      // 繼續往前，不追殘骸
      // 0.25° 跟拍，爆開那一下震
      body(mustang, t, 12, 2.5, -7, true, out.position)
      body(mustang, t, 0, 0, 2, true, out.target)
      shake(t, 0.25, 11, out, M1_KILL)
      out.fov = 50
    },
  },
  {
    from: 18.8, subject: G1, mount: M2,
    camera(t, out) {
      // 野馬僚機的座艙後上方：翻滾切入、幾乎垂直往下衝，109 在底下 400 m
      // 掛在機上，0.1°
      body(rescuer, t, 0.5, 1.6, 3.6, false, out.position)
      messerschmitt(t, S1)
      body(rescuer, t, 0, 0.9, -80, false, S2)
      aimBetween(out.position, S2, S1, 0.4, out.target)
      bodyUp(rescuer, t, out.up)
      shake(t, 0.1, 12, out)
      out.fov = 56
    },
  },
  {
    from: 20.7, subject: G1,
    camera(t, out) {
      // 釘在 109 俯衝線側下方的半空，往上仰拍：109 從鏡頭前斜衝下去，野馬咬在後面。
      // 架在俯衝線的正前方的話，背景正好是主角殘骸拖著煙往下掉的那一條
      messerschmitt(22.3, out.position)
      out.position.x += 48
      out.position.y -= 25
      out.position.z += 50
      // 手持仰拍 0.3°，注視點晚 0.15 秒：109 衝過去時跟不太上
      messerschmitt(t - 0.15, S1)
      rescuer(t, S2)
      aimBetween(out.position, S1, S2, 0.2, out.target)
      shake(t, 0.3, 13, out)
      out.fov = 46
    },
  },
  {
    from: 22.6, subject: G1, mount: M2,
    camera(t, out) {
      // 野馬僚機右肩後：曳光收進 109，23.7 秒起火。掛在機上，0.1°
      body(rescuer, t, 1.0, 1.75, 3.6, false, out.position)
      messerschmitt(t, out.target)
      bodyUp(rescuer, t, out.up)
      shake(t, 0.1, 14, out)
      out.fov = 40
    },
  },
  {
    from: 24.2, subject: G1,
    camera(t, out) {
      // 109 左前方 16 m 回看：起火冒煙，後方野馬再一串，25 秒爆開。鏡頭照它原本的航線往前
      // 0.25° 跟拍，爆開那一下震
      body(messerschmitt, t, -13, 2, -9, true, out.position)
      body(messerschmitt, t, 0, 0, 3, true, out.target)
      shake(t, 0.25, 15, out, G1_KILL)
      out.fov = 50
    },
  },
  {
    from: 25.4, subject: M2,
    camera(t, out) {
      // 釘在爆炸點下方往上仰拍：野馬穿過煙拉起、直直爬上天
      // 手持仰拍 0.3°，野馬從頭頂掠過的那一刻震一下。注視點只晚 0.05 秒 —— 它離鏡頭最近
      // 只有 50 m，晚多了會直接甩出畫面
      rescuer(26.6, out.position)
      out.position.x -= 30
      out.position.y -= 55
      rescuer(t - 0.05, out.target)
      shake(t, 0.3, 16, out, 26.3)
      out.fov = 56
    },
  },
  {
    from: 28, subject: M2,
    camera(t, out) {
      // 野馬右後側 40 m 跟拍：爬升中的勝利滾轉
      // 片尾收在平穩的跟拍，0.15°
      body(rescuer, t, 30, -6, 30, true, out.position)
      rescuer(t - 0.1, out.target)
      shake(t, 0.15, 17, out)
      out.fov = 44
    },
  },
]

const EVENTS: ReelEvent[] = [
  // 對頭：主角打僚機，長機那一串從主角身邊擦過去
  { at: 1.7, kind: 'burst', actor: M1, seconds: 1.15, target: G2 },
  { at: 2.3, kind: 'burst', actor: G1, seconds: 1.0 },
  { at: 2.7, kind: 'smoke', actor: G2, fire: true },
  { at: G2_KILL, kind: 'kill', actor: G2, blast: true },
  // 長機從上方壓下來，第一串打在主角前面
  { at: 11.0, kind: 'burst', actor: G1, seconds: 0.6 },
  // 剪刀之後咬上：主角拉成直線爬升，導引在 17.8 秒之後收斂到機首壓在它機身上，只在這一段開火
  { at: 17.85, kind: 'burst', actor: G1, seconds: 0.5, target: M1 },
  { at: 18.0, kind: 'smoke', actor: M1, fire: true },
  { at: M1_KILL, kind: 'kill', actor: M1, blast: true },
  // 僚機報仇
  { at: 23.3, kind: 'burst', actor: M2, seconds: 0.9, target: G1 },
  { at: 23.7, kind: 'smoke', actor: G1, fire: true },
  { at: 24.4, kind: 'burst', actor: M2, seconds: 0.55, target: G1 },
  { at: G1_KILL, kind: 'kill', actor: G1, blast: true },
  // 背景：各組追的那一架一串一串打，曳光在遠處交叉；冒煙的那一架整段都在往下掉
  { at: 0, kind: 'smoke', actor: BG_FALL },
  ...[1.5, 6.0, 10.5, 15.0, 20.0, 26.0].map((at) => ({ at, kind: 'burst' as const, actor: BG_A + 1, seconds: 0.6, target: BG_A })),
  ...[3.0, 8.0, 13.0, 18.5, 23.0, 28.0].map((at) => ({ at, kind: 'burst' as const, actor: BG_B + 1, seconds: 0.6, target: BG_B })),
  ...[4.5, 9.0, 16.0, 22.0, 29.0].map((at) => ({ at, kind: 'burst' as const, actor: BG_C + 1, seconds: 0.6, target: BG_C })),
]

export const DOGFIGHT: Shot = {
  id: 'dogfight',
  duration: 31,
  timeOfDay: 'noon',
  faceSun: false,
  // 動作範圍約 2.5 km 見方。圓要大上好幾倍：掛機與仰拍的鏡頭看得到地平線，
  // 小了島就擠在畫面邊上
  clear: { x: 0, z: -1000, radius: 12000 },
  planes: [
    { spec: P51D, path: mustang },
    { spec: BF109K4, path: messerschmitt },
    { spec: BF109K4, path: wing109 },
    { spec: P51D, path: rescuer },
    { spec: BF109K4, path: track(TABLES[BG_A]!), extra: true },
    { spec: P51D, path: track(TABLES[BG_A + 1]!), extra: true },
    { spec: P51D, path: track(TABLES[BG_B]!), extra: true },
    { spec: BF109K4, path: track(TABLES[BG_B + 1]!), extra: true },
    { spec: BF109K4, path: track(TABLES[BG_C]!), extra: true },
    { spec: P51D, path: track(TABLES[BG_C + 1]!), extra: true },
    { spec: BF109K4, path: track(TABLES[BG_FALL]!), extra: true },
  ],
  ships: [],
  cuts: CUTS,
  camera: edit(CUTS),
  events: timeline(EVENTS),
}
