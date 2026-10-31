import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { DefenceManeuvers } from '../../src/ai/defenceManeuvers'
import { createTargetBoard } from '../../src/ai/target'
import { createCommand } from '../../src/control/Controller'
import { P51D } from '../../src/specs/p51d'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'

const DT = 1 / 240
function craft(z = 0) {
  const a = new Aircraft(applyFeel(P51D, GAME_FEEL), 2500, 150)
  // 讓正式物理先更新空速／失速餘裕，避免未初始化讀值觸發救速。
  a.update(new Vector3(0,0,-1), 0.7, DT)
  a.state.position.y = 2500
  a.state.position.z = z
  return a
}

describe('正式防禦換招接線', () => {
  it('攻擊目標在遠方，換招仍依後方實際追擊者，且不偷改攻擊目標', () => {
    const self = craft(), target = craft(-5000), attacker = craft(350)
    const ai = new AiController(), out = createCommand()
    ai.board = createTargetBoard([
      {index:0, aircraft:self, team:'blue', alive:true},
      {index:1, aircraft:target, team:'red', alive:true},
      {index:2, aircraft:attacker, team:'red', alive:true},
    ])
    ai.selfIndex = 0; ai.focusTarget = target
    for (let i = 0; i < 120; i++) ai.update(self, DT, out)
    expect(ai.target).toBe(target)
    expect(ai.defensive.source).toBe(attacker)
    expect(ai.defensive.phase).toBe('短促換面')
    expect(ai.hudPhase).toBe('短促換面')
    expect(out.aimWorld.length()).toBeCloseTo(1)
    ai.board.candidates[2]!.alive = false
    for (let i = 0; i < 48; i++) ai.update(self, DT, out)
    expect(ai.defensive.source).toBeNull()
  })

  it('距離威脅因子為零、警戒仍成立時，防禦方向也指向實際來襲者', () => {
    const self = craft(), target = craft(-5000), attacker = craft(950)
    const ai = new AiController(), out = createCommand()
    ai.board = createTargetBoard([
      {index:0, aircraft:self, team:'blue', alive:true},
      {index:1, aircraft:target, team:'red', alive:true},
      {index:2, aircraft:attacker, team:'red', alive:true},
    ])
    ai.selfIndex = 0; ai.focusTarget = target
    for (let i = 0; i < 240; i++) ai.update(self, DT, out)
    expect(ai.defensive.source).toBe(attacker)
    expect(ai.sit.threatLos.z).toBeGreaterThan(0.99)
    ai.resetAirTactics()
    expect(ai.defensive.source).toBeNull()
    expect(Number.isNaN(ai.defensive.height.anchor)).toBe(true)
  })

  it('同段防禦換威脅不重置高度預算，安全接管中斷機動，退出空戰才清空', () => {
    const self = craft(), enemy = craft(350), other = craft(360)
    const state = new DefenceManeuvers(), out = createCommand()
    const tick = (e:Aircraft, safety=false, allowed=true) =>
      state.update(self,e,1,DT,out,allowed,0,safety,false)
    for(let i=0;i<120;i++)tick(enemy)
    expect(state.phase).toBe('短促換面')
    self.state.position.y -= 80
    tick(other)
    expect(state.height.anchor).toBe(2500)
    expect(state.height.debt).toBe(80)
    for(let i=0;i<120;i++)tick(other)
    tick(other,true)
    expect(state.phase).toBe('off')
    expect(state.label).toBe('off')
    expect(state.height.anchor).toBe(2500)
    tick(other,false,false)
    expect(state.source).toBeNull()
    expect(Number.isNaN(state.height.anchor)).toBe(true)
  })

  it('威脅消失後記憶會到期，不把整場高度鎖在第一次交戰處', () => {
    const self=craft(), enemy=craft(350), state=new DefenceManeuvers(), out=createCommand()
    state.update(self,enemy,1,DT,out,true,0,false,false)
    enemy.state.position.z=-3000
    for(let i=0;i<9*240;i++)state.update(self,enemy,0,DT,out,true,0,false,false)
    expect(state.source).toBeNull()
    expect(Number.isNaN(state.height.anchor)).toBe(true)
    expect(state.memory.reports).toHaveLength(0)
  })

  it('持續咬尾而暫無精準射擊解時，會選擇分段斜爬而非無限水平轉彎', () => {
    const self=craft(), enemy=craft(450), state=new DefenceManeuvers(), out=createCommand()
    const position=self.state.position.clone(), velocity=self.state.velocity.clone()
    let climbed=false
    for(let i=0;i<20*240;i++){
      state.update(self,enemy,0.3,DT,out,true,0,false,false)
      if(state.climb.stage==='斜爬・拉高'){
        climbed=true
        expect(out.aimWorld.y).toBeGreaterThan(0)
        break
      }
    }
    expect(climbed).toBe(true)
    expect(self.state.position.equals(position)&&self.state.velocity.equals(velocity)).toBe(true)
  })

  it('正式掃描最高威脅輪替時，防禦層保持穩定參考；同位置友機不列入', () => {
    const self=craft(), target=craft(-5000), enemies=[craft(450),craft(460),craft(470)], friend=craft(350)
    const ai=new AiController(),out=createCommand(),forward=new Vector3(0,0,-1),up=new Vector3(0,1,0)
    ai.board=createTargetBoard([
      {index:0,aircraft:self,team:'blue',alive:true},
      {index:1,aircraft:target,team:'red',alive:true},
      ...enemies.map((aircraft,i)=>({index:i+2,aircraft,team:'red' as const,alive:true})),
      {index:5,aircraft:friend,team:'blue',alive:true},
    ])
    ai.selfIndex=0;ai.focusTarget=target
    const immediate=new Set<Aircraft>(),reference=new Set<Aircraft>()
    for(let i=0;i<90;i++){
      enemies.forEach((enemy,j)=>enemy.state.orientation.setFromAxisAngle(up,j===i%3?0:0.1))
      for(let k=0;k<24;k++){
        ai.update(self,DT,out)
        if(ai.threatSource)immediate.add(ai.threatSource)
        if(ai.defensive.source)reference.add(ai.defensive.source)
      }
    }
    expect(immediate.size).toBe(3)
    expect(reference.size).toBe(1)
    expect(ai.defenceThreats.activeCount).toBe(3)
    expect(ai.defenceThreats.records.some(r=>r.aircraft===friend)).toBe(false)
    expect(ai.defensive.changes).toBeGreaterThan(0)
    expect(out.aimWorld.dot(forward)).toBeLessThan(1)
  })

  it('轟炸機與俯衝轟炸機保持原本控制，不啟用戰鬥機換招層', () => {
    for(const extra of [{role:'bomber' as const},{diveBomber:true as const}]){
      const self=new Aircraft({...applyFeel(P51D,GAME_FEEL),...extra},2500,150),enemy=craft(350)
      self.update(new Vector3(0,0,-1),0.7,DT)
      const ai=new AiController(),out=createCommand()
      ai.board=createTargetBoard([{index:0,aircraft:self,team:'blue',alive:true},{index:1,aircraft:enemy,team:'red',alive:true}])
      ai.selfIndex=0
      for(let i=0;i<240;i++)ai.update(self,DT,out)
      expect(ai.threatSource).toBe(enemy)
      expect(ai.defenceThreats.activeCount).toBe(0)
      expect(ai.defensive.source).toBeNull()
    }
  })
})
