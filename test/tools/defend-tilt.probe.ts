/**
 * **止損閘門**：高度對 `defendTilt` 有沒有反應？**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/defend-tilt.probe.ts
 *
 * 【這一支存在的理由】`pitchSurplusGain` 那一輪蓋完整套才發現「關到
 * 底都沒差」，白燒一輪。這次先問「這根槓桿接得上嗎」再決定要不要蓋。
 *
 * 【不改任何出貨值】`defendTilt` 已經是 `SteerConfig` 的欄位，這裡在跑之前
 * 改它、跑完在 `finally` 還原。這是**量測**，不是改動。
 *
 * 【判準必須指定方向】只寫「變化 > 393 m」的話，抬角調低反而爬得**更多**也算
 * 通過 —— 那是反證，不是支持。方向、兩個開局的一致性、最小效果量三者缺一
 * 不可。
 */
import { DEFAULT_STEER } from '../../src/ai/steer'
import { measureDrift, showDrift, DRIFT_HEADER, OPENINGS } from './drift'

const RAD = Math.PI / 180

console.log('20v20、420 秒、VETERAN、兩個開局。出貨 defendTilt = 20°\n')
console.log(DRIFT_HEADER)
for (const deg of [20, 10, 0, -10]) {
  for (const o of OPENINGS) {
    const saved = DEFAULT_STEER.defendTilt
    DEFAULT_STEER.defendTilt = deg * RAD
    try {
      showDrift(`${deg}°`, o, measureDrift(o))
    } finally {
      DEFAULT_STEER.defendTilt = saved
    }
  }
}
console.log('\n【止損判準 —— 三條全部要成立才繼續】')
console.log('　一、方向：抬角 20° → 0° → −10°，結束高度必須**單調變低**。')
console.log('　　　變高 = 這根槓桿的因果方向與假設相反，計畫作廢。')
console.log('　二、一致性：兩個開局同向。只有一個開局動 = 雜訊。')
console.log('　三、效果量：20° 與 −10° 的結束高度差 > 393 m（開局間雜訊底線），')
console.log('　　　**或**回落由 ~0 明顯變大且兩個開局同向。')
console.log('　任何一條不成立 —— 這根槓桿接不上，整個計畫當場結案。')
console.log('　另：任何一列標了「無效」就重跑該列，不得拿進判定。')
