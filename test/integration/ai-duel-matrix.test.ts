import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { INTENTS, type Intent } from '../../src/ai/rules'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import type { AircraftSpec } from '../../src/specs/types'
import type { Battery } from '../../src/weapons/types'
import { DEG } from '../../src/core/math'

const DT = 1 / 240
const MAX_SECONDS = 90

interface Outcome {
  /** 'blue' | 'red' | 'timeout' */
  winner: string
  seconds: number
  finite: boolean
  touchedSea: boolean
  /** 各意圖佔藍方總時間的比例 */
  blueIntentTime: Record<Intent, number>
  /** 藍方 Ps 為大負值的時間比例 */
  blueDeepNegativePs: number
}

interface Side {
  spec: AircraftSpec
  /** 覆寫武裝。用於消融測試 */
  battery?: Battery
  altitude: number
  tas: number
  /** 開局位置，相對藍方 */
  offset: [number, number, number]
  headingDeg: number
}

/**
 * 跑一場 AI vs AI。
 *
 * 【為什麼雙方都用同一個 AiController 類別】要驗的是「同一顆腦袋開不同的
 * 飛機，勝率會不會隨機種與開局條件而變」。若兩邊用不同的 AI，測出來的
 * 差異分不清是飛機還是腦袋。
 *
 * 【零隨機】零延遲、零瞄準誤差、無亂數，所以固定的開局條件給出固定的結果。
 * 測試不會飄。
 */
function duel(blue: Side, red: Side): Outcome {
  const world = new World()

  const make = (side: Side, base: Vector3) => {
    const spec = side.battery ? { ...side.spec, battery: side.battery } : side.spec
    const a = new Aircraft(spec, side.altitude, side.tas)
    const pos = base.clone().add(new Vector3(...side.offset))
    const h = side.headingDeg * DEG
    const dir = new Vector3(-Math.sin(h), 0, -Math.cos(h))
    a.state.position.copy(pos)
    a.state.velocity.copy(dir).multiplyScalar(side.tas)
    a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
    return { a, pos }
  }

  const origin = new Vector3(0, 0, 0)
  const b = make(blue, origin)
  const r = make(red, origin)

  const blueAi = new AiController()
  const redAi = new AiController()
  const bc = world.add(b.a, blueAi, 'blue', b.pos, blue.altitude, blue.tas)
  const rc = world.add(r.a, redAi, 'red', r.pos, red.altitude, red.tas)
  blueAi.target = r.a
  redAi.target = b.a
  // 【不重生】要量的是「誰先被打下來」。開重生的話戰鬥永遠不收斂。
  bc.respawnOnDestroy = false
  rc.respawnOnDestroy = false

  const intentSteps: Record<string, number> = {}
  for (const i of INTENTS) intentSteps[i] = 0
  let deepNegative = 0
  let touchedSea = false

  const total = MAX_SECONDS * 240
  for (let i = 0; i < total; i++) {
    world.step(DT)
    intentSteps[blueAi.intent] = (intentSteps[blueAi.intent] ?? 0) + 1
    if (b.a.specificExcessPowerActual < -60) deepNegative++
    if (b.a.state.position.y <= 0 || r.a.state.position.y <= 0) touchedSea = true
    if (!Number.isFinite(b.a.state.position.y) || !Number.isFinite(r.a.state.position.y)) {
      return {
        winner: 'nan', seconds: i * DT, finite: false, touchedSea,
        blueIntentTime: fractions(intentSteps, i + 1), blueDeepNegativePs: deepNegative / (i + 1),
      }
    }
    if (bc.hp <= 0 || rc.hp <= 0) {
      return {
        winner: rc.hp <= 0 ? 'blue' : 'red', seconds: i * DT, finite: true, touchedSea,
        blueIntentTime: fractions(intentSteps, i + 1), blueDeepNegativePs: deepNegative / (i + 1),
      }
    }
  }
  return {
    winner: 'timeout', seconds: MAX_SECONDS, finite: true, touchedSea,
    blueIntentTime: fractions(intentSteps, total), blueDeepNegativePs: deepNegative / total,
  }
}

function fractions(steps: Record<string, number>, total: number): Record<Intent, number> {
  const out = {} as Record<Intent, number>
  for (const i of INTENTS) out[i] = (steps[i] ?? 0) / total
  return out
}

/** 高能量開局：藍方在上方 1500 m 且快 80 m/s。 */
const HIGH_ENERGY: [Side, Side] = [
  { spec: P51D, altitude: 5500, tas: 250, offset: [0, 1500, 800], headingDeg: 180 },
  { spec: BF109G6, altitude: 4000, tas: 170, offset: [0, 0, 0], headingDeg: 0 },
]

/** 共速共高開局：純粹的纏鬥。 */
const CO_ENERGY: [Side, Side] = [
  { spec: P51D, altitude: 4000, tas: 190, offset: [400, 0, 400], headingDeg: 135 },
  { spec: BF109G6, altitude: 4000, tas: 190, offset: [0, 0, 0], headingDeg: 0 },
]

