/**
 * 全機隊的砲塔點放到底有多同步？
 *
 *   npx tsx test/tools/turret-burst.probe.ts
 *
 * 【人工回報】「轟炸機上的機槍，開火時間、冷卻時間都一樣，
 * 是不是可以有點錯開的落差？」
 *
 * ── 程式碼上的縫在哪 ──────────────────────────────────────
 *
 * `resetTurretStates` 對**每一座**都寫死同一組初值：
 *
 * ```
 *   s.burstFiring = true
 *   s.burstTimer  = BURST_ON
 * ```
 *
 * 而 `stepBurst` 只吃 `dt`，沒有任何一項與砲塔或載機有關 —— 所以一旦同步
 * 就**永遠同步**。相位（`wobblePhase`）與搜尋時刻（黃金比）都刻意錯開過，
 * 只有點放漏掉。
 *
 * 【判準】兩個獨立的量，兩個都要看：
 *
 * 1. **同時開火的座數**。20 架 B-17G = 160 座，完全同步時每一步不是 160
 *    就是 0；理想的錯開會讓它貼著期望值 160 × 0.6 = 96 上下小幅擺動。
 * 2. **一座砲塔自己的節奏**。就算初值錯開了，週期若還是每座都恰好 2.0 秒，
 *    整個機隊就是一組**頻率相同、只差相位**的方波 —— 相對關係凍結，聽起來
 *    仍然很機械。這裡量的是「機隊裡出現幾種不同的週期」。
 */
import {
  createTurretStates, stepBurst, BURST_ON, BURST_OFF,
} from '../../src/world/turrets'
import type { TurretState } from '../../src/world/turrets'
import { B17G } from '../../src/specs/b17g'
import { HE111 } from '../../src/specs/he111'

const DT = 1 / 240
const SECONDS = 60
const BOMBERS = 20

/** 一個混編機隊：20 架 B-17G（8 座）+ 20 架 He 111（5 座）。 */
function fleet(): { states: TurretState[]; label: string }[] {
  const out: { states: TurretState[]; label: string }[] = []
  let index = 0
  for (let k = 0; k < BOMBERS; k++) {
    out.push({ states: createTurretStates(B17G, index), label: `B17G#${k}` })
    index++
  }
  for (let k = 0; k < BOMBERS; k++) {
    out.push({ states: createTurretStates(HE111, index), label: `He111#${k}` })
    index++
  }
  return out
}

const f = fleet()
const all: TurretState[] = f.flatMap((a) => a.states)
const N = all.length

// ── 一、同時開火的座數 ────────────────────────────────────
const steps = Math.round(SECONDS / DT)
let sum = 0
let sumSq = 0
let min = Infinity
let max = -Infinity
let allOn = 0
let allOff = 0
/** 每一座各自的切換次數 —— 拿來反推週期。 */
const flips = new Array<number>(N).fill(0)
const wasFiring = all.map((s) => s.burstFiring)

for (let k = 0; k < steps; k++) {
  let on = 0
  for (let i = 0; i < N; i++) {
    const s = all[i]!
    if (stepBurst(s, DT)) on++
    if (s.burstFiring !== wasFiring[i]) { flips[i]!++; wasFiring[i] = s.burstFiring }
  }
  sum += on
  sumSq += on * on
  if (on < min) min = on
  if (on > max) max = on
  if (on === N) allOn++
  if (on === 0) allOff++
}

const mean = sum / steps
const sd = Math.sqrt(Math.max(0, sumSq / steps - mean * mean))
const expected = N * (BURST_ON / (BURST_ON + BURST_OFF))

console.log(`  混編機隊：${BOMBERS} 架 B-17G + ${BOMBERS} 架 He 111`
  + ` = ${N} 座砲塔，跑 ${SECONDS} 秒`)
console.log('')
console.log('  ── 一、同時處在開火段的座數 ──')
console.log(`  期望值（工作週期 ${(BURST_ON / (BURST_ON + BURST_OFF) * 100).toFixed(0)}%）`
  + `：${expected.toFixed(1)} 座`)
console.log(`  實測平均 ${mean.toFixed(1)}   標準差 ${sd.toFixed(1)}`
  + `   範圍 ${min} … ${max}`)
console.log(`  全部一起開火的步數：${allOn} / ${steps}`
  + `（${(allOn / steps * 100).toFixed(1)}%）`)
console.log(`  全部一起停火的步數：${allOff} / ${steps}`
  + `（${(allOff / steps * 100).toFixed(1)}%）`)

// ── 二、機隊裡有幾種不同的週期 ────────────────────────────
console.log('')
console.log('  ── 二、每一座自己的節奏 ──')
const periods = new Map<string, number>()
for (let i = 0; i < N; i++) {
  // 切換次數 ÷ 2 = 完整週期數
  const p = SECONDS / (flips[i]! / 2)
  const key = p.toFixed(3)
  periods.set(key, (periods.get(key) ?? 0) + 1)
}
const sorted = [...periods.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))
console.log(`  出現過的週期共 ${sorted.length} 種`
  + `（完全同步時是 1 種，全部 ${(BURST_ON + BURST_OFF).toFixed(1)} 秒）`)
for (const [p, n] of sorted.slice(0, 12)) {
  console.log(`    ${p} 秒 × ${n} 座`)
}
if (sorted.length > 12) console.log(`    …（另外 ${sorted.length - 12} 種）`)

// ── 三、一架 B-17G 的八座之間差多少 ──────────────────────
console.log('')
console.log('  ── 三、單機 B-17G#0 的八座，開火段起點錯開多少 ──')
const one = createTurretStates(B17G, 0)
const firstOn: number[] = one.map(() => -1)
const st = one.map((s) => s.burstFiring)
for (let k = 0; k < Math.round(4 / DT); k++) {
  for (let i = 0; i < one.length; i++) {
    const s = one[i]!
    stepBurst(s, DT)
    if (s.burstFiring && !st[i] && firstOn[i]! < 0) firstOn[i] = k * DT
    st[i] = s.burstFiring
  }
}
for (let i = 0; i < one.length; i++) {
  const t = firstOn[i]!
  console.log(`    ${B17G.turrets[i]!.id.padEnd(8)} 第一次進入開火段：`
    + (t < 0 ? '（四秒內沒有切換）' : `${t.toFixed(3)} 秒`))
}
