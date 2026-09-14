/** P-51D 各旋鈕的「只退回本項、其餘出貨值」掃描。註解裡的數字由這支產生。 */
import { P51D, P51D_HISTORICAL as H } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import {
  maxClimbRate, maxLevelSpeed, serviceCeiling, stallSpeed,
} from '../../src/analysis/envelope'
import { enginePower, propEfficiency, propThrust } from '../../src/physics/propulsion'
import { atmosphere } from '../../src/physics/atmosphere'
import { derivedClMax, type AircraftSpec } from '../../src/specs/types'
const KMH = 3.6
const HP = 745.7
const pc = (v: number, r: number): string => `${((v / r - 1) * 100 >= 0 ? '+' : '')}${((v / r - 1) * 100).toFixed(2)}%`
const adv = (s: AircraftSpec, h: number): number =>
  (maxLevelSpeed(s, h) - maxLevelSpeed(BF109K4, h)) * KMH
function line(label: string, s: AircraftSpec): void {
  console.log(label.padEnd(26)
    + `升限 ${serviceCeiling(s).toFixed(1).padStart(8)} ${pc(serviceCeiling(s), H.serviceCeiling).padStart(7)}`
    + `  爬升 ${(maxClimbRate(s, 0).rate * 60).toFixed(1).padStart(7)} ${pc(maxClimbRate(s, 0).rate * 60, H.climbRateSeaLevel * 60).padStart(7)}`
    + `  臨界極速 ${(maxLevelSpeed(s, H.vmaxAtCritical.altitude) * KMH).toFixed(1).padStart(6)} ${pc(maxLevelSpeed(s, H.vmaxAtCritical.altitude) * KMH, H.vmaxAtCritical.speed * KMH).padStart(7)}`
    + `  9,000m 優勢 ${adv(s, 9000).toFixed(1).padStart(5)}`)
}
console.log('── oswald ──')
for (const o of [0.80, 0.85, 0.88]) line(`oswald ${o}`, { ...P51D, wing: { ...P51D.wing, oswald: o } })
console.log('── alphaCrit（CL_max 與失速）──')
for (const a of [15.0, 15.5, 16.0, 16.5, 17.0]) {
  const s = { ...P51D, lift: { ...P51D.lift, alphaCrit: a * Math.PI / 180 } }
  console.log(`alphaCrit ${a}°`.padEnd(20)
    + `CL_max ${derivedClMax(s, false).toFixed(4)} ${pc(derivedClMax(s, false), H.clMax).padStart(7)}`
    + `  失速 ${(stallSpeed(s, 0, 1) * KMH).toFixed(2).padStart(6)} ${pc(stallSpeed(s, 0, 1) * KMH, H.stallSpeed * KMH).padStart(7)}`)
}
console.log('── ramEfficiency ──')
for (const r of [0.80, 0.85, 0.90, 0.95]) {
  const s = { ...P51D, engine: { ...P51D.engine, ramEfficiency: r } }
  const peak = maxLevelSpeed(s, H.vmaxAtCritical.altitude) * KMH
  console.log(`ram ${r}`.padEnd(26)
    + `升限 ${pc(serviceCeiling(s), H.serviceCeiling).padStart(7)}`
    + `  9,000m 優勢 ${adv(s, 9000).toFixed(1).padStart(5)}`
    + `  峰值餘裕 ${(peak - maxLevelSpeed(s, 4900) * KMH).toFixed(1).padStart(5)} / ${(peak - maxLevelSpeed(s, 10925) * KMH).toFixed(1).padStart(5)}`)
}
console.log('── prop（etaMax / vRef）──')
for (const [e, v] of [[0.85, 42], [0.90, 42], [0.90, 55]] as [number, number][]) {
  const s = { ...P51D, prop: { ...P51D.prop, etaMax: e, vRef: v } }
  const vb = maxClimbRate(s, 0).speed
  console.log(`etaMax ${e} vRef ${v}`.padEnd(26)
    + `η = ${propEfficiency(s, vb).toFixed(3)} @ ${vb.toFixed(1)} m/s`
    + `  爬升 ${(maxClimbRate(s, 0).rate * 60).toFixed(1)} m/min ${pc(maxClimbRate(s, 0).rate * 60, H.climbRateSeaLevel * 60)}`)
}
console.log('── 引擎功率（測試釘住的那幾點）──')
const air = atmosphere(0, { density: 0, pressure: 0, temperature: 0, sigma: 0, soundSpeed: 0 } as never)
for (const h of [0, 1753, 5883, 9000]) {
  const a = atmosphere(h, { density: 0, pressure: 0, temperature: 0, sigma: 0, soundSpeed: 0 } as never)
  console.log(`  ${String(h).padStart(5)} m 靜止 WEP  ${(enginePower(P51D, a, 0, 1.1) / HP).toFixed(1)} hp`
    + `   K-4 ${(enginePower(BF109K4, a, 0, 1.1) / HP).toFixed(1)} hp`)
}
void air
console.log('── V→0 推力極限 etaMax·P/vRef ──')
for (const s of [P51D, BF109K4]) {
  const a = atmosphere(0, { density: 0, pressure: 0, temperature: 0, sigma: 0, soundSpeed: 0 } as never)
  const p = enginePower(s, a, 0, 1.1)
  console.log(`  ${s.name.padEnd(14)} 解析極限 ${(s.prop.etaMax * p / s.prop.vRef / 1000).toFixed(3)} kN`
    + `   實際 ${(propThrust(s, p, 0.5, a) / 1000).toFixed(3)} kN`)
}

