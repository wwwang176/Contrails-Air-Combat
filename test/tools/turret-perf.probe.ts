/**
 * 量砲塔的每步成本 —— **門檻要先量再訂**。
 *
 *   npx vite-node test/tools/turret-perf.probe.ts
 *
 * vite-node 走 SSR 轉譯，計時只能在同一個執行器裡互相比較。
 * 搜尋／追瞄的總時間含還原合成擺位的成本，與 `multi-load` 的差不是
 * 砲塔程式碼單獨的量測。
 *
 * 三份負載的架數與彈丸池相同，紅隊的機種與擺位不同；搜尋、追瞄負載另含
 * 固定相對姿態的成本，因此相減僅供比較整份負載：
 *
 *   20v20（P-51D vs Bf 109）  既有門檻量的那一份，**砲塔數 0**
 *   搜尋（P-51D vs B-17G）    160 座砲塔，全部搜不到目標
 *   追瞄（P-51D vs B-17G）    160 座砲塔，**全部**有目標
 *
 * 【它同時報「有幾座真的在追瞄」】沒有這一欄時，追瞄負載可能
 * 只有 114/160 座取得目標（`top` 與 `tail` 是 0 座），門檻因此沒有涵蓋它
 * 宣稱的最壞情形。這一欄就是為了讓那件事**下次不必靠人去發現**。
 *
 * 量法照 `perf-gate.test.ts`：取多批的最小值，批次多而短 —— 最小值取的是
 * 干擾最少的那一批，才是「這段程式要花多久」的估計。
 */
import { createMultiLoad, resetMultiLoad, stepMultiLoad } from '../../bench/multi-load'
import {
  createTurretSearchLoad, createTurretTrackLoad,
} from '../../bench/turret-load'
import { measureTurretLoad } from '../../bench/turret-measure'

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

const multi = ((): number => {
  const s = createMultiLoad()
  for (let i = 0; i < 300; i++) stepMultiLoad(s)
  resetMultiLoad(s)
  return measure(() => stepMultiLoad(s))
})()
const { microseconds: search, targeted: searchT, total: searchTotal } = measureTurretLoad(createTurretSearchLoad)
const { microseconds: track, targeted: trackT, total: trackTotal } = measureTurretLoad(createTurretTrackLoad)

const n = (v: number): string => v.toFixed(1).padStart(8)
console.log('  負載                        每步 µs    比 20v20 多')
console.log(`  20v20（無砲塔）           ${n(multi)}          ——`)
console.log(`  搜尋（160 座、搜不到）    ${n(search)}    ${n(search - multi)}`)
console.log(`  追瞄（160 座、全有目標）  ${n(track)}    ${n(track - multi)}`)
console.log('')
console.log(`  搜尋負載取得目標：${searchT}/${searchTotal}`)
console.log(`  追瞄負載取得目標：${trackT}/${trackTotal}`)
