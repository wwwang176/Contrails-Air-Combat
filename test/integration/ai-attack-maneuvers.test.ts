import { describe, expect, it } from 'vitest'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { PURSUIT } from '../../src/ai/pursuitProgress'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { VETERAN } from '../../src/ai/profile'
import { P51D } from '../../src/specs/p51d'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import { World } from '../../src/world/World'
import type { Command } from '../../src/control/Controller'

/** 保留正式射擊判斷供計數，只停用彈丸傷害以觀察完整一輪接戰。 */
class ObserverAi extends AiController {
  firingSteps=0
  override update(a:Aircraft,dt:number,out:Command):void{
    super.update(a,dt,out);if(out.firing)this.firingSteps++
    out.firing=false;out.bombing=false
  }
}
describe('正式攻擊換招的實際飛行',()=>{
  for(const altitude of [2500,400])it(`${altitude} m 空戰依僵持狀態換招，仍可開火並保留安全輸出`,()=>{
    const world=new World(),spec=applyFeel(P51D,GAME_FEEL)
    const target=new Aircraft(spec,altitude,150),self=new Aircraft(spec,altitude,150)
    self.state.position.set(20,altitude,450);self.prevPosition.copy(self.state.position)
    const defence=new ObserverAi(),attack=new ObserverAi()
    for(const ai of [defence,attack])ai.profile=VETERAN
    world.add(target,defence,'blue',target.state.position.clone(),altitude,150).respawnOnDestroy=false
    world.add(self,attack,'red',self.state.position.clone(),altitude,150).respawnOnDestroy=false
    const board=createTargetBoard(world.combatants)
    defence.board=board;defence.selfIndex=0;attack.board=board;attack.selfIndex=1
    let changes=0,minimum=altitude,maxPressure=0
    for(let i=0;i<90*240;i++){
      world.step(1/240);changes=Math.max(changes,attack.offensive.changes)
      for(const ai of [attack,defence]){
        if(ai.intent!=='defend')expect(ai.defensive.label).not.toBe('防禦保高')
      }
      minimum=Math.min(minimum,self.state.position.y)
      maxPressure=Math.max(maxPressure,attack.offensive.progress.pressure)
      if(!world.combatants.every(c=>c.alive))break
    }
    expect(world.combatants.every(c=>c.alive)).toBe(true)
    console.log({altitude,maxPressure,changes,firingSteps:attack.firingSteps,minimum})
    // 保高不再干預一般接戰後，高低空都依實際僵持程度判斷，不強迫額外換招。
    if(maxPressure>=PURSUIT.stale)expect(changes).toBeGreaterThan(0)
    else expect(changes).toBe(0)
    expect(attack.firingSteps).toBeGreaterThan(0)
    expect(minimum).toBeGreaterThan(0)
    expect(self.state.position.toArray().every(Number.isFinite)).toBe(true)
    attack.clearTerrainState();expect(attack.offensive.phase).toBe('off')
    expect(attack.offensive.progress.pressure).toBe(0)
  },30000)
})
