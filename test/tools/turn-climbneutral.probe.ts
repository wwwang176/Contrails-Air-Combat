/**
 * 「爬升不動」的前提下能把迴轉半徑縮多少。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/turn-climbneutral.probe.ts
 *
 * 【為什麼爬升可以被綁住】爬升是 Ps = V(T−D)/W。減重同時動分子與分母，
 * 所以它推爬升；但另外兩條路不會：
 *
 *   甲 CLmax（feel.lift）—— 完全不進 Ps，實測 ×0.7~×3.0 爬升逐格 1999 m/min
 *   乙 減重 + 同時收推力 —— 把減重送的餘功率原路還回去
 *
 * 乙 還要多綁一條：`power` 與 `cd0` 同倍率時極速不變（V_max³ ∝ P/cd0，
 * 見 feel.ts 的 cd0 註解）。所以收推力時 cd0 要同步收，否則極速會掉。
 *
 * 【GAME_FEEL 已含 mass 0.9】要表達「相對史實 spec 的有效質量 m」，
 * 這裡的倍率必須先除掉出貨值，否則每一列都比標示再輕 10%。
 */
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { GAME_FEEL, applyFeel, type FeelProfile } from '../../src/specs/feel'
import {
  instantaneousTurnRate, stallSpeed, maxClimbRate, maxLevelSpeed, serviceCeiling,
} from '../../src/analysis/envelope'
import { derivedClMax, type AircraftSpec } from '../../src/specs/types'

const KMH = 3.6

/** 有效質量 m（相對史實）對應的 feel.mass 值 */
const massFor = (m: number) => m
/** 有效 lift 倍率 L（相對史實）對應的 feel.lift 值 */
const liftFor = (l: number) => GAME_FEEL.lift * l

function specOf(raw: AircraftSpec, f: Partial<FeelProfile>): AircraftSpec {
  const base = applyFeel(raw, { ...GAME_FEEL, ...f })
  // 軟夾之後的有效過載上限就是結構極限，envelope 讀 gPositive 剛好正確
  return base
}

const climbOf = (s: AircraftSpec) => maxClimbRate(s, 0).rate * 60
function minInst(s: AircraftSpec, alt: number): number {
  let best = Infinity
  for (let v = 40; v <= 320; v += 0.5) {
    const w = instantaneousTurnRate(s, alt, v)
    if (w > 1e-6) best = Math.min(best, v / w)
  }
  return best
}

/** 改動前的基準：軟夾、原重量 */
const BASE = specOf(P51D, { mass: 1 })
const BASE_CLIMB = climbOf(BASE)
const BASE_R = minInst(BASE, 4000)
console.log(`基準（軟夾、原重量）：爬升 ${BASE_CLIMB.toFixed(0)} m/min、`
  + `最小瞬時 R@4000 ${BASE_R.toFixed(0)} m、SL 極速 ${(maxLevelSpeed(BASE, 0) * KMH).toFixed(0)} km/h\n`)

console.log('═══ 甲：只動 CLmax（天生爬升中性）═══')
console.log('lift倍率  CLmax  最小瞬時R@4k  vs基準   爬升m/min  失速SL  角速4k  SL極速')
for (const l of [1.0, 1.1, 1.2, 1.3, 1.45, 1.6]) {
  const s = specOf(P51D, { mass: 1, lift: liftFor(l) })
  const r = minInst(s, 4000)
  console.log(
    `${l.toFixed(2).padStart(6)}  ${derivedClMax(s, false).toFixed(2).padStart(5)} `
    + `${r.toFixed(0).padStart(11)}m ${((r / BASE_R - 1) * 100).toFixed(1).padStart(7)}% `
    + `${climbOf(s).toFixed(0).padStart(10)} `
    + `${(stallSpeed(s, 0, 1) * KMH).toFixed(0).padStart(7)} `
    + `${(stallSpeed(s, 4000, s.limits.gPositive) * KMH).toFixed(0).padStart(7)} `
    + `${(maxLevelSpeed(s, 0) * KMH).toFixed(0).padStart(7)}`,
  )
}

