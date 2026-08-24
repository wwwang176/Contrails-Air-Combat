/**
 * **高速換來的速度被阻力吃掉多快** —— 純檢視用。不是測試（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/speed-decay.probe.ts
 *
 * 【它回答的問題】專案負責人 2026-08-24：「高度換速度這件事，高速換到速度後
 * 很容易被空氣阻力減速，重新拉回高度後會很不值得。」把這句話變成數字：
 * 平飛滿油門下，各速度的 Ps（正 = 還在加速、負 = 阻力正在吃掉速度），
 * 以及「俯衝換到的超額速度衰減回可持續速度要幾秒、來回一趟虧幾成」。
 */
import { BF109G6 } from '../../src/specs/bf109g6'
import { P51D } from '../../src/specs/p51d'
import { GAME_FEEL, applyFeel } from '../../src/specs/feel'
import { specificExcessPower, maxLevelSpeed, cornerSpeed } from '../../src/analysis/envelope'
import { G0 } from '../../src/core/math'
import type { AircraftSpec } from '../../src/specs/types'

const ALT = 4000

for (const [name, base] of [['Bf 109 G-6', BF109G6], ['P-51D', P51D]] as const) {
  const spec: AircraftSpec = applyFeel(base, GAME_FEEL)
  const vLevel = maxLevelSpeed(spec, ALT, 1)
  const vc = cornerSpeed(spec, ALT)
  console.log(`\n══ ${name} @ ${ALT} m ══`)
  console.log(`  可持續極速 ${vLevel.toFixed(0)} m/s　角落速度 ${vc.toFixed(0)} m/s`
    + `（比值 ${(vLevel / vc).toFixed(2)}）`)
  console.log('   V(m/s)  V/角落   Ps(m/s)   掉速率(m/s²)   這格速度全換高度值多少 m')
  for (const v of [120, 140, 160, 180, 200, 220, 240, 260]) {
    const ps = specificExcessPower(spec, ALT, v, 1, 1)
    const dvdt = (G0 * ps) / v
    console.log(
      `   ${v.toFixed(0).padStart(4)}  ${(v / vc).toFixed(2).padStart(6)}`
      + `  ${ps.toFixed(1).padStart(7)}  ${dvdt.toFixed(2).padStart(9)}`
      + `      ${((v * v - vc * vc) / (2 * G0)).toFixed(0).padStart(6)}`,
    )
  }

  // 來回一趟的帳：由 vLevel 俯衝加速到 1.3 倍角落，平飛讓阻力吃回 vLevel，
  // 算「白白蒸發的能量高度」。dV/dt = g·Ps/V，逐步積分。
  const vHigh = 1.3 * vc
  if (vHigh > vLevel) {
    let v = vHigh
    let t = 0
    let dissipated = 0
    const DT = 0.1
    while (v > vLevel + 0.5 && t < 120) {
      const ps = specificExcessPower(spec, ALT, v, 1, 1)
      // Ps < 0：這一格蒸發 |Ps|·dt 公尺的能量高度
      dissipated += Math.max(0, -ps) * DT
      v += (G0 * ps / v) * DT
      t += DT
    }
    console.log(
      `  超額速度 ${vHigh.toFixed(0)} → ${vLevel.toFixed(0)} m/s：`
      + `${t.toFixed(0)} 秒內被阻力吃光，蒸發能量高度 ${dissipated.toFixed(0)} m`
      + `（原本值 ${((vHigh * vHigh - vLevel * vLevel) / (2 * G0)).toFixed(0)} m）`,
    )
  } else {
    console.log(`  1.3 倍角落（${vHigh.toFixed(0)}）低於可持續極速 —— 平飛養得住，不虧`)
  }
}
