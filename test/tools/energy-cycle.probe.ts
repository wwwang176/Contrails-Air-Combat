import { createBattle, stepBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_TACTICS, hasSlot, teamIndexOf } from '../../src/ai/tactics'
import type { TacticalPhase } from '../../src/ai/tactics'
import { manoeuvreSpeed } from '../../src/ai/doctrine'
import { G0 } from '../../src/core/math'
import { Idle } from './spawn-snapshot'
import { readyCard } from '../fixtures/mission'

/**
 * 戰術循環跑不跑得完一輪，以及 `buildMax` 該訂多少。
 *
 * ```
 * npx tsx test/tools/energy-cycle.probe.ts
 * ```
 *
 * 【`buildMax` 的回填規則】取「`energyRatio` 從 0 建到 `perchEnter` 需要多久」
 * 的 p90，再加三成餘裕。速率不能直接拿 `psSelf − psTarget` 除 —— 它的單位是
 * m/s（比能量的變化率），而 `energyRatio` 是無因次的：
 *
 * ```
 * d(energyRatio)/dt = (psSelf − psTarget) / (vc² / 2 G0)
 * ```
 *
 * `vc` 是自己在**當下高度**的角落速度，尺標隨高度變，所以逐格算、取分布，
 * 不用一個代表值反推。
 *
 * 【為什麼不能用自己的爬升率反推】把「爬升」與「加速」當成兩份可以相加的
 * 收益，但它們是**同一份比能量**的分配，而且敵人同時也在累積能量。
 */
const DT = 1 / 240
const SECONDS = 300
const SEED = 20260822
const QUOTA = 0.5
const PHASES: TacticalPhase[] = ['off', 'build', 'perch', 'dive', 'zoom', 'cooldown']

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (i - lo)
}

function fmt(xs: number[], digits = 3): string {
  if (xs.length === 0) return 'n=0'
  return `n=${xs.length}  p10 ${quantile(xs, 0.1).toFixed(digits)}`
    + `  中位 ${quantile(xs, 0.5).toFixed(digits)}`
    + `  p90 ${quantile(xs, 0.9).toFixed(digits)}`
}

/** 一架的追蹤狀態 */
interface Track {
  ai: AiController
  prev: TacticalPhase
  /** 這個相位待了多久 */
  dwell: number
  /** 進入 build 時的 energyRatio */
  cycleBase: number
  /** 這一輪有沒有形成過射擊窗 */
  cycleShot: boolean
  /** 走到過 perch 沒有（一圈的判準） */
  reachedPerch: boolean
  reachedDive: boolean
  reachedZoom: boolean
}

/** 一張卡量完之後要彙總的東西 */
interface Result {
  fullCycles: number
  cyclesWithShot: number
  buildRate: number[]
  buildSeconds: number[]
  diveByDeadline: number
  diveByPassing: number
}

