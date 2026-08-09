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
import { countLocks, targetScore, DEFAULT_TARGET, type TargetConfig } from '../../src/ai/target'
import { threatFactor, turnTime } from '../../src/ai/assess'
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

  const vel = S3.copy(self.state.velocity)
  const speed = vel.length()
  if (speed > 1e-3) vel.divideScalar(speed)
  else vel.copy(FWD).applyQuaternion(self.state.orientation)
  let d = vel.dot(losUnit)
  if (d < -1) d = -1
  else if (d > 1) d = 1

  return {
    geometry, range: rangeD, crowd: crowdD, turn: turnD,
    product: geometry * rangeD * crowdD * turnD,
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

function run(perSide = 20): Result {
  const cfg: TargetConfig = DEFAULT_TARGET
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
 * 【為什麼要跑三種架數】這個模擬是**全決定性的**（種子只決定飛行員名字，
 * 三顆種子逐字相同），所以單一場次只有**一個樣本**。而 `DEFAULT_TARGET`
 * 的註解已經記過參數敏感度是混沌的（`baseScore` 0.5 那個 7.90% 被判定為
 * 「孤峰，不要當成證據」）。換架數是這個專案唯一拿得到獨立實現的辦法。
 */
const SIZES = [20, 12, 8]
const results = new Map<number, Result>()
for (const n of SIZES) results.set(n, run(n))

for (const [n, r] of results) {
  if (!(r.selfCheckWorst < 1e-9)) {
    throw new Error(`${n}v${n}：探針算的公式與 targetScore 對不上`)
  }
}
console.log('自我檢查通過（四因子乘積 vs targetScore，最差相對誤差 '
  + `${Math.max(...[...results.values()].map((r) => r.selfCheckWorst)).toExponential(2)}）`)

console.log('\n=== 換目標的組成（150 s、種子 20260805）===')
console.log('架數    總換  舊的已陣亡  舊的還活著  A→B→A   長機A→B→A  長機持有中位  貼在下限')
for (const [n, r] of results) {
  console.log(
    `${n}v${n}`.padStart(6)
    + `  ${String(r.switchesAll).padStart(4)}  ${String(r.switchesAll - r.switchesOldAlive).padStart(10)}`
    + `  ${String(r.switchesOldAlive).padStart(10)}`
    + `  ${pct(r.backToPrev / Math.max(r.switchesOldAlive, 1)).padStart(6)}`
    + `  ${pct(r.leaderBackToPrev / Math.max(r.leaderSwitchesAlive, 1)).padStart(9)}`
    + `  ${f2(r.leaderHoldMedian).padStart(11)} s  ${pct(r.atFloor).padStart(7)}`,
  )
}

console.log('\n=== 幾何：換過去之後變好還是變差 ===')
console.log('架數    離軸更差  後半球  離軸中位(舊→新)  距離中位(舊→新)')
for (const [n, r] of results) {
  console.log(
    `${n}v${n}`.padStart(6) + `  ${pct(r.worseAxis).padStart(8)}  ${pct(r.newRear).padStart(6)}`
    + `  ${`${f2(r.offAxisOldMed)}°→${f2(r.offAxisNewMed)}°`.padStart(15)}`
    + `  ${`${r.rangeOldMed.toFixed(0)}→${r.rangeNewMed.toFixed(0)} m`.padStart(15)}`,
  )
}

console.log('\n=== Dicta Boelcke 第二條「一旦開始攻擊就要打完」的反面 ===')
console.log('架數    有槍解卻換走  其中換去沒槍解')
for (const [n, r] of results) {
  console.log(
    `${n}v${n}`.padStart(6) + `  ${String(r.withShot).padStart(10)}`
    + `（${pct(r.withShot / Math.max(r.switchesOldAlive, 1))}）`
    + `  ${String(r.shotToNoShot).padStart(10)}`
    + `（${pct(r.shotToNoShot / Math.max(r.withShot, 1))}）`,
  )
}

console.log('\n=== ai-targeting.test.ts 的四條門檻（20v20 才是它的定義域）===')
console.log('架數    holdMedian(≥1.5)  rearShare(≤0.35)  fireShare(≥0.025)  onNose(≥0.12)')
for (const [n, r] of results) {
  console.log(
    `${n}v${n}`.padStart(6) + `  ${f2(r.holdMedian).padStart(14)}  ${pct(r.rearShare).padStart(14)}`
    + `  ${pct(r.fireShare).padStart(15)}  ${pct(r.onNose).padStart(12)}`,
  )
}

const main = results.get(20)
if (main !== undefined) {
  console.log('\n=== 20v20 的因子分解：誰把分數推過門檻 ===')
  console.log('因子        新÷舊中位   >1.5 倍的比例')
  for (const k of ['geometry', 'range', 'crowd', 'turn']) {
    console.log(`${k.padEnd(10)}  ${f2(main.ratioMedian[k]!).padStart(9)}   `
      + `${pct(main.ratioBig[k]!).padStart(8)}`)
  }
  console.log('新目標離軸角分布：'
    + main.axisBuckets.map((n, k) => `${k * 30}-${k * 30 + 30}° `
      + `${pct(n / Math.max(main.switchesOldAlive, 1))}`).join('　'))
}
