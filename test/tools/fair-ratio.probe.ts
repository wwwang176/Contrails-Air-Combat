/**
 * **公平對照組的傷害比：拆尾翼盒之前 vs 之後，四種架數 × 兩種機種。**
 * 不是測試。跑法：`npx vite-node test/tools/fair-ratio.probe.ts`
 *
 * 【為什麼要這一支】拆尾翼盒有沒有把鏡像對戰的傷害比推歪，要先分清楚是
 * **系統性偏斜**還是**單一場次的極值統計**。模擬是全決定性的，單一場次
 * 只有一個樣本；拿到獨立實現的唯一辦法是換架數。這一支跑 20 / 16 / 12 / 8
 * 四種架數 × P-51 對 P-51 與 K-4 對 K-4 兩種鏡像，**新舊盒各跑一遍**。
 *
 * 【對照組怎麼來的】把 `spec.hitBoxes` 換成拆盒前那一個尾翼 AABB。其餘
 * 完全相同（同一個種子、同一份編組表），所以兩邊的差只來自命中盒。
 */
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { HEAD_ON } from '../../src/battle/entry'
import { lineAbreast } from '../../src/battle/order'
import { AiController } from '../../src/ai/AiController'
import { makeHitBox, type HitBox } from '../../src/world/hit'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import type { AircraftSpec } from '../../src/specs/types'

const DT = 1 / 240
const SECONDS = 150
const SIZES = [20, 16, 12, 8]

/** 對照組：尾翼拆盒之前的那一個 AABB。 */
const OLD_TAIL: Record<string, HitBox> = {
  p51d: makeHitBox('tail', [-1.98, -0.31, 4.40], [1.98, 1.93, 6.58]),
  bf109k4: makeHitBox('tail', [-1.66, -0.18, 4.50], [1.66, 1.46, 6.07]),
}

/** 換掉某台的尾翼盒，回傳還原用的函式。 */
function withOldTail(spec: AircraftSpec): () => void {
  const arr = spec.hitBoxes as HitBox[]
  const saved = arr.slice()
  const rest = saved.filter((b) => b.part !== 'tail')
  arr.length = 0
  arr.push(...rest, OLD_TAIL[spec.id]!)
  return () => { arr.length = 0; arr.push(...saved) }
}

function ratio(spec: AircraftSpec, size: number): { blue: number; red: number } {
  const b = createBattle(new AiController(), {
    ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, spec, size, spec, size),
  })
  const cs = b.world.combatants
  const prev = new Float64Array(cs.length)
  for (let i = 0; i < cs.length; i++) prev[i] = cs[i]!.hp
  let blue = 0, red = 0
  for (let k = 0; k < SECONDS / DT; k++) {
    stepBattle(b, DT)
    for (const c of cs) {
      const drop = prev[c.index]! - c.hp
      if (drop > 0) { if (c.team === b.blue[0]?.team) blue += drop; else red += drop }
      prev[c.index] = c.hp
    }
  }
  return { blue, red }
}

const n = (v: number, w: number, d = 2): string => v.toFixed(d).padStart(w)
console.log('══ 公平對照組的傷害比（同機種、150 s）══')
console.log('機種      架數     舊盒 藍:紅         比值      新盒 藍:紅         比值')
for (const spec of [P51D, BF109K4]) {
  for (const size of SIZES) {
    const restore = withOldTail(spec)
    const a = ratio(spec, size)
    restore()
    const b = ratio(spec, size)
    const r = (x: { blue: number; red: number }): number =>
      Math.max(x.blue, x.red) / Math.max(1, Math.min(x.blue, x.red))
    console.log(`${spec.id.padEnd(9)} ${String(size).padStart(2)}v${size}`
      + `  ${n(a.blue, 8, 0)}:${n(a.red, 7, 0)}  ${n(r(a), 8)}`
      + `  ${n(b.blue, 8, 0)}:${n(b.red, 7, 0)}  ${n(r(b), 8)}`)
  }
}
console.log('\n【怎麼讀】八組都往同一側跑＝系統性偏斜，要退回或修正。')
console.log('來回跳＝極值統計，那條門檻量的場景本來就不穩，與拆盒無關。')
