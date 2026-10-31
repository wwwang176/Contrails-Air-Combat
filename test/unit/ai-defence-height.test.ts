import { describe, expect, it } from 'vitest'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import { stallSpeed } from '../../src/analysis/envelope'
import { createCommand } from '../../src/control/Controller'
import { HeightDiscipline } from '../../src/ai/defenceHeight'

describe('放寬防禦保高的介入條件',()=>{
  it('舊高度與下沉門檻不立即接管，超過新門檻仍止沉',()=>{
    const h=new HeightDiscipline();h.observe(2500,0,.1)
    h.observe(2330,0,.1);expect(h.recovering).toBe(false)
    h.observe(2300,0,.1);expect(h.recovering).toBe(true)
    h.reset();h.observe(2500,-14,.1);expect(h.recovering).toBe(false)
    h.observe(2500,-16,.1);expect(h.recovering).toBe(true)
    for(let i=0;i<12;i++)h.observe(2470,0,.1)
    expect(h.recovering).toBe(false)
  })
  it('輕微低頭與低速餘裕不再過早接管，真正低速仍補速且不蓋掉緊急救速',()=>{
    const self=new Aircraft(applyFeel(P51D,GAME_FEEL),2500,150)
    const enemy=new Aircraft(self.spec,2500,150);enemy.state.position.z=400
    const h=new HeightDiscipline(),out=createCommand(),stall=stallSpeed(self.spec,2500,1)
    h.observe(2500,0,.1)
    const pitch=-2*Math.PI/180
    out.aimWorld.set(0,Math.sin(pitch),-Math.cos(pitch))
    self.state.velocity.set(0,0,-stall*1.4)
    expect(h.apply(self,enemy,out,false)).toBe(false)
    self.state.velocity.set(0,0,-stall*1.3)
    expect(h.apply(self,enemy,out,false)).toBe(true)
    expect(h.label).toContain('補速')
    self.state.velocity.set(0,0,-stall*1.1)
    expect(h.apply(self,enemy,out,false)).toBe(false)
    expect(h.label).toContain('安全層')
  })
})
