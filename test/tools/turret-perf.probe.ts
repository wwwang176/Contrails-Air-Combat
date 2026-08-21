/**
 * 量砲塔的每步成本 —— **門檻要先量再訂**。
 *
 *   npx tsx test/tools/turret-perf.probe.ts
 *
 * 三份負載的架數、彈丸池、控制器完全相同，唯一的差別是紅隊的機種，所以
 * 三個數字直接可減：
 *
 *   20v20（P-51D vs Bf 109）  既有門檻量的那一份，**砲塔數 0**
 *   搜尋（P-51D vs B-17G）    160 座砲塔，全部搜不到目標
 *   追瞄（P-51D vs B-17G）    160 座砲塔，全部在射程內
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

function turret(make: () => TurretLoadState): number {
  const s = make()
  for (let i = 0; i < 300; i++) stepTurretLoad(s)
  resetTurretLoad(s)
  return measure(() => stepTurretLoad(s))
}

const multi = ((): number => {
  const s = createMultiLoad()
  for (let i = 0; i < 300; i++) stepMultiLoad(s)
  resetMultiLoad(s)
  return measure(() => stepMultiLoad(s))
})()
const search = turret(createTurretSearchLoad)
const track = turret(createTurretTrackLoad)

const n = (v: number): string => v.toFixed(1).padStart(8)
console.log('  負載                        每步 µs    比 20v20 多')
console.log(`  20v20（無砲塔）           ${n(multi)}          ——`)
console.log(`  搜尋（160 座、搜不到）    ${n(search)}    ${n(search - multi)}`)
console.log(`  追瞄（160 座、射程內）    ${n(track)}    ${n(track - multi)}`)
