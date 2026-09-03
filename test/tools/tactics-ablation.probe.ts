import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import type { BattleConfig } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_TACTICS } from '../../src/ai/tactics'
import type { TacticalPhase } from '../../src/ai/tactics'
import { Idle } from './spawn-snapshot'
import { readyCard } from '../fixtures/mission'

/**
 * 戰術層的消融與通用性表。
 *
 * ```
 * npx tsx test/tools/tactics-ablation.probe.ts
 * ```
 *
 * **七張卡 × `quota` 三檔 × 五個種子。** `quota = 0` 的五個種子就是「什麼都
 * 沒改」的分散度 —— 判準「任何一格的退步不得超過雜訊」需要先知道雜訊有多大，
 * 而那比任何憑空訂的百分比誠實。
 *
 * 【為什麼「戰鬥機對轟炸機」要單獨列一格】無因次化讓一組參數對所有**機型**
 * 成立，但它保證不了對所有**配對**成立：戰鬥機打轟炸機時速度優勢恆為正、
 * 能量優勢恆為正，整個循環的觸發條件都在飽和端（spec §3.1）。
 */
const DT = 1 / 240
const SECONDS = 150
const SEEDS = [20260805, 20260812, 20260819, 20260826, 20260902]
const QUOTAS = [0, 0.5, 1]
const PHASES: TacticalPhase[] = ['off', 'build', 'perch', 'dive', 'zoom', 'cooldown']

const CARDS: [string, () => BattleConfig][] = [
  ['遭遇戰', () => DEFAULT_BATTLE],
  ['日 M1 臺灣沖', () => card('japan-m1')],
  ['德 M1 攔截', () => card('germany-m1')],
  ['德 M4 防線', () => card('germany-m4')],
  ['盟 M1 護送', () => card('allies-m1')],
  ['日 M3 護航', () => card('japan-m3')],
]

function card(id: string): BattleConfig {
  return missionConfigFrom(readyCard(id))
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) / 2
  return s.length % 2 ? s[i]! : (s[i - 0.5]! + s[i + 0.5]!) / 2
}

/** 一次跑產出的量。全部是**戰鬥機**的量，除了另外標明的那一格 */
interface Metrics {
  engage: number
  extend: number
  /** 比能量差的中位，m */
  energy: number
  /** 與當前目標的距離中位，m */
  range: number
  /** 有射擊解的取樣比例 */
  shot: number
  phase: Map<TacticalPhase, number>
  /** 目標是轟炸機時的交戰佔時與射擊解比例 */
  vsBomberEngage: number
  vsBomberShot: number
}

/**
 * 把每一架的初速擾動 ±0.5%，擾動量由 `(seed, index)` 決定。
 *
 * 【為什麼需要它】`createBattle` 的 `seed` **只餵飛行員名字**，出生幾何、
 * 速度、決策相位全都與它無關 —— 五個種子跑出來的數字因此逐位元相同，雜訊帶
 * 是 0.000，而「退步不得超過雜訊」就變成一個永遠成立不了的判準。
 *
 * 【為什麼擾動初速而不是位置】初速是連續量、對雙方對稱、而且不改變任何一張
 * 卡的幾何前提（誰在哪一邊、距離多遠）。位置一動就等於換了一張卡。
 *
 * 【為什麼不用 `Math.random`】專案禁止它。這裡用的是 `(seed, index)` 的整數
 * 雜湊，同樣一組輸入永遠給同樣一組擾動。
 */
function jitter(b: ReturnType<typeof createBattle>, seed: number): void {
  for (const c of b.world.combatants) {
    let h = (seed ^ (c.index * 0x9e3779b1)) >>> 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
    const eps = ((h >>> 8) / 0xffffff - 0.5) * 0.01
    c.aircraft.state.velocity.multiplyScalar(1 + eps)
  }
}

