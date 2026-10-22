import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { AiController } from '../../src/ai/AiController'
import type { FlightOrder } from '../../src/ai/commandTypes'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

/**
 * 指揮層的命令通道：`CommandState.orders` 裡的命令要送到分隊每一位成員的
 * `AiController.order`，命令解除時也要一起清掉。
 *
 * 規劃層（`stepCommand`）只寫 `CommandState`，戰機只讀 `AiController.order`；
 * 中間那一段（`stepCommandLayer` 的「發下去」迴圈）斷掉時，指揮官照樣發令、
 * 照樣判到達，戰機卻從頭到尾在自由交戰，沒有任何錯誤。
 */

const DT = 1 / 240

/** 玩家座位放一個什麼都不做的控制器：平飛，不參戰 */
class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.throttle = 0.7
    out.brake = 0
    out.firing = false
  }
}

function rally(point: Vector3): FlightOrder {
  return { kind: 'rally', point, radius: 300, targetFlight: -1, side: 0, focusIndex: -1 }
}

describe('指揮層的命令通道（4v4、兩步）', () => {
  /**
   * 用紅隊的分隊：玩家坐藍隊，紅隊沒有豁免；預設關卡沒有護送、撤離與警戒，
   * 那三種命令都不會蓋過指揮官的這一張。
   */
  it('分隊的命令送到每一位成員；長機到達、命令解除後成員的命令一起清掉', () => {
    const b = createBattle(new Idle(), {
      ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 4, BF109K4, 4),
    })
    const f = b.flights.flights.findIndex((fl) => fl.team === 'red')
    expect(b.redOrderFlights).toContain(f)
    const flight = b.flights.flights[f]!
    const members = (): AiController[] => {
      const out: AiController[] = []
      for (let p = 0; p < flight.count; p++) {
        const ctl = b.world.combatants[flight.members[p]!]!.controller
        if (ctl instanceof AiController) out.push(ctl)
      }
      return out
    }
    expect(members().length).toBe(4)

    // 集合點放在 20 km 外：這一步不會判到達
    const lead = b.world.combatants[flight.members[0]!]!.aircraft
    const order = rally(lead.state.position.clone().add(new Vector3(0, 0, 20000)))
    b.redCommand.orders[f] = order
    stepBattle(b, DT)
    expect(b.redCommand.orders[f]).toBe(order)
    for (const ai of members()) expect(ai.order).toBe(order)

    // 把集合點搬到長機身上：下一步判到達、解除。這一步不是規劃週期，
    // 不會補發新命令，所以成員拿到的 null 就是解除本身
    order.point.copy(lead.state.position)
    stepBattle(b, DT)
    expect(b.redCommand.orders[f]).toBeNull()
    for (const ai of members()) expect(ai.order).toBeNull()
  })
})
