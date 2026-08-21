/**
 * 量砲塔的每步成本 —— **門檻要先量再訂**。
 *
 *   npx tsx test/tools/turret-perf.probe.ts
 *
 * 三份負載的架數、彈丸池、控制器完全相同，唯一的差別是紅隊的機種與擺位，
 * 所以三個數字直接可減：
 *
 *   20v20（P-51D vs Bf 109）  既有門檻量的那一份，**砲塔數 0**
 *   搜尋（P-51D vs B-17G）    160 座砲塔，全部搜不到目標
 *   追瞄（P-51D vs B-17G）    160 座砲塔，**全部**有目標
 *
 * 【它同時報「有幾座真的在追瞄」】Codex 2026-08-21 抓到第一版的追瞄負載
 * 只有 114/160 座取得目標（`top` 與 `tail` 是 0 座），門檻因此沒有涵蓋它
 * 宣稱的最壞情形。這一欄就是為了讓那件事**下次不必靠人去發現**。
 *
 * 量法照 `perf-gate.test.ts`：取多批的最小值，批次多而短 —— 最小值取的是
 * 干擾最少的那一批，才是「這段程式要花多久」的估計。
 */
import { createMultiLoad, resetMultiLoad, stepMultiLoad } from '../../bench/multi-load'
import {
  createTurretSearchLoad, createTurretTrackLoad, resetTurretLoad, stepTurretLoad,
  type TurretLoadState,
} from '../../bench/turret-load'

const BATCHES = 40
const N = 25

function measure(step: () => void): number {
  let best = Infinity
  for (let b = 0; b < BATCHES; b++) {
    const t0 = performance.now()
    for (let i = 0; i < N; i++) step()
    best = Math.min(best, ((performance.now() - t0) * 1000) / N)
  }
  return best
}

/** 有幾座砲塔取得了目標 / 全部幾座。 */
function targeted(s: TurretLoadState): string {
  let hit = 0
  let total = 0
  const byId = new Map<string, number>()
  for (const c of s.battle.world.combatants) {
    const ts = c.aircraft.spec.turrets
    for (let i = 0; i < ts.length; i++) {
      total++
      if (c.turretStates[i]!.targetIndex >= 0) {
        hit++
        byId.set(ts[i]!.id, (byId.get(ts[i]!.id) ?? 0) + 1)
      }
    }
  }
  const detail = [...byId.entries()].map(([k, v]) => `${k}:${v}`).join(' ')
  return `${hit}/${total}  ${detail}`
}

function turret(make: () => TurretLoadState): [number, string] {
  const s = make()
  for (let i = 0; i < 300; i++) stepTurretLoad(s)
  resetTurretLoad(s)
  for (let i = 0; i < 300; i++) stepTurretLoad(s)
  const t = targeted(s)
  return [measure(() => stepTurretLoad(s)), t]
}

const multi = ((): number => {
  const s = createMultiLoad()
  for (let i = 0; i < 300; i++) stepMultiLoad(s)
  resetMultiLoad(s)
  return measure(() => stepMultiLoad(s))
})()
const [search, searchT] = turret(createTurretSearchLoad)
const [track, trackT] = turret(createTurretTrackLoad)

const n = (v: number): string => v.toFixed(1).padStart(8)
console.log('  負載                        每步 µs    比 20v20 多')
console.log(`  20v20（無砲塔）           ${n(multi)}          ——`)
console.log(`  搜尋（160 座、搜不到）    ${n(search)}    ${n(search - multi)}`)
console.log(`  追瞄（160 座、全有目標）  ${n(track)}    ${n(track - multi)}`)
console.log('')
console.log(`  搜尋負載取得目標：${searchT}`)
console.log(`  追瞄負載取得目標：${trackT}`)
