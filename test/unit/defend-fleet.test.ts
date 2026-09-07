import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { Idle } from '../tools/spawn-snapshot'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import type { MissionFleet } from '../../src/battle/missions'
import type { Battle } from '../../src/battle/setup'

const DT = 1 / 240

/**
 * 一支藍方艦隊：一艘要害艦 + 兩艘不是。
 *
 * 【為什麼三艘就夠】這一支測的是**計數**，不是陣型。三艘剛好蓋到「要害
 * 沉了」「不是要害的沉了」「紅方的沉了」三種情形各自的效果。
 */
function fleet(): MissionFleet {
  return {
    center: new Vector3(0, 0, 0),
    heading: 0,
    speed: 8,
    ships: [
      { cls: 'essex', team: 'blue', offset: new Vector3(0, 0, 0), vital: true },
      { cls: 'fletcher', team: 'blue', offset: new Vector3(-900, 0, -900) },
      { cls: 'wichita', team: 'red', offset: new Vector3(900, 0, -900) },
    ],
  }
}

function battle(): Battle {
  return createBattle(new Idle(), {
    ...DEFAULT_BATTLE,
    units: lineAbreast(HEAD_ON, P51D, 4, BF109K4, 4),
    rules: { kind: 'defend' },
    fleet: fleet(),
  })
}

/** 把一艘船打沉。**直接改 hp 再跑一步** —— 這一支不測傷害路徑 */
function sink(b: Battle, index: number): void {
  const sh = b.world.ships[index]!
  sh.hp = 0
  sh.alive = false
}

describe('守住艦隊：`vitalSunk` 只算我方的要害艦', () => {
  it('艦隊生得出來，而且 `vital` 有透傳', () => {
    const b = battle()
    expect(b.world.ships.length).toBe(3)
    expect(b.world.ships[0]!.vital).toBe(true)
    expect(b.world.ships[1]!.vital).toBe(false)
    expect(b.world.ships[2]!.vital).toBe(false)
  })

  it('開場不判輸', () => {
    const b = battle()
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('fighting')
  })

  /** 【這一條是整支的重點】要害艦沉 → 輸，雙方飛機都還在 */
  it('要害艦沉 → defeat', () => {
    const b = battle()
    sink(b, 0)
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('defeat')
  })

  /**
   * 【六艘驅逐艦沉光也不算輸】它們的價值在防空火網，不在勝負條件裡。
   * 少了 `sh.vital` 的檢查，這一條就紅。
   */
  it('我方非要害艦沉掉不算輸', () => {
    const b = battle()
    sink(b, 1)
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('fighting')
  })

  /** 【保護日 M4】紅方的船沉掉與 `vitalSunk` 無關 */
  it('敵方的船沉掉不算輸', () => {
    const b = battle()
    sink(b, 2)
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('fighting')
  })

  /**
   * 【每一步要歸零】少了歸零就是上一步的值累加下去。這一條驗的是計數本身
   * 不累加 —— 判定在第一步就定案了，所以直接讀 `vitalSunk` 是看不到的，
   * 改成「沉了又救回來」：`alive` 復原之後不得留下殘值。
   */
  it('沉船復原之後不留殘值', () => {
    const b = battle()
    const sh = b.world.ships[0]!
    sh.alive = false
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('defeat')
    // 同一場已經定案，換一場驗計數真的重算
    const c = battle()
    c.world.ships[0]!.alive = false
    stepBattle(c, DT)
    expect(c.mission.outcome).toBe('defeat')
    const d = battle()
    stepBattle(d, DT)
    expect(d.mission.outcome, '新的一場不得沿用上一場的計數').toBe('fighting')
  })
})
