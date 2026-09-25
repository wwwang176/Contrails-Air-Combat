/**
 * **20v20 打滿 150 秒，兩隊各自吃了多少傷害。**
 * 不是測試（`.probe.ts`）。跑法：npx vite-node test/tools/fair-damage.probe.ts
 *
 * 【為什麼這是探針而不是護欄】傷害比是**整場仗的結果**，取決於玩起來
 * 順不順，不是某一段程式的契約。跨機種的比值更是混沌量 —— 12 組不同架數
 * 裡，完全沒被改過的基線都有 3 組超過 3 倍（最差 50 倍）。把它寫成門檻，
 * 紅了指不出是哪裡壞了，而任何一次手感微調都會讓它亂跳。
 *
 * 判「AI 打得合不合理」是試飛的事。程式的契約由各自的機制測試守：
 * 目標選擇與鎖定計數看 `test/unit/ai-target.test.ts`，彈道與傷害看
 * `test/integration/hit-matrix.test.ts`。
 *
 * ── 【看同機種那一行，不要看跨機種那一行】───────────────────
 *
 * `DEFAULT_BATTLE` 的預設場景有**兩個結構性偏差**，方向相反、在 20v20
 * 剛好互相抵銷，於是任何 AI 改動都會擾動這個抵銷，比值大幅跳動：
 *
 *   1. 兩隊飛不同的飛機。把機種對調，優勢跟著換邊：
 *
 *        P51 對 109   20v20 比 1.5 藍優　12v12 比 2.6 藍優　8v8 比 3.7 紅優
 *        109 對 P51   20v20 比 1.7 紅優　12v12 比 2.6 紅優　8v8 比 3.1 紅優
 *
 *      **贏的永遠是開 P-51 的那一隊** —— 量到的主要是機種平衡。
 *
 *   2. 藍隊有一架平飛的玩家佔位機，等於 19 打 20。鏡像機種下看得很清楚：
 *      109 對 109 三種架數全部紅方贏（比 2.9 / 3.2 / 3.6）。
 *
 * 同機種、雙方都不缺人的那一組穩定得多：
 *
 *   P51 對 P51   20v20 1.20　16v16 1.37　12v12 1.48　8v8 1.58
 *   109 對 109   20v20 1.45　16v16 1.04　12v12 2.12　8v8 1.39
 *
 * 八組全部低於 3 倍，最大 2.12。**調完手感想知道有沒有歪掉，看這一行。**
 */
import {
  createBattle, stepBattle, DEFAULT_BATTLE, type Battle,
} from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { AiController } from '../../src/ai/AiController'
import type { AircraftSpec } from '../../src/specs/types'

const DT = 1 / 240
const SECONDS = 150

/** 兩隊各自**掉**的血。只累計下降量 —— 重置會把 hp 補回去 */
function damageTaken(blueSpec: AircraftSpec, redSpec: AircraftSpec): [number, number] {
  const b: Battle = createBattle(new AiController(), {
    ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, blueSpec, 20, redSpec, 20),
  })
  const cs = b.world.combatants
  const prev = new Float64Array(cs.length)
  for (let i = 0; i < cs.length; i++) prev[i] = cs[i]!.hp
  let blue = 0
  let red = 0
  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      const drop = prev[i]! - c.hp
      if (drop > 0) {
        if (b.blue.includes(c)) blue += drop
        else red += drop
      }
      prev[i] = c.hp
    }
  }
  return [blue, red]
}

function report(name: string, blueSpec: AircraftSpec, redSpec: AircraftSpec): void {
  const [blue, red] = damageTaken(blueSpec, redSpec)
  const lo = Math.min(blue, red)
  const hi = Math.max(blue, red)
  console.log(
    `${name.padEnd(16)} 藍 ${blue.toFixed(0).padStart(6)}`
    + ` / 紅 ${red.toFixed(0).padStart(6)}`
    + `　比值 ${(hi / Math.max(1, lo)).toFixed(2)}`,
  )
}

report('公平對照（同機種）', P51D, P51D)
report('P-51 對 Bf 109', P51D, BF109K4)
