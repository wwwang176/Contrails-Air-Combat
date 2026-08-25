/**
 * 「在哪個 (高度, 速度) 我贏得過他」的優勢圖。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/advantage-map.probe.ts
 *
 * 【為什麼一定要相對而不是絕對】兩台的**絕對**最佳持續轉彎幾乎相同
 * （4000 m：P-51 29.3°/s @370、109 29.5°/s @358）。用「我自己表現最好的
 * 地方」定義甜蜜區，兩台會得到幾乎一樣的框，什麼也分不出來。
 * 差異只存在於相對比較。
 *
 * 【三個量分開印，不先合成】要先看它們**同不同意**。若三者的分界線落在
 * 同一處，那個框就是穩固的、用哪一個量都行；若彼此矛盾，合成出來的分數
 * 只會把矛盾藏起來。
 */
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { GAME_FEEL, applyFeel } from '../../src/specs/feel'
import {
  sustainedTurnRate, maxRollRate, specificExcessPower, maxLoadFactorAero,
} from '../../src/analysis/envelope'
import type { AircraftSpec } from '../../src/specs/types'

const KMH = 3.6
const DEG = 180 / Math.PI
const P = applyFeel(P51D, GAME_FEEL)
const B = applyFeel(BF109K4, GAME_FEEL)

const ALTS = [0, 2000, 4000, 6000, 8000, 10000]
const SPEEDS = [300, 350, 400, 450, 500, 550, 600, 650]

/** 正 = P-51 佔優 */
function grid(name: string, f: (s: AircraftSpec, alt: number, v: number) => number, unit: string) {
  console.log(`\n=== ${name}（正 = P-51 佔優，${unit}）===`)
  console.log('高度\\速度 ' + SPEEDS.map((k) => String(k).padStart(7)).join(''))
  for (const alt of ALTS) {
    const cells = SPEEDS.map((kmh) => {
      const v = kmh / KMH
      const d = f(P, alt, v) - f(B, alt, v)
      return d.toFixed(1).padStart(7)
    })
    console.log(`${String(alt).padStart(6)} m ` + cells.join(''))
  }
}

grid('持續迴旋率', (s, a, v) => sustainedTurnRate(s, a, v) * DEG, '°/s')
grid('滾轉率', (s, a, v) => maxRollRate(s, a, v) * DEG, '°/s')
grid('1G 比余功率', (s, a, v) => specificExcessPower(s, a, v, 1), 'm/s')

// 纏鬥時真正在付的代價：4 G 下的比余功率
grid('4G 比余功率', (s, a, v) => {
  const n = Math.min(maxLoadFactorAero(s, a, v), s.limits.gPositive, 4)
  return specificExcessPower(s, a, v, n)
}, 'm/s')

console.log('\n\n=== 三個量的分界線同不同意？（正負號一致的格子比例）===')
let agree = 0
let total = 0
const disagreeCells: string[] = []
for (const alt of ALTS) {
  for (const kmh of SPEEDS) {
    const v = kmh / KMH
    const t = sustainedTurnRate(P, alt, v) - sustainedTurnRate(B, alt, v)
    const r = maxRollRate(P, alt, v) - maxRollRate(B, alt, v)
    const e = specificExcessPower(P, alt, v, 1) - specificExcessPower(B, alt, v, 1)
    const signs = [Math.sign(t), Math.sign(r), Math.sign(e)]
    total++
    if (signs[0] === signs[1] && signs[1] === signs[2]) agree++
    else disagreeCells.push(`${alt}m/${kmh}: 迴旋${signs[0]! > 0 ? '+' : '−'} 滾轉${signs[1]! > 0 ? '+' : '−'} 能量${signs[2]! > 0 ? '+' : '−'}`)
  }
}
console.log(`一致 ${agree}/${total}（${(agree / total * 100).toFixed(0)}%）`)
console.log('不一致的格子：')
for (const c of disagreeCells) console.log(`  ${c}`)

console.log('\n\n=== 每個高度的「翻轉速度」（持續迴旋率由 109 優轉為 P-51 優）===')
for (const alt of ALTS) {
  let flip = -1
  for (let kmh = 250; kmh <= 700; kmh += 1) {
    const v = kmh / KMH
    if (sustainedTurnRate(P, alt, v) > sustainedTurnRate(B, alt, v)) { flip = kmh; break }
  }
  console.log(`${String(alt).padStart(6)} m  ${flip > 0 ? `${flip} km/h` : '全速度帶 109 優'}`)
}
