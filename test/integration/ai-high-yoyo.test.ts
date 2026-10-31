import { describe, it, expect } from 'vitest'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_STEER } from '../../src/ai/steerConfig'
import { VETERAN } from '../../src/ai/profile'
import { P51D } from '../../src/specs/p51d'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import type { Command, Controller } from '../../src/control/Controller'

/** 只關閉傷害；雙方位置、速度、姿態全由正式物理更新。 */
class Pursuer extends AiController {
  shots = 0
  override update(a: Aircraft, dt: number, out: Command): void {
    super.update(a, dt, out)
    if (out.firing) this.shots += dt
    out.firing = false
  }
}
const level: Controller = { update(_a, _dt, out) {
  out.aimWorld.set(0,0,-1);out.throttle=0.5;out.brake=0;out.firing=false
} }

describe('正式 AI 提前 high yo-yo', () => {
  it('遊戲物理下在原三秒門檻之前拉高，之後結束回升並重新取得射擊窗口', () => {
    const world=new World(),spec=applyFeel(P51D,GAME_FEEL)
    const mine=new Aircraft(spec,2500,210),target=new Aircraft(spec,2500,100)
    target.state.position.z=-650;target.prevPosition.copy(target.state.position)
    const ai=new Pursuer();ai.target=target;ai.profile=VETERAN
    const a=world.add(mine,ai,'blue',mine.state.position.clone(),2500,210)
    const b=world.add(target,level,'red',target.state.position.clone(),2500,100)
    a.respawnOnDestroy=false;b.respawnOnDestroy=false
    let started=false,ended=false,startHeight=0,gain=0,shotsAtEnd=0
    for(let i=0;i<45*240;i++){
      world.step(1/240)
      expect(a.alive&&b.alive).toBe(true)
      if(!started&&ai.band.forced){
        started=true;startHeight=mine.state.position.y
        expect(ai.sit.timeToMerge).toBeGreaterThan(DEFAULT_STEER.airPassLead)
        expect(ai.sit.timeToMerge).toBeLessThan(DEFAULT_STEER.highYoYoLead)
        expect(ai.intent==='engage'||ai.intent==='approach').toBe(true)
      }
      if(started&&!ended){
        gain=Math.max(gain,mine.state.position.y-startHeight)
        if(!Number.isFinite(ai.band.perch)){ended=true;shotsAtEnd=ai.shots}
      }
    }
    expect(started&&ended).toBe(true)
    expect(gain).toBeGreaterThan(300)
    expect(ai.shots-shotsAtEnd).toBeGreaterThan(0.1)
    ai.resetAirTactics()
    expect(ai.band.forced).toBe(false)
    expect(Number.isNaN(ai.band.perch)).toBe(true)
  })
})
