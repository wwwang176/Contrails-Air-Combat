/**
 * 反過來問：要達成史實那三個點，**需要多少軸馬力**？
 *
 * 這支不改任何 spec。它把 `dragAt` 求出的阻力乘以速度、除以螺旋槳效率，
 * 得到「所需軸功率」，再拿去和 spec 的引擎在該高度**實際給得出來**的
 * 功率比。比值 > 1 就是史實值與引擎資料互相矛盾，不是係數沒調好。
 */
import { dragAt } from '../../src/analysis/envelope'
import { atmosphere } from '../../src/physics/atmosphere'
import { enginePower, WEP_THROTTLE } from '../../src/physics/propulsion'
import { propEfficiency } from '../../src/physics/propulsion'
import { HE111, HE111_HISTORICAL } from '../../src/specs/he111'
import { B17G, B17G_HISTORICAL } from '../../src/specs/b17g'
import type { AircraftSpec, HistoricalReference } from '../../src/specs/types'
import type { AirData } from '../../src/physics/types'

const AIR: AirData = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }

const PS = 735.5
const n = (v: number, w: number, d = 0): string => v.toFixed(d).padStart(w)

function need(base: AircraftSpec, hist: HistoricalReference,
  cd0s: readonly number[]): void {
  const pts = [
    { alt: 0, v: hist.vmaxSeaLevel, tag: '海平面' },
    { alt: hist.vmaxAtCritical.altitude, v: hist.vmaxAtCritical.speed,
      tag: `${hist.vmaxAtCritical.altitude} m` },
  ]
  console.log(`\n══ ${base.name} ═══════════════════════════════════════`)
  console.log(`  引擎：海平面 ${(base.engine.gears[0]!.powerSeaLevel / PS).toFixed(0)} PS`
    + `、臨界 ${(base.engine.gears[0]!.powerCritical / PS).toFixed(0)} PS`
    + ` @ ${base.engine.gears[0]!.altCritical} m`)
  for (const p of pts) {
    const air = atmosphere(p.alt, AIR)
    const have = enginePower(base, air, p.v / air.soundSpeed, WEP_THROTTLE)
    const eta = propEfficiency(base, p.v)
    console.log(`\n  ${p.tag}  ${(p.v * 3.6).toFixed(0)} km/h`
      + `   引擎給得出 ${n(have / 1000, 6, 0)} kW（${n(have / PS, 5, 0)} PS）  η ${eta.toFixed(3)}`)
    console.log('      cd0      阻力 N   需要軸功率 kW   需要／給得出')
    for (const cd0 of cd0s) {
      const s: AircraftSpec = { ...base, drag: { ...base.drag, cd0 } }
      const d = dragAt(s, p.alt, p.v, 1)
      const req = (d * p.v) / eta
      console.log(`    ${n(cd0, 6, 4)}  ${n(d, 8, 0)}  ${n(req / 1000, 12, 0)}`
        + `  ${n(req / have, 12, 2)}${req / have > 1.02 ? '  ← 不可能' : ''}`)
    }
  }
}

need(HE111, HE111_HISTORICAL, [0.032, 0.026, 0.022, 0.018, 0.014])
need(B17G, B17G_HISTORICAL, [0.0245, 0.0215, 0.0185])
console.log()
