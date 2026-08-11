/**
 * AI 實際在哪個速度／半徑纏鬥。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/turn-regime.probe.ts
 *
 * 【它要回答什麼】迴轉半徑有兩個不同的天花板：角落速度以下由 CLmax 決定，
 * 以上由結構過載 gPositive 決定。「把半徑縮 25%」該動哪一個，取決於 AI
 * **實際**大部分時間在哪一段。用包絡表推是猜的，這支直接跑一場戰鬥去量。
 *
 * 轉彎率由**速度向量**的轉動量出來，不是機體角速度 —— 半徑講的是航跡。
 */
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import {
  cornerSpeed, stallSpeed, instantaneousTurnRate, maxLoadFactorAero,
} from '../../src/analysis/envelope'
import { derivedClMax } from '../../src/specs/types'

const DT = 1 / 240
const SECONDS = 180
const SEED = 20260811
const RAD = 180 / Math.PI
const KMH = 3.6
/** 只採計「真的在轉」的樣本。10°/s 以下是巡航微調，不是纏鬥。 */
const HARD_TURN = 10 / RAD
/** 每 0.1 s 採一次，避免相鄰幀高度相關。 */
const SAMPLE_STRIDE = 24

// 玩家席也交給 AI —— 量的是 AI 對 AI，與 target-churn.probe.ts 同一個做法
const b = createBattle(new AiController(), DEFAULT_BATTLE, SEED)
const cs = b.world.combatants
const prevVel = cs.map(() => new Vector3())
for (let i = 0; i < cs.length; i++) prevVel[i]!.copy(cs[i]!.aircraft.state.velocity)

interface Sample {
  tas: number
  alt: number
  rate: number
  radius: number
  overCorner: boolean
  /** 該速度／高度下的瞬時極限半徑，m。實際 ÷ 它 = 有沒有把飛機用滿 */
  limitRadius: number
  /** 實際過載 ÷ 該點可用的最大過載 */
  gUse: number
  /** 升降舵**指令**絕對值，0..1 */
  elev: number
  /** 迎角 ÷ 失速迎角 */
  alphaUse: number
}
const samples: Sample[] = []
const tmp = new Vector3()
const tmp2 = new Vector3()

const steps = Math.round(SECONDS / DT)
for (let s = 0; s < steps; s++) {
  stepBattle(b, DT)
  const sampling = s % SAMPLE_STRIDE === 0
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    const v = c.aircraft.state.velocity
    if (sampling && c.alive) {
      const pv = prevVel[i]!
      const sp = v.length()
      const psp = pv.length()
      if (sp > 1 && psp > 1) {
        // 兩個速度單位向量之間的夾角 ÷ 這段時間 = 航跡角速度
        tmp.copy(v).divideScalar(sp)
        tmp2.copy(pv).divideScalar(psp)
        let d = tmp.dot(tmp2)
        if (d > 1) d = 1
        else if (d < -1) d = -1
        const rate = Math.acos(d) / (SAMPLE_STRIDE * DT)
        if (rate > HARD_TURN) {
          const alt = c.aircraft.state.position.y
          const spec = c.aircraft.spec
          const limitRate = instantaneousTurnRate(spec, alt, sp)
          const nAvail = Math.min(maxLoadFactorAero(spec, alt, sp), spec.limits.gPositive)
          const alphaCrit = spec.lift.alphaCrit
            + (c.aircraft.diag.slatsDeployed ? spec.lift.slatAlphaBonus : 0)
          samples.push({
            tas: sp,
            alt,
            rate,
            radius: sp / rate,
            overCorner: sp > cornerSpeed(spec, alt),
            limitRadius: limitRate > 1e-6 ? sp / limitRate : Infinity,
            gUse: nAvail > 0 ? Math.abs(c.aircraft.diag.loadFactor) / nAvail : 0,
            elev: Math.abs(c.aircraft.controls.elevator),
            alphaUse: c.aircraft.diag.aero.alpha / alphaCrit,
          })
        }
      }
    }
    if (sampling) prevVel[i]!.copy(v)
  }
}

function pct(arr: number[], p: number): number {
  const a = [...arr].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))]!
}