describe('L4-B 對戰矩陣 —— 打得起來、不會壞', () => {
  const GEOMETRIES: readonly [string, [Side, Side]][] = [
    ['高能量開局', HIGH_ENERGY],
    ['共速共高', CO_ENERGY],
    ['對頭', [
      { spec: P51D, altitude: 4000, tas: 200, offset: [0, 0, 1500], headingDeg: 180 },
      { spec: BF109G6, altitude: 4000, tas: 200, offset: [0, 0, 0], headingDeg: 0 },
    ]],
    ['藍方被咬', [
      { spec: P51D, altitude: 4000, tas: 180, offset: [0, 0, 0], headingDeg: 0 },
      { spec: BF109G6, altitude: 4000, tas: 200, offset: [0, 0, 500], headingDeg: 0 },
    ]],
  ]

  for (const [name, [blue, red]] of GEOMETRIES) {
    for (const swap of [false, true]) {
      const b = swap ? { ...red, spec: red.spec } : blue
      const r = swap ? { ...blue, spec: blue.spec } : red
      it(`${name}${swap ? '（機種對調）' : ''}`, () => {
        const o = duel(b, r)
        expect(o.finite).toBe(true)
        expect(o.touchedSea).toBe(false)
        // 【收斂】戰鬥要嘛分出勝負、要嘛在時限內都還活著——兩者都可接受，
        // 不可接受的是 NaN 或飛進海裡。
        expect(['blue', 'red', 'timeout']).toContain(o.winner)
      })
    }
  }
})

describe('L4-C 能量戰證據', () => {
  /**
   * 【為什麼勝率單獨不夠】若測出勝率與開局無關，有三種可能的原因：
   * AI 沒用好能量、飛行模型差異不足、或初始幾何讓優勢來不及轉化。
   * 勝率分不出來，所以要加 telemetry 與消融。
   *
   * 【勝率先當觀測值，不當紅綠門檻】等下面的 telemetry 斷言證明 AI 確實
   * 在打能量戰之後，才考慮把它升級成門檻（spec §13.3）。
   */
  it('記錄兩種開局的勝負與意圖分佈（觀測值，不是門檻）', () => {
    const high = duel(...HIGH_ENERGY)
    const co = duel(...CO_ENERGY)
    console.log('高能量開局：', high.winner, `${high.seconds.toFixed(1)}s`, high.blueIntentTime)
    console.log('共速共高：  ', co.winner, `${co.seconds.toFixed(1)}s`, co.blueIntentTime)
    expect(high.finite && co.finite).toBe(true)
  })

  it('能量劣勢開局時，AI 花在 extend 的時間顯著多於能量優勢開局', () => {
    // 藍方在下方且慢 → 應該先脫離重整而不是硬纏
    const lowEnergy: [Side, Side] = [
      { spec: P51D, altitude: 3000, tas: 150, offset: [0, -1000, 0], headingDeg: 0 },
      { spec: BF109G6, altitude: 4000, tas: 250, offset: [0, 0, 600], headingDeg: 0 },
    ]
    const low = duel(...lowEnergy)
    const high = duel(...HIGH_ENERGY)
    expect(low.blueIntentTime.extend).toBeGreaterThan(high.blueIntentTime.extend)
  })

  it('能量優勢方不會長期把 Ps 壓在大負值（那是死拉 6G，不是能量戰）', () => {
    const o = duel(...HIGH_ENERGY)
    expect(o.blueDeepNegativePs).toBeLessThan(0.5)
  })

  /**
   * 【消融測試】把兩台的武器對調再跑同一組開局。
   *
   * M2 量到 109 的近距 DPS 高於 P-51（627 vs 480）。若 P-51 在高能量開局
   * 輸給 109，可能是飛行模型差異不夠、也可能是 AI 把 boom-and-zoom 飛成了
   * 近距盤旋戰、還可能只是 DPS 壓過一切。對調武器就能把它們分開：
   *
   *   勝率模式跟著**機體**走 → 飛行模型的差異在起作用
   *   勝率模式跟著**槍**走   → DPS 在主導
   */
  it('武器對調：記錄勝負是否跟著機體走（觀測值）', () => {
    const [blue, red] = HIGH_ENERGY
    const normal = duel(blue, red)
    const swapped = duel(
      { ...blue, battery: BF109G6.battery },
      { ...red, battery: P51D.battery },
    )
    console.log('高能量開局 原始武裝：', normal.winner, `${normal.seconds.toFixed(1)}s`)
    console.log('高能量開局 武器對調：', swapped.winner, `${swapped.seconds.toFixed(1)}s`)
    // 兩場都要跑得完；勝負本身是觀測值
    expect(normal.finite && swapped.finite).toBe(true)
  })
})
