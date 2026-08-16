/**
 * 兩台飛機的優勢在哪個速度帶翻轉。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/tactics-sheet.probe.ts
 *
 * 【要回答什麼】「該用什麼打法」這件事在戰術上只有一個核心問題：
 * **在什麼條件下我比他強**。所以量三條隨速度變化的曲線：
 * 迴旋率、滾轉率、比余功率（能量增減）。
 */
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { GAME_FEEL, applyFeel } from '../../src/specs/feel'
import {
  instantaneousTurnRate, sustainedTurnRate, maxRollRate, specificExcessPower,
  maxLoadFactorAero,
} from '../../src/analysis/envelope'

const KMH = 3.6
const DEG = 180 / Math.PI
const P = applyFeel(P51D, GAME_FEEL)
const B = applyFeel(BF109G6, GAME_FEEL)
const ALT = 4000

console.log(`高度 ${ALT} m，全油門 WEP\n`)
console.log('速度   ─瞬時迴旋 °/s─  ─持續迴旋 °/s─  ──滾轉率 °/s──  ─1G 比余功率 m/s─')
console.log('km/h   P-51   109  差    P-51   109  差    P-51   109  差    P-51   109   差')
for (const kmh of [300, 350, 400, 450, 500, 550, 600, 650, 700]) {
  const v = kmh / KMH
  const f = (a: number, b: number, d = 1) =>
    `${(a).toFixed(d).padStart(5)} ${(b).toFixed(d).padStart(5)} ${(b - a >= 0 ? '+' : '') + (b - a).toFixed(d).padStart(4)}`
  const ip = instantaneousTurnRate(P, ALT, v) * DEG
  const ib = instantaneousTurnRate(B, ALT, v) * DEG
  const sp = sustainedTurnRate(P, ALT, v) * DEG
  const sb = sustainedTurnRate(B, ALT, v) * DEG
  const rp = maxRollRate(P, ALT, v) * DEG
  const rb = maxRollRate(B, ALT, v) * DEG
  const pp = specificExcessPower(P, ALT, v, 1)
  const pb = specificExcessPower(B, ALT, v, 1)
  console.log(`${String(kmh).padStart(4)}  ${f(ip, ib)}  ${f(sp, sb)}  ${f(rp, rb, 0)}  ${f(pp, pb)}`)
}

console.log('\n【差 = 109 − P-51。正數代表 109 較優】')

console.log('\n=== 誰能撐住多少 G（氣動可達過載，受結構上限夾）===')
console.log('速度   P-51   109')
for (const kmh of [300, 400, 500, 600]) {
  const v = kmh / KMH
  const np = Math.min(maxLoadFactorAero(P, ALT, v), P.limits.gPositive)
  const nb = Math.min(maxLoadFactorAero(B, ALT, v), B.limits.gPositive)
  console.log(`${String(kmh).padStart(4)}  ${np.toFixed(1).padStart(5)} ${nb.toFixed(1).padStart(5)}`)
}

console.log('\n=== 爬升：誰在哪個高度爬得快 ===')
console.log('（用 1G 比余功率代表爬升能力，m/s）')
console.log('高度    P-51最佳  109最佳   差')
for (const alt of [0, 2000, 4000, 6000, 8000, 10000]) {
  let bp = -Infinity
  let bb = -Infinity
  for (let v = 60; v <= 250; v += 2) {
    bp = Math.max(bp, specificExcessPower(P, alt, v, 1))
    bb = Math.max(bb, specificExcessPower(B, alt, v, 1))
  }
  console.log(`${String(alt).padStart(5)} m ${bp.toFixed(1).padStart(9)} ${bb.toFixed(1).padStart(8)} `
    + `${(bb - bp >= 0 ? '+' : '') + (bb - bp).toFixed(1).padStart(5)}`)
}
