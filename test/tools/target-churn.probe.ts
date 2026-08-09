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
 *
 * 【自我檢查】探針自己重算一次四因子的乘積，與 `targetScore` 逐值比對。
 * 對不上就代表這支量的不是真正在跑的那條公式，會直接報錯。
 */
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { countLocks, targetScore, DEFAULT_TARGET } from '../../src/ai/target'
import { threatFactor, turnTime } from '../../src/ai/assess'
import { isFlightLeader } from '../../src/battle/flights'
import type { Aircraft } from '../../src/aircraft/Aircraft'

const DT = 1 / 240
const SECONDS = 150
const SEED = 20260805
const FWD = new Vector3(0, 0, -1)
const cfg = DEFAULT_TARGET

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
  locks: number
}

function factorsOf(self: Aircraft, enemy: Aircraft, locks: number): Factors {
  const los = S1.copy(enemy.state.position).sub(self.state.position)
  const range = los.length()
  const losUnit = S2.copy(los).divideScalar(Math.max(range, 1e-9))

  const enemyFwd = S3.copy(FWD).applyQuaternion(enemy.state.orientation)
  let b = enemyFwd.dot(losUnit)
  if (b < -1) b = -1
  else if (b > 1) b = 1
  const opportunity = b > 0 ? b : 0
  const threat = threatFactor(enemy, self)

  const geometry = cfg.baseScore
    + cfg.opportunityWeight * opportunity
    + cfg.threatWeight * threat
  const rangeD = discount(range / cfg.rangeScale, cfg.rangeWeight)
  const relief = cfg.shotRelief > 0
    ? Math.min(1, threatFactor(self, enemy) / cfg.shotRelief)
    : 0
  const crowdD = discount(cfg.crowdPenalty * locks * (1 - relief), cfg.crowdWeight)
  const turnD = discount(turnTime(self, enemy) / cfg.turnTimeScale, cfg.turnWeight)

  // 離軸角：速度向量對視線
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
    locks,
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

const b = createBattle(new AiController(), DEFAULT_BATTLE, SEED)
const cs = b.world.combatants
const indexOf = new Map<Aircraft, number>()
for (const c of cs) indexOf.set(c.aircraft, c.index)

const prev: number[] = cs.map(() => -2)
const prevPrev: number[] = cs.map(() => -2)
const holdStart: number[] = cs.map(() => 0)
const holds: number[] = []
const leaderHolds: number[] = []

let switchesAll = 0
let switchesOldDead = 0
let switchesOldAlive = 0
let backToPrev = 0
let leaderSwitchesAlive = 0
let leaderBackToPrev = 0
let selfCheckWorst = 0

/** 舊目標還活著的那些換目標，四因子的新÷舊 */
const ratios = { geometry: [] as number[], range: [] as number[], crowd: [] as number[], turn: [] as number[] }
const offAxisOld: number[] = []
const offAxisNew: number[] = []
const rangeOld: number[] = []
const rangeNew: number[] = []
/** 新目標的離軸角比舊目標**更差**的比例 */
let worseAxis = 0
/** 新目標落在後半球（離軸 > 90°）的次數 */
let newRear = 0
/** 換的當下對**舊目標**仍有射擊解（Dicta Boelcke 第二條的正反面） */
let switchedWithShot = 0
/** 換的當下對舊目標有射擊解、而新目標沒有 */
let switchedShotToNoShot = 0
/** 新目標離軸角的分桶 */
const axisBuckets = [0, 0, 0, 0, 0, 0]

const steps = Math.round(SECONDS / DT)
for (let s = 0; s < steps; s++) {
  stepBattle(b, DT)
  const t = s * DT
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    if (!c.alive) { prev[i] = -2; prevPrev[i] = -2; continue }
    const ai = c.controller
    if (!(ai instanceof AiController)) continue

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
      const oldC = cs[old]!
      if (!oldC.alive) {
        switchesOldDead++
      } else {
        switchesOldAlive++
        if (leader) leaderSwitchesAlive++
        if (tgt === prevPrev[i]) {
          backToPrev++
          if (leader) leaderBackToPrev++
        }

        const fOld = factorsOf(c.aircraft, oldC.aircraft,
          countLocks(b.board, c.team, i, old))
        const realOld = targetScore(c.aircraft, oldC.aircraft,
          countLocks(b.board, c.team, i, old), cfg)
        const rel = Math.abs(fOld.product - realOld) / Math.max(realOld, 1e-12)
        if (rel > selfCheckWorst) selfCheckWorst = rel

        const newC = cs[tgt]!
        const fNew = factorsOf(c.aircraft, newC.aircraft,
          countLocks(b.board, c.team, i, tgt))

        ratios.geometry.push(fNew.geometry / Math.max(fOld.geometry, 1e-12))
        ratios.range.push(fNew.range / Math.max(fOld.range, 1e-12))
        ratios.crowd.push(fNew.crowd / Math.max(fOld.crowd, 1e-12))
        ratios.turn.push(fNew.turn / Math.max(fOld.turn, 1e-12))
        offAxisOld.push(fOld.offAxis)
        offAxisNew.push(fNew.offAxis)
        rangeOld.push(fOld.rangeM)
        rangeNew.push(fNew.rangeM)
        if (fNew.offAxis > fOld.offAxis) worseAxis++
        if (fNew.offAxis > 90) newRear++
        axisBuckets[Math.min(5, Math.floor(fNew.offAxis / 30))]!++

        const shotOld = threatFactor(c.aircraft, oldC.aircraft)
        const shotNew = threatFactor(c.aircraft, newC.aircraft)
        if (shotOld > 0) {
          switchedWithShot++
          if (shotNew <= 0) switchedShotToNoShot++
        }
      }
    }

    if (tgt >= 0) holdStart[i] = t
    prevPrev[i] = old
    prev[i] = tgt
  }
}

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`
const f2 = (x: number): string => x.toFixed(2)

console.log('=== 自我檢查 ===')
console.log(`四因子乘積 vs targetScore，最差相對誤差 ${selfCheckWorst.toExponential(2)}`)
if (!(selfCheckWorst < 1e-9)) {
  throw new Error('探針算的公式與 targetScore 對不上 —— 這支量到的不是真正在跑的東西')
}

console.log('\n=== 換目標的組成（20v20、150 s、種子 20260805）===')
console.log(`總換目標          ${switchesAll}`)
console.log(`  舊目標已陣亡    ${switchesOldDead}（${pct(switchesOldDead / switchesAll)}）—— 不是猶豫`)
console.log(`  舊目標還活著    ${switchesOldAlive}（${pct(switchesOldAlive / switchesAll)}）`)
console.log(`    其中 A→B→A    ${backToPrev}（佔活著的 ${pct(backToPrev / Math.max(switchesOldAlive, 1))}）`)
console.log(`長機：活著時換 ${leaderSwitchesAlive}，其中 A→B→A ${leaderBackToPrev}`
  + `（${pct(leaderBackToPrev / Math.max(leaderSwitchesAlive, 1))}）`)

console.log('\n=== 持有時間 ===')
console.log(`全體中位 ${f2(median(holds))} s（minDwell = ${cfg.minDwell}）`)
console.log(`長機中位 ${f2(median(leaderHolds))} s`)
console.log(`貼在 minDwell 下限（≤ 2.1 s）的比例 ${pct(share(holds, (x) => x <= 2.1))}`)

console.log('\n=== 舊目標還活著的那些換目標：誰把分數推過門檻 ===')
console.log('因子        新÷舊中位   >1.5 倍的比例')
for (const k of ['geometry', 'range', 'crowd', 'turn'] as const) {
  const xs = ratios[k]
  console.log(`${k.padEnd(10)}  ${f2(median(xs)).padStart(9)}   ${pct(share(xs, (x) => x > 1.5)).padStart(8)}`)
}

console.log('\n=== 離軸角（速度向量對視線，度）與距離 ===')
console.log(`舊目標離軸中位 ${f2(median(offAxisOld))}°、新目標 ${f2(median(offAxisNew))}°`)
console.log(`新目標離軸**更差**的比例 ${pct(worseAxis / Math.max(switchesOldAlive, 1))}`)
console.log(`舊目標距離中位 ${median(rangeOld).toFixed(0)} m、新目標 ${median(rangeNew).toFixed(0)} m`)
console.log(`新目標在後半球（> 90°）的比例 ${pct(newRear / Math.max(switchesOldAlive, 1))}`)
console.log('新目標離軸角分布：'
  + axisBuckets.map((n, k) => `${k * 30}-${k * 30 + 30}° ${pct(n / Math.max(switchesOldAlive, 1))}`).join('　'))

console.log('\n=== Dicta Boelcke 第二條「一旦開始攻擊就要打完」的反面 ===')
console.log(`換的當下對舊目標**仍有射擊解** ${switchedWithShot}`
  + `（${pct(switchedWithShot / Math.max(switchesOldAlive, 1))}）`)
console.log(`  其中換去的新目標**沒有**射擊解 ${switchedShotToNoShot}`
  + `（${pct(switchedShotToNoShot / Math.max(switchedWithShot, 1))}）`)
