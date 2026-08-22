/**
 * **`extend` 命令低頭，飛機為什麼在爬？** **不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/extend-pitch.probe.ts
 *
 * 【承接 `climb-blame.probe.ts`】高度歸戶的結果是「每一種意圖都在爬」，
 * 而最不合理的一列是 `extend`：它是**補能量**的模式，卻每秒淨爬升 4.2 m。
 *
 * `extendPitchAngle` 的算式是
 * `−pitchSpeedGain × (1 − cornerRatio) + pitchAltitudeGain × altitudeDeficit`，
 * `pitchSpeedGain = 4 × EXTEND_PITCH`。`cornerRatio` 0.9 時應該命令 −10°
 * （低頭）；高空時 `altitudeDeficit` 恆為 0，所以那一項不會抵銷。
 *
 * 【要分辨的兩件事，修法完全相反】
 *
 *   命令就是正的  → `extendPitchAngle` 或它的輸入有問題
 *   命令是負的但航跡角是正的 → 飛機**做不到** —— 那是指揮儀／拉桿紀律／
 *                              時間不夠的問題，不是俯仰政策的問題
 *
 * 【量三個角度，全部是相對地平線的航跡角】
 *
 *   命令      `extendPitchAngle(cornerRatio, speedAdvantage, clearance, cfg)`
 *   進入當下  進入 `extend` 那一格的實際航跡角
 *   當下      每個物理步的實際航跡角
 *
 * 「進入當下」是關鍵：若 AI 總是在**已經爬得很陡**的時候才進 extend，而
 * 一段 extend 中位只有 3.6 秒，那它根本來不及把機頭壓下來 —— 那時該修的
 * 是「太晚進 extend」或「太早被打斷」，不是俯仰角。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_STEER, extendPitchAngle } from '../../src/ai/steer'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 420
const RAD = 180 / Math.PI
const START_ALT = 2000

function gammaOf(c: Combatant): number {
  const v = c.aircraft.state.velocity
  const sp = v.length()
  return sp > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, v.y / sp))) * RAD : 0
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))
  return sorted[i]!
}
const show = (name: string, xs: number[], unit = '°') => {
  const s = [...xs].sort((a, b) => a - b)
  console.log(
    `  ${name.padEnd(26)} 中位 ${pct(s, 0.5).toFixed(1).padStart(6)}${unit}　`
    + `p10 ${pct(s, 0.1).toFixed(1).padStart(6)}${unit}　`
    + `p90 ${pct(s, 0.9).toFixed(1).padStart(6)}${unit}　`
    + `>0 的比例 ${(s.filter((x) => x > 0).length / Math.max(s.length, 1) * 100).toFixed(0)}%`,
  )
}

const b = createBattle(
  new AiController(),
  { ...battleConfigFrom(DEFAULT_SKIRMISH), altitude: START_ALT, tas: 200 },
  20260813,
)
const cs: Combatant[] = b.world.combatants

/** 撤退期間每個取樣點的「命令角度」與「實際航跡角」 */
const commanded: number[] = []
const actual: number[] = []
/** 進入 extend 那一格的航跡角 */
const atEntry: number[] = []
/** 進入 extend 那一格的 cornerRatio */
const ratioAtEntry: number[] = []
/** 每一段 extend 結束時的航跡角 */
const atExit: number[] = []
const wasExtend = new Uint8Array(cs.length)

for (let s = 0; s < Math.round(SECONDS / DT); s++) {
  stepBattle(b, DT)
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    const ai = c.controller
    if (!(ai instanceof AiController)) continue
    const now = c.alive && ai.intent === 'extend' ? 1 : 0
    if (now === 1) {
      if (wasExtend[i] === 0) {
        atEntry.push(gammaOf(c))
        ratioAtEntry.push(ai.sit.cornerRatio)
      }
      // 【每 24 步取樣一次就夠】這幾個是分佈，不是事件
      if (s % 24 === 0) {
        const clearance = c.aircraft.state.position.y - ai.seaHeight
        commanded.push(extendPitchAngle(ai.sit.cornerRatio, ai.sit.speedAdvantage, clearance, DEFAULT_STEER) * RAD)
        actual.push(gammaOf(c))
      }
    } else if (wasExtend[i] === 1 && c.alive) {
      atExit.push(gammaOf(c))
    }
    wasExtend[i] = now
  }
}

console.log(`20v20、${SECONDS} 秒、VETERAN、開局 ${START_ALT} m。`)
console.log(`extend 段數 ${atEntry.length}，撤退期間取樣 ${commanded.length}\n`)

console.log('── 撤退期間（每 0.1 s 取樣）──')
show('extendPitchAngle 命令', commanded)
show('實際航跡角', actual)
console.log('')
console.log('── 每一段的頭尾 ──')
show('進入 extend 當下的航跡角', atEntry)
show('離開 extend 當下的航跡角', atExit)
show('進入時的 cornerRatio', ratioAtEntry, '')

console.log('\n【怎麼讀】')
console.log('　命令中位是負的、實際中位是正的 → 命令對，飛機做不到。')
console.log('　　那時看「進入當下的航跡角」：若它已經很正（正在爬），')
console.log('　　而一段 extend 中位只有 3.6 秒 —— 就是來不及壓下來。')
console.log('　命令中位本身就是正的 → extendPitchAngle 或它的輸入壞了。')
