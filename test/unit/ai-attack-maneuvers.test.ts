import { AiController } from '../../src/ai/AiController'
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import { PursuitProgress, type PursuitSample } from '../../src/ai/pursuitProgress'
import { AttackManeuvers } from '../../src/ai/attackManeuvers'
import { buildEngageBasis, createEngageBasis } from '../../src/ai/engageGeometry'
import { createCommand } from '../../src/control/Controller'

const aircraft=()=>new Aircraft(applyFeel(P51D,GAME_FEEL),2500,150)
describe('攻擊換招的接戰記憶',()=>{
  it('頻繁換人只重算局部幾何，不無限延後換招；持續射擊窗口解除僵持',()=>{
    const targets=[aircraft(),aircraft()],p=new PursuitProgress()
    const sample:PursuitSample={target:targets[0]!,range:450,error:1,aot:1,circling:true,shot:false,energy:3500}
    for(let i=0;i<100;i++)p.update(sample,.1,true)
    const pressure=p.pressure
    p.update({...sample,target:targets[1]!},.1,true)
    expect(p.pressure).toBeGreaterThanOrEqual(pressure-.1);expect(p.localAge).toBeLessThan(.2)
    for(let i=0;i<200;i++)p.update({...sample,target:targets[Math.floor(i/20)%2]!},.1,true)
    expect(p.pressure).toBeGreaterThan(6);expect(p.grace).toBe(0)
    for(let i=0;i<50;i++)p.update({...sample,shot:true},.1,true)
    expect(p.pressure).toBeLessThan(1)
    p.reset();expect(p.target).toBeNull();expect(p.switches).toBe(0);expect(p.pressure).toBe(0)
  })
  it('換招不改扳機；換目標保留高度基準，接回途中換人則取消並保留冷卻',()=>{
    const self=aircraft(),target=aircraft(),next=aircraft(),state=new AttackManeuvers()
    target.state.position.set(200,2500,-400);next.state.position.set(250,2500,-400)
    const basis=createEngageBasis(),out=createCommand()
    buildEngageBasis(self,target,basis)
    for(let i=0;i<20;i++)state.update(self,target,basis,.1,out,true)
    state.progress.pressure=7;out.firing=true;out.bombing=true
    expect(state.update(self,target,basis,.1,out,true)).toBe(true)
    expect(out.firing).toBe(true);expect(out.bombing).toBe(true)
    const height=state.entryAltitude,changes=state.changes
    buildEngageBasis(self,next,basis);state.update(self,next,basis,.1,out,true)
    expect(state.entryAltitude).toBe(height);expect(state.changes).toBe(changes)
    state.phase='高悠悠・接回';buildEngageBasis(self,target,basis)
    expect(state.update(self,target,basis,.1,out,true)).toBe(false)
    expect(state.phase).toBe('off');expect(state.cooldown).toBeGreaterThan(0)
    state.reset();expect(state.changes).toBe(0);expect(state.cooldown).toBe(0)
  })
  it('防禦／安全接管後停止改寫指令；既有能量失敗冷卻不因換人消失',()=>{
    const self=aircraft(),target=aircraft(),next=aircraft(),state=new AttackManeuvers()
    target.state.position.set(200,2500,-400);next.state.position.set(250,2500,-400)
    const basis=createEngageBasis(),out=createCommand();buildEngageBasis(self,target,basis)
    for(let i=0;i<20;i++)state.update(self,target,basis,.1,out,true)
    state.progress.pressure=7;state.update(self,target,basis,.1,out,true)
    expect(state.phase).toBe('高悠悠・拉高')
    self.state.position.y-=130
    state.update(self,target,basis,.1,out,true)
    expect(state.learning).toContain('暫停重用 20 秒')
    for(let i=0;i<50;i++){
      const enemy=i%2?target:next;buildEngageBasis(self,enemy,basis)
      state.progress.pressure=8;state.update(self,enemy,basis,.1,out,true)
      expect(state.phase.startsWith('高悠悠')).toBe(false)
    }
    out.aimWorld.set(1,0,0);state.update(self,next,basis,.1,out,false)
    expect(state.phase).toBe('off');expect(out.aimWorld.toArray()).toEqual([1,0,0])
  })
})

// 以相同指令逐步對照，避免只驗證狀態旗標卻意外改動轟炸或任務操縱。
it('轟炸機、俯衝轟炸機、巡航與撤離不受攻擊換招開關影響',()=>{
  for(const kind of ['bomber','dive','transit','evacuating'] as const){
    const spec={...applyFeel(P51D,GAME_FEEL),...(kind==='bomber'?{role:'bomber' as const}:{}),...(kind==='dive'?{diveBomber:true as const}:{})}
    const self=new Aircraft(spec,2500,150),target=aircraft()
    target.state.position.set(200,2500,-400)
    const a=new AiController(),b=new AiController(),outA=createCommand(),outB=createCommand()
    b.attackManeuversEnabled=false
    for(const ai of [a,b]){ai.target=target;ai.transit=kind==='transit';ai.evacuating=kind==='evacuating'}
    for(let i=0;i<480;i++){
      a.offensive.progress.pressure=16;b.offensive.progress.pressure=16
      a.update(self,1/240,outA);b.update(self,1/240,outB)
      expect(outA.aimWorld.toArray()).toEqual(outB.aimWorld.toArray())
      expect(outA.firing).toBe(outB.firing);expect(outA.bombing).toBe(outB.bombing)
    }
    expect(a.offensive.changes).toBe(0)
  }
})
