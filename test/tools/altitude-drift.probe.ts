/**
 * **AI 會不會一路往上飄？誰造成的？** **不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/altitude-drift.probe.ts
 *
 * 【起因】專案負責人回報「很常在 5000 m 以下就開始拉到 6000 m」，並懷疑
 * 是不是有人把 P-51 的偏好高度設在 5000~6000。
 *
 * **程式裡沒有任何高度目標** —— AI 那一層唯一的高度特徵是
 * `DEFAULT_STEER.clearanceScale`（500 m），而它只在離地 500 m 以下作用。
 * 所以若真的有往上飄，那是**湧現**的，要找出是哪一層造成的。
 *
 * 【兩個嫌疑】
 *
 *   甜蜜區 `sweetSpotPitch`  它找的是**速度**，但手段是**俯仰** ——
 *                            想減速就抬頭，而抬頭就是爬升。若它系統性地
 *                            想減速，AI 就會一路往上飄
 *   垂直旋鈕 `engageKnobs`   接近速度高時給正的 vertical（高 yo-yo 往上）。
 *                            大家都想爬到對方頭上 → 互相加價
 *
 * 【為什麼這件事要緊 —— 它會回頭放大 extend 的問題】角落速度隨高度上升：
 *
 * ```
 *   3000 m  426 km/h        5000 m  473 km/h        6000 m  500 km/h
 * ```
 *
 * 而 `cornerRatio = TAS ÷ 角落速度`。**飛得越高，同樣的空速被判定成越沒
 * 能量**，於是 `extend` 觸發得更頻繁。往上飄與「一直想補能量」可能是同一
 * 個迴圈的兩端。
 *
 * 【消融】甜蜜區用 `sweetSpotMaxPitch = 0` 關掉（那一層的輸出恆為 0，等於
 * 不存在）。垂直旋鈕沒有乾淨的開關，所以只量、不消融。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_DOCTRINE } from '../../src/ai/doctrine'
import { cornerSpeed } from '../../src/analysis/envelope'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import { P51D } from '../../src/specs/p51d'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 420
const STRIDE = 240 // 每秒一次
/** 每隔幾秒印一列 */
const REPORT = 60

interface Sample {
  t: number
  altMedian: number
  ratioMedian: number
  /** 甜蜜區偏置的平均，度。正 = 要求抬頭 */
  sweetDeg: number
  extendShare: number
}

function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

function run(sweetOn: boolean, startAlt: number): Sample[] {
  const saved = DEFAULT_DOCTRINE.sweetSpotMaxPitch
  if (!sweetOn) DEFAULT_DOCTRINE.sweetSpotMaxPitch = 0
  try {
    const cfg = { ...battleConfigFrom(DEFAULT_SKIRMISH), altitude: startAlt, tas: 200 }
    const b = createBattle(new AiController(), cfg, 20260813)
    const cs: Combatant[] = b.world.combatants
    const out: Sample[] = []
    let t = 0
    let acc = 0
    const alts: number[] = []
    const ratios: number[] = []
    let sweetSum = 0
    let sweetN = 0
    let extendN = 0
    let liveN = 0
    for (let s = 0; s < Math.round(SECONDS / DT); s++) {
      stepBattle(b, DT)
      t += DT
      if (s % STRIDE !== 0) continue
      for (const c of cs) {
        if (!c.alive) continue
        const ai = c.controller
        if (!(ai instanceof AiController)) continue
        alts.push(c.aircraft.state.position.y)
        ratios.push(ai.sit.cornerRatio)
        sweetSum += ai.sit.sweetPitch * (180 / Math.PI)
        sweetN++
        liveN++
        if (ai.intent === 'extend') extendN++
      }
      acc += STRIDE * DT
      if (acc >= REPORT) {
        out.push({
          t,
          altMedian: median(alts),
          ratioMedian: median(ratios),
          sweetDeg: sweetSum / Math.max(sweetN, 1),
          extendShare: extendN / Math.max(liveN, 1),
        })
        acc = 0; alts.length = 0; ratios.length = 0
        sweetSum = 0; sweetN = 0; extendN = 0; liveN = 0
      }
    }
    return out
  } finally {
    DEFAULT_DOCTRINE.sweetSpotMaxPitch = saved
  }
}

const SPEC = applyFeel(P51D, GAME_FEEL)
console.log('20v20、420 秒、VETERAN。P-51 的角落速度隨高度（km/h）：')
console.log('  ' + [3000, 4000, 5000, 6000, 7000]
  .map((a) => `${a}m ${(cornerSpeed(SPEC, a) * 3.6).toFixed(0)}`).join('　'))
console.log('')

for (const startAlt of [4000, 2000]) {
  for (const sweetOn of [true, false]) {
    console.log(`── 開局 ${startAlt} m　甜蜜區 ${sweetOn ? '開' : '**關**'} ──`)
    console.log('    t     高度中位   cornerRatio中位   甜蜜區偏置   extend佔時')
    for (const s of run(sweetOn, startAlt)) {
      console.log(
        `  ${s.t.toFixed(0).padStart(3)}s   `
        + `${s.altMedian.toFixed(0).padStart(6)} m   `
        + `${s.ratioMedian.toFixed(3).padStart(10)}   `
        + `${(s.sweetDeg >= 0 ? '+' : '') + s.sweetDeg.toFixed(2)}°`.padStart(11) + '   '
        + `${(s.extendShare * 100).toFixed(1).padStart(5)}%`,
      )
    }
    console.log('')
  }
}

console.log('【怎麼讀】')
console.log('　高度中位隨時間單調上升 → 真的有往上飄。')
console.log('　甜蜜區「關」之後飄幅明顯變小 → 是甜蜜區造成的。')
console.log('　兩者都飄 → 是垂直旋鈕（互相爬到對方頭上）或別的層，甜蜜區無辜。')
console.log('　【關鍵連動】高度上升 → 角落速度上升 → cornerRatio 下降 → extend 佔時上升。')
console.log('　　若這四欄同向移動，往上飄與「一直想補能量」就是同一個迴圈。')
