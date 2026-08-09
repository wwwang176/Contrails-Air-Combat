/**
 * `shotRelief` 的免除程度隨距離怎麼衰減。**不是測試**（`.probe.ts`）。
 *
 * 跑法：`npx vite-node test/tools/shot-relief.probe.ts`
 *
 * 【要回答什麼】實測長機「有槍解卻換走」那一群，分攤折扣的新÷舊中位是
 * 4.00（20v20，88% 的案例 >1.5 倍），而 `shotRelief` 本來就是設計來免除
 * 分攤的。它為什麼沒生效？同一群的舊目標**距離中位是 837 m**。
 */
import { DEFAULT_TARGET } from '../../src/ai/target'
import { THREAT_RANGE, THREAT_CONE } from '../../src/ai/assess'

const RAD = 180 / Math.PI

console.log(`THREAT_RANGE = ${THREAT_RANGE} m、THREAT_CONE = ${(THREAT_CONE * RAD).toFixed(0)}°、`
  + `shotRelief = ${DEFAULT_TARGET.shotRelief}、crowdPenalty = ${DEFAULT_TARGET.crowdPenalty}`)
console.log('\n【機首完美對準（noseFactor = 1）時的免除程度】')
console.log('距離     threatFactor   免除   分攤折扣(鎖定2)  新÷舊倍率')
for (const r of [200, 300, 400, 500, 600, 675, 700, 800, 837, 880, 900]) {
  const threat = 1 - r / THREAT_RANGE
  const relief = Math.min(1, threat / DEFAULT_TARGET.shotRelief)
  // 舊目標：鎖定 2、有免除；新目標：鎖定 0、折扣 1
  const crowd = 1 / (1 + DEFAULT_TARGET.crowdPenalty * 2 * (1 - relief))
  console.log(
    `${String(r).padStart(4)} m  ${threat.toFixed(3).padStart(12)}  ${(100 * relief).toFixed(0).padStart(4)}%`
    + `  ${crowd.toFixed(3).padStart(14)}  ${(1 / crowd).toFixed(2).padStart(9)} ×`,
  )
}
console.log(`\n免除完全生效的距離上限：${(THREAT_RANGE * (1 - DEFAULT_TARGET.shotRelief)).toFixed(0)} m`
  + `（機首完美對準時）—— 超過就開始塌`)
console.log('而實測那一群的舊目標距離中位是 837 m。')
