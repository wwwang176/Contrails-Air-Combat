import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { rallyAim, rallyCommand } from '../../src/ai/rally'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { P51D } from '../../src/specs/p51d'

/** 在 4000 m、機首朝 −Z、以 200 m/s 平飛的飛機 */
function flyer(): Aircraft {
  const a = new Aircraft(P51D, 4000, 200)
  a.state.position.set(0, 4000, 0)
  a.state.velocity.set(0, 0, -200)
  a.state.orientation.identity()
  a.prevPosition.copy(a.state.position)
  return a
}

describe('rallyAim', () => {
  it('瞄準點指向集合點，且是單位向量', () => {
    const self = flyer()
    const out = new Vector3()
    rallyAim(self, new Vector3(3000, 4000, 0), out)
    expect(out.length()).toBeCloseTo(1, 9)
    expect(out.x).toBeCloseTo(1, 9)
    expect(out.y).toBeCloseTo(0, 9)
    expect(out.z).toBeCloseTo(0, 9)
  })

  it('集合點在上方時瞄準點朝上', () => {
    const self = flyer()
    const out = new Vector3()
    rallyAim(self, new Vector3(0, 6000, -3000), out)
    expect(out.y).toBeGreaterThan(0)
  })

  /**
   * 【退化】飛機剛好在集合點上時方向沒有定義。回機首而不是 NaN ——
   * NaN 會流進指揮儀，所有比較都變成 false（`stationPoint` 的註解記過
   * 同一件事）。
   */
  it('已經在集合點上 → 回機首方向，不產生 NaN', () => {
    const self = flyer()
    const out = new Vector3()
    rallyAim(self, self.state.position.clone(), out)
    expect(Number.isNaN(out.x + out.y + out.z)).toBe(false)
    expect(out.length()).toBeCloseTo(1, 9)
    expect(out.z).toBeCloseTo(-1, 6)
  })
})

describe('rallyCommand', () => {
  it('遠離集合點時全推力，不減速', () => {
    const self = flyer()
    const cmd = createCommand()
    rallyCommand(self, new Vector3(0, 4000, -5000), cmd)
    expect(cmd.throttle).toBe(WEP_THROTTLE)
    expect(cmd.brake).toBe(0)
  })

  /** 開火紀律是獨立的一層，撤離途中不開槍 */
  it('不開火', () => {
    const self = flyer()
    const cmd = createCommand()
    cmd.firing = true
    rallyCommand(self, new Vector3(0, 4000, -5000), cmd)
    expect(cmd.firing).toBe(false)
  })

  it('瞄準點與 rallyAim 一致', () => {
    const self = flyer()
    const cmd = createCommand()
    const point = new Vector3(1000, 5000, -2000)
    const expected = new Vector3()
    rallyAim(self, point, expected)
    rallyCommand(self, point, cmd)
    expect(cmd.aimWorld.x).toBeCloseTo(expected.x, 12)
    expect(cmd.aimWorld.y).toBeCloseTo(expected.y, 12)
    expect(cmd.aimWorld.z).toBeCloseTo(expected.z, 12)
  })
})
