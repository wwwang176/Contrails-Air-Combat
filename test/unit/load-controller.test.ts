import { describe, expect, it } from 'vitest'
import { LoadController } from '../../bench/load-controller'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { P51D } from '../../src/specs/p51d'

describe('效能負載控制器', () => {
  it.each([false, true])('開火設定 %s：完整覆寫舊命令，固定世界航向並重用輸出', firing => {
    const controller = new LoadController(firing)
    const aircraft = new Aircraft(P51D)
    aircraft.state.orientation.set(0, 1, 0, 0)
    const command = createCommand()
    const aim = command.aimWorld
    for (let i = 0; i < 3; i++) {
      command.aimWorld.set(1, 0, 0)
      Object.assign(command, {
        throttle: 1.1, brake: 1, firing: !firing, bombing: true,
        upright: true, pull: true, trackTurn: true, releaseFloor: 60,
      })
      controller.update(aircraft, 1 / 240, command)
      expect(command).toEqual({ ...createCommand(), throttle: 0.7, firing })
      expect(command.aimWorld).toBe(aim)
    }
  })
})
