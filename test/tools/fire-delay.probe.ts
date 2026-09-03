/**
 * 開火要不要參與反應延遲（2026-09-04）。
 *
 * 專案負責人：「你開分支走丙看看，我想看看效果。」丙 = 開火完全不延遲。
 *
 * ── 這支量的是什麼 ────────────────────────────────────
 *
 * `ai-reaction-delay.test.ts` 的 24 場對決只回報勝負與長度，那是「延遲讓
 * AI 咬得住殺不掉」的證據。這裡沿用**同一組開局與同一個對決函式**（刻意
 * 逐字照抄，不共用 —— 測試是護欄，護欄不該被工具改動牽連），多量兩件事：
 *
 * ```
 *   扣扳機的步數   `Combatant.command.firing` 為真的物理步數
 *   打出去的傷害   對手的 hp 掉了多少
 * ```
 *
 * 兩者相除就是**每一發子彈換到多少傷害**。這正是甲乙丙三案分得開的地方：
 *
 * ```
 *   甲 全延遲     朝 0.3 秒前的答案開火 → 目標已閃開仍在潑，效率低
 *   丙 不延遲     扳機讀當下幾何       → 只在打得到的角度開火，效率高
 * ```
 *
 * 【為什麼不是量命中率】彈丸與命中判定之間隔著散佈、彈道下墜與延遲引信，
 * 「發數」要從 `cooldowns` 反推每個掛架各自的節奏。傷害是同一件事的下游，
 * 而且是玩家真正感覺得到的那一端。
 *
 * 【怎麼比對】這支要在兩個 commit 上各跑一次（本分支與 `main`），自己不做
 * A/B —— 差異在 `ai/delay.ts` 的一行，沒有旗標可以切。
 *
 * 跑法：`npx tsx test/tools/fire-delay.probe.ts`
 */
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { ACE, VETERAN } from '../../src/ai/profile'
import { P51D } from '../../src/specs/p51d'
import { DEG } from '../../src/core/math'

const DT = 1 / 240
const SECONDS = 300

interface Side {
  altitude: number
  tas: number
  offset: [number, number, number]
  headingDeg: number
}

interface Duel {
  winner: string
  seconds: number
  /** 延遲方（VETERAN）扣扳機的物理步數 */
  lagFireSteps: number
  /** 延遲方打掉對手多少 hp */
  lagDamage: number
  /** 零延遲方（ACE）的同兩項，當對照 */
  aceFireSteps: number
  aceDamage: number
}

function duel(blue: Side, red: Side, delayed: string): Duel {
  const world = new World()
  const make = (s: Side) => {
    const a = new Aircraft(P51D, s.altitude, s.tas)
    const pos = new Vector3(s.offset[0], s.altitude, s.offset[2])
    const h = s.headingDeg * DEG
    const dir = new Vector3(-Math.sin(h), 0, -Math.cos(h))
    a.state.position.copy(pos)
    a.state.velocity.copy(dir).multiplyScalar(s.tas)
    a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
    return { a, pos }
  }
  const b = make(blue)
  const r = make(red)
  const blueAi = new AiController()
  const redAi = new AiController()
  blueAi.profile = delayed === 'blue' ? VETERAN : ACE
  redAi.profile = delayed === 'red' ? VETERAN : ACE
  const bc = world.add(b.a, blueAi, 'blue', b.pos, blue.altitude, blue.tas)
  const rc = world.add(r.a, redAi, 'red', r.pos, red.altitude, red.tas)
  blueAi.target = r.a
  redAi.target = b.a
  bc.respawnOnDestroy = false
  rc.respawnOnDestroy = false

  const lag = delayed === 'blue' ? bc : rc
  const ace = delayed === 'blue' ? rc : bc
  const lagHp0 = ace.hp
  const aceHp0 = lag.hp
  let lagFireSteps = 0
  let aceFireSteps = 0

  const total = SECONDS * 240
  for (let i = 0; i < total; i++) {
    world.step(DT)
    if (lag.command.firing) lagFireSteps++
    if (ace.command.firing) aceFireSteps++
    if (bc.hp <= 0 || rc.hp <= 0) {
      return {
        winner: rc.hp <= 0 ? 'blue' : 'red', seconds: i * DT,
        lagFireSteps, lagDamage: lagHp0 - ace.hp,
        aceFireSteps, aceDamage: aceHp0 - lag.hp,
      }
    }
  }
  return {
    winner: 'timeout', seconds: SECONDS,
    lagFireSteps, lagDamage: lagHp0 - ace.hp,
    aceFireSteps, aceDamage: aceHp0 - lag.hp,
  }
}

