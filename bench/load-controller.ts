import type { Aircraft } from '../src/aircraft/Aircraft'
import type { Command, Controller } from '../src/control/Controller'

/** 效能負載共用的固定航向控制器；是否持續開火由負載決定。 */
export class LoadController implements Controller {
  constructor(private readonly firing = false) {}

  update(_aircraft: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.7
    out.brake = 0
    out.firing = this.firing
    out.bombing = false
    out.upright = false
    out.pull = false
    out.trackTurn = false
    out.releaseFloor = 0
  }
}
