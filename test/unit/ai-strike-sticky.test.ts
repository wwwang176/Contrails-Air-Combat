import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { BOMB_PROFILE } from '../../src/ai/bombRun'
import { B17G } from '../../src/specs/b17g'
import { createGroundTarget } from '../../src/world/groundTargets'

/**
 * # 一趟攻擊只打一個目標
 *
 * 同價值的目標比距離，飛機一動最近的那個就換，進場到一半瞄點跳走，飛機
 * 帶著坡度鎖航向、整趟放不出來。目標只在三個時機重選：還沒有、被炸掉、
 * 上一趟結束（`StrikeState.repick`）。
 */

const DT = 1 / 240
const ALT = 1500

function setup() {
  const w = new World()
  w.crashPolicy = () => false
  // 同一種建築、同價值：A 起初比較近
  w.groundTargets.push(createGroundTarget(0, 'boilerHouse', 'red', -300, -6000, 0))
  w.groundTargets.push(createGroundTarget(1, 'boilerHouse', 'red', 300, -6300, 0))
  const ai = new AiController()
  const pos = new Vector3(0, ALT, 0)
  const c = w.add(new Aircraft(B17G, ALT, 95), ai, 'blue', pos, ALT, 95)
  c.respawnOnDestroy = false
  ai.board = createTargetBoard([c])
  ai.selfIndex = 0
  ai.groundTargets = w.groundTargets
  ai.bombBay = c.bombBay
  ai.bombDrag = w.bombDrag
  ai.strikeProfile = BOMB_PROFILE
  const run = (seconds: number) => { for (let i = 0; i < seconds * 240; i++) w.step(DT) }
  /** 瞬移到 B 比較近的地方 */
  const moveNearB = () => {
    c.aircraft.state.position.set(600, ALT, -5000)
    c.aircraft.prevPosition.copy(c.aircraft.state.position)
  }
  return { w, ai, run, moveNearB }
}

describe('打擊目標的黏性', () => {
  it('進場途中另一個同價值的變近了：不換', () => {
    const { ai, run, moveNearB } = setup()
    run(0.5)
    expect(ai.strikeRef.index).toBe(0)
    moveNearB()
    run(0.5)
    expect(ai.strikeRef.index).toBe(0)
  })

  it('目標被炸掉：重選', () => {
    const { w, ai, run, moveNearB } = setup()
    run(0.5)
    moveNearB()
    w.groundTargets[0]!.alive = false
    run(0.5)
    expect(ai.strikeRef.index).toBe(1)
  })

  describe('更值錢的出現', () => {
    function withOilTank() {
      const s = setup()
      // 手上是一座油槽（比鍋爐房便宜），鍋爐房就在旁邊
      s.w.groundTargets.push(createGroundTarget(2, 'oilTank', 'red', 0, -5800, 0))
      s.ai.strikeRef.kind = 'ground'
      s.ai.strikeRef.index = 2
      return s
    }

    it('還沒進直飛段：換過去', () => {
      const { ai, run } = withOilTank()
      run(0.5)
      expect(ai.strikeRef.index).not.toBe(2)
    })

    it('直飛段中：不換', () => {
      const { ai, run } = withOilTank()
      ai.strike.phase = 'run'
      ai.strike.target = 2
      run(0.5)
      expect(ai.strike.phase).toBe('run')
      expect(ai.strikeRef.index).toBe(2)
    })
  })

  it('上一趟結束：重選最近的', () => {
    const { ai, run, moveNearB } = setup()
    run(0.5)
    moveNearB()
    ai.strike.repick = true
    run(0.5)
    expect(ai.strikeRef.index).toBe(1)
    expect(ai.strike.repick).toBe(false)
  })
})
