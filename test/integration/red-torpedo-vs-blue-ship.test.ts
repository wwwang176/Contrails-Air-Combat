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
import type { StrikePlan } from '../../src/ai/strikeRun'

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
   * 【紅隊投的魚雷傷得了藍船】直接投一枚，不經過 AI。
   *
   * 【為什麼不讓 AI 飛完一整趟】那會把「AI 飛得夠好嗎」綁進這一條：進場
   * 幾何、`RUN_ALTITUDE`、`LOCK_CONE`、裝填秒數任何一個被調就會紅，而那時
   * 紅的不是缺陷，是有人在調手感。**AI 打得準不準是試飛的事。**
   *
   * 這一支要證明的是**方向**：紅隊投的東西傷得了藍隊的船。既有的
   * `torpedo-vs-ship.test.ts` 只跑過藍打紅。
   */
  it('紅隊投的魚雷打得掉藍船的血', () => {
    const world = sea()
    const ship = blueCarrier(world)
    const hp0 = ship.hp
    // 從艦艏前方朝船投，`team = 1`（紅）
    world.dropTorpedo(0, 40, -800, 0, 0, 90, 15_000, 0, 1, 1)
    for (let i = 0; i < 240 * 160 && world.torpedoes.live > 0; i++) world.step(DT)
    expect(ship.hp, '藍船沒有掉血').toBeLessThan(hp0)
  })

  /**
   * 【魚雷不看隊別 —— 這是現況，已回報負責人】`onTorpedoBlocked`
   * （`World.ts:751`）的迴圈只跳過沉船，沒有 `sh.team` 的比較，所以自家的
   * 魚雷一樣打得掉自家的船。
   *
   * **與機槍不一致**：`World.ts:1073` 對友軍的船是早退的。範圍傷害
   * （`applyBombBlast`）則與魚雷一樣不分隊 —— 那一條講得通（爆炸不看陣營），
   * 魚雷這一條講不講得通是遊戲設計的決定。
   *
   * 這一輪的兩關都不受影響：日 M4 只有藍方掛雷、紅方全是船；盟 M4 反過來。
   *
   * 這一條**釘住現況**，不是主張它是對的。要改是動模擬，那是負責人的決定。
   */
  it('魚雷不分隊別 —— 藍隊投的一樣打得掉藍船', () => {
    const world = sea()
    const ship = blueCarrier(world)
    const hp0 = ship.hp
    world.dropTorpedo(0, 40, -800, 0, 0, 90, 15_000, 0, 1, 0)
    for (let i = 0; i < 240 * 160 && world.torpedoes.live > 0; i++) world.step(DT)
    expect(ship.hp).toBeLessThan(hp0)
  })
})
