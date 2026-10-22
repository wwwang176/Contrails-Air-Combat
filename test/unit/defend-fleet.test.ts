import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, resetBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { Idle } from '../tools/spawn-snapshot'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import {
  CAMPAIGNS, MISSIONS, missionConfigFrom,
  type MissionFleet, type ReadyMissionCard,
} from '../../src/battle/missions'
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

  /** 【保護日 M3】紅方的船沉掉與 `vitalSunk` 無關 */
  it('敵方的船沉掉不算輸', () => {
    const b = battle()
    sink(b, 2)
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('fighting')
  })

  /**
   * 【每一步要歸零】計數放在跨場共用的快照裡，少了歸零就是上一步的值累加下去。
   * 判定在第一步就定案了，所以直接讀 `vitalSunk` 是看不到的：沉了判輸之後
   * 就地 `resetBattle`（航母浮回來），再走一步不得沿用上一步的計數。
   */
  it('沉船復原之後不留殘值', () => {
    const b = battle()
    sink(b, 0)
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('defeat')
    resetBattle(b, 1)
    expect(b.world.ships[0]!.alive).toBe(true)
    stepBattle(b, DT)
    expect(b.mission.outcome, '重開之後不得沿用上一場的計數').toBe('fighting')
  })
})

/**
 * 守住艦隊的卡片。
 *
 * 【為什麼卡片自己要有測試】`missionConfigFrom` 是**明列欄位、不透傳未知
 * 資料**，而漏抄一格的症狀是「型別過了但進戰鬥少了東西」，不報錯。
 */
describe('守住艦隊的卡片', () => {
  /**
   * 【恰好一艘要害艦，而且是我方的】漏標的症狀是「這一關永遠不會輸」而畫面上
   * 一切正常；多標的症狀是「掉一艘驅逐艦就輸」；標在敵艦上永遠不會輸。都不報錯。
   */
  it('每一張守艦隊的卡恰好一艘要害艦，而且是我方的', () => {
    const defend = CAMPAIGNS.flatMap((c) => MISSIONS[c])
      .filter((m): m is ReadyMissionCard => m.battle !== null)
      .filter((m) => missionConfigFrom(m).rules.kind === 'defend')
    expect(defend.length).toBeGreaterThan(0)
    for (const m of defend) {
      const vital = m.battle.fleet!.ships.filter((s) => s.vital === true)
      expect(vital.length, m.id).toBe(1)
      expect(vital[0]!.team, m.id).toBe('blue')
    }
  })
})

describe('盟 M3：沖繩外海', () => {
  const card = MISSIONS.allies.find((m) => m.id === 'allies-m3')!
  const b = card.battle!

  /**
   * 【透傳】艦隊原樣、重生排在波次前面。
   *
   * 【為什麼重生在前】波次的 `batch` 條件讀的是同一步剛加上去的批數，
   * 排在後面的話會晚一個物理步預警，而兩則預警本該同一刻
   */
  it('走完 missionConfigFrom 之後艦隊原樣、重生排在增援前面', () => {
    const cfg = missionConfigFrom(card as ReadyMissionCard)
    expect(cfg.fleet).toBe(b.fleet)
    const kinds = cfg.beats!.map((x) => x.kind)
    expect(kinds[0]).toBe('recycle')
    expect(kinds).toContain('reinforce')
  })

  /** 【端到端】進戰鬥之後打沉航母就判輸 */
  it('進戰鬥之後打沉航母 → defeat', () => {
    const bt = createBattle(new Idle(), missionConfigFrom(card as ReadyMissionCard))
    expect(bt.world.ships.length).toBe(b.fleet!.ships.length)
    const carrier = bt.world.ships.find((s) => s.vital)!
    expect(carrier.team).toBe('blue')
    stepBattle(bt, DT)
    expect(bt.mission.outcome).toBe('fighting')
    carrier.alive = false
    stepBattle(bt, DT)
    expect(bt.mission.outcome).toBe('defeat')
  })
})

describe('守住艦隊的目標列印航母的血量百分比', () => {
  /**
   * 【不印敵機數】零戰整隊重生，敵機數一直回到 16，讀不出仗打到哪裡；
   * 玩家要盯的是航母還剩幾成。要害艦的血量比例每步從船讀，HUD 印成百分比
   */
  it('metric 是要害艦的血量比例，種類是 percent', () => {
    const card = MISSIONS.allies.find((m) => m.id === 'allies-m3')!
    const bt = createBattle(new Idle(), missionConfigFrom(card as ReadyMissionCard))
    stepBattle(bt, DT)
    expect(bt.mission.metricKind).toBe('percent')
    expect(bt.mission.metric).toBeCloseTo(1, 6)
    const essex = bt.world.ships.find((s) => s.vital)!
    essex.hp = essex.cls.hp * 0.4
    stepBattle(bt, DT)
    expect(bt.mission.metric).toBeCloseTo(0.4, 6)
  })
})
