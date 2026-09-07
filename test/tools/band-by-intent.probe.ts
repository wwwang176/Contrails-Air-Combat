/**
 * **空層鎖（`stepBand`）在哪些意圖底下真的生效。**
 * 不是測試（`.probe.ts`）。跑法：npx vite-node test/tools/band-by-intent.probe.ts
 *
 * 【它回答的問題】「平飛鎖住高度接近、敵人在下方就壓機頭」那個打法還在不在。
 * `stepBand` 的 `active` 只在 `engage` / `approach` / `merge` 成立，`extend`
 * 期間完全不動 —— 所以 `extend` 佔時越高，這一層死得越久。
 *
 * 【`dive` 走法可能一次都不觸發】它要求高度優勢超過 `bandDiveGap`（1200 m）。
 * 迴旋吃虧的機種對達不到，所以「壓低機頭」實際上是 `level` 走法加上
 * 「敵人在下方時空層貼著他那層走」（`state.altitude = min(anchor, chaseAlt)`）。
 * 看到 `dive 0.0%` 不是壞掉。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, uniform } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { INTENTS, type Intent } from '../../src/ai/rules'
import type { BandKind } from '../../src/ai/steer'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 300
const SEED = 20260907
const KINDS: BandKind[] = ['off', 'level', 'zoom', 'dive']

function run(blue: string, red: string, n: number) {
  const b = createBattle(new AiController(), battleConfigFrom(uniform(blue, n, red, n)), SEED)
  const cs: Combatant[] = b.world.combatants
  const isBlue = cs.map(c => b.blue.includes(c))
  const kind: Record<string, number> = {}
  for (const k of KINDS) kind[k] = 0
  const byIntent: Record<string, [number, number]> = {}
  for (const i of INTENTS) byIntent[i] = [0, 0]
  let alive = 0
  for (let s = 0; s < Math.round(SECONDS / DT); s++) {
    stepBattle(b, DT)
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      const a = c.controller
      if (!(a instanceof AiController) || !c.alive || !isBlue[i]) continue
      alive += DT
      kind[a.band.kind] = (kind[a.band.kind] ?? 0) + DT
      const e = byIntent[a.intent as Intent]!
      e[0] += DT
      if (a.band.kind !== 'off') e[1] += DT
    }
  }
  return { alive, kind, byIntent }
}

const P = (x: number, a: number) => `${(100 * x / Math.max(1e-9, a)).toFixed(1).padStart(5)}%`
for (const [bl, rd] of [['f4f4', 'a6m5'], ['f4f4', 'f4f4']] as [string, string][]) {
  for (const n of [4, 20]) {
    const x = run(bl, rd, n)
    console.log(`\n══ ${bl} vs ${rd}、${n}v${n} ══`)
    console.log('  走法佔時：' + KINDS.map(k => `${k} ${P(x.kind[k] ?? 0, x.alive)}`).join('   '))
    console.log('  各意圖底下 band 有沒有作用：')
    for (const i of INTENTS) {
      const [t, on] = x.byIntent[i]!
      if (t < 1) continue
      console.log(`    ${i.padEnd(9)} 佔時 ${P(t, x.alive)}   其中 band 生效 ${P(on, t)}`)
    }
  }
}
