import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { Idle } from '../tools/spawn-snapshot'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import {
  MISSIONS, missionConfigFrom, missionRules,
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

/**
 * 盟 M4「沖繩外海」的卡片。
 *
 * 【為什麼卡片自己要有測試】`missionConfigFrom` 是**明列欄位、不透傳未知
 * 資料**，而漏抄一格的症狀是「型別過了但進戰鬥少了東西」，不報錯。
 */
describe('盟 M4：沖繩外海', () => {
  const card = MISSIONS.allies.find((m) => m.id === 'allies-m4')!
  const b = card.battle!

  it('打得起來了', () => {
    expect(card.battle).not.toBeNull()
  })

  it('規則是守住艦隊', () => {
    expect(missionRules(card as ReadyMissionCard, b.altitude ?? 4000, 750))
      .toEqual({ kind: 'defend' })
  })

  /**
   * 【恰好一艘要害艦】漏標的症狀是「這一關永遠不會輸」而畫面上一切正常；
   * 多標的症狀是「掉一艘驅逐艦就輸」。兩種都不報錯。
   */
  it('艦隊 9 艘、全部是我方的、恰好一艘要害艦', () => {
    const ships = b.fleet!.ships
    expect(ships.length).toBe(9)
    for (const s of ships) expect(s.team).toBe('blue')
    expect(ships.filter((s) => s.vital === true).length).toBe(1)
    expect(ships.find((s) => s.vital === true)!.cls).toBe('essex')
  })

  /**
   * 【`role` 不能省】省了的話第一批 G4M 進場之後會把自己算進存活數，
   * 第二批就永遠不來。
   */
  it('波次由敵方戰鬥機的存活數觸發，而且有時間兜底', () => {
    const w = b.waves![0]!
    expect(w.when.kind).toBe('alive')
    if (w.when.kind !== 'alive') throw new Error('應為 alive')
    expect(w.when.side).toBe('theirs')
    expect(w.when.role).toBe('fighter')
    expect(w.when.atMost).toBeLessThan(b.redCount)
    expect(Number.isFinite(w.when.byLatest)).toBe(true)
    expect(w.spec.id).toBe('g4m')
  })

  /** 【透傳】艦隊原樣、波次轉成等價的 beats */
  it('走完 missionConfigFrom 之後艦隊與波次都在', () => {
    const cfg = missionConfigFrom(card as ReadyMissionCard)
    expect(cfg.fleet).toBe(b.fleet)
    expect(cfg.beats?.length).toBe(1)
    expect(cfg.beats![0]!.kind).toBe('reinforce')
  })

  /** 【端到端】進戰鬥之後場上真的有九艘藍船，打沉航母就判輸 */
  it('進戰鬥之後打沉航母 → defeat', () => {
    const bt = createBattle(new Idle(), missionConfigFrom(card as ReadyMissionCard))
    expect(bt.world.ships.length).toBe(9)
    const carrier = bt.world.ships.find((s) => s.vital)!
    expect(carrier.team).toBe('blue')
    stepBattle(bt, DT)
    expect(bt.mission.outcome).toBe('fighting')
    carrier.alive = false
    stepBattle(bt, DT)
    expect(bt.mission.outcome).toBe('defeat')
  })
})
