/**
 * `manoeuvreGFraction` 的掃描 —— **讓所有能量判準一起平移**。
 * **不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/manoeuvre-g.probe.ts
 *
 * 【與 `extend-threshold.probe.ts` 的差別，這是本支存在的理由】那一支只搬
 * `cornerEnter`/`cornerExit` 一個門檻，結果 AI「不撤了」但其他四層仍然用
 * 8 G 的分母把它當低能量對待，兩邊打架 —— 實測安全層佔時衝到 65.6%
 * （上限 5%），被否決。
 *
 * 這一支改的是**分母本身**，所以下列全部一起平移：
 *
 * ```
 *   rules.ts    cornerEnter / cornerExit      要不要放棄追擊
 *   doctrine.ts energyFloorRatio              拉桿上限
 *   steer.ts    brakeCornerRatio              要不要減速
 *   steer.ts    extendPitchAngle 的速度增益   低頭換速的量
 *   command.ts  spentRatio / ENGAGED_RATIO    指揮層的見底與已交戰
 * ```
 *
 * 【方向不一致，所以不能只看 extend】ratio 變大之後：
 *
 *   cornerEnter    較少觸發 → 少放棄追擊　　　　　**要的**
 *   energyFloorRatio 較少限制 → 拉更猛　　　　　　**危險**
 *   extendPitchAngle 較少低頭換速　　　　　　　　 **危險**
 *   brakeCornerRatio 更常減速　　　　　　　　　　 反效果
 *
 * 後三者正是上一次炸掉 `safetyShare` 的方向，所以**這一支一定要量安全層**。
 * `safetyShare` 是主否決條件，不是附註。
 *
 * 【1.0 是恆等基準】`manoeuvreGFraction = 1` 時 `manoeuvreSpeed` 就是
 * `cornerSpeed`，行為與 2026-08-13 之前逐位元相同。表的第一列若與既有紀錄
 * 對不上，那是量具壞了，不是改動有效。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_DOCTRINE } from '../../src/ai/doctrine'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 300
const STRIDE = 24

const OPENINGS = [
  { name: '4000/200', altitude: 4000, tas: 200 },
  { name: '5500/150', altitude: 5500, tas: 150 },
]

interface Row {
  share: Map<string, number>
  samples: number
  safety: number
  belowStall: number
  ratioSum: number
  tasSum: number
  blueAlive: number
  redAlive: number
  damage: number
  extendEntries: number
}

function run(fraction: number, opening: typeof OPENINGS[number]): Row {
  const saved = DEFAULT_DOCTRINE.manoeuvreGFraction
  DEFAULT_DOCTRINE.manoeuvreGFraction = fraction
  try {
    const cfg = {
      ...battleConfigFrom(DEFAULT_SKIRMISH),
      altitude: opening.altitude,
      tas: opening.tas,
    }
    const b = createBattle(new AiController(), cfg, 20260813)
    const cs: Combatant[] = b.world.combatants
    const hp0 = cs.map((c) => c.hp)
    const r: Row = {
      share: new Map(), samples: 0, safety: 0, belowStall: 0, ratioSum: 0, tasSum: 0,
      blueAlive: 0, redAlive: 0, damage: 0, extendEntries: 0,
    }
    const prev: string[] = cs.map(() => '')
    for (let s = 0; s < Math.round(SECONDS / DT); s++) {
      stepBattle(b, DT)
      if (s % STRIDE !== 0) continue
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i]!
        if (!c.alive) continue
        const ai = c.controller
        if (!(ai instanceof AiController)) continue
        r.samples++
        r.share.set(ai.intent, (r.share.get(ai.intent) ?? 0) + 1)
        // 【主否決條件】安全層在替 AI 飛的比例
        if (ai.safetyAction !== 'none') r.safety++
        if (ai.sit.stallMargin < 1) r.belowStall++
        r.ratioSum += ai.sit.cornerRatio
        r.tasSum += c.aircraft.diag.aero.tas * 3.6
        if (ai.intent === 'extend' && prev[i] !== 'extend') r.extendEntries++
        prev[i] = ai.intent
      }
    }
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      r.damage += Math.max(0, hp0[i]! - c.hp)
      if (!c.alive) continue
      if (b.blue.includes(c)) r.blueAlive++
      else r.redAlive++
    }
    return r
  } finally {
    DEFAULT_DOCTRINE.manoeuvreGFraction = saved
  }
}

const pct = (n: number, d: number) => (n / Math.max(d, 1) * 100)
const sh = (r: Row, k: string) => pct(r.share.get(k) ?? 0, r.samples)

console.log(`20v20、${SECONDS} 秒、VETERAN、兩個開局。P-51 的 gPositive = 8\n`)
console.log('倍率(=幾G)  開局      extend  engage  approach ｜ **安全層**  失速  ｜ ratio  TAS  ｜ 存活 B:R  傷害')

for (const f of [1.0, 0.75, 0.625, 0.5]) {
  for (const o of OPENINGS) {
    const r = run(f, o)
    console.log(
      `${f.toFixed(3)}(${(8 * f).toFixed(1)}G) ${o.name.padStart(8)}  `
      + `${sh(r, 'extend').toFixed(1).padStart(5)}%  `
      + `${sh(r, 'engage').toFixed(1).padStart(5)}%  `
      + `${sh(r, 'approach').toFixed(1).padStart(6)}%  ｜ `
      + `${pct(r.safety, r.samples).toFixed(2).padStart(6)}%  `
      + `${pct(r.belowStall, r.samples).toFixed(2).padStart(5)}%  ｜ `
      + `${(r.ratioSum / Math.max(r.samples, 1)).toFixed(2)} `
      + `${(r.tasSum / Math.max(r.samples, 1)).toFixed(0).padStart(4)} ｜ `
      + `${String(r.blueAlive).padStart(3)}:${String(r.redAlive).padEnd(3)} `
      + `${r.damage.toFixed(0).padStart(6)}`,
    )
  }
}
console.log('\n【怎麼讀】1.000 是恆等基準，與改動前相同。')
console.log('　　　　　主判準：extend 降、engage 升。')
console.log('　　　　　**主否決條件：安全層佔時**。上一次的失敗就是它衝到 65.6%（1v1 上限 5%）。')
console.log('　　　　　20v20 的安全層佔時與 ai-manoeuvre 的 1v1 不同場景，數值不可直接比 ——')
console.log('　　　　　看的是**相對於 1.000 有沒有惡化**。真正的裁定要跑 ai-manoeuvre。')
