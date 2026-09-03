/**
 * **`alarm` 在實戰中長什麼樣子？** 不是測試（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/alarm-dist.probe.ts
 *
 * 【為什麼要這一支】`extend` 的回場偏置要乘一個威脅抑制係數
 * （`2026-08-22-extend-recovery-design.md` §6）：
 *
 * ```
 *   homeAuthority = 1 − min(1, alarm / extendAlarmFull)
 * ```
 *
 * `extendAlarmFull` 是「威脅到這個程度就完全不轉回去」的飽和點，而它**沒有
 * 任何可引用的量級** —— 訂一個沒量過的數字正是這一輪已經犯過兩次的錯
 * （`etaMax` 反推、`extendBankMax` 15°）。
 *
 * 【量什麼】`alarm = alarmFactor(攻擊者, 我) × alarmRamp(持續秒數)`，就是
 * `defendLatch` 吃的那個量。對每一架己方戰鬥機、每個決策節拍，掃全場敵機
 * 取最大的 `alarmFactor`（與 `AiController.scanThreat` 同一個定義），自己
 * 累計持續秒數再乘 ramp。
 *
 * 【為什麼不直接讀 AiController】那個值是 `update` 裡的區域變數，沒有欄位。
 * 為了量測在熱路徑上加一個欄位不划算；這裡重算，定義逐行對齊。
 *
 * 【分位數要怎麼讀】`extendAlarmFull` 該落在「真的有人在瞄我」那一段的
 * 下緣：訂太高等於抑制永遠不飽和（偏置在被咬時仍然開著），訂太低等於
 * 一有風吹草動就完全不回場。所以下面同時印**全體**分布與**非零**分布 ——
 * 全體的中位數通常是 0（大多數時候沒有人瞄我），那個數字不能拿來訂值。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { alarmFactor, alarmRamp } from '../../src/ai/assess'
import { Idle } from './spawn-snapshot'
import type { Combatant } from '../../src/world/World'
import { readyCard } from '../fixtures/mission'

const DT = 1 / 240
const SECONDS = 300
const SEED = 20260805
/** 10 Hz —— 與 AI_DECISION_HZ 一致 */
const STRIDE = 24

const CARDS: [string][] = [
  ['allies-m1'],
  ['germany-m1'],
]

const n = (v: number, w: number, d = 3): string =>
  (Number.isFinite(v) ? v.toFixed(d) : '—').padStart(w)

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))
  return sorted[i]!
}

for (const [id] of CARDS) {
  const card = readyCard(id)
  const b = createBattle(new Idle(), missionConfigFrom(card), SEED)
  const cs: Combatant[] = b.world.combatants

  // 只看戰鬥機 —— 轟炸機不走 extend
  const watched = cs.filter((c) => c.controller instanceof AiController
    && c.aircraft.spec.role === 'fighter')
  const seconds = new Float64Array(cs.length)
  const all: number[] = []
  const nonZero: number[] = []
  // 「被咬」的定義：alarm 連續 > 0 至少一拍。統計它佔多少取樣
  let hot = 0

  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    if (k % STRIDE !== 0) continue
    const step = DT * STRIDE
    for (const c of watched) {
      if (!c.alive) { seconds[c.index] = 0; continue }
      let best = 0
      for (const o of cs) {
        if (!o.alive || o.team === c.team) continue
        const a = alarmFactor(o.aircraft, c.aircraft)
        if (a > best) best = a
      }
      seconds[c.index] = best > 0 ? seconds[c.index]! + step : 0
      const alarm = best * alarmRamp(seconds[c.index]!)
      all.push(alarm)
      if (alarm > 0) { nonZero.push(alarm); hot++ }
    }
  }

  all.sort((x, y) => x - y)
  nonZero.sort((x, y) => x - y)

  console.log(`\n══ ${id}（${card.title}）—— ${watched.length} 架戰鬥機，`
    + `${SECONDS} s，10 Hz 取樣 ══`)
  console.log(`  取樣 ${all.length}，其中 alarm > 0 的佔 `
    + `${(100 * hot / Math.max(1, all.length)).toFixed(1)}%`)
  console.log('               p50     p75     p90     p95     p99     max')
  console.log(`  全體    ${n(pct(all, 0.5), 8)}${n(pct(all, 0.75), 8)}`
    + `${n(pct(all, 0.9), 8)}${n(pct(all, 0.95), 8)}`
    + `${n(pct(all, 0.99), 8)}${n(all[all.length - 1] ?? NaN, 8)}`)
  console.log(`  非零    ${n(pct(nonZero, 0.5), 8)}${n(pct(nonZero, 0.75), 8)}`
    + `${n(pct(nonZero, 0.9), 8)}${n(pct(nonZero, 0.95), 8)}`
    + `${n(pct(nonZero, 0.99), 8)}`
    + `${n(nonZero[nonZero.length - 1] ?? NaN, 8)}`)
}

console.log('\n【怎麼訂 extendAlarmFull】它是抑制的飽和點：alarm 到這個值時'
  + '回場偏置完全關掉。')
console.log('全體的 p50 通常是 0（大多數時候沒人瞄我），不能拿來訂值；'
  + '要看「非零」那一列。')