console.log(`樣本 ${samples.length} 筆（${SECONDS} s、40 架、每 0.1 s、轉彎率 > 10°/s）`)
const tas = samples.map((x) => x.tas * KMH)
const rad = samples.map((x) => x.radius)
const rate = samples.map((x) => x.rate * RAD)
const alt = samples.map((x) => x.alt)
const over = samples.filter((x) => x.overCorner).length

const row = (name: string, a: number[], unit: string) => {
  console.log(`${name.padEnd(12)} p10 ${pct(a, 0.1).toFixed(0).padStart(6)}  `
    + `中位 ${pct(a, 0.5).toFixed(0).padStart(6)}  p90 ${pct(a, 0.9).toFixed(0).padStart(6)}  `
    + `p99 ${pct(a, 0.99).toFixed(0).padStart(6)}  ${unit}`)
}
row('TAS', tas, 'km/h')
row('航跡半徑', rad, 'm')
row('轉彎率', rate, '°/s')
row('高度', alt, 'm')
console.log(`\n角落速度以上（受 gPositive 限制）的比例：${(over / samples.length * 100).toFixed(1)}%`)
console.log(`角落速度以下（受 CLmax 限制）的比例：${((1 - over / samples.length) * 100).toFixed(1)}%`)

// 分速度帶看半徑
console.log('\n速度帶       樣本%   中位半徑  中位轉彎率')
const BANDS = [[0, 300], [300, 400], [400, 500], [500, 600], [600, 1000]]
for (const [lo, hi] of BANDS) {
  const g = samples.filter((x) => x.tas * KMH >= lo! && x.tas * KMH < hi!)
  if (g.length === 0) continue
  console.log(`${String(lo).padStart(4)}–${String(hi).padStart(4)} km/h `
    + `${(g.length / samples.length * 100).toFixed(1).padStart(6)}%  `
    + `${pct(g.map((x) => x.radius), 0.5).toFixed(0).padStart(7)} m  `
    + `${pct(g.map((x) => x.rate * RAD), 0.5).toFixed(1).padStart(8)}°/s`)
}

// 相對於自己的失速／角落速度
console.log('\n=== 有沒有把飛機用滿 ===')
const row2 = (name: string, a: number[]) => {
  console.log(`${name.padEnd(14)} p10 ${pct(a, 0.1).toFixed(2).padStart(5)}  `
    + `中位 ${pct(a, 0.5).toFixed(2).padStart(5)}  p90 ${pct(a, 0.9).toFixed(2).padStart(5)}  `
    + `p99 ${pct(a, 0.99).toFixed(2).padStart(5)}`)
}
const util = samples.map((x) => x.limitRadius / x.radius)
row2('極限R÷實際R（1=拉滿）', util)
row2('過載使用率', samples.map((x) => x.gUse))
row2('升降舵指令', samples.map((x) => x.elev))
row2('迎角÷失速迎角', samples.map((x) => x.alphaUse))
console.log(`拉到極限 90% 以上的樣本：${(samples.filter((x) => x.limitRadius / x.radius > 0.9).length / samples.length * 100).toFixed(1)}%`)
console.log(`升降舵指令 > 0.95 的樣本：${(samples.filter((x) => x.elev > 0.95).length / samples.length * 100).toFixed(1)}%`)
console.log(`中位極限半徑 ${pct(samples.map((x) => x.limitRadius), 0.5).toFixed(0)} m`
  + ` vs 中位實際半徑 ${pct(rad, 0.5).toFixed(0)} m`)
console.log(`P-51D CLmax（含手感）= ${derivedClMax(cs[0]!.aircraft.spec, false).toFixed(3)}`)

const ratios = samples.map((x) => {
  const spec = cs[0]!.aircraft.spec
  return x.tas / cornerSpeed(spec, x.alt)
})
console.log(`\nTAS ÷ 角落速度：p10 ${pct(ratios, 0.1).toFixed(2)}  中位 ${pct(ratios, 0.5).toFixed(2)}`
  + `  p90 ${pct(ratios, 0.9).toFixed(2)}`)
const stallR = samples.map((x) => x.tas / stallSpeed(cs[0]!.aircraft.spec, x.alt, 1))
console.log(`TAS ÷ 失速速度：p10 ${pct(stallR, 0.1).toFixed(2)}  中位 ${pct(stallR, 0.5).toFixed(2)}`
  + `  p90 ${pct(stallR, 0.9).toFixed(2)}`)
