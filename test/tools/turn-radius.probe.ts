/**
 * 迴轉半徑與「把它縮小 25%」要付的代價。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/turn-radius.probe.ts
 *
 * 【一定要套 GAME_FEEL】遊戲裡真正在飛的是 applyFeel(spec, GAME_FEEL)
 * （見 battle/setup.ts:280），不是 specs/*.ts 的史實值。直接拿史實 spec 算
 * 出來的半徑跟玩家看到的差很多。
 *
 * R = V / omega。
 */
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { GAME_FEEL, HISTORICAL, applyFeel, type FeelProfile } from '../../src/specs/feel'
import {
  instantaneousTurnRate, sustainedTurnRate, bestSustainedTurnRate,
  cornerSpeed, stallSpeed, maxClimbRate, maxLevelSpeed, serviceCeiling,
} from '../../src/analysis/envelope'
import type { AircraftSpec } from '../../src/specs/types'

const DEG = 180 / Math.PI
const KMH = 3.6

/** 掃速度求最小瞬時半徑，回傳 [半徑 m, 速度 m/s]。 */
function minInstRadius(spec: AircraftSpec, alt: number): [number, number] {
  let best = Infinity
  let bv = 0
  for (let v = 40; v <= 320; v += 0.5) {
    const w = instantaneousTurnRate(spec, alt, v)
    if (w > 1e-6) {
      const r = v / w
      if (r < best) { best = r; bv = v }
    }
  }
  return [best, bv]
}

/** 最佳持續轉彎的 [半徑 m, 轉彎率 rad/s, 速度 m/s]。 */
function minSustRadius(spec: AircraftSpec, alt: number): [number, number, number] {
  const w = bestSustainedTurnRate(spec, alt)
  if (!(w > 1e-6)) return [Infinity, 0, 0]
  // bestSustainedTurnRate 只回傳率，速度要自己找回來（快取版綁 WeakMap，
  // 消融用的臨時 spec 每次都是新物件，拿快取表反而每次重填）。
  let bv = 0
  let bd = Infinity
  for (let v = 40; v <= 250; v += 0.25) {
    const d = Math.abs(sustainedTurnRate(spec, alt, v) - w)
    if (d < bd) { bd = d; bv = v }
  }
  return [bv / w, w, bv]
}

const ALTS = [0, 2000, 4000]

console.log('====== 一、遊戲裡實際的迴轉半徑（GAME_FEEL 已套用）======')
for (const raw of [P51D, BF109G6]) {
  const game = applyFeel(raw, GAME_FEEL)
  const hist = applyFeel(raw, HISTORICAL)
  console.log(`\n=== ${raw.name} ===`)
  console.log('高度   失速km/h 角速度km/h  最佳持續°/s @km/h  最小持續R  最小瞬時R @km/h   (史實持續R)')
  for (const alt of ALTS) {
    const [rs, ws, vs] = minSustRadius(game, alt)
    const [ri, vi] = minInstRadius(game, alt)
    const [rsh] = minSustRadius(hist, alt)
    console.log(
      `${String(alt).padStart(5)}m `
      + `${(stallSpeed(game, alt, 1) * KMH).toFixed(0).padStart(7)} `
      + `${(cornerSpeed(game, alt) * KMH).toFixed(0).padStart(9)} `
      + `${(ws * DEG).toFixed(1).padStart(11)}°/s @${(vs * KMH).toFixed(0).padStart(4)} `
      + `${rs.toFixed(0).padStart(9)}m `
      + `${ri.toFixed(0).padStart(9)}m @${(vi * KMH).toFixed(0).padStart(4)} `
      + `${rsh.toFixed(0).padStart(11)}m`,
    )
  }
  // 常態纏鬥速度下的半徑
  console.log('  海平面各速度：速度  瞬時R   持續R')
  for (const kmh of [300, 400, 500, 600]) {
    const v = kmh / KMH
    const wi = instantaneousTurnRate(game, 0, v)
    const ws2 = sustainedTurnRate(game, 0, v)
    const f = (w: number) => (w > 1e-6 ? `${(v / w).toFixed(0).padStart(6)}m` : '     —')
    console.log(`         ${String(kmh).padStart(4)} km/h ${f(wi)} ${f(ws2)}`)
  }
}

