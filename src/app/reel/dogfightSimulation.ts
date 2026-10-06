import { Vector3 } from 'three'
import type { Path } from '../reelFlight'

// ── 飛行模擬：由分鏡初始化時積分一次，播放時只查表 ────────────
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

export type Pilot = (t: number, me: Craft, all: readonly Craft[], order: Order) => void

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
export function script(steps: readonly Step[]): Pilot {
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
export function pursue(target: number, c: Chase): Pilot {
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
export function phases(list: readonly (readonly [number, Pilot])[]): Pilot {
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

export interface Start { readonly x: number, readonly y: number, readonly z: number, readonly heading: number, readonly v: number }

/** 把所有參與模擬的飛機一起積分，回傳每一架的樣本表（位置、速度交錯存放） */
export function simulate(starts: readonly Start[], pilots: readonly Pilot[]): Float64Array[] {
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
export function track(tb: Float64Array): Path {
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
