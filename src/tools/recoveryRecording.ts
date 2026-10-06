/** 復原試飛的逐格錄製與播放取樣；不依賴 DOM 或場景。 */
import {
  DT, bankFromUpright, simulateTrial,
  type ModelParams, type SafetyModel, type Scenario,
} from './recoveryModel'

const DEG = Math.PI / 180

/** 模擬長度，s */
export const SIM_SECONDS = 25

/** 每幾個物理步存一格 */
const STRIDE = 2

export const FRAME_DT = DT * STRIDE

/** 每格欄位 */
export const F = { x: 0, y: 1, z: 2, qx: 3, qy: 4, qz: 5, qw: 6, needed: 7, takeover: 8, bank: 9, gamma: 10, n: 11, tas: 12 } as const

export const FIELDS = 13

export interface Run {
  frames: Float32Array
  count: number
  /** 第一次接管的格；−1 = 沒有 */
  trigger: number
  minIndex: number
  crashed: boolean
}

export function record(s: Scenario, model: SafetyModel, p: ModelParams): Run {
  const maxFrames = Math.ceil(SIM_SECONDS / FRAME_DT) + 2
  const frames = new Float32Array(maxFrames * FIELDS)
  let count = 0
  let trigger = -1
  let minIndex = 0
  let minY = Infinity
  let crashedAt = -1
  const res = simulateTrial(s, model, p, SIM_SECONDS, true, (st) => {
    const i = Math.round(st.t / DT)
    const hit = st.agl <= 0
    const first = st.takeover && trigger < 0
    if (i % STRIDE !== 0 && !hit && !first) return
    if (count >= maxFrames) return
    const a = st.aircraft
    const o = count * FIELDS
    const pos = a.state.position
    const q = a.state.orientation
    const vel = a.state.velocity
    const tas = vel.length()
    frames[o + F.x] = pos.x
    frames[o + F.y] = Math.max(st.agl, 0)
    frames[o + F.z] = pos.z
    frames[o + F.qx] = q.x
    frames[o + F.qy] = q.y
    frames[o + F.qz] = q.z
    frames[o + F.qw] = q.w
    frames[o + F.needed] = st.needed
    frames[o + F.takeover] = st.takeover ? 1 : 0
    frames[o + F.bank] = bankFromUpright(a) / DEG
    frames[o + F.gamma] = Math.asin(Math.max(-1, Math.min(1, vel.y / Math.max(tas, 1e-3)))) / DEG
    frames[o + F.n] = a.diag.loadFactor
    frames[o + F.tas] = tas
    if (first) trigger = count
    if (st.agl < minY) {
      minY = st.agl
      minIndex = count
    }
    if (hit) crashedAt = count
    count++
  })
  return { frames, count, trigger, minIndex: res.crashed && crashedAt >= 0 ? crashedAt : minIndex, crashed: res.crashed }
}

export function frameIndex(run: Run, t: number): { i: number; f: number } {
  const x = t / FRAME_DT
  const i = Math.min(Math.floor(x), run.count - 1)
  const f = i >= run.count - 1 ? 0 : x - i
  return { i: Math.max(i, 0), f }
}

export function lerpField(run: Run, i: number, f: number, field: number): number {
  const a = run.frames[i * FIELDS + field]!
  if (f === 0) return a
  const b = run.frames[(i + 1) * FIELDS + field]!
  return a + (b - a) * f
}