function run(cfg: BattleConfig, seed: number, quota: number): Metrics {
  const b = createBattle(new Idle(), cfg, seed)
  jitter(b, seed)
  for (const c of b.world.combatants) {
    if (c.controller instanceof AiController) {
      c.controller.tacticalConfig = { ...DEFAULT_TACTICS, quota }
    }
  }

  let samples = 0
  let engage = 0
  let extend = 0
  let shot = 0
  const energies: number[] = []
  const ranges: number[] = []
  const phase = new Map<TacticalPhase, number>(PHASES.map((p) => [p, 0]))
  let vsBomber = 0
  let vsBomberEngage = 0
  let vsBomberShot = 0

  const steps = Math.round(SECONDS / DT)
  for (let k = 0; k < steps; k++) {
    stepBattle(b, DT)
    // 【每 0.1 s 取樣一次】與決策節拍同頻
    if (k % 24 !== 0) continue
    for (const c of b.world.combatants) {
      const ai = c.controller
      if (!(ai instanceof AiController) || !c.alive) continue
      if (c.aircraft.spec.role !== 'fighter') continue
      samples++
      if (ai.intent === 'engage') engage++
      if (ai.intent === 'extend') extend++
      if (ai.shotInstant > 0) shot++
      phase.set(ai.tactics.phase, phase.get(ai.tactics.phase)! + 1)
      const t = ai.target
      if (t === null) continue
      energies.push(ai.sit.energyAdvantage)
      ranges.push(ai.sit.range)
      if (t.spec.role !== 'fighter') {
        vsBomber++
        if (ai.intent === 'engage') vsBomberEngage++
        if (ai.shotInstant > 0) vsBomberShot++
      }
    }
  }

  const n = samples > 0 ? samples : 1
  const m = vsBomber > 0 ? vsBomber : 1
  const occ = new Map<TacticalPhase, number>(
    PHASES.map((p) => [p, phase.get(p)! / n]),
  )
  return {
    engage: engage / n,
    extend: extend / n,
    energy: median(energies),
    range: median(ranges),
    shot: shot / n,
    phase: occ,
    vsBomberEngage: vsBomber > 0 ? vsBomberEngage / m : NaN,
    vsBomberShot: vsBomber > 0 ? vsBomberShot / m : NaN,
  }
}

function pct(x: number): string {
  return Number.isNaN(x) ? '   —  ' : `${(100 * x).toFixed(1)}%`.padStart(6)
}
function met(x: number): string {
  return Number.isNaN(x) ? '    —' : x.toFixed(0).padStart(5)
}

for (const [name, make] of CARDS) {
  const cfg = make()
  console.log(`══ ${name} ══`)
  console.log('  quota   engage  extend  射擊解   比能量差  距離   '
    + '對轟engage 對轟射擊解')
  /** quota = 0 的五個種子，用來當雜訊帶 */
  const noise = new Map<string, number[]>()
  for (const quota of QUOTAS) {
    const runs = SEEDS.map((s) => run(cfg, s, quota))
    const pick = (f: (r: Metrics) => number): number[] => runs.map(f)
    const cells: [string, number[]][] = [
      ['engage', pick((r) => r.engage)],
      ['extend', pick((r) => r.extend)],
      ['shot', pick((r) => r.shot)],
      ['energy', pick((r) => r.energy)],
      ['range', pick((r) => r.range)],
      ['vsBomberEngage', pick((r) => r.vsBomberEngage)],
      ['vsBomberShot', pick((r) => r.vsBomberShot)],
    ]
    if (quota === 0) for (const [k, v] of cells) noise.set(k, v)
    const v = new Map(cells.map(([k, xs]) => [k, median(xs)]))
    console.log(`  ${String(quota).padEnd(6)}${pct(v.get('engage')!)}  `
      + `${pct(v.get('extend')!)}  ${pct(v.get('shot')!)}  `
      + `${met(v.get('energy')!)}  ${met(v.get('range')!)}   `
      + `${pct(v.get('vsBomberEngage')!)}     ${pct(v.get('vsBomberShot')!)}`)
    if (quota === QUOTAS[QUOTAS.length - 1]) {
      const band = [...noise].map(([k, xs]) => {
        const lo = Math.min(...xs.filter((x) => !Number.isNaN(x)))
        const hi = Math.max(...xs.filter((x) => !Number.isNaN(x)))
        const d = hi - lo
        return `${k} ${Number.isFinite(d) ? d.toFixed(k === 'energy' || k === 'range'
          ? 0 : 3) : '—'}`
      })
      console.log(`  雜訊帶（quota=0 的五種子全距）  ${band.join('  ')}`)
    }
    const occ = PHASES.map((p) => `${p} `
      + `${(100 * median(runs.map((r) => r.phase.get(p)!))).toFixed(1)}%`)
    console.log(`          相位  ${occ.join('  ')}`)
  }
  console.log('')
}