console.log('\n═══ 乙：減重 + 收推力把爬升還回去（cd0 同倍率，鎖住極速）═══')
console.log('有效質量  推力倍率  最小瞬時R@4k  vs基準   爬升m/min  失速SL  SL極速  4k極速  升限')
for (const m of [0.95, 0.9, 0.85, 0.8, 0.75, 0.7]) {
  // 二分求 k：power 與 cd0 同乘 k，使海平面最佳爬升率回到基準
  let lo = 0.2
  let hi = 1.0
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    const s = specOf(P51D, {
      mass: massFor(m),
      power: GAME_FEEL.power * mid,
      cd0: GAME_FEEL.cd0 * mid,
    })
    if (climbOf(s) > BASE_CLIMB) hi = mid
    else lo = mid
  }
  const k = (lo + hi) / 2
  const s = specOf(P51D, {
    mass: massFor(m),
    power: GAME_FEEL.power * k,
    cd0: GAME_FEEL.cd0 * k,
  })
  const r = minInst(s, 4000)
  console.log(
    `${m.toFixed(2).padStart(6)}  ${k.toFixed(3).padStart(8)} `
    + `${r.toFixed(0).padStart(11)}m ${((r / BASE_R - 1) * 100).toFixed(1).padStart(7)}% `
    + `${climbOf(s).toFixed(0).padStart(10)} `
    + `${(stallSpeed(s, 0, 1) * KMH).toFixed(0).padStart(7)} `
    + `${(maxLevelSpeed(s, 0) * KMH).toFixed(0).padStart(7)} `
    + `${(maxLevelSpeed(s, 4000) * KMH).toFixed(0).padStart(7)} `
    + `${serviceCeiling(s).toFixed(0).padStart(6)}`,
  )
}

console.log('\n═══ 丙：兩者混合，都綁住爬升 ═══')
console.log('質量  lift  推力倍率  最小瞬時R@4k  vs基準  爬升  CLmax  失速SL  SL極速')
for (const [m, l] of [[0.9, 1.15], [0.85, 1.15], [0.9, 1.3], [0.85, 1.3]] as [number, number][]) {
  let lo = 0.2
  let hi = 1.0
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    const s = specOf(P51D, {
      mass: massFor(m), lift: liftFor(l),
      power: GAME_FEEL.power * mid, cd0: GAME_FEEL.cd0 * mid,
    })
    if (climbOf(s) > BASE_CLIMB) hi = mid
    else lo = mid
  }
  const k = (lo + hi) / 2
  const s = specOf(P51D, {
    mass: massFor(m), lift: liftFor(l),
    power: GAME_FEEL.power * k, cd0: GAME_FEEL.cd0 * k,
  })
  const r = minInst(s, 4000)
  console.log(
    `${m.toFixed(2)}  ${l.toFixed(2)}  ${k.toFixed(3).padStart(8)} `
    + `${r.toFixed(0).padStart(11)}m ${((r / BASE_R - 1) * 100).toFixed(1).padStart(7)}% `
    + `${climbOf(s).toFixed(0).padStart(6)} ${derivedClMax(s, false).toFixed(2).padStart(6)} `
    + `${(stallSpeed(s, 0, 1) * KMH).toFixed(0).padStart(7)} `
    + `${(maxLevelSpeed(s, 0) * KMH).toFixed(0).padStart(7)}`,
  )
}

console.log('\n═══ 兩機平衡（各配方的 109÷P51 最小瞬時 R@4000）═══')
const CHECK: { name: string; f: Partial<FeelProfile> }[] = [
  { name: '基準', f: { mass: 1 } },
  { name: 'CLmax ×1.45', f: { mass: 1, lift: liftFor(1.45) } },
  { name: '質量 0.8 + 推力收', f: { mass: 0.8, power: GAME_FEEL.power * 0.62, cd0: GAME_FEEL.cd0 * 0.62 } },
]
for (const c of CHECK) {
  const p = specOf(P51D, c.f)
  const b = specOf(BF109K4, c.f)
  console.log(`${c.name.padEnd(20)} ${(minInst(b, 4000) / minInst(p, 4000)).toFixed(3)}`)
}