function main(cardId: string): Result {
  const card = readyCard(cardId)
  const cfg = missionConfigFrom(card)
  const b = createBattle(new Idle(), cfg, SEED)

  const tracks: Track[] = []
  for (const c of b.world.combatants) {
    if (!(c.controller instanceof AiController)) continue
    c.controller.tacticalConfig = { ...DEFAULT_TACTICS, quota: QUOTA }
    tracks.push({
      ai: c.controller, prev: 'off', dwell: 0,
      cycleBase: 0, cycleShot: false,
      reachedPerch: false, reachedDive: false, reachedZoom: false,
    })
  }

  const occupancy = new Map<TacticalPhase, number>(PHASES.map((p) => [p, 0]))
  let samples = 0
  /**
   * `off` 的四道閘各擋掉多少取樣。**按 stepTactics 的判定順序歸因**，
   * 一筆只算一次 —— 同時被三道擋住時歸給最前面那一道。
   */
  const offCause = new Map<string, number>([
    ['沒名額', 0], ['transit', 0], ['有命令', 0], ['沒目標', 0], ['太近', 0], ['其他', 0],
  ])
  /** 每個相位待了多久（結束時記一筆） */
  const dwells = new Map<TacticalPhase, number[]>(PHASES.map((p) => [p, []]))
  /** 一輪的 energyRatio 淨變化 */
  const cycleGain: number[] = []
  /** 完成的整圈數 */
  let fullCycles = 0
  let cyclesWithShot = 0
  /** build 相位裡逐格量到的 d(energyRatio)/dt */
  const buildRate: number[] = []
  /** 建到 perchEnter 需要多久，s */
  const buildSeconds: number[] = []
  let diveByDeadline = 0
  let diveByPassing = 0

  const steps = Math.round(SECONDS / DT)
  for (let k = 0; k < steps; k++) {
    stepBattle(b, DT)
    // 【每 0.1 s 取樣一次】與決策節拍同頻
    if (k % 24 !== 0) continue
    for (const t of tracks) {
      const ph = t.ai.tactics.phase
      occupancy.set(ph, occupancy.get(ph)! + 1)
      samples++
      if (ph === 'off') {
        const board = t.ai.board
        const slot = board !== null
          && hasSlot(teamIndexOf(board, t.ai.selfIndex), QUOTA)
        const key = !slot ? '沒名額'
          : t.ai.transit ? 'transit'
            : t.ai.order !== null ? '有命令'
              : t.ai.targetIndex < 0 ? '沒目標'
                : t.ai.sit.range < DEFAULT_TACTICS.enterRange ? '太近' : '其他'
        offCause.set(key, offCause.get(key)! + 1)
      }
      if (t.ai.shotInstant > 0) t.cycleShot = true

      if (ph === 'build') {
        const self = b.world.combatants[t.ai.selfIndex]
        if (self) {
          const vc = manoeuvreSpeed(self.aircraft.spec, self.aircraft.state.position.y)
          const scale = (vc * vc) / (2 * G0)
          buildRate.push((t.ai.sit.psSelf - t.ai.sit.psTarget) / scale)
        }
      }

      if (ph === t.prev) { t.dwell += 0.1; continue }

      // ── 換相位 ────────────────────────────────────────
      dwells.get(t.prev)!.push(t.dwell)
      if (t.prev === 'build' && ph === 'perch') buildSeconds.push(t.dwell)
      // 【dive 被什麼結束的】期限（diveMax）還是通過判定（passing）。
      // 兩者的差別是「有沒有真的貼上去再穿出來」
      if (t.prev === 'dive') {
        if (t.dwell >= DEFAULT_TACTICS.diveMax - 0.15) diveByDeadline++
        else diveByPassing++
      }
      t.dwell = 0

      if (ph === 'build') {
        // 上一輪結算
        if (t.reachedPerch && t.reachedDive && t.reachedZoom) {
          fullCycles++
          if (t.cycleShot) cyclesWithShot++
          cycleGain.push(t.ai.sit.energyRatio - t.cycleBase)
        }
        t.cycleBase = t.ai.sit.energyRatio
        t.cycleShot = false
        t.reachedPerch = false
        t.reachedDive = false
        t.reachedZoom = false
      }
      if (ph === 'perch') t.reachedPerch = true
      if (ph === 'dive') t.reachedDive = true
      if (ph === 'zoom') t.reachedZoom = true
      t.prev = ph
    }
  }

  console.log(`── ${card.id}（${card.title}），${SECONDS} s，`
    + `quota = ${QUOTA}，${tracks.length} 架 AI`)
  console.log('  相位佔時  ' + PHASES.map((ph) => `${ph} `
    + `${(100 * occupancy.get(ph)! / samples).toFixed(1)}%`).join('  '))
  console.log('  off 成因  ' + [...offCause]
    .map(([k, v]) => `${k} ${(100 * v / samples).toFixed(1)}%`).join('  '))
  for (const ph of ['build', 'perch', 'dive', 'zoom'] as const) {
    console.log(`  ${ph.padEnd(6)}停留秒數 ${fmt(dwells.get(ph)!, 1)}`)
  }
  console.log(`  完整循環 ${fullCycles} 次，其中形成過射擊窗 ${cyclesWithShot} 次`)
  console.log(`  dive 結束於：期限 ${diveByDeadline} 次、通過判定 ${diveByPassing} 次`)
  console.log(`  每輪 energyRatio 淨變化  ${fmt(cycleGain)}`)
  console.log('')

  return { fullCycles, cyclesWithShot, buildRate, buildSeconds, diveByDeadline, diveByPassing }
}

const CARDS: [string, 'allies' | 'axis'][] = [
  ['japan-m1', 'allies'],
  ['germany-m1', 'allies'],
  ['allies-m1', 'allies'],
  ['germany-m1', 'axis'],
  ['allies-m1', 'axis'],
]

const all: Result = {
  fullCycles: 0, cyclesWithShot: 0, buildRate: [], buildSeconds: [],
  diveByDeadline: 0, diveByPassing: 0,
}
for (const [id] of CARDS) {
  const r = main(id)
  all.fullCycles += r.fullCycles
  all.cyclesWithShot += r.cyclesWithShot
  all.buildRate.push(...r.buildRate)
  all.buildSeconds.push(...r.buildSeconds)
  all.diveByDeadline += r.diveByDeadline
  all.diveByPassing += r.diveByPassing
}

console.log('══ 五張卡彙總 ══')
console.log(`完整循環 ${all.fullCycles} 次，其中形成過射擊窗 ${all.cyclesWithShot} 次`)
console.log(`dive 結束於：期限 ${all.diveByDeadline} 次、通過判定 ${all.diveByPassing} 次`)
console.log(`build 的 d(energyRatio)/dt，1/s   ${fmt(all.buildRate, 4)}`)
console.log(`build → perch 實際花的秒數        ${fmt(all.buildSeconds, 1)}`)
console.log('')
const p10 = quantile(all.buildRate, 0.1)
if (p10 > 0) {
  console.log(`buildMax = perchEnter / p10 × 1.3 = `
    + `${(DEFAULT_TACTICS.perchEnter / p10 * 1.3).toFixed(1)} s`)
} else {
  console.log(`p10 的建能速率是 ${p10.toFixed(4)} —— 一成的時間裡能量在倒退，`)
  console.log('那個除法沒有定義。改用直接量到的 build → perch 秒數：')
  console.log(`  buildMax = p90 × 1.3 = `
    + `${(quantile(all.buildSeconds, 0.9) * 1.3).toFixed(1)} s`)
}
