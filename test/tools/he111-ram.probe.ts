/**
 * He 111 的 5,000 m 極速差 −6.2%，要在**不動其他四項**的前提下補回來。
 *
 * 【只有兩個旋鈕在海平面完全不作用】`enginePower` 算的是
 * `σ_eff = min(σ · ramFactor(mach, ramEfficiency), 1)`，海平面那個 min
 * **一定夾在 1**，於是 `t = 1`、功率恆等於 `powerSeaLevel`。所以
 * `ramEfficiency` 與 `powerCritical` 這兩項調再多，海平面極速一個字不動；
 * 到了 5,000 m（σ 只有 0.60）夾制解除，兩者才開始說話。
 *
 * 對照：cd0 與 etaMax 動的是全速域（海平面會跟著跑）、altCritical 是查到的
 * 史實值（Jumo 211F 的 Nennhöhe 5,300 m），不該為了配合數字去動。
 *
 * 【powerCritical 有一個有原則的取值，不是硬調】現在填的 2,120 PS 是
 * **爬升檔**在 5,300 m 的值（1,060 ×2），而 `powerSeaLevel` 填的 2,680 是
 * **起飛檔**（1,340 ×2）—— 兩端不同額定，這是 spec 註解已經寫明的已知不精確。
 * 兩個額定在海平面的比值是 1,340 / 1,120 = **1.196**；把同一個比值套到
 * 5,300 m 的爬升值上，得到「起飛檔等效」的 1,060 × 1.196 × 2 = **2,536 PS**。
 * 這樣兩端就是同一種額定了。
 */
import {
  maxLevelSpeed, maxClimbRate, stallSpeed, serviceCeiling,
} from '../../src/analysis/envelope'
import { HE111, HE111_HISTORICAL as H } from '../../src/specs/he111'
import type { AircraftSpec } from '../../src/specs/types'

const KMH = 3.6
const PS = 735.5
const n = (v: number, w: number, d = 1): string => v.toFixed(d).padStart(w)
const pct = (a: number, b: number): string => {
  const p = ((a - b) / b) * 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`.padStart(8)
}

function row(label: string, ram: number, crit: number): void {
  const s: AircraftSpec = {
    ...HE111,
    engine: {
      ramEfficiency: ram,
      gears: [{ ...HE111.engine.gears[0]!, powerCritical: crit * PS }],
    },
  }
  console.log(`  ${label.padEnd(14)}`
    + pct(maxLevelSpeed(s, 0) * KMH, H.vmaxSeaLevel * KMH)
    + pct(maxLevelSpeed(s, 5000) * KMH, H.vmaxAtCritical.speed * KMH)
    + pct(maxClimbRate(s, 0).rate, H.climbRateSeaLevel)
    + pct(stallSpeed(s, 0, 1) * KMH, H.stallSpeed * KMH)
    + pct(serviceCeiling(s), H.serviceCeiling)
    + `  ${n(maxLevelSpeed(s, 5000) * KMH, 6, 1)}${n(serviceCeiling(s), 8, 0)}`)
}

console.log('\n  史實：海平面 369、5,000 m 405 km/h、海爬 4.5、失速 150、升限 6,300\n')
console.log('  設定            海平面   5000m     海爬     失速     升限   5000m   升限')
console.log('  —— ramEfficiency 單獨掃（powerCritical 維持 2,120）————————————')
for (const r of [0.50, 0.70, 0.95]) row(`ram ${r.toFixed(2)}`, r, 2120)
console.log('  —— powerCritical 單獨掃（ram 維持 0.50）—————————————————')
for (const c of [2120, 2250, 2380, 2536, 2680]) row(`crit ${c}`, 0.50, c)
console.log('  —— 細掃：找「5,000 m 與升限兩項都在 ±5% 內」的區間 ————————')
for (const c of [2214, 2216, 2218, 2220, 2222, 2224]) row(`crit ${c}`, 0.50, c)
console.log()
