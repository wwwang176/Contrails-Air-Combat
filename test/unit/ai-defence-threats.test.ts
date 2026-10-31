import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { DefenceThreats } from '../../src/ai/defenceThreats'
import { DefenceManeuvers } from '../../src/ai/defenceManeuvers'
import { createCommand } from '../../src/control/Controller'
import { P51D } from '../../src/specs/p51d'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'

function craft(x=0,z=0){
  const a=new Aircraft(applyFeel(P51D,GAME_FEEL),2500,150)
  a.update(new Vector3(0,0,-1),0.7,1/240)
  a.state.position.set(x,2500,z)
  return a
}
function scan(g:DefenceThreats,self:Aircraft,enemies:Aircraft[],alarms:number[]){
  g.beginScan(0.1)
  enemies.forEach((e,i)=>g.observe(self,e,alarms[i]!,e.state.position.distanceTo(self.state.position),null))
  g.endScan()
}

describe('多敵機防禦評估',()=>{
  it('三架後方敵機最高威脅輪替，不重置機動參考與咬尾累積',()=>{
    const self=craft(),enemies=[craft(-20,400),craft(0,410),craft(20,420)]
    const group=new DefenceThreats(),state=new DefenceManeuvers(),out=createCommand()
    let initial:Aircraft|null=null,changes=0,previous:Aircraft|null=null,maxPressure=0
    const phases=new Set<string>()
    for(let i=0;i<120;i++){
      scan(group,self,enemies,enemies.map((_,j)=>j===i%3?0.84:0.8))
      initial??=group.reference
      if(previous && previous!==group.reference)changes++
      previous=group.reference
      for(let j=0;j<24;j++){
        state.update(self,group.reference!,group.alarm,1/240,out,true,0,false,false,group)
        phases.add(state.phase);maxPressure=Math.max(maxPressure,state.pressure)
      }
    }
    expect(group.activeCount).toBe(3)
    expect(group.reference).toBe(initial)
    expect(changes).toBe(0)
    expect(maxPressure).toBeGreaterThan(4)
    expect(phases.has('短促換面')).toBe(true)
    expect(state.changes).toBeGreaterThan(1)
  })

  it('新敵明顯更危險需持續確認，近距離緊急瞄準則立即交接',()=>{
    const self=craft(),a=craft(0,700),b=craft(0,650),g=new DefenceThreats()
    scan(g,self,[a,b],[0.7,0.6]);expect(g.reference).toBe(a)
    for(let i=0;i<5;i++)scan(g,self,[a,b],[0.25,0.8])
    expect(g.reference).toBe(a)
    for(let i=0;i<15;i++)scan(g,self,[a,b],[0.25,0.8])
    expect(g.reference).toBe(b)
    a.state.position.z=180
    scan(g,self,[a,b],[0.99,0.3])
    expect(g.reference).toBe(a)
  })

  it('死亡或離場立即移除；正常交接保留既有機動與保高基準',()=>{
    const self=craft(),a=craft(-10,400),b=craft(10,420),g=new DefenceThreats()
    const state=new DefenceManeuvers(),out=createCommand()
    scan(g,self,[a,b],[0.4,0.3])
    state.update(self,a,0.4,0.1,out,true,0,false,false,g)
    state.climb.start(self)
    scan(g,self,[b],[0.3])
    expect(g.records).toHaveLength(1);expect(g.reference).toBe(b)
    state.update(self,b,0.3,0.1,out,true,0,false,false,g)
    expect(state.climb.stage).toBe('斜爬・拉高')
    expect(state.height.anchor).toBe(2500)
    scan(g,self,[],[])
    expect(g.reference).toBeNull();expect(g.activeCount).toBe(0)
  })

  it('另一架仍在後方咬尾時，不因參考敵機衝過頭就允許反轉',()=>{
    const self=craft(),passed=craft(0,-100),tail=craft(20,350),g=new DefenceThreats()
    scan(g,self,[passed,tail],[0.2,0.2])
    expect(g.blocksReversal(passed)).toBe(true)
    scan(g,self,[passed],[0.2])
    expect(g.blocksReversal(passed)).toBe(false)
  })

  it('選擇轉向會避開另一側的多架槍口，鏡射配置得到相反選擇',()=>{
    const self=craft()
    for(const side of [1,-1]){
      const g=new DefenceThreats(),enemies=[craft(side*130,160),craft(side*160,240)]
      scan(g,self,enemies,[0.8,0.8])
      expect(g.chooseTurn(self,side,45*Math.PI/180)).toBe(-side)
    }
  })
})
