/**
 * AI 對 AI 一對一的數值健全性：幾種開局幾何、機種對調，雙方都用同一個
 * `AiController`。只驗狀態有限、不碰海面、結果落在合法集合內；誰贏不驗。
 */
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import type { AircraftSpec } from '../../src/specs/types'
import { DEG } from '../../src/core/math'

const DT = 1 / 240
const MAX_SECONDS = 90

interface Outcome {
  /** 'blue' | 'red' | 'timeout' | 'nan' */
  winner: string
  finite: boolean
  touchedSea: boolean
}

interface Side {
  spec: AircraftSpec
  altitude: number
  tas: number
  /**
   * 開局的**水平**位移，m。y 分量不用 —— 高度一律取 `altitude`。
   * 若把 y 當位置，`altitude` 會被 `position.copy(pos)` 蓋掉，兩機在海平面開局。
   */
  offset: [number, number, number]
  headingDeg: number
}

/**
 * 跑一場 AI vs AI，任一方被擊落、狀態出現非有限值或跑滿 `MAX_SECONDS` 即停。
 *
 * 零延遲、零瞄準誤差、無亂數，所以固定的開局條件給出固定的結果。
 */
function duel(blue: Side, red: Side): Outcome {
  const world = new World()

  const make = (side: Side) => {
    const a = new Aircraft(side.spec, side.altitude, side.tas)
    // 高度取自 `altitude`，offset 只提供水平位移——見 Side.offset 的註解。
    const pos = new Vector3(side.offset[0], side.altitude, side.offset[2])
    const h = side.headingDeg * DEG
    const dir = new Vector3(-Math.sin(h), 0, -Math.cos(h))
    a.state.position.copy(pos)
    a.state.velocity.copy(dir).multiplyScalar(side.tas)
    a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
    return { a, pos }
  }

  const b = make(blue)
  const r = make(red)

  const blueAi = new AiController()
  const redAi = new AiController()
  const bc = world.add(b.a, blueAi, 'blue', b.pos, blue.altitude, blue.tas)
  const rc = world.add(r.a, redAi, 'red', r.pos, red.altitude, red.tas)
  blueAi.target = r.a
  redAi.target = b.a
  // 【不重生】重生會讓戰鬥永遠不收斂，擊落那條結束路徑就走不到
  bc.respawnOnDestroy = false
  rc.respawnOnDestroy = false

  let touchedSea = false
  const total = MAX_SECONDS * 240
  for (let i = 0; i < total; i++) {
    world.step(DT)
    if (b.a.state.position.y <= 0 || r.a.state.position.y <= 0) touchedSea = true
    if (!Number.isFinite(b.a.state.position.y) || !Number.isFinite(r.a.state.position.y)) {
      return { winner: 'nan', finite: false, touchedSea }
    }
    if (bc.hp <= 0 || rc.hp <= 0) {
      return { winner: rc.hp <= 0 ? 'blue' : 'red', finite: true, touchedSea }
    }
  }
  return { winner: 'timeout', finite: true, touchedSea }
}

/** 高能量開局：藍方在上方 1500 m（5500 vs 4000）且快 80 m/s。 */
const HIGH_ENERGY: [Side, Side] = [
  { spec: P51D, altitude: 5500, tas: 250, offset: [0, 0, 800], headingDeg: 180 },
  { spec: BF109K4, altitude: 4000, tas: 170, offset: [0, 0, 0], headingDeg: 0 },
]

/** 共速共高開局：純粹的纏鬥。 */
const CO_ENERGY: [Side, Side] = [
  { spec: P51D, altitude: 4000, tas: 190, offset: [400, 0, 400], headingDeg: 135 },
  { spec: BF109K4, altitude: 4000, tas: 190, offset: [0, 0, 0], headingDeg: 0 },
]

describe('L4-B 對戰矩陣 —— 數值不會壞', () => {
  const GEOMETRIES: readonly [string, [Side, Side]][] = [
    ['高能量開局', HIGH_ENERGY],
    ['共速共高', CO_ENERGY],
    ['對頭', [
      { spec: P51D, altitude: 4000, tas: 200, offset: [0, 0, 1500], headingDeg: 180 },
      { spec: BF109K4, altitude: 4000, tas: 200, offset: [0, 0, 0], headingDeg: 0 },
    ]],
    ['藍方被咬', [
      { spec: P51D, altitude: 4000, tas: 180, offset: [0, 0, 0], headingDeg: 0 },
      { spec: BF109K4, altitude: 4000, tas: 200, offset: [0, 0, 500], headingDeg: 0 },
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