console.log('── vRef：夾制餘裕 vs 爬升（出力已修正，1,780 hp）──')
{
  const a0 = atmosphere(0, { density: 0, pressure: 0, temperature: 0, sigma: 0, soundSpeed: 0 } as never)
  for (const v of [42, 44, 45, 46, 47, 48, 50]) {
    const s: AircraftSpec = { ...P51D, prop: { ...P51D.prop, vRef: v } }
    const power = enginePower(s, a0, 0, 1.1)
    const r = s.prop.diameter / 2
    const ideal = Math.cbrt(2 * a0.density * Math.PI * r * r * power * power)
    const staticMax = s.prop.figureOfMerit * ideal
    const dyn = s.prop.etaMax * power / s.prop.vRef
    console.log(`  vRef ${String(v).padStart(2)}  夾制餘裕 ${(((staticMax - dyn) / dyn) * 100).toFixed(1).padStart(6)}%`
      + `  爬升 ${(maxClimbRate(s, 0).rate * 60).toFixed(1).padStart(7)} ${pc(maxClimbRate(s, 0).rate * 60, H.climbRateSeaLevel * 60).padStart(7)}`
      + `  升限 ${pc(serviceCeiling(s), H.serviceCeiling).padStart(7)}`
      + `  臨界極速 ${pc(maxLevelSpeed(s, H.vmaxAtCritical.altitude) * KMH, H.vmaxAtCritical.speed * KMH).padStart(7)}`)
  }
}
console.log('── 高空保留率（M 0.6）──')
{
  const ret = (s: AircraftSpec): number =>
    enginePower(s, atmosphere(8000, {} as never), 0.6, 1.1) / enginePower(s, atmosphere(0, {} as never), 0.6, 1.1)
  console.log(`  P-51D ${ret(P51D).toFixed(4)}   K-4 ${ret(BF109K4).toFixed(4)}   差 ${(ret(P51D) - ret(BF109K4)).toFixed(4)}`)
}
console.log('── 功率曲線的局部極大值 ──')
{
  const xs: number[] = []
  for (let h = 0; h <= 9000; h += 250) xs.push(enginePower(P51D, atmosphere(h, {} as never), 0, 1.1) / HP)
  let peaks: number[] = []
  for (let i = 1; i < xs.length - 1; i++) if (xs[i]! > xs[i - 1]! && xs[i]! >= xs[i + 1]!) peaks.push(i * 250)
  console.log('  峰在 ', peaks.join(', '), 'm')
  console.log('  ' + xs.filter((_, i) => i % 4 === 0).map((v, i) => `${i * 1000}m:${v.toFixed(0)}`).join('  '))
}
