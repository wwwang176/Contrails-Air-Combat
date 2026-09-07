/**
 * **是誰在把 AI 往上推？** **不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/climb-blame.probe.ts
 *
 * 【承接 `altitude-drift.probe.ts`】已確認：
 *
 *   開局 2000 m → 420 秒後爬到 4823 m；關掉甜蜜區仍爬到 4146 m
 *   高度上升 → 角落速度上升 → `cornerRatio` 下降 → `extend` 佔時翻倍
 *
 * 甜蜜區只解釋 360~680 m，**主因還沒找到**。
 *
 * 【瞄準點的產生鏈】`steerCommand` 只有這幾個地方會決定俯仰：
 *
 * ```
 *   意圖分支            engage → aimFromKnobs（吃 engageKnobs.vertical）
 *                       extend → unloadAim(extendPitchAngle)
 *                       defend → defendAim
 *                       approach/merge → 追前置點（目標在上面就往上）
 *   shrinkTowardNose    只縮短誤差角，不改方位     ← 不會製造爬升
 *   applyPitchBias      甜蜜區，已消融，只佔一小部分
 *   applyFloor          只抬不壓，但離地 ≥500 m 時**嚴格為 0**
 * ```
 *
 * 所以往上飄一定來自**意圖分支**。這一支把每個物理步的高度變化**歸戶**到
 * 當下的意圖，看是誰在爬。
 *
 * 【為什麼用「高度變化的總和」而不是「平均航跡角」】平均航跡角會被時間
 * 加權抹平：一個意圖若只佔 5% 的時間但每次都猛爬，平均角度看起來不高，
 * 而它對總高度的貢獻可能最大。要問「誰造成的」就該直接加總它的產出。
 *
 * 【對照組：垂直旋鈕】`engageKnobs.vertical` 是純函數，可以在外面重算，
 * 不必為了觀測去改 `AiController`（`reversal-cause.probe.ts` 同一個手法）。
 * 它的符號分佈直接說明「大家是不是都在往上 yo-yo」。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { engageKnobs, type Knobs } from '../../src/ai/steer'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 420
/** 起始高度。低開局讓「往上爬」的訊號最大 */
const START_ALT = 2000

interface Blame {
  /** 這個意圖下的高度淨變化總和，m（正 = 爬） */
  net: number
  /** 只算上升的部分 */
  up: number
  /** 只算下降的部分 */
  down: number
  seconds: number
}

const knobs: Knobs = { leadLag: 0, vertical: 0, diveIas: 0 }

const b = createBattle(
  new AiController(),
  { ...battleConfigFrom(DEFAULT_SKIRMISH), altitude: START_ALT, tas: 200 },
  20260813,
)
const cs: Combatant[] = b.world.combatants
const blame = new Map<string, Blame>()
const prevAlt = cs.map((c) => c.aircraft.state.position.y)
/** 垂直旋鈕的符號統計（只在 engage 意圖下有意義） */
let vUp = 0
let vDown = 0
let vZero = 0
/** 追擊時目標在我上面的比例 */
let targetAbove = 0
let targetSamples = 0

function bucket(k: string): Blame {
  let v = blame.get(k)
  if (v === undefined) { v = { net: 0, up: 0, down: 0, seconds: 0 }; blame.set(k, v) }
  return v
}

for (let s = 0; s < Math.round(SECONDS / DT); s++) {
  stepBattle(b, DT)
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    if (!c.alive) { prevAlt[i] = c.aircraft.state.position.y; continue }
    const ai = c.controller
    if (!(ai instanceof AiController)) { prevAlt[i] = c.aircraft.state.position.y; continue }
    const alt = c.aircraft.state.position.y
    const d = alt - prevAlt[i]!
    prevAlt[i] = alt

    const bl = bucket(ai.intent)
    bl.net += d
    if (d > 0) bl.up += d
    else bl.down += d
    bl.seconds += DT

    // 每 24 步取樣一次的統計量
    if (s % 24 !== 0) continue
    if (ai.intent === 'engage') {
      engageKnobs(ai.sit, knobs)
      if (knobs.vertical > 0.05) vUp++
      else if (knobs.vertical < -0.05) vDown++
      else vZero++
    }
    if (ai.target !== null && (ai.intent === 'approach' || ai.intent === 'engage')) {
      targetSamples++
      if (ai.target.state.position.y > alt) targetAbove++
    }
  }
}

console.log(`20v20、${SECONDS} 秒、VETERAN、開局 ${START_ALT} m。`)
console.log(`結束時高度中位 ${(() => {
  const alts = cs.filter((c) => c.alive).map((c) => c.aircraft.state.position.y)
    .sort((a, x) => a - x)
  return alts.length === 0 ? NaN : alts[Math.floor(alts.length / 2)]!
})().toFixed(0)} m\n`)

console.log('意圖        佔時      **淨高度變化**      上升量      下降量    每秒淨爬升')
const rows = [...blame].sort((a, c) => c[1].net - a[1].net)
let total = 0
for (const [, v] of rows) total += v.net
for (const [k, v] of rows) {
  console.log(
    `${k.padEnd(10)} ${(v.seconds / 60).toFixed(0).padStart(5)} 機分  `
    + `${(v.net / 1000).toFixed(1).padStart(9)} km  `
    + `${(v.up / 1000).toFixed(1).padStart(9)} km  `
    + `${(v.down / 1000).toFixed(1).padStart(9)} km  `
    + `${(v.net / Math.max(v.seconds, 1)).toFixed(3).padStart(8)} m/s`,
  )
}
console.log(`${'合計'.padEnd(9)} ${' '.repeat(10)}${(total / 1000).toFixed(1).padStart(9)} km`)

console.log('')
const vN = Math.max(vUp + vDown + vZero, 1)
console.log(
  `engage 的垂直旋鈕：往上 ${(vUp / vN * 100).toFixed(0)}%　`
  + `往下 ${(vDown / vN * 100).toFixed(0)}%　中性 ${(vZero / vN * 100).toFixed(0)}%`,
)
console.log(
  `追擊時目標在我上面的比例：${(targetAbove / Math.max(targetSamples, 1) * 100).toFixed(0)}%`,
)

console.log('\n【怎麼讀】')
console.log('　「淨高度變化」最大的那一列就是元凶 —— 它是那個意圖產出的總爬升。')
console.log('　垂直旋鈕若「往上」遠多於「往下」→ 高 yo-yo 是系統性偏向，互相加價。')
console.log('　目標在上面的比例若 > 50% → 追擊本身就在把大家往上帶（追高的人一起變高）。')
console.log('　　那是一個正回饋：誰先爬，其他人追著爬，全場一起漂上去。')
