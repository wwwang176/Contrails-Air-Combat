import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { VETERAN } from '../../src/ai/profile'
import { P51D } from '../../src/specs/p51d'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import { World } from '../../src/world/World'
import type { Command } from '../../src/control/Controller'
import { solveLead, NO_INTERCEPT } from '../../src/world/lead'

/** 真實物理與正式控制器，只停用傷害以保留完整觀察窗。 */
class ObserverAi extends AiController {
  override update(a:Aircraft, dt:number, out:Command):void {
    super.update(a,dt,out); out.firing=false; out.bombing=false
  }
}
class PersistentPursuer extends ObserverAi {
  private los=new Vector3()
  private relative=new Vector3()
  private lead=new Vector3()
  private smooth=new Vector3(0,0,-1)
  constructor(private victim:Aircraft) { super(); this.defenceManeuversEnabled=false }
  override update(a:Aircraft,dt:number,out:Command):void {
    super.update(a,dt,out)
    if(this.safetyAction!=='none')return
    this.los.copy(this.victim.state.position).sub(a.state.position)
    this.relative.copy(this.victim.state.velocity).sub(a.state.velocity)
    if(solveLead(this.los,this.relative,a.spec.battery.sight.muzzleVelocity,this.lead)===NO_INTERCEPT)
      this.lead.copy(this.los).normalize()
    this.smooth.lerp(this.lead,1-Math.exp(-dt/0.3)).normalize()
    out.aimWorld.copy(this.smooth);out.trackTurn=true;out.throttle=1;out.brake=0
  }
}

describe('正式防禦換招的實際飛行',()=>{
  for(const [altitude,count] of [[2500,1],[400,1],[2500,3]] as const)it(`${altitude} m／${count} 架持續追擊下會換招，保留安全輸出與有限高度預算`,()=>{
    const world=new World(),spec=applyFeel(P51D,GAME_FEEL)
    const self=new Aircraft(spec,altitude,150),enemy=new Aircraft(spec,altitude,157.5)
    enemy.state.position.set(20,altitude,350);enemy.prevPosition.copy(enemy.state.position)
    const defence=new ObserverAi(),attack=new PersistentPursuer(self)
    defence.profile=VETERAN;attack.profile=VETERAN
    const a=world.add(self,defence,'blue',self.state.position.clone(),altitude,150)
    const b=world.add(enemy,attack,'red',enemy.state.position.clone(),altitude,157.5)
    a.respawnOnDestroy=false;b.respawnOnDestroy=false
    for(let i=1;i<count;i++){
      const extra=new Aircraft(spec,altitude,157.5)
      extra.state.position.set(i===1?-80:80,altitude,350+i*100)
      extra.prevPosition.copy(extra.state.position)
      const pilot=new PersistentPursuer(self);pilot.profile=VETERAN
      const c=world.add(extra,pilot,'red',extra.state.position.clone(),altitude,157.5)
      c.respawnOnDestroy=false
    }
    let remote:Aircraft|null=null
    if(count>1){
      remote=new Aircraft(spec,altitude,150);remote.state.position.z=-5000
      remote.prevPosition.copy(remote.state.position)
      world.add(remote,{update(_a,_dt,out){out.aimWorld.set(0,0,-1);out.throttle=0.7;out.firing=false}},
        'red',remote.state.position.clone(),altitude,150).respawnOnDestroy=false
      defence.focusTarget=remote
    }
    const board=createTargetBoard(world.combatants)
    defence.board=board;defence.selfIndex=0;attack.board=board;attack.selfIndex=1
    for(let i=2;i<world.combatants.length;i++){
      const pilot=world.combatants[i]!.controller as PersistentPursuer
      if(!(pilot instanceof AiController))continue
      pilot.board=board;pilot.selfIndex=i
    }
    let minimum:number=altitude,finite=true,mostThreats=0
    const phases=new Set<string>()
    for(let i=0;i<60*240;i++){
      world.step(1/240)
      minimum=Math.min(minimum,self.state.position.y)
      finite &&= [...self.state.position.toArray(),...self.state.velocity.toArray()].every(Number.isFinite)
      phases.add(defence.defensive.label)
      mostThreats=Math.max(mostThreats,defence.defenceThreats.activeCount)
      if(!a.alive||!b.alive)break
    }
    console.log({altitude,count,minimum,phases:[...phases],changes:defence.defensive.changes,mostThreats})
    expect(a.alive&&b.alive&&finite).toBe(true)
    expect(phases.has('短促換面')).toBe(true)
    expect(defence.defensive.changes).toBeGreaterThan(1)
    expect(minimum).toBeGreaterThan(altitude-200)
    expect(defence.defensive.memory.reports).toHaveLength(0)
    expect(mostThreats).toBe(count)
    if(remote)expect(defence.target).toBe(remote)
  })
})
