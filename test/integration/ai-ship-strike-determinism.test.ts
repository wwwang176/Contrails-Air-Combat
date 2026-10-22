import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'
import { G4M } from '../../src/specs/g4m'
import { resetBombBay } from '../../src/weapons/bomb'
import { wireBattleAi } from '../../src/app/wireBattleAi'
import type { Loadout } from '../../src/weapons/stores'

/**
 * # AI 對艦攻擊的決定性
 *
 * 一台 G4M、一艘不開火的船，接線走 `wireBattleAi`（與 `main.ts` 同一個接線點）。
 * 魚雷與炸彈各走自己的剖面（`TORPEDO_PROFILE`／`BOMB_PROFILE`），兩條都驗。
 */

const DT = 1 / 240

/** 500 kg × 2。G4M 的預設掛載是魚雷，這一份走轟炸航路 */
const BOMB_LOAD: Loadout = { kind: 'bomb', count: 2, damage: 11_700, reloadSeconds: 20 }

/** 第一枚投出之前最多等幾秒。實測炸彈約 26 秒、魚雷約 33 秒 */
const DROP_LIMIT = 120
/** 投出之後再飛幾秒：落彈約 14 秒 */
const FALL_SECONDS = 20

/** `loadout` 省略 = G4M 的預設（魚雷） */
function run(loadout?: Loadout) {
  const w = new World()
  // 【關掉墜地】量的是投彈，不是撞海
  w.crashPolicy = () => false
  const ship = createShip(0, SHIP_CLASSES.wichita, 'red', 0, -4000, 0, 8)
  ship.guns = []
  ship.gunCooldowns = new Float32Array(0)
  w.ships.push(ship)
  const ai = new AiController()
  const c = w.add(new Aircraft(G4M), ai, 'blue', new Vector3(0, 1000, 1000), 1000, 110)
  // 【`w.add` 只存重生點】飛機要自己放過去
  c.aircraft.state.position.copy(c.spawnPosition)
  c.aircraft.prevPosition.copy(c.aircraft.state.position)
  // 【掛載先換、再接線】`wireBattleAi` 依 `c.loadout` 選剖面
  if (loadout !== undefined) {
    c.loadout = loadout
    resetBombBay(c.bombBay, c.loadout)
  }
  ai.board = createTargetBoard([c])
  ai.selfIndex = c.index
  wireBattleAi(w, {}, c, new AiController(), { islands: [] })

  const dropped = (): number => w.bombs.dropped + w.torpedoes.dropped
  while (dropped() === 0 && w.time < DROP_LIMIT) w.step(DT)
  const t0 = w.time
  while (w.time < t0 + FALL_SECONDS) w.step(DT)
  const e = w.bombEvents
  return {
    dropped: dropped(),
    points: Array.from(e.data.subarray(0, e.count * 6)),
    // 【魚雷要看池子】落彈事件只記炸彈；投雷後 20 秒魚雷還在水裡跑、沒打到船，
    // 不比池子的話魚雷的散佈換成亂數也照樣相等
    torpedoes: [...w.torpedoes.x, ...w.torpedoes.z],
    hp: ship.hp,
    position: c.aircraft.state.position.toArray(),
  }
}

describe('AI 一式陸攻對艦攻擊', () => {
  /**
   * 【決定性】spec §7.1。投彈的散佈走 `spreadPair(bombs.dropped)`，是累計
   * 序號的雜湊而不是 `Math.random()`；釋放的判準是純函數。所以同一組初始
   * 狀態跑兩次必須逐位元相同。
   *
   * 【比落點與船的血量而不是只比枚數】枚數相同但落點不同的話，枚數那一條看不
   * 出來 —— 而落點才是這件事的內容。
   */
  for (const [name, loadout] of [['魚雷', undefined], ['炸彈', BOMB_LOAD]] as const) {
    it(`${name}：跑兩次逐位元相同`, () => {
      const a = run(loadout)
      const b = run(loadout)
      // 【一枚都沒投的話下面的比較是空的】
      expect(a.dropped).toBeGreaterThan(0)
      expect(b).toEqual(a)
    })
  }
})
