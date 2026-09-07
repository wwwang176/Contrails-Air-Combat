import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { SHIP_CLASSES, createShip, type Ship } from '../../src/world/ships'
import { createShipGuns, resetShipGuns } from '../../src/world/shipGuns'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { G4M } from '../../src/specs/g4m'
import { bombDragK, BOMB_TERMINAL_SPEED } from '../../src/world/bomb'
import { createShipAim, pickShipTarget } from '../../src/ai/shipAttack'
import {
  RUN_ALTITUDE, TORPEDO_PROFILE, setTorpedoBallistics,
} from '../../src/ai/torpedoRun'
import { createStrikeState, stepStrike, type StrikePlan } from '../../src/ai/strikeRun'
import { createCommand } from '../../src/control/Controller'

const DT = 1 / 240
const K = bombDragK(BOMB_TERMINAL_SPEED)

/**
 * # 紅方的一式陸攻打得到藍方的船嗎
 *
 * **這一整條路徑從來沒有跑過。** 既有的 `torpedo-vs-ship.test.ts` 是玩家
 * （藍隊）的 G4M 打紅艦；盟 M4 是反過來的 —— 紅方的 G4M 打藍方的第 58
 * 特遣艦隊。
 *
 * 每一層查起來都是團隊感知的（`pickShipTarget` 的 `s.team === selfTeam`
 * 早退、`shipGuns.ts` 的 `o.team === ship.team` 早退、`placeFleet` 逐字
 * 透傳 `e.team`），但**「查起來是對的」與「真的跑過」是兩件事**。
 *
 * 少了這一支，盟 M4 的每一條護欄都會綠，而玩起來是「敵機繞著艦隊飛，
 * 什麼也不做」。
 */

/** 一艘藍方的航母，擺在原點 */
function blueCarrier(world: World): Ship {
  const ship = createShip(world.ships.length, SHIP_CLASSES.essex!, 'blue', 0, 0, 0, 0)
  ship.guns = createShipGuns(ship.cls)
  ship.gunCooldowns = new Float32Array(ship.cls.zones.length)
  resetShipGuns(ship)
  world.ships.push(ship)
  return ship
}

/** 一台紅方的一式陸攻，在航路高度上朝 −Z 直飛，距船 `d` 公尺 */
function redBomber(d: number): Aircraft {
  const a = new Aircraft(G4M)
  a.state.position.set(0, RUN_ALTITUDE, d)
  a.state.velocity.set(0, 0, -100)
  return a
}

function sea(): World {
  const world = new World()
  world.groundAt = () => 0
  world.waterAt = () => 0
  return world
}

describe('紅方的一式陸攻對藍方艦隊', () => {
  /**
   * 【索敵】`pickShipTarget` 跳過同隊的船。紅方看得到藍船，看不到紅船。
   */
  it('紅機選得到藍船，選不到紅船', () => {
    const world = sea()
    const blue = blueCarrier(world)
    const out = createShipAim()
    const p = new Vector3(0, RUN_ALTITUDE, 1500)

    expect(pickShipTarget(p, 'red', world.ships, out)).toBe(true)
    expect(out.ship).toBe(0)

    // 同一艘船、同一個位置，換成藍方來看就不該選得到
    expect(pickShipTarget(p, 'blue', world.ships, out)).toBe(false)
    expect(blue.team).toBe('blue')
  })

  /**
   * 【剖面】紅機對藍船解得出雷擊航路 —— 鎖定距離為正、脫離距離為正。
   */
  it('紅機對藍船解得出雷擊航路', () => {
    setTorpedoBallistics(K, DT)
    const world = sea()
    blueCarrier(world)
    const self = redBomber(3000)
    const plan: StrikePlan = { aim: new Vector3(), lockRange: 0, egressRange: 0 }
    TORPEDO_PROFILE.plan(self, world.ships[0]!, plan)
    // 【鎖定距離為正 = 這一拍算得出一條航路】0 的意思是「還不到鎖的時候」
    expect(plan.lockRange).toBeGreaterThan(0)
    expect(plan.egressRange).toBeGreaterThan(0)
  })

  /**
   * 【端到端】把紅機交給打擊狀態機跑到它真的投雷，然後看藍船掉不掉血。
   *
   * **這一條是整支的重點。** 前兩條各自只證明一層。
   */
  it('紅機投得出雷，而且藍船會掉血', () => {
    setTorpedoBallistics(K, DT)
    const world = sea()
    const ship = blueCarrier(world)
    const hp0 = ship.hp
    const self = redBomber(4000)
    const state = createStrikeState()
    const out = createCommand()

    let dropped = false
    for (let i = 0; i < 240 * 240; i++) {
      // 【每 24 步一個決策拍】與 `AiController` 的 10 Hz 同頻
      stepStrike(
        state, self, ship, 0, TORPEDO_PROFILE,
        !dropped, i % 24 === 0, DT, out,
      )
      // 【姿態要跟著指令走】不推進飛行模型的話它永遠停在初始姿態，
      // 剖面的「對正才鎖」就永遠不成立
      self.update(out.aimWorld, out.throttle, DT, out.brake)
      if (out.bombing && !dropped) {
        const v = self.state.velocity
        const p = self.state.position
        world.dropTorpedo(
          p.x, p.y, p.z, v.x, v.y, v.z, 15_000,
          v.x / Math.hypot(v.x, v.z), v.z / Math.hypot(v.x, v.z), 1,
        )
        dropped = true
      }
      world.step(DT)
      if (dropped && world.torpedoes.live === 0) break
    }

    expect(dropped, '紅機從來沒有投出去').toBe(true)
    expect(ship.hp, '藍船沒有掉血').toBeLessThan(hp0)
  })
})
