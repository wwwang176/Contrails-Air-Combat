/**
 * 【一次性量測】高度差對 `airframeTurnAdvantage` 的污染 —— 迴轉閂鎖的
 * 門檻是 −0.02（enter）／−0.01（exit），設計上對 P-51 vs Bf 109 應休眠
 * （同高度實測只差 −0.006~+0.017）。量「我在上、他在下」時的讀值。
 *
 *   npx vite-node test/tools/turn-latch-alt.probe.ts
 */
import { bestSustainedTurnRateCached } from '../../src/analysis/envelope'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'

console.log('P-51 在上（4800）、Bf 109 在下 —— airframeTurnAdvantage（rad/s）')
console.log('高度差    P51@4800 − 109@下方    跨 enter −0.02?')
for (const gap of [0, 200, 400, 600, 800, 1000]) {
  const mine = bestSustainedTurnRateCached(P51D, 4800)
  const his = bestSustainedTurnRateCached(BF109K4, 4800 - gap)
  const adv = mine - his
  console.log(
    `  ${String(gap).padStart(4)}      ${adv.toFixed(4).padStart(8)}`
    + `             ${adv < -0.02 ? '【觸發】' : adv < -0.01 ? '（出不了場）' : '—'}`,
  )
}
console.log('\n同機種對照（P-51 對 P-51）—— 純高度差的貢獻')
for (const gap of [0, 200, 400, 600, 800, 1000]) {
  const adv = bestSustainedTurnRateCached(P51D, 4800) - bestSustainedTurnRateCached(P51D, 4800 - gap)
  console.log(`  ${String(gap).padStart(4)}      ${adv.toFixed(4).padStart(8)}`)
}
