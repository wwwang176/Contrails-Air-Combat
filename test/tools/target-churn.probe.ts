/**
 * 目標猶豫的量測探針。**不是測試** —— 副檔名是 `.probe.ts`，而 `vite.config.ts`
 * 的 `test.include` 只收 `test/**\/*.test.ts`。
 *
 * 跑法：`npx vite-node test/tools/target-churn.probe.ts`
 *
 * 【它要回答什麼】專案負責人回報「AI 還是會在兩個敵人之間猶豫」，並提議
 * 三件事：提高換敵成本、瞄準點角度內加分、背後扣分。這支把「猶豫」拆成
 * 可量的東西，好判斷那三件事各自打不打得中真正的成因：
 *
 *   1. 換目標裡有多少是**舊目標還活著**的（死了才換不是猶豫）
 *   2. 其中有多少是 A→B→A（換走又換回來）
 *   3. 每一次換目標，四個乘法因子各自變了多少倍 —— 是誰把分數推過門檻的
 *   4. 新舊目標的**離軸角**（由速度向量量，與 `turnTime` 同一個基準）
 *   5. **Dicta Boelcke 第二條的反面**：對舊目標仍有射擊解卻換走
 *
 * 【自我檢查】探針自己重算一次四因子的乘積，與 `targetScore` 逐值比對。
 * 對不上就代表這支量的不是真正在跑的那條公式，會直接報錯。
 *
 * 【`ai-targeting.test.ts` 的四條門檻也一起算】改動若動到它們，這裡先看得到。
 */
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import {
  countLocks, targetScore, visionFactor, DEFAULT_TARGET, type TargetConfig,
} from '../../src/ai/target'
import { threatFactor, trackAngle, turnTime } from '../../src/ai/assess'
import { isFlightLeader } from '../../src/battle/flights'
import type { Aircraft } from '../../src/aircraft/Aircraft'

const DT = 1 / 240
const SECONDS = 150
const SEED = 20260805
const FWD = new Vector3(0, 0, -1)

function discount(x: number, w: number): number {
  if (w === 0) return 1
  if (!(x > 0)) return 1
  const d = 1 / (1 + x)
  return w === 1 ? d : Math.pow(d, w)
}

const S1 = new Vector3()
const S2 = new Vector3()
const S3 = new Vector3()

interface Factors {
  geometry: number
  range: number
  crowd: number
  turn: number
  product: number
  /** 離軸角，度。由**速度向量**量 —— 與 turnTime 同一個基準 */
  offAxis: number
  rangeM: number
}

