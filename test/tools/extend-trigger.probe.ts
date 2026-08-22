import { Vector3 } from 'three'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { Idle } from './spawn-snapshot'

/**
 * **每一次進入 `extend` 是被什麼觸發的。**不是測試。
 *
 * ```
 * npx tsx test/tools/extend-trigger.probe.ts
 * ```
 *
 * 【它在回答什麼】人工回報：「Bf 109 只要一低頭沒幾秒就會觸發 extend，這樣
 * 根本與俯衝攻擊衝突；而且很常瞄準到敵人沒多久又觸發 extend。」
 *
 * 假設是：**追蹤與俯衝本身要花能量，而能量閂鎖把那個花費讀成「該撤了」**
 * —— 承諾攻擊的動作自己製造出中止攻擊的條件。這支逐次記錄進入 `extend` 的
 * 當下有哪些閂鎖成立、前 5 秒的俯仰與比能量怎麼變、以及距離上一次有射擊解
 * 過了多久，用來證實或推翻它。
 *
 * 【為什麼要看「前 5 秒」而不是只看當下】閂鎖是遲滯的，觸發的那一格只告訴
 * 你「越線了」，越線的**原因**在前面幾秒的變化裡。
 */
const DT = 1 / 240
const SECONDS = 300
const SEED = 20260805
const STRIDE = 24
/** 回看的視窗，s */
const LOOK = 5
const LOOK_N = Math.round(LOOK / (DT * STRIDE))

const ID = 'axis-escort'
const FACTION: 'allies' | 'axis' = 'axis'

const card = MISSIONS[FACTION].find((m) => m.id === ID)!
const b = createBattle(new Idle(), missionConfigFrom(card, FACTION), SEED)

interface Track {
  ai: AiController
  spec: string
  prev: string
  theta: number[]
  energy: number[]
  /** 距離上一次 `shotInstant > 0` 有多久，s。Infinity = 從來沒有 */
  sinceShot: number
}

const tracks: Track[] = []
for (const c of b.world.combatants) {
  if (!(c.controller instanceof AiController)) continue
  if (c.aircraft.spec.role !== 'fighter') continue
  tracks.push({
    ai: c.controller, spec: c.aircraft.spec.id, prev: 'approach',
    theta: [], energy: [], sinceShot: Infinity,
  })
}

interface Entry {
  spec: string
  energyLatch: boolean
  turnLatch: boolean
  floorLatch: boolean
  /** 前 5 秒的平均俯仰角，度。負 = 低頭 */
  theta5: number
  /** 前 5 秒比能量差的變化，m */
  dEnergy5: number
  energy: number
  cornerRatio: number
  range: number
  sinceShot: number
}
const entries: Entry[] = []

const FWD = new Vector3(0, 0, -1)
const nose = new Vector3()

for (let k = 0; k < Math.round(SECONDS / DT); k++) {
  stepBattle(b, DT)
  if (k % STRIDE !== 0) continue
  for (const t of tracks) {
    const c = b.world.combatants[t.ai.selfIndex]!
    if (!c.alive) continue
    nose.copy(FWD).applyQuaternion(c.aircraft.state.orientation)
    const th = Math.asin(Math.max(-1, Math.min(1, nose.y))) * (180 / Math.PI)
    t.theta.push(th)
    t.energy.push(t.ai.sit.energyAdvantage)
    if (t.theta.length > LOOK_N + 1) { t.theta.shift(); t.energy.shift() }
    t.sinceShot = t.ai.shotInstant > 0 ? 0 : t.sinceShot + DT * STRIDE

    const now = t.ai.intent
    if (now === 'extend' && t.prev !== 'extend' && t.theta.length > 2) {
      let sum = 0
      for (const v of t.theta) sum += v
      entries.push({
        spec: t.spec,
        energyLatch: t.ai.rules.extendEnergyLatch,
        turnLatch: t.ai.rules.extendTurnLatch,
        floorLatch: t.ai.rules.extendFloorLatch,
        theta5: sum / t.theta.length,
        dEnergy5: t.energy[t.energy.length - 1]! - t.energy[0]!,
        energy: t.ai.sit.energyAdvantage,
        cornerRatio: t.ai.sit.cornerRatio,
        range: t.ai.sit.range,
        sinceShot: t.sinceShot,
      })
    }
    t.prev = now
  }
}

function q(xs: number[], p: number): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b2) => a - b2)
  const i = (s.length - 1) * p
  const lo = Math.floor(i), hi = Math.ceil(i)
  return lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (i - lo)
}
function line(name: string, xs: number[], dp = 1): string {
  return `  ${name.padEnd(22)}n=${String(xs.length).padStart(4)}  `
    + `p10 ${q(xs, .1).toFixed(dp).padStart(8)}  `
    + `中位 ${q(xs, .5).toFixed(dp).padStart(8)}  `
    + `p90 ${q(xs, .9).toFixed(dp).padStart(8)}`
}

console.log(`${card.id}，${SECONDS} s，${tracks.length} 架戰鬥機`)
console.log(`進入 extend 共 ${entries.length} 次`)
console.log('')

const only = (f: (e: Entry) => boolean) => entries.filter(f)
const e = only(x => x.energyLatch && !x.turnLatch && !x.floorLatch)
const t2 = only(x => !x.energyLatch && x.turnLatch && !x.floorLatch)
const f2 = only(x => !x.energyLatch && !x.turnLatch && x.floorLatch)
const mix = only(x => [x.energyLatch, x.turnLatch, x.floorLatch].filter(Boolean).length > 1)
console.log('觸發的閂鎖（互斥歸類）')
for (const [name, arr] of [['只有能量', e], ['只有迴旋', t2], ['只有絕對見底', f2],
  ['兩個以上', mix]] as [string, Entry[]][]) {
  console.log(`  ${name.padEnd(12)}${String(arr.length).padStart(4)} 次  `
    + `${(100 * arr.length / Math.max(1, entries.length)).toFixed(1)}%`)
}
console.log('')

const all = entries
console.log('進入 extend 的當下')
console.log(line('前 5 秒平均俯仰°', all.map(x => x.theta5)))
console.log(line('前 5 秒比能量變化 m', all.map(x => x.dEnergy5), 0))
console.log(line('比能量差 m', all.map(x => x.energy), 0))
console.log(line('cornerRatio', all.map(x => x.cornerRatio), 3))
console.log(line('距離 m', all.map(x => x.range), 0))
console.log('')

const noseDown = all.filter(x => x.theta5 < -3)
const recentShot = all.filter(x => x.sinceShot <= 3)
console.log(`前 5 秒平均在低頭（< −3°）的：${noseDown.length} 次`
  + `（${(100 * noseDown.length / Math.max(1, all.length)).toFixed(1)}%）`)
console.log(`3 秒內還有射擊解的：${recentShot.length} 次`
  + `（${(100 * recentShot.length / Math.max(1, all.length)).toFixed(1)}%）`)
console.log('')
console.log('分機種')
const specs = [...new Set(all.map(x => x.spec))]
for (const sp of specs) {
  const g = all.filter(x => x.spec === sp)
  const nd = g.filter(x => x.theta5 < -3).length
  console.log(`  ${sp.padEnd(10)}${String(g.length).padStart(4)} 次  `
    + `低頭觸發 ${(100 * nd / Math.max(1, g.length)).toFixed(0)}%  `
    + `前 5 秒比能量變化中位 ${q(g.map(x => x.dEnergy5), .5).toFixed(0)} m`)
}