console.log('\n\n====== 二、每個旋鈕買到多少半徑（P-51D，海平面 + 4000 m）======')
type Knob = { name: string; apply: (f: FeelProfile, m: number) => FeelProfile }
const KNOBS: Knob[] = [
  { name: 'lift（CLmax）', apply: (f, m) => ({ ...f, lift: f.lift * m }) },
  { name: 'oswald（誘導阻力）', apply: (f, m) => ({ ...f, oswald: f.oswald * m }) },
  { name: 'power（推力）', apply: (f, m) => ({ ...f, power: f.power * m }) },
  { name: 'cd0（寄生阻力）', apply: (f, m) => ({ ...f, cd0: f.cd0 * m }) },
  {
    name: 'power+cd0 同倍（極速鎖住）',
    apply: (f, m) => ({ ...f, power: f.power * m, cd0: f.cd0 * m }),
  },
]

for (const raw of [P51D]) {
  for (const knob of KNOBS) {
    console.log(`\n--- ${knob.name} ---`)
    console.log('倍率   SL持續R  SL瞬時R   4000持續R 4000瞬時R   失速km/h 角速km/h  SL爬升m/min  SL極速km/h')
    for (const m of [0.7, 1.0, 1.3, 1.6, 2.0, 2.5, 3.0]) {
      const s = applyFeel(raw, knob.apply(GAME_FEEL, m))
      const [rs0] = minSustRadius(s, 0)
      const [ri0] = minInstRadius(s, 0)
      const [rs4] = minSustRadius(s, 4000)
      const [ri4] = minInstRadius(s, 4000)
      console.log(
        `${m.toFixed(1).padStart(4)}  ${rs0.toFixed(0).padStart(7)}m ${ri0.toFixed(0).padStart(8)}m `
        + `${rs4.toFixed(0).padStart(10)}m ${ri4.toFixed(0).padStart(8)}m `
        + `${(stallSpeed(s, 0, 1) * KMH).toFixed(0).padStart(9)} `
        + `${(cornerSpeed(s, 0) * KMH).toFixed(0).padStart(8)} `
        + `${(maxClimbRate(s, 0).rate * 60).toFixed(0).padStart(11)} `
        + `${(maxLevelSpeed(s, 0) * KMH).toFixed(0).padStart(11)}`,
      )
    }
  }
}

console.log('\n\n====== 三、非 feel 旋鈕（要改 spec 或加新倍率才動得到）======')
console.log('--- 質量倍率（翼負荷）---')
console.log('倍率   SL持續R  SL瞬時R   失速km/h  SL爬升m/min')
for (const m of [0.75, 0.85, 1.0]) {
  const base = applyFeel(P51D, GAME_FEEL)
  const s: AircraftSpec = { ...base, mass: base.mass * m }
  const [rs0] = minSustRadius(s, 0)
  const [ri0] = minInstRadius(s, 0)
  console.log(`${m.toFixed(2).padStart(4)}  ${rs0.toFixed(0).padStart(7)}m ${ri0.toFixed(0).padStart(8)}m `
    + `${(stallSpeed(s, 0, 1) * KMH).toFixed(0).padStart(9)} ${(maxClimbRate(s, 0).rate * 60).toFixed(0).padStart(12)}`)
}
console.log('--- 結構過載 gPositive ---')
console.log('  值    SL持續R  SL瞬時R   角速度km/h')
for (const g of [8, 10, 12]) {
  const base = applyFeel(P51D, GAME_FEEL)
  const s: AircraftSpec = { ...base, limits: { ...base.limits, gPositive: g } }
  const [rs0] = minSustRadius(s, 0)
  const [ri0] = minInstRadius(s, 0)
  console.log(`${String(g).padStart(4)}  ${rs0.toFixed(0).padStart(7)}m ${ri0.toFixed(0).padStart(8)}m `
    + `${(cornerSpeed(s, 0) * KMH).toFixed(0).padStart(11)}`)
}

console.log('\n\n====== 四、解出 −25% 各要多少（P-51D 海平面）======')
const base = applyFeel(P51D, GAME_FEEL)
const [rs0Base] = minSustRadius(base, 0)
const [ri0Base] = minInstRadius(base, 0)
const targetS = rs0Base * 0.75
const targetI = ri0Base * 0.75
console.log(`基準：持續 ${rs0Base.toFixed(0)} m → 目標 ${targetS.toFixed(0)} m；`
  + `瞬時 ${ri0Base.toFixed(0)} m → 目標 ${targetI.toFixed(0)} m`)