function factorsOf(self: Aircraft, enemy: Aircraft, locks: number, cfg: TargetConfig): Factors {
  const los = S1.copy(enemy.state.position).sub(self.state.position)
  const range = los.length()
  const losUnit = S2.copy(los).divideScalar(Math.max(range, 1e-9))

  const enemyFwd = S3.copy(FWD).applyQuaternion(enemy.state.orientation)
  let b = enemyFwd.dot(losUnit)
  if (b < -1) b = -1
  else if (b > 1) b = 1
  const opportunity = b > 0 ? b : 0

  const geometry = cfg.baseScore
    + cfg.opportunityWeight * opportunity
    + cfg.threatWeight * threatFactor(enemy, self)
  const rangeD = discount(range / cfg.rangeScale, cfg.rangeWeight)
  const relief = cfg.shotRelief > 0
    ? Math.min(1, threatFactor(self, enemy) / cfg.shotRelief)
    : 0
  const crowdD = discount(cfg.crowdPenalty * locks * (1 - relief), cfg.crowdWeight)
  const turnD = discount(turnTime(self, enemy) / cfg.turnTimeScale, cfg.turnWeight)
  const visionD = visionFactor(trackAngle(self, enemy), cfg)

  const vel = S3.copy(self.state.velocity)
  const speed = vel.length()
  if (speed > 1e-3) vel.divideScalar(speed)
  else vel.copy(FWD).applyQuaternion(self.state.orientation)
  let d = vel.dot(losUnit)
  if (d < -1) d = -1
  else if (d > 1) d = 1

  return {
    geometry, range: rangeD, crowd: crowdD, turn: turnD,
    product: geometry * rangeD * crowdD * turnD * visionD,
    offAxis: (Math.acos(d) * 180) / Math.PI,
    rangeM: range,
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

function share(xs: number[], pred: (x: number) => boolean): number {
  if (xs.length === 0) return NaN
  return xs.filter(pred).length / xs.length
}

interface Result {
  switchesAll: number
  switchesOldAlive: number
  backToPrev: number
  leaderSwitchesAlive: number
  leaderBackToPrev: number
  holdMedian: number
  leaderHoldMedian: number
  atFloor: number
  worseAxis: number
  newRear: number
  withShot: number
  shotToNoShot: number
  offAxisOldMed: number
  offAxisNewMed: number
  rangeOldMed: number
  rangeNewMed: number
  ratioMedian: Record<string, number>
  ratioBig: Record<string, number>
  axisBuckets: number[]
  /** 以下四項是 ai-targeting.test.ts 的門檻 */
  rearShare: number
  fireShare: number
  onNose: number
  selfCheckWorst: number
}

function run(perSide: number, visionPower: number): Result {
  const cfg: TargetConfig = { ...DEFAULT_TARGET, visionPower }
  const b = createBattle(
    new AiController(),
    { ...DEFAULT_BATTLE, blueCount: perSide, redCount: perSide },
    SEED,
  )
  const cs = b.world.combatants
  for (const c of cs) {
    if (c.controller instanceof AiController) c.controller.targetConfig = cfg
  }
  const indexOf = new Map<Aircraft, number>()
  for (const c of cs) indexOf.set(c.aircraft, c.index)

  const prev: number[] = cs.map(() => -2)
  const prevPrev: number[] = cs.map(() => -2)
  const holdStart: number[] = cs.map(() => 0)
  const holds: number[] = []
  const leaderHolds: number[] = []

  let switchesAll = 0
  let switchesOldAlive = 0
  let backToPrev = 0
  let leaderSwitchesAlive = 0
  let leaderBackToPrev = 0
  let selfCheckWorst = 0
  let worseAxis = 0
  let newRear = 0
  let withShot = 0
  let shotToNoShot = 0
  let rearNose = 0
  let fire = 0
  let alive = 0
  let onNose = 0
  let samples = 0
  const axisBuckets = [0, 0, 0, 0, 0, 0]
  const ratios: Record<string, number[]> = { geometry: [], range: [], crowd: [], turn: [] }
  const offAxisOld: number[] = []
  const offAxisNew: number[] = []
  const rangeOld: number[] = []
  const rangeNew: number[] = []

  const nose = new Vector3()
  const los = new Vector3()
  const aspectOf = (self: Aircraft, tgt: Aircraft): number => {
    los.copy(tgt.state.position).sub(self.state.position)
    const r = los.length()
    if (r < 1e-3) return 0
    los.divideScalar(r)
    nose.copy(FWD).applyQuaternion(self.state.orientation)
    return Math.acos(Math.max(-1, Math.min(1, nose.dot(los))))
  }

  const steps = Math.round(SECONDS / DT)
  for (let s = 0; s < steps; s++) {
    stepBattle(b, DT)
    const t = s * DT
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      if (!c.alive) { prev[i] = -2; prevPrev[i] = -2; continue }
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      alive += DT
      if (c.command.firing) fire += DT
      if (s % 60 === 0) {
        samples++
        if (ai.target && aspectOf(c.aircraft, ai.target) < (15 * Math.PI) / 180) onNose++
      }

      const tgt = ai.target ? indexOf.get(ai.target)! : -1
      if (tgt === prev[i]) continue

      const old = prev[i]!
      const leader = isFlightLeader(b.flights, i)
      if (old >= 0) {
        holds.push(t - holdStart[i]!)
        if (leader) leaderHolds.push(t - holdStart[i]!)
      }

      if (tgt >= 0 && old >= 0) {
        switchesAll++
        if (aspectOf(c.aircraft, cs[tgt]!.aircraft) > Math.PI / 2) rearNose++
        const oldC = cs[old]!
        if (oldC.alive) {
          switchesOldAlive++
          if (leader) leaderSwitchesAlive++
          if (tgt === prevPrev[i]) {
            backToPrev++
            if (leader) leaderBackToPrev++
          }

          const oldLocks = countLocks(b.board, c.team, i, old)
          const fOld = factorsOf(c.aircraft, oldC.aircraft, oldLocks, cfg)
          const realOld = targetScore(c.aircraft, oldC.aircraft, oldLocks, cfg)
          const rel = Math.abs(fOld.product - realOld) / Math.max(realOld, 1e-12)
          if (rel > selfCheckWorst) selfCheckWorst = rel

          const newC = cs[tgt]!
          const fNew = factorsOf(c.aircraft, newC.aircraft,
            countLocks(b.board, c.team, i, tgt), cfg)

          ratios.geometry!.push(fNew.geometry / Math.max(fOld.geometry, 1e-12))
          ratios.range!.push(fNew.range / Math.max(fOld.range, 1e-12))
          ratios.crowd!.push(fNew.crowd / Math.max(fOld.crowd, 1e-12))
          ratios.turn!.push(fNew.turn / Math.max(fOld.turn, 1e-12))
          offAxisOld.push(fOld.offAxis)
          offAxisNew.push(fNew.offAxis)
          rangeOld.push(fOld.rangeM)
          rangeNew.push(fNew.rangeM)
          if (fNew.offAxis > fOld.offAxis) worseAxis++
          if (fNew.offAxis > 90) newRear++
          axisBuckets[Math.min(5, Math.floor(fNew.offAxis / 30))]!++

          if (threatFactor(c.aircraft, oldC.aircraft) > 0) {
            withShot++
            if (threatFactor(c.aircraft, newC.aircraft) <= 0) shotToNoShot++
          }
        }
      }

      if (tgt >= 0) holdStart[i] = t
      prevPrev[i] = old
      prev[i] = tgt
    }
  }

  const med: Record<string, number> = {}
  const big: Record<string, number> = {}
  for (const k of ['geometry', 'range', 'crowd', 'turn']) {
    med[k] = median(ratios[k]!)
    big[k] = share(ratios[k]!, (x) => x > 1.5)
  }

  return {
    switchesAll, switchesOldAlive, backToPrev, leaderSwitchesAlive, leaderBackToPrev,
    holdMedian: median(holds), leaderHoldMedian: median(leaderHolds),
    atFloor: share(holds, (x) => x <= 2.1),
    worseAxis: worseAxis / Math.max(switchesOldAlive, 1),
    newRear: newRear / Math.max(switchesOldAlive, 1),
    withShot, shotToNoShot,
    offAxisOldMed: median(offAxisOld), offAxisNewMed: median(offAxisNew),
    rangeOldMed: median(rangeOld), rangeNewMed: median(rangeNew),
    ratioMedian: med, ratioBig: big, axisBuckets,
    rearShare: switchesAll > 0 ? rearNose / switchesAll : 0,
    fireShare: alive > 0 ? fire / alive : 0,
    onNose: samples > 0 ? onNose / samples : 0,
    selfCheckWorst,
  }
}

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`
const f2 = (x: number): string => x.toFixed(2)

/**
 * 【為什麼要跑三種架數】這個模擬是**全決定性的**（種子只決定飛行員名字），
 * 所以單一場次只有**一個樣本**，而 `DEFAULT_TARGET` 的註解已經記過參數敏感度
 * 是混沌的。換架數是這個專案唯一拿得到獨立實現的辦法。2026-08-09 的
 * `engagedMargin` 提案就是這樣被否決的：20v20 看起來 −43%，12v12 只有 −3%。
 *
 * 【視野折扣的 A/B 在同一輪跑】`visionPower` 0 = 關掉，2 = 現行值。
 */
const SIZES = [20, 12, 8]
const ARMS = [0, DEFAULT_TARGET.visionPower]
const results = new Map<string, Result>()
for (const n of SIZES) {
  for (const v of ARMS) results.set(`${n}|${v}`, run(n, v))
}
const get = (n: number, v: number): Result => results.get(`${n}|${v}`)!

for (const [k, r] of results) {
  if (!(r.selfCheckWorst < 1e-9)) {
    throw new Error(`${k}：探針算的公式與 targetScore 對不上（${r.selfCheckWorst}）`)
  }
}
console.log('自我檢查通過（五因子乘積 vs targetScore，最差相對誤差 '
  + `${Math.max(...[...results.values()].map((r) => r.selfCheckWorst)).toExponential(2)}）`)

const arrow = (a: number, b: number, f: (x: number) => string): string =>
  `${f(a)} → ${f(b)}`

console.log('\n=== 視野折扣 A/B（150 s、種子 20260805）visionPower 0 → 2 ===')
console.log('【這次要打的：換去後半球】')
console.log('架數    新目標在後半球      離軸更差           換去 90-180° 的次數')
for (const n of SIZES) {
  const a = get(n, 0)
  const b = get(n, ARMS[1]!)
  console.log(
    `${n}v${n}`.padStart(6) + `  ${arrow(a.newRear, b.newRear, pct).padStart(16)}`
    + `  ${arrow(a.worseAxis, b.worseAxis, pct).padStart(16)}`
    + `  ${arrow(Math.round(a.newRear * a.switchesOldAlive),
      Math.round(b.newRear * b.switchesOldAlive), (x) => String(Math.round(x))).padStart(14)}`,
  )
}

console.log('\n【專案負責人抱怨的：猶豫】')
console.log('架數    活著時換目標        A→B→A              長機 A→B→A')
for (const n of SIZES) {
  const a = get(n, 0)
  const b = get(n, ARMS[1]!)
  console.log(
    `${n}v${n}`.padStart(6)
    + `  ${arrow(a.switchesOldAlive, b.switchesOldAlive, (x) => String(x)).padStart(16)}`
    + `  ${arrow(a.backToPrev / Math.max(a.switchesOldAlive, 1),
      b.backToPrev / Math.max(b.switchesOldAlive, 1), pct).padStart(16)}`
    + `  ${arrow(a.leaderBackToPrev / Math.max(a.leaderSwitchesAlive, 1),
      b.leaderBackToPrev / Math.max(b.leaderSwitchesAlive, 1), pct).padStart(16)}`,
  )
}

console.log('\n【既有護欄 —— ai-targeting.test.ts，20v20 才是它的定義域】')
console.log('架數    holdMedian(≥1.5)   rearShare(≤0.35)   fireShare(≥0.025)  onNose(≥0.12)')
for (const n of SIZES) {
  const a = get(n, 0)
  const b = get(n, ARMS[1]!)
  console.log(
    `${n}v${n}`.padStart(6) + `  ${arrow(a.holdMedian, b.holdMedian, f2).padStart(15)}`
    + `  ${arrow(a.rearShare, b.rearShare, pct).padStart(17)}`
    + `  ${arrow(a.fireShare, b.fireShare, pct).padStart(16)}`
    + `  ${arrow(a.onNose, b.onNose, pct).padStart(14)}`,
  )
}

console.log('\n【20v20 的離軸分布】')
for (const v of ARMS) {
  const r = get(20, v)
  console.log(`visionPower ${v}：`
    + r.axisBuckets.map((c, k) => `${k * 30}-${k * 30 + 30}° `
      + `${pct(c / Math.max(r.switchesOldAlive, 1))}`).join('　'))
}
