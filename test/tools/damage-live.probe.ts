/**
 * **真的打起來的時候，那五個部位倍率各自吃到多少？** 不是測試。
 *
 * 跑法：`npx vite-node test/tools/damage-live.probe.ts`
 *
 * 【為什麼不能只看 `damage-parts.probe.ts`】那一支打的是**均勻彈幕**，
 * 每個進場角度等權。真正的對局不是那樣 —— AI 絕大多數時間在尾追，而
 * 正後方那一欄的座艙是 0%。要知道「座艙 2.5 到底有沒有在運作」，得看
 * 實際發生的分佈。
 *
 * 【三個架數】模擬是全決定性的，單一場次只有一個樣本。拿到獨立實現的
 * 唯一辦法是換架數（見 encounter-balance.probe.ts 的同一段理由）。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, uniform } from '../../src/battle/skirmish'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { AiController } from '../../src/ai/AiController'
import { PART_MULTIPLIER, type HitPart } from '../../src/world/hit'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 420
const SEED = 20260807
const SIZES = [20, 12, 8]
const PARTS: readonly HitPart[] = ['cockpit', 'engine', 'tail', 'fuselage', 'wingLeft', 'wingRight']

const n = (v: number, w: number, d = 1): string =>
  (Number.isFinite(v) ? v.toFixed(d) : '—').padStart(w)

interface Row {
  hits: Map<HitPart, number>
  damage: Map<HitPart, number>
  /** 未套倍率的原始傷害，用來算實效倍率 —— 三種槍的單發傷害不同，
   *  拿命中數去除是錯的（MK 108 一發 250、M2 一發 18） */
  raw: number
  mult: number
  kills: number
  /** 每一次擊墜吃了幾發 */
  shotsPerKill: number[]
}

function run(size: number): Row {
  const b = createBattle(
    new AiController(),
    battleConfigFrom(uniform(P51D.id, size, BF109K4.id, size)),
    SEED,
  )
  const hits = new Map<HitPart, number>()
  const damage = new Map<HitPart, number>()
  const taken = new Map<number, number>()
  let raw = 0, mult = 0
  const shotsPerKill: number[] = []
  let kills = 0

  const w = b.world
  const orig = w.applyDamage.bind(w)
  w.applyDamage = (victim: Combatant, dmg: number, part: HitPart, shooter?: Combatant): void => {
    const before = victim.alive
    hits.set(part, (hits.get(part) ?? 0) + 1)
    damage.set(part, (damage.get(part) ?? 0) + dmg * PART_MULTIPLIER[part])
    raw += dmg
    mult += dmg * PART_MULTIPLIER[part]
    taken.set(victim.index, (taken.get(victim.index) ?? 0) + 1)
    orig(victim, dmg, part, shooter)
    if (before && !victim.alive) {
      kills++
      shotsPerKill.push(taken.get(victim.index) ?? 0)
      taken.set(victim.index, 0)
    }
  }

  for (let k = 0; k < Math.round(SECONDS / DT); k++) stepBattle(b, DT)
  return { hits, damage, kills, shotsPerKill, raw, mult }
}

console.log(`══ 實際對局裡的部位分佈（20v20 / 12v12 / 8v8、各 ${SECONDS} s）══`)
console.log('架數 欄位  ' + PARTS.map((p) => p.slice(0, 7).padStart(9)).join('')
  + '     合計')
const tot = { hits: new Map<HitPart, number>(), damage: new Map<HitPart, number>() }
let allKills = 0
let allRaw = 0, allMult = 0
const allShots: number[] = []
for (const size of SIZES) {
  const r = run(size)
  const h = [...r.hits.values()].reduce((a, x) => a + x, 0)
  const d = [...r.damage.values()].reduce((a, x) => a + x, 0)
  console.log(`${String(size).padStart(2)}v${size} 命中`
    + PARTS.map((p) => `${n(100 * (r.hits.get(p) ?? 0) / Math.max(1, h), 5, 1)}%`.padStart(9)).join('')
    + `  ${n(h, 8, 0)} 發`)
  console.log('     傷害'
    + PARTS.map((p) => `${n(100 * (r.damage.get(p) ?? 0) / Math.max(1, d), 5, 1)}%`.padStart(9)).join('')
    + `  ${n(d, 8, 0)}`)
  const spk = r.shotsPerKill.slice().sort((a, x) => a - x)
  console.log(`     擊墜 ${r.kills} 次，平均每次吃 `
    + `${n(spk.reduce((a, x) => a + x, 0) / Math.max(1, spk.length), 5, 1)} 發`
    + `（中位 ${n(spk[spk.length >> 1] ?? 0, 4, 0)}）`
    + `　實效倍率 ${n(r.mult / Math.max(1, r.raw), 5, 3)}`)
  for (const p of PARTS) {
    tot.hits.set(p, (tot.hits.get(p) ?? 0) + (r.hits.get(p) ?? 0))
    tot.damage.set(p, (tot.damage.get(p) ?? 0) + (r.damage.get(p) ?? 0))
  }
  allKills += r.kills
  allRaw += r.raw
  allMult += r.mult
  allShots.push(...r.shotsPerKill)
}
const H = [...tot.hits.values()].reduce((a, x) => a + x, 0)
const D = [...tot.damage.values()].reduce((a, x) => a + x, 0)
console.log('\n三場合計 命中'
  + PARTS.map((p) => `${n(100 * (tot.hits.get(p) ?? 0) / H, 5, 1)}%`.padStart(9)).join('')
  + `  ${n(H, 8, 0)} 發`)
console.log('         傷害'
  + PARTS.map((p) => `${n(100 * (tot.damage.get(p) ?? 0) / D, 5, 1)}%`.padStart(9)).join('')
  + `  ${n(D, 8, 0)}`)
console.log(`\n擊墜 ${allKills} 次。**實效倍率 ${n(allMult / allRaw, 5, 3)}**`
  + `　—— 五個倍率（0.7…2.5、跨距 3.6 倍）合起來只把傷害改變了`
  + ` ${n(100 * (allMult / allRaw - 1), 5, 1)}%。`)
console.log(`平均每次擊墜吃 `
  + `${n(allShots.reduce((a, x) => a + x, 0) / Math.max(1, allShots.length), 5, 1)} 發`)