function solve(knob: Knob, which: 'sust' | 'inst', target: number): number {
  const at = (m: number) => {
    const s = applyFeel(P51D, knob.apply(GAME_FEEL, m))
    return which === 'sust' ? minSustRadius(s, 0)[0] : minInstRadius(s, 0)[0]
  }
  let lo = 1
  let hi = 1
  // 先往上找到跨過目標的上界（半徑對這些旋鈕都是遞減的）
  for (let i = 0; i < 20 && at(hi) > target; i++) hi *= 1.3
  if (at(hi) > target) return NaN
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (at(mid) > target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

console.log('\n旋鈕                       −25%持續要的倍率  −25%瞬時要的倍率')
for (const knob of KNOBS) {
  const ms = solve(knob, 'sust', targetS)
  const mi = solve(knob, 'inst', targetI)
  const f = (x: number) => (Number.isFinite(x) ? `×${x.toFixed(2)}` : '達不到')
  console.log(`${knob.name.padEnd(28)} ${f(ms).padStart(10)}      ${f(mi).padStart(10)}`)
}

console.log('\n--- 各候選的完整副作用（P-51D）---')
const CANDIDATES: { name: string; feel: FeelProfile }[] = []
for (const knob of KNOBS) {
  const ms = solve(knob, 'sust', targetS)
  if (Number.isFinite(ms)) {
    CANDIDATES.push({ name: `${knob.name} ×${ms.toFixed(2)}（持續 −25%）`, feel: knob.apply(GAME_FEEL, ms) })
  }
}
const liftMi = solve(KNOBS[0]!, 'inst', targetI)
CANDIDATES.push({
  name: `lift ×${liftMi.toFixed(2)}（瞬時 −25%）`,
  feel: KNOBS[0]!.apply(GAME_FEEL, liftMi),
})
console.log('輪廓                                       SL持續R SL瞬時R 4k持續R 失速 角速 爬升m/min SL極速 4k極速 升限')
for (const c of [{ name: '現行 GAME_FEEL', feel: GAME_FEEL }, ...CANDIDATES]) {
  const s = applyFeel(P51D, c.feel)
  const [rs0] = minSustRadius(s, 0)
  const [ri0] = minInstRadius(s, 0)
  const [rs4] = minSustRadius(s, 4000)
  console.log(
    c.name.padEnd(42)
    + `${rs0.toFixed(0).padStart(6)}m ${ri0.toFixed(0).padStart(6)}m ${rs4.toFixed(0).padStart(6)}m `
    + `${(stallSpeed(s, 0, 1) * KMH).toFixed(0).padStart(4)} ${(cornerSpeed(s, 0) * KMH).toFixed(0).padStart(4)} `
    + `${(maxClimbRate(s, 0).rate * 60).toFixed(0).padStart(8)} `
    + `${(maxLevelSpeed(s, 0) * KMH).toFixed(0).padStart(6)} `
    + `${(maxLevelSpeed(s, 4000) * KMH).toFixed(0).padStart(6)} `
    + `${serviceCeiling(s).toFixed(0).padStart(6)}`,
  )
}

console.log('\n--- Bf 109 套同一組倍率會怎樣（比值才是平衡）---')
for (const c of [{ name: '現行 GAME_FEEL', feel: GAME_FEEL }, ...CANDIDATES]) {
  const p = applyFeel(P51D, c.feel)
  const b = applyFeel(BF109G6, c.feel)
  const [rp] = minSustRadius(p, 0)
  const [rb] = minSustRadius(b, 0)
  const [ip] = minInstRadius(p, 0)
  const [ib] = minInstRadius(b, 0)
  console.log(`${c.name.padEnd(42)} 持續 P51 ${rp.toFixed(0)}m / 109 ${rb.toFixed(0)}m `
    + `(比 ${(rb / rp).toFixed(3)})   瞬時 ${ip.toFixed(0)}m / ${ib.toFixed(0)}m (比 ${(ib / ip).toFixed(3)})`)
}
