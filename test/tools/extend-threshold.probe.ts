/**
 * `extend`（放棄追擊、撤下來補能量）門檻的掃描。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/extend-threshold.probe.ts
 *
 * 【問題】實機回報「明明在追擊敵人，卻很常放棄追擊改平累積能量，
 * 頻率滿高的」。`rules.ts` 的判準是 `cornerRatio < cornerEnter(0.75)` 觸發、
 * `> cornerExit(0.95)` 解除，而 `cornerRatio = TAS ÷ 角落速度`。
 *
 * 【為什麼門檻可疑】角落速度的定義是 `stallSpeed(spec, alt, gPositive)` ——
 * 拉得出**結構極限 8 G** 的最低速度。空戰實際用的是 3~5 G。5000 m 換算：
 *
 * ```
 *   角落速度(8G)  473 km/h
 *   放棄追擊      355 km/h   ← 0.75 ×
 *   才准回來      449 km/h   ← 0.95 ×
 * ```
 *
 * 而實機 log 的交戰速度帶是 250~470 km/h —— **遲滯帶整段夾在交戰速度的
 * 正中央**，所以每一次轉彎掉速都會踩到它。
 *
 * 【量什麼】每組門檻跑同一場 20v20，記錄：
 *
 *   意圖佔時       `extend` 應該降、`engage` 應該升。這是主判準
 *   總傷害         打得激不激烈。降太多表示大家都在互相閃避
 *   擊落數         真的分出勝負了沒
 *   cornerRatio    速度帶本身有沒有被推高（門檻放寬會不會讓 AI 一直低速泡著）
 *
 * 【為什麼跑 VETERAN 而不是 ACE】`DEFAULT_BATTLE` 用 `ACE`（零反應延遲），
 * 玩家實際玩到的是 `VETERAN`。護欄全部跑在 ACE 上，那正是記下
 * 的缺陷丙。這一支要回答的是玩家的觀察，所以跑玩家的配置。
 *
 * 【一組門檻跑兩個開局】種子不進物理路徑（只取飛行員名字），所以誤差棒
 * 要靠改**開局**：兩組不同的初始高度與速度。改動的效果若比開局差異還小，
 * 那就不是效果。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_RULES } from '../../src/ai/rules'
import type { Intent } from '../../src/ai/rules'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 420
const STRIDE = 24

interface Row {
  share: Map<string, number>
  samples: number
  ratioSum: number
  tasSum: number
  blueAlive: number
  redAlive: number
  damage: number
  /** `extend` 的進入次數。佔時高有兩種成因：進得多、或每次都很長 */
  extendEntries: number
  extendSecondsMax: number
}

/** 兩個開局：高度與初速。名字只用來印表 */
const OPENINGS = [
  { name: '4000/200', altitude: 4000, tas: 200 },
  { name: '5500/150', altitude: 5500, tas: 150 },
]

function run(enter: number, exit: number, opening: typeof OPENINGS[number]): Row {
  const savedEnter = DEFAULT_RULES.cornerEnter
  const savedExit = DEFAULT_RULES.cornerExit
  DEFAULT_RULES.cornerEnter = enter
  DEFAULT_RULES.cornerExit = exit
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
      share: new Map(), samples: 0, ratioSum: 0, tasSum: 0,
      blueAlive: 0, redAlive: 0, damage: 0, extendEntries: 0, extendSecondsMax: 0,
    }
    const prevIntent: Intent[] = cs.map(() => 'approach')
    const extendSince = new Float64Array(cs.length)
    let t = 0
    for (let s = 0; s < Math.round(SECONDS / DT); s++) {
      stepBattle(b, DT)
      t += DT
      if (s % STRIDE !== 0) continue
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i]!
        if (!c.alive) continue
        const ai = c.controller
        if (!(ai instanceof AiController)) continue
        r.samples++
        r.share.set(ai.intent, (r.share.get(ai.intent) ?? 0) + 1)
        r.ratioSum += ai.sit.cornerRatio
        r.tasSum += c.aircraft.diag.aero.tas * 3.6
        if (ai.intent === 'extend' && prevIntent[i] !== 'extend') {
          r.extendEntries++
          extendSince[i] = t
        } else if (ai.intent !== 'extend' && prevIntent[i] === 'extend') {
          const held = t - extendSince[i]!
          if (held > r.extendSecondsMax) r.extendSecondsMax = held
        }
        prevIntent[i] = ai.intent
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
    DEFAULT_RULES.cornerEnter = savedEnter
    DEFAULT_RULES.cornerExit = savedExit
  }
}

const pct = (r: Row, k: string) => (r.share.get(k) ?? 0) / Math.max(r.samples, 1) * 100

console.log(`20v20、${SECONDS} 秒、VETERAN、兩個開局（高度/初速 m·m/s）\n`)
console.log('門檻          開局      extend  engage  approach defend  ｜ 進入數 最長  ｜ ratio  TAS  ｜ 存活 B:R  傷害')

/** 出貨值 + 四組候選。遲滯帶寬度刻意保持 0.20，只平移 */
const CASES: [number, number][] = [
  [0.75, 0.95],
  [0.65, 0.85],
  [0.55, 0.75],
  [0.45, 0.65],
  [0.55, 0.65],
]
for (const [enter, exit] of CASES) {
  for (const opening of OPENINGS) {
    const r = run(enter, exit, opening)
    const tag = `${enter.toFixed(2)}/${exit.toFixed(2)}`
    console.log(
      `${tag.padEnd(12)} ${opening.name.padStart(8)}   `
      + `${pct(r, 'extend').toFixed(1).padStart(5)}%  `
      + `${pct(r, 'engage').toFixed(1).padStart(5)}%  `
      + `${pct(r, 'approach').toFixed(1).padStart(6)}%  `
      + `${pct(r, 'defend').toFixed(1).padStart(5)}%  ｜ `
      + `${String(r.extendEntries).padStart(5)} ${r.extendSecondsMax.toFixed(0).padStart(4)}s ｜ `
      + `${(r.ratioSum / Math.max(r.samples, 1)).toFixed(2)} `
      + `${(r.tasSum / Math.max(r.samples, 1)).toFixed(0).padStart(4)} ｜ `
      + `${String(r.blueAlive).padStart(3)}:${String(r.redAlive).padEnd(3)} `
      + `${r.damage.toFixed(0).padStart(6)}`,
    )
  }
}
console.log('\n【怎麼讀】主判準是 extend 降、engage 升。')
console.log('　　　　　傷害若同時大幅下降，表示大家都在閃避而不是在打 —— 那是壞的。')
console.log('　　　　　TAS 若大幅下降，表示 AI 開始低速泡著，門檻放太寬。')