/** 與 `ai-reaction-delay.test.ts` 逐字相同的 12 種開局 */
const GEOMETRIES: readonly [Side, Side][] = [
  [{ altitude: 4000, tas: 200, offset: [0, 0, 1500], headingDeg: 180 }, { altitude: 4000, tas: 200, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 220, offset: [0, 0, 3000], headingDeg: 180 }, { altitude: 4000, tas: 220, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 190, offset: [400, 0, 400], headingDeg: 135 }, { altitude: 4000, tas: 190, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 190, offset: [900, 0, 0], headingDeg: 90 }, { altitude: 4000, tas: 190, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 190, offset: [0, 0, 600], headingDeg: 0 }, { altitude: 4000, tas: 190, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 190, offset: [0, 0, 0], headingDeg: 0 }, { altitude: 4000, tas: 190, offset: [0, 0, 600], headingDeg: 0 }],
  [{ altitude: 5000, tas: 200, offset: [0, 0, 1200], headingDeg: 180 }, { altitude: 4000, tas: 200, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 200, offset: [0, 0, 1200], headingDeg: 180 }, { altitude: 5000, tas: 200, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 250, offset: [0, 0, 1500], headingDeg: 180 }, { altitude: 4000, tas: 190, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 190, offset: [0, 0, 1500], headingDeg: 180 }, { altitude: 4000, tas: 250, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 3000, tas: 200, offset: [1200, 0, 600], headingDeg: 45 }, { altitude: 3000, tas: 200, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 6000, tas: 210, offset: [1200, 0, 600], headingDeg: 45 }, { altitude: 6000, tas: 210, offset: [0, 0, 0], headingDeg: 0 }],
]

let aceWin = 0
let lagWin = 0
let draw = 0
let seconds = 0
let lagFire = 0
let lagDmg = 0
let aceFire = 0
let aceDmg = 0
let n = 0

for (const [blue, red] of GEOMETRIES) {
  for (const delayed of ['blue', 'red'] as const) {
    const o = duel(blue, red, delayed)
    n++
    seconds += o.seconds
    lagFire += o.lagFireSteps
    lagDmg += o.lagDamage
    aceFire += o.aceFireSteps
    aceDmg += o.aceDamage
    if (o.winner === 'timeout') draw++
    else if (o.winner === delayed) lagWin++
    else aceWin++
  }
}

const per = (dmg: number, steps: number) => steps === 0 ? 0 : dmg / (steps * DT)
console.log(`\n══ 開火延遲探針 ══  ${n} 場 × ${SECONDS} s，同機種 P-51D 1v1\n`)
console.log(`  勝負        ACE ${aceWin} : ${lagWin} VETERAN　平手 ${draw}`)
console.log(`  平均長度    ${(seconds / n).toFixed(1)} s`)
console.log('')
console.log('                    扣扳機秒數      打出傷害      每秒傷害')
console.log(`  VETERAN（延遲）   ${(lagFire * DT).toFixed(1).padStart(8)}   ${lagDmg.toFixed(0).padStart(11)}   ${per(lagDmg, lagFire).toFixed(1).padStart(11)}`)
console.log(`  ACE（零延遲）     ${(aceFire * DT).toFixed(1).padStart(8)}   ${aceDmg.toFixed(0).padStart(11)}   ${per(aceDmg, aceFire).toFixed(1).padStart(11)}`)
console.log('')
