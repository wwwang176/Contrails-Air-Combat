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
import { isFlightLeader, flightOfCombatant } from '../../src/battle/flights'
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
  vision: number
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
    geometry, range: rangeD, crowd: crowdD, turn: turnD, vision: visionD,
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
  /** 長機的換目標裡，當下有集火命令的（那時 target 被 focusTarget 覆寫）*/
  leaderFocusDriven: number
  /** 長機「有槍解卻換走」的次數，依機制拆開 */
  leaderShotFocus: number
  leaderShotSelect: number
  /** 長機處於集火命令下的取樣比例 */
  focusShare: number
  /** 長機「有槍解卻換走」那一群的因子分解 */
  shotRatioMedian: Record<string, number>
  shotRatioBig: Record<string, number>
  shotOldRange: number[]
  shotNewRange: number[]
  shotOldAxis: number[]
  shotNewAxis: number[]
  shotOldLocks: number[]
  shotNewLocks: number[]
  /** 舊目標身上的鎖定裡，有幾個是**長機自己那個小隊的僚機** */
  shotOldLocksOwn: number[]
  /** 全場任一時刻的鎖定裡，同小隊佔的比例（每 60 步取樣一次） */
  ownLockShare: number
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
  let leaderFocusDriven = 0
  let leaderShotFocus = 0
  let leaderShotSelect = 0
  let focusSamples = 0
  let leaderSamples = 0
  let fire = 0
  let alive = 0
  let onNose = 0
  let samples = 0
  const axisBuckets = [0, 0, 0, 0, 0, 0]
  const ratios: Record<string, number[]> = { geometry: [], range: [], crowd: [], turn: [], vision: [] }
  const shotRatios: Record<string, number[]> = {
    geometry: [], range: [], crowd: [], turn: [], vision: [],
  }
  const shotOldRange: number[] = []
  const shotNewRange: number[] = []
  const shotOldAxis: number[] = []
  const shotNewAxis: number[] = []
  const shotOldLocks: number[] = []
  const shotNewLocks: number[] = []
  const shotOldLocksOwn: number[] = []
  let lockTotal = 0
  let lockOwn = 0

  /**
   * `countLocks(board, team, self, candidate)` 的同小隊子集。
   *
   * 【為什麼可以在探針裡跨層】`src/ai/` 不准 import `src/battle/`，但探針在
   * `test/tools/`，兩邊都摸得到。這正是要量的東西：分攤折扣目前**看不見
   * 小隊**，所以只能從外面對照。
   */
  const ownFlightLocks = (self: number, candidate: number): number => {
    const flight = flightOfCombatant(b.flights, self)
    if (flight === null) return 0
    let n = 0
    for (let m = 0; m < flight.count; m++) {
      const idx = flight.members[m]!
      if (idx === self) continue
      if (b.board.assignments[idx] === candidate && cs[idx]!.alive) n++
    }
    return n
  }
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
        if (isFlightLeader(b.flights, i)) {
          leaderSamples++
          if (ai.focusTarget !== null) focusSamples++
        }
        if (ai.target && aspectOf(c.aircraft, ai.target) < (15 * Math.PI) / 180) onNose++
        // 【分攤的來源結構】此刻壓在我目標上的隊友，有幾個是我自己的僚機
        // 【為什麼分母要自己加起來】`countLocks` 現在**已經排除同小隊**，
        // 直接拿它當分母會算出 >100% 的比例
        if (ai.target) {
          const ti = indexOf.get(ai.target)!
          const own = ownFlightLocks(i, ti)
          lockOwn += own
          lockTotal += countLocks(b.board, c.team, i, ti) + own
        }
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
          const newLocks = countLocks(b.board, c.team, i, tgt)
          const fNew = factorsOf(c.aircraft, newC.aircraft, newLocks, cfg)

          ratios.geometry!.push(fNew.geometry / Math.max(fOld.geometry, 1e-12))
          ratios.range!.push(fNew.range / Math.max(fOld.range, 1e-12))
          ratios.crowd!.push(fNew.crowd / Math.max(fOld.crowd, 1e-12))
          ratios.turn!.push(fNew.turn / Math.max(fOld.turn, 1e-12))
          ratios.vision!.push(fNew.vision / Math.max(fOld.vision, 1e-12))
          offAxisOld.push(fOld.offAxis)
          offAxisNew.push(fNew.offAxis)
          rangeOld.push(fOld.rangeM)
          rangeNew.push(fNew.rangeM)
          if (fNew.offAxis > fOld.offAxis) worseAxis++
          if (fNew.offAxis > 90) newRear++
          axisBuckets[Math.min(5, Math.floor(fNew.offAxis / 30))]!++

          const hadShot = threatFactor(c.aircraft, oldC.aircraft) > 0
          if (hadShot) {
            withShot++
            if (threatFactor(c.aircraft, newC.aircraft) <= 0) shotToNoShot++
          }
          // 【長機的機制歸類】`AiController:236` 對長機無條件覆寫：
          // focusTarget 非 null 時 target 就是它，繞過 minDwell/switchMargin/shotRelief
          if (leader) {
            const byFocus = ai.focusTarget !== null
            if (byFocus) leaderFocusDriven++
            if (hadShot) {
              if (byFocus) leaderShotFocus++
              else {
                leaderShotSelect++
                shotRatios.geometry!.push(fNew.geometry / Math.max(fOld.geometry, 1e-12))
                shotRatios.range!.push(fNew.range / Math.max(fOld.range, 1e-12))
                shotRatios.crowd!.push(fNew.crowd / Math.max(fOld.crowd, 1e-12))
                shotRatios.turn!.push(fNew.turn / Math.max(fOld.turn, 1e-12))
                shotRatios.vision!.push(fNew.vision / Math.max(fOld.vision, 1e-12))
                shotOldRange.push(fOld.rangeM)
                shotNewRange.push(fNew.rangeM)
                shotOldAxis.push(fOld.offAxis)
                shotNewAxis.push(fNew.offAxis)
                shotOldLocks.push(oldLocks)
                shotNewLocks.push(newLocks)
                shotOldLocksOwn.push(ownFlightLocks(i, old))
              }
            }
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
  const smed: Record<string, number> = {}
  const sbig: Record<string, number> = {}
  for (const k of ['geometry', 'range', 'crowd', 'turn', 'vision']) {
    med[k] = median(ratios[k]!)
    big[k] = share(ratios[k]!, (x) => x > 1.5)
    smed[k] = median(shotRatios[k]!)
    sbig[k] = share(shotRatios[k]!, (x) => x > 1.5)
  }

  return {
    switchesAll, switchesOldAlive, backToPrev, leaderSwitchesAlive, leaderBackToPrev,
    holdMedian: median(holds), leaderHoldMedian: median(leaderHolds),
    atFloor: share(holds, (x) => x <= 2.1),
    worseAxis: worseAxis / Math.max(switchesOldAlive, 1),
    newRear: newRear / Math.max(switchesOldAlive, 1),
    withShot, shotToNoShot,
    leaderFocusDriven, leaderShotFocus, leaderShotSelect,
    focusShare: leaderSamples > 0 ? focusSamples / leaderSamples : 0,
    shotRatioMedian: smed, shotRatioBig: sbig,
    shotOldRange, shotNewRange, shotOldAxis, shotNewAxis, shotOldLocks, shotNewLocks,
    shotOldLocksOwn,
    ownLockShare: lockTotal > 0 ? lockOwn / lockTotal : 0,
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
 * 所以單一場次只有**一個樣本**。換架數是這個專案唯一拿得到獨立實現的辦法。
 * 2026-08-09 的 `engagedMargin` 提案就是這樣被否決的：20v20 看起來 −43%，
 * 12v12 只有 −3%。
 */
const SIZES = [20, 12, 8]
const results = new Map<number, Result>()
for (const n of SIZES) results.set(n, run(n, DEFAULT_TARGET.visionPower))

for (const [n, r] of results) {
  if (!(r.selfCheckWorst < 1e-9)) {
    throw new Error(`${n}v${n}：探針算的公式與 targetScore 對不上`)
  }
}
console.log('自我檢查通過（五因子乘積 vs targetScore，最差相對誤差 '
  + `${Math.max(...[...results.values()].map((r) => r.selfCheckWorst)).toExponential(2)}）`)

console.log('\n=== 換目標的組成（150 s、種子 20260805）===')
console.log('架數    總換  舊的已陣亡  舊的還活著  A→B→A   長機持有中位  貼在下限')
for (const [n, r] of results) {
  console.log(
    `${n}v${n}`.padStart(6)
    + `  ${String(r.switchesAll).padStart(4)}  ${String(r.switchesAll - r.switchesOldAlive).padStart(10)}`
    + `  ${String(r.switchesOldAlive).padStart(10)}`
    + `  ${pct(r.backToPrev / Math.max(r.switchesOldAlive, 1)).padStart(6)}`
    + `  ${f2(r.leaderHoldMedian).padStart(11)} s  ${pct(r.atFloor).padStart(7)}`,
  )
}

console.log('\n=== 【機制歸類】長機的換目標是誰造成的 ===')
console.log('AiController:236 對長機無條件覆寫：focusTarget 非 null 時 target 就是它，')
console.log('繞過 minDwell / switchMargin / shotRelief。')
console.log('架數    長機換目標  集火命令造成  selectTarget 造成  長機在集火令下的時間')
for (const [n, r] of results) {
  const sel = r.leaderSwitchesAlive - r.leaderFocusDriven
  console.log(
    `${n}v${n}`.padStart(6) + `  ${String(r.leaderSwitchesAlive).padStart(10)}`
    + `  ${String(r.leaderFocusDriven).padStart(8)}`
    + `（${pct(r.leaderFocusDriven / Math.max(r.leaderSwitchesAlive, 1))}）`
    + `  ${String(sel).padStart(11)}`
    + `（${pct(sel / Math.max(r.leaderSwitchesAlive, 1))}）`
    + `  ${pct(r.focusShare).padStart(14)}`,
  )
}

console.log('\n=== 【專案負責人看到的那一幕】有射擊解卻換走，依機制拆開 ===')
console.log('架數    全體有槍解卻換走  長機的  其中集火造成  其中 selectTarget 造成')
for (const [n, r] of results) {
  const tot = r.leaderShotFocus + r.leaderShotSelect
  console.log(
    `${n}v${n}`.padStart(6) + `  ${String(r.withShot).padStart(14)}`
    + `  ${String(tot).padStart(6)}`
    + `  ${String(r.leaderShotFocus).padStart(11)}`
    + `（${pct(r.leaderShotFocus / Math.max(tot, 1))}）`
    + `  ${String(r.leaderShotSelect).padStart(16)}`
    + `（${pct(r.leaderShotSelect / Math.max(tot, 1))}）`,
  )
}

console.log('\n=== 【核心問題】長機「有槍解卻換走」那一群，是誰把分數推過門檻 ===')
console.log('（門檻 ' + `${(1 + DEFAULT_TARGET.switchMargin).toFixed(2)}` + ' 倍。>1.5 倍那一欄越高，代表這一項越常是主因）')
for (const [n, r] of results) {
  const k = r.leaderShotSelect
  console.log(`
${n}v${n}　樣本 ${k} 次`)
  if (k === 0) continue
  console.log('  因子        新÷舊中位   >1.5 倍的比例')
  for (const key of ['geometry', 'range', 'crowd', 'turn', 'vision']) {
    console.log(`  ${key.padEnd(10)}  ${f2(r.shotRatioMedian[key]!).padStart(9)}   `
      + `${pct(r.shotRatioBig[key]!).padStart(8)}`)
  }
  console.log(`  距離中位 ${median(r.shotOldRange).toFixed(0)} → ${median(r.shotNewRange).toFixed(0)} m`
    + `　離軸中位 ${f2(median(r.shotOldAxis))}° → ${f2(median(r.shotNewAxis))}°`
    + `　鎖定數中位 ${median(r.shotOldLocks)} → ${median(r.shotNewLocks)}`)
}

/**
 * 【分攤的計數單位】`countLocks` 數的是**每一架**同隊存活飛機，完全看不見
 * 小隊。而 `wingman.ts` 的 LEVEL_FOCUS 讓僚機去打「長機正在打的那一架」，
 * 並寫進同一份 `assignments` —— 所以長機的僚機跟過來，會回頭變成壓在長機
 * 自己目標上的分攤折扣。這一段量的就是那個回授迴路有多大。
 */
console.log('\n=== 【分攤的計數單位】壓在我目標上的隊友，有幾個是我自己的僚機 ===')
console.log('（`countLocks` 只數別的小隊，所以「同小隊」那一欄是它看不見、也不再處罰的那一群）')
console.log('架數    全場鎖定裡同小隊佔比   長機「有槍解卻換走」時的舊目標：別隊鎖定中位  同小隊中位')
for (const [n, r] of results) {
  console.log(
    `${n}v${n}`.padStart(6) + `  ${pct(r.ownLockShare).padStart(18)}`
    + `  ${String(median(r.shotOldLocks)).padStart(42)}`
    + `  ${String(median(r.shotOldLocksOwn)).padStart(11)}`,
  )
}
