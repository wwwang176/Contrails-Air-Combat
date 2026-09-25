/**
 * 指揮層三種命令各發出幾張，以及兩個觸發計時器走到哪裡。不是測試（`.probe.ts`）。
 *
 * 跑法：`npx vite-node test/tools/command-trigger.probe.ts`
 *
 * 【要回答什麼】指揮層的量測值（命令張數、到達、集火、撤退）一起歸零時，
 * 例如改了「分攤折扣不數同小隊」這類目標分配的規則之後，通常代表**命令
 * 根本沒發出來**，而不是效果變小。
 *
 * `stepCommand` 的撤退令要先過兩道計時器（`command.ts`）：
 *
 *   - `spent`：分隊裡第 `spentRank` 低的那一架能量見底連續多久
 *   - `idle`：分隊裡**沒有任何一架**握著射擊解連續多久，要 ≥ `idleSeconds`
 *
 * 咬得住目標的直接後果就是 `idle` 一直被歸零。這支把它量出來。
 */
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { DEFAULT_COMMAND } from '../../src/ai/command'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

/** 玩家座位放一個什麼都不做的假駕駛：平飛，不參戰 */
class Idle implements Controller {
  private readonly aim = new Vector3(0, 0, -1)
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim)
    out.throttle = 0.7
    out.firing = false
  }
}

const DT = 1 / 240
const SECONDS = 300
const SEED = 20260805

function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

interface Out {
  issued: Record<string, number>
  /** 每 60 步取樣一次的 idle 值（兩隊全部分隊） */
  idleSamples: number[]
  /** 取樣時 idle 已經 ≥ idleSeconds 的比例 —— 撤退令的必要條件 */
  idleQualified: number
  spentSamples: number[]
}

function run(flightAware: boolean): Out {
  const b = createBattle(new Idle(), DEFAULT_BATTLE, SEED)
  if (!flightAware) {
    const off = new Int32Array(b.world.combatants.length).fill(-1)
    ;(b.board as { flightOf: Int32Array }).flightOf = off
  }

  const issued: Record<string, number> = { rally: 0, flank: 0, focus: 0 }
  const idleSamples: number[] = []
  const spentSamples: number[] = []
  let idleQualified = 0
  let idleTotal = 0

  const states = [b.blueCommand, b.redCommand]
  const prevKind: (string | null)[][] = states.map((s) => s.orders.map(() => null))

  const steps = Math.round(SECONDS / DT)
  for (let i = 0; i < steps; i++) {
    stepBattle(b, DT)
    for (let t = 0; t < states.length; t++) {
      const s = states[t]!
      for (let f = 0; f < s.orders.length; f++) {
        const o = s.orders[f] ?? null
        const kind = o === null ? null : o.kind
        // 【只數「由無到有」與「換了種類」】命令會持續好幾秒，逐步數等於數秒數
        if (kind !== null && kind !== prevKind[t]![f]) issued[kind] = (issued[kind] ?? 0) + 1
        prevKind[t]![f] = kind
      }
      if (i % 60 !== 0) continue
      for (let f = 0; f < s.idle.length; f++) {
        // 玩家那一隊被 skipFlight 清成 0，混進來會稀釋分布 —— 但兩組同樣
        // 稀釋，對照仍然成立，而且排除它需要 `src/battle` 的內部知識
        idleSamples.push(s.idle[f]!)
        spentSamples.push(s.spent[f]!)
        idleTotal++
        if (s.idle[f]! >= DEFAULT_COMMAND.idleSeconds) idleQualified++
      }
    }
  }

  return {
    issued,
    idleSamples,
    spentSamples,
    idleQualified: idleTotal > 0 ? idleQualified / idleTotal : 0,
  }
}

const off = run(false)
const on = run(true)

console.log(`=== 指揮層的觸發（20v20、${SECONDS} s、種子 ${SEED}）===`)
console.log(`idleSeconds = ${DEFAULT_COMMAND.idleSeconds} s、spentRatio = ${DEFAULT_COMMAND.spentRatio}`)
console.log('\n【發出的命令張數】')
console.log('設定                rally（撤退）   flank（側翼）   focus（集火）')
for (const [name, r] of [['每一架都數（舊）', off], ['不數同小隊（新）', on]] as const) {
  console.log(`${name}  ${String(r.issued.rally).padStart(11)}  ${String(r.issued.flank).padStart(13)}`
    + `  ${String(r.issued.focus).padStart(13)}`)
}

console.log('\n【撤退令的必要條件：分隊連續多久沒有任何人握著射擊解】')
console.log('設定                idle 中位   idle 最大   已達 idleSeconds 的取樣比例')
for (const [name, r] of [['每一架都數（舊）', off], ['不數同小隊（新）', on]] as const) {
  console.log(`${name}  ${median(r.idleSamples).toFixed(2).padStart(9)} s`
    + `  ${Math.max(...r.idleSamples).toFixed(1).padStart(9)} s`
    + `  ${(100 * r.idleQualified).toFixed(1).padStart(20)}%`)
}

console.log('\n【另一道閘：能量見底計時】')
console.log('設定                spent 中位   spent 最大')
for (const [name, r] of [['每一架都數（舊）', off], ['不數同小隊（新）', on]] as const) {
  console.log(`${name}  ${median(r.spentSamples).toFixed(2).padStart(10)} s`
    + `  ${Math.max(...r.spentSamples).toFixed(1).padStart(10)} s`)
}
