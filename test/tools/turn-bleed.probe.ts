/**
 * 轉彎掉多少速度 —— 兩個候選配方的能量代價。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/turn-bleed.probe.ts
 *
 * 【問題】「減重會不會比較不掉速度？」同一個轉彎率下，需要的過載 n 與
 * 重量無關（n = sqrt(1 + (omega·V/g)^2)），但升力 = n·W，而誘導阻力正比
 * 於升力平方。所以輕的飛機轉同樣的圈，付的阻力比較少。
 *
 * 用 Ps = V(T−D)/W 換算等高度下的掉速率：dV/dt = g·Ps/V。
 */
import { P51D } from '../../src/specs/p51d'
import { GAME_FEEL, applyFeel } from '../../src/specs/feel'
import { specificExcessPower, maxLoadFactorAero } from '../../src/analysis/envelope'
import { G0 } from '../../src/core/math'
import type { AircraftSpec } from '../../src/specs/types'

const KMH = 3.6
const RAD = Math.PI / 180
const ALT = 4000

const CASES: { name: string; spec: AircraftSpec; nEff: number }[] = [
  { name: '現行', spec: applyFeel(P51D, GAME_FEEL), nEff: 6.5 },
  {
    name: 'K 質量 ×0.8',
    spec: applyFeel({ ...P51D, mass: P51D.mass * 0.8 }, GAME_FEEL),
    nEff: 8.7,
  },
  {
    name: 'I CLmax ×1.5',
    spec: applyFeel({ ...P51D, lift: { ...P51D.lift, clAlpha: P51D.lift.clAlpha * 1.5 } }, GAME_FEEL),
    nEff: 8.7,
  },
]

console.log(`P-51D @ ${ALT} m，固定轉彎率下的掉速率（負 = 掉速），全油門 WEP\n`)
for (const rateDeg of [15, 20, 25]) {
  console.log(`--- 轉彎率 ${rateDeg}°/s ---`)
  console.log('速度km/h   ' + CASES.map((c) => c.name.padEnd(20)).join(''))
  for (const kmh of [350, 450, 550]) {
    const v = kmh / KMH
    const n = Math.sqrt(1 + ((rateDeg * RAD * v) / G0) ** 2)
    const cells = CASES.map((c) => {
      const nAvail = Math.min(maxLoadFactorAero(c.spec, ALT, v), c.nEff)
      if (n > nAvail) return '拉不到'.padEnd(20)
      const ps = specificExcessPower(c.spec, ALT, v, n)
      const dv = (G0 * ps) / v // m/s²
      return `${(dv * KMH).toFixed(0).padStart(6)} km/h/s (n=${n.toFixed(1)})`.padEnd(20)
    })
    console.log(`${String(kmh).padStart(6)}     ` + cells.join(''))
  }
  console.log()
}

console.log('--- 轉 180° 之後還剩多少速度（450 km/h 進場、固定 20°/s、9 秒）---')
for (const c of CASES) {
  let v = 450 / KMH
  const dt = 0.05
  let ok = true
  for (let t = 0; t < 9; t += dt) {
    const n = Math.sqrt(1 + ((20 * RAD * v) / G0) ** 2)
    const nAvail = Math.min(maxLoadFactorAero(c.spec, ALT, v), c.nEff)
    if (n > nAvail) { ok = false; break }
    const ps = specificExcessPower(c.spec, ALT, v, n)
    v += ((G0 * ps) / v) * dt
    if (v < 40) { ok = false; break }
  }
  console.log(`${c.name.padEnd(14)} ${ok ? `${(v * KMH).toFixed(0)} km/h（掉 ${(450 - v * KMH).toFixed(0)}）` : '中途拉不動了'}`)
}
