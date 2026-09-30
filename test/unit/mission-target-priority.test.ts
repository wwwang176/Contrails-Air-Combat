import { describe, expect, it } from 'vitest'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import type { ReadyMissionCard } from '../../src/battle/missions'
import { createBattle } from '../../src/battle/setup'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { createCommand } from '../../src/control/Controller'
import { A6M5 } from '../../src/specs/a6m5'
import { F4F4 } from '../../src/specs/f4f4'
import type { AircraftSpec } from '../../src/specs/types'
import { createBombBay, type BombBay } from '../../src/weapons/bomb'
import { A6M5_BOMB_LOADOUT } from '../../src/weapons/stores'
import { SHIP_CLASSES, createShip, type Ship } from '../../src/world/ships'
import { createShipGuns } from '../../src/world/shipGuns'

/**
 * # 任務的目標優先
 *
 * 日 M1：F4F 先打陸攻、零戰先打 F4F。盟 M3：掛彈的零戰仍然先打船。
 * 只驗接線與分支有沒有生效；打起來合不合理是試玩的事。
 */

const DT = 1 / 240

/** 擺在 (x, y, z)、朝 −Z 以 200 m/s 平飛 */
function craft(spec: AircraftSpec, x: number, y: number, z: number): Aircraft {
  const a = new Aircraft(spec, y, 200)
  a.state.position.set(x, y, z)
  a.state.velocity.set(0, 0, -200)
  a.state.orientation.identity()
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.identity()
  return a
}

/** 紅隊的驅逐艦，停在 (x, z) */
function destroyer(x: number, z: number): Ship {
  const s = createShip(0, SHIP_CLASSES.fletcher, 'red', x, z, 0, 0)
  s.guns = createShipGuns(SHIP_CLASSES.fletcher)
  s.gunCooldowns = new Float32Array(SHIP_CLASSES.fletcher.zones.length)
  return s
}

const card = MISSIONS.japan.find((m) => m.id === 'japan-m1') as ReadyMissionCard

describe('日 M1 的目標優先', () => {
  /** 【陸攻在 F4F 眼中比零戰值錢】少了它，F4F 只看威脅與幾何，會去纏會還手的零戰 */
  it('陸攻的座位吃卡片的轟炸機倍率，戰鬥機維持 1', () => {
    const want = card.battle.bomberPriority
    expect(want).toBeGreaterThan(1)
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    let bombers = 0
    for (const c of b.world.combatants) {
      if (c.aircraft.spec.role === 'bomber') {
        bombers++
        expect(b.board.priority[c.index]).toBe(want)
      } else {
        expect(b.board.priority[c.index]).toBe(1)
      }
    }
    expect(bombers).toBe(card.battle.convoyCount)
  })

  /**
   * 【沒掛彈的戰鬥機不插隊打船】對艦分支排在空戰之前，只給掛了彈的那幾架。
   * 戰鬥機進了那一支的話，整隊零戰會丟下 F4F 去掃射巡洋艦。
   * 掛了彈的那一架是對照組：同一個情境下它要進對艦分支
   */
  it('有 F4F 也有敵艦時，沒掛彈的零戰鎖 F4F、掛了彈的去打船', () => {
    const pick = (bay: BombBay) => {
      const self = craft(A6M5, 0, 500, 0)
      const enemy = craft(F4F4, 900, 500, -1200)
      const ai = new AiController()
      ai.board = createTargetBoard([
        { index: 0, aircraft: self, team: 'blue', alive: true },
        { index: 1, aircraft: enemy, team: 'red', alive: true },
      ])
      ai.selfIndex = 0
      ai.ships = [destroyer(0, -1500)]
      ai.bombBay = bay
      ai.update(self, DT, createCommand())
      return { ship: ai.shipAim.ship, target: ai.target, enemy }
    }
    const empty = pick(createBombBay(null))
    expect(empty.ship).toBe(-1)
    expect(empty.target).toBe(empty.enemy)
    expect(pick(createBombBay(A6M5_BOMB_LOADOUT)).ship).toBe(0)
  })
})

describe('盟 M3 的零戰先打船', () => {
  /**
   * 【對艦插隊看的是彈艙容量】盟 M3 的零戰靠卡片的爆戦掛載才有容量；掛載被拿掉的話
   * 它們會改成先纏 F6F，艦隊沒人去打，而且不報錯
   */
  it('紅隊零戰開場的彈艙容量大於 0', () => {
    const m3 = MISSIONS.allies.find((m) => m.id === 'allies-m3') as ReadyMissionCard
    const b = createBattle({ update() {} }, missionConfigFrom(m3), 1)
    const zeros = b.world.combatants.filter((c) => c.team === 'red' && c.aircraft.spec.id === 'a6m5')
    expect(zeros.length).toBeGreaterThan(0)
    for (const c of zeros) expect(c.bombBay.capacity, `第 ${c.index} 架`).toBeGreaterThan(0)
  })
})
