/**
 * `turnDiscount` 的實際形狀。**不是測試**（`.probe.ts` 不在 vitest 的 include）。
 *
 * 跑法：`npx vite-node test/tools/turn-curve.probe.ts`
 *
 * 【要回答什麼】提案是「改 `turnDiscount` 的形狀」。動手之前得先知道現行曲線
 * 在真實的迴旋率下長什麼樣 —— 用推估的角速度講「1.38 倍」會把整個設計建在
 * 一個猜的數字上。
 */
import { instantaneousTurnRate } from '../../src/analysis/envelope'
import { DEFAULT_TARGET } from '../../src/ai/target'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'

const ALT = 4000
const TAS = 200
const RAD = 180 / Math.PI

function discount(x: number, w: number): number {
  if (w === 0) return 1
  if (!(x > 0)) return 1
  return Math.pow(1 / (1 + x), w)
}

for (const spec of [P51D, BF109K4]) {
  const rate = instantaneousTurnRate(spec, ALT, TAS)
  console.log(`\n=== ${spec.id}　${ALT} m、TAS ${TAS} m/s　瞬時迴旋率 `
    + `${(rate * RAD).toFixed(1)}°/s ===`)
  console.log('離軸角   轉向時間   現行折扣   相對 0° 的倍率')
  const at0 = discount(0, DEFAULT_TARGET.turnWeight)
  for (const deg of [0, 15, 30, 45, 57, 60, 75, 90, 120, 150, 180]) {
    const t = (deg / RAD) / rate
    const d = discount(t / DEFAULT_TARGET.turnTimeScale, DEFAULT_TARGET.turnWeight)
    console.log(
      `${String(deg).padStart(4)}°  ${t.toFixed(2).padStart(8)} s  `
      + `${d.toFixed(3).padStart(8)}   ${(at0 / d).toFixed(2).padStart(8)} ×`,
    )
  }
  // 換敵門檻要跨過的那一階
  const d57 = discount(((57 / RAD) / rate) / DEFAULT_TARGET.turnTimeScale, DEFAULT_TARGET.turnWeight)
  const d90 = discount(((90 / RAD) / rate) / DEFAULT_TARGET.turnTimeScale, DEFAULT_TARGET.turnWeight)
  const d180 = discount(((180 / RAD) / rate) / DEFAULT_TARGET.turnTimeScale, DEFAULT_TARGET.turnWeight)
  console.log(`57°→90° 只損失 ${(d57 / d90).toFixed(2)} 倍，`
    + `而換敵門檻是 ${(1 + DEFAULT_TARGET.switchMargin).toFixed(2)} 倍`)
  console.log(`57°→180° 損失 ${(d57 / d180).toFixed(2)} 倍，`
    + `而分攤折扣每多一個隊友鎖定就是 ${(1 + DEFAULT_TARGET.crowdPenalty).toFixed(2)} 倍`)
}

/**
 * 候選形狀：在現行 `turnDiscount` 之上再乘一個**純角度**的視野項。
 *
 * `vis(θ) = floor + (1 − floor) · ((1 + cos θ) / 2)^k`
 *
 * 【為什麼一定要有 `floor`】乘法項若在 180° 歸零，全部候選都會被乘成 0，
 * 而選擇就退化成「取索引最小的那一架」—— 那正是 `baseScore` 的註解記下的
 * 那個缺陷。下限讓「背後」是**很差**而不是**不存在**。
 *
 * 【為什麼另乘一項而不是改 `turnTime` 的響應】`turnTime` 帶著迴旋率，而
 * `rearShare` 的門檻由 0.30 放寬到 0.35，理由正是
 * 「對一台持續迴旋 25°/s 的飛機來說掉頭不再是浪費」。把迴旋率拿掉等於推翻
 * 那次裁定。分成兩項：**轉過去要多久**（既有）×**看不看得見**（新）。
 */
const RATE = instantaneousTurnRate(P51D, ALT, TAS)
const turnD = (deg: number): number =>
  discount(((deg / RAD) / RATE) / DEFAULT_TARGET.turnTimeScale, DEFAULT_TARGET.turnWeight)
const vis = (deg: number, k: number, floor: number): number =>
  floor + (1 - floor) * Math.pow((1 + Math.cos(deg / RAD)) / 2, k)

const CANDIDATES: { name: string, k: number, floor: number }[] = [
  { name: '甲 k=1 floor=0.15', k: 1, floor: 0.15 },
  { name: '乙 k=2 floor=0.10', k: 2, floor: 0.10 },
  { name: '丙 k=3 floor=0.05', k: 3, floor: 0.05 },
]

console.log('\n\n=== 候選視野項（P-51D、乘在現行 turnDiscount 之上）===')
console.log('離軸角   現行    ' + CANDIDATES.map((c) => c.name.padEnd(18)).join(''))
for (const deg of [0, 15, 30, 45, 57, 75, 90, 120, 150, 180]) {
  const base = turnD(deg)
  console.log(
    `${String(deg).padStart(4)}°  ${base.toFixed(3)}  `
    + CANDIDATES.map((c) => (base * vis(deg, c.k, c.floor)).toFixed(4).padEnd(18)).join(''),
  )
}

console.log('\n關鍵比值（越大代表越擋得住）')
console.log('形狀                 57°→90°   57°→180°   0°→15°（前方兩架的分辨力）')
const rows: { name: string, f: (d: number) => number }[] = [
  { name: '現行', f: turnD },
  ...CANDIDATES.map((c) => ({
    name: c.name,
    f: (d: number) => turnD(d) * vis(d, c.k, c.floor),
  })),
]
for (const r of rows) {
  console.log(
    r.name.padEnd(20) + `  ${(r.f(57) / r.f(90)).toFixed(2).padStart(6)} ×  `
    + `${(r.f(57) / r.f(180)).toFixed(1).padStart(7)} ×  `
    + `${(r.f(0) / r.f(15)).toFixed(3).padStart(10)} ×`,
  )
}
console.log(`（換敵門檻 ${(1 + DEFAULT_TARGET.switchMargin).toFixed(2)} ×、`
  + `一個隊友鎖定 ${(1 + DEFAULT_TARGET.crowdPenalty).toFixed(2)} ×）`)
