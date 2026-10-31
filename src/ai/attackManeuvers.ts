import { Vector3 } from 'three'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import { stallSpeed } from '../analysis/envelope'
import type { EngageBasis } from './engageGeometry'
import type { DefenceThreats } from './defenceThreats'
import { PURSUIT, PursuitProgress, type PursuitSample } from './pursuitProgress'
import { G0 } from '../core/math'

const RAD=Math.PI/180
/** 持續追擊沒有進展時的小幅修正；與防禦、射擊、地形安全保持獨立。 */
type Move='off'|'後置追擊'|'保高補速'|'高悠悠・拉高'|'高悠悠・轉向'|'高悠悠・接回'
export class AttackManeuvers {
  readonly progress=new PursuitProgress()
  phase:Move='off'
  reason='依正式攻擊 AI 追擊'
  learning=''
  changes=0
  cooldown=0
  gainTarget=0
  entryAltitude=0
  private elapsed=0
  private elapsedTotal=0
  private entryEnergy=0
  private turnSign=1
  private time=0
  private blocked=new Map<string,number>()
  private pending:{key:string;age:number;target:Aircraft;error:number;energy:number;shots:number;aborted:boolean}|null=null
  private startError=0
  private startTarget:Aircraft|null=null
  private maneuverTarget:Aircraft|null=null
  private selectedKey=''
  private heading=new Vector3()
  private desired=new Vector3()
  private nose=new Vector3()
  private previousHeading=NaN
  private previousTargetHeading=NaN
  private previousTarget:Aircraft|null=null
  private sample:PursuitSample={target:null,range:Infinity,error:Math.PI,aot:Math.PI,circling:false,shot:false,energy:0}
  private measureTimer=0
  get aimError():number{return this.sample.error/RAD}
  reset():void {
    this.progress.reset();this.phase='off';this.reason='';this.learning='';this.changes=0
    this.cooldown=0;this.gainTarget=0;this.entryAltitude=0;this.elapsed=0;this.elapsedTotal=0
    this.entryEnergy=0;this.turnSign=1;this.time=0;this.blocked.clear();this.pending=null
    this.startError=0;this.startTarget=null;this.maneuverTarget=null;this.selectedKey=''
    this.previousHeading=NaN;this.previousTargetHeading=NaN;this.previousTarget=null;this.measureTimer=0
    this.sample.target=null;this.sample.range=Infinity;this.sample.error=Math.PI;this.sample.aot=Math.PI
    this.sample.circling=false;this.sample.shot=false;this.sample.energy=0
  }
  interrupt():void { this.finish(true,'防禦、任務或安全層接管') }
  private available(key:string):boolean { return this.time>=(this.blocked.get(key)??0) }

  /** 只寫延遲前的方向、油門與跟瞄旗標；射擊及最終安全輸出仍由控制器處理。 */
  update(self:Aircraft,target:Aircraft,basis:EngageBasis,dt:number,out:Command,eligible:boolean,group?:DefenceThreats):boolean {
    this.time+=dt;this.cooldown=Math.max(0,this.cooldown-dt)
    if(target){
      this.nose.set(0,0,-1).applyQuaternion(self.state.orientation)
      const range=self.state.position.distanceTo(target.state.position)
      this.sample.target=target;this.sample.range=range;this.sample.error=this.nose.angleTo(basis.leadPoint)
      this.desired.copy(self.state.position).sub(target.state.position).normalize()
      this.nose.set(0,0,1).applyQuaternion(target.state.orientation)
      this.sample.aot=this.nose.angleTo(this.desired)
      this.sample.shot=range<800&&this.sample.error<5*RAD;this.sample.energy=self.specificEnergy
      this.measureTimer+=dt
      if(this.measureTimer>=0.1){
        const own=Math.atan2(self.state.velocity.x,-self.state.velocity.z),enemy=Math.atan2(target.state.velocity.x,-target.state.velocity.z)
        const delta=(a:number,b:number)=>Math.atan2(Math.sin(a-b),Math.cos(a-b))/this.measureTimer
        if(this.previousTarget===target&&Number.isFinite(this.previousHeading)){
          const a=delta(own,this.previousHeading),b=delta(enemy,this.previousTargetHeading)
          this.sample.circling=a*b>0&&Math.abs(a)>3*RAD&&Math.abs(b)>3*RAD
        }
        // 換人只重設目標轉率量測，短暫沿用同一接戰的迴旋證據；不歸零整體僵持。
        this.previousHeading=own;this.previousTargetHeading=enemy;this.previousTarget=target;this.measureTimer=0
      }
    }else{this.sample.target=null;this.sample.range=Infinity;this.sample.shot=false;this.sample.circling=false}
    this.progress.update(this.sample,dt,eligible&&this.phase==='off'&&!this.pending)
    if(this.pending){
      const p=this.pending;p.age+=dt;p.shots+=this.sample.shot?dt:0
      if(p.target!==target){
        // 換人後無法比較原目標的瞄準進展，停止評分，既有失敗記憶與冷卻仍保留。
        this.learning=`${p.key}：目標已換，取消本次評分；保留既有冷卻`
        this.pending=null
      }
      if(this.pending&&p.age>=PURSUIT.observe){
        const useful=!p.aborted&&(this.sample.error<p.error-6*RAD||p.shots/p.age>0.15)
          &&self.specificEnergy>p.energy-PURSUIT.energyBudget
        if(!useful)this.blocked.set(p.key,this.time+PURSUIT.failedCooldown)
        this.learning=useful?`${p.key}：觀察到射擊／瞄準改善`:`${p.key}：未確認改善，暫停重用 20 秒`
        if(useful)this.progress.pressure=Math.max(0,this.progress.pressure-4)
        this.pending=null
      }
    }
    if(this.phase!=='off'&&(!eligible||!target))this.finish(true,'威脅、原版回升或安全層優先')
    if(this.phase!=='off'&&target&&target!==this.maneuverTarget){
      if(this.phase==='高悠悠・接回')this.finish(true,'換目標：取消對舊目標的接回，保留冷卻')
      else {
        this.maneuverTarget=target
        this.heading.copy(self.state.velocity).setY(0).normalize();this.desired.copy(target.state.position).sub(self.state.position)
        this.turnSign=(this.heading.x*this.desired.z-this.heading.z*this.desired.x)>=0?1:-1
        this.reason='換目標：重算接戰方向，保留補速／爬升與高度預算'
      }
    }
    if(eligible&&target&&this.phase==='off'&&!this.pending&&this.cooldown===0
      &&this.progress.pressure>=PURSUIT.stale&&this.progress.grace<=0&&!this.sample.shot){
      const speed=self.state.velocity.length(),floor=stallSpeed(self.spec,self.state.position.y,3)
      const surplus=(speed*speed-floor*floor)/(2*G0)*0.35
      if(speed>floor*1.2&&surplus>PURSUIT.climbMin&&this.available('短幅 high yo-yo')){
        this.gainTarget=Math.min(PURSUIT.climbMax,surplus);this.start(self,target,'高悠悠・拉高','短幅 high yo-yo',group)
      }else if(speed<floor*1.12&&this.available('保高補速'))this.start(self,target,'保高補速','保高補速',group)
      else if(this.available('後置追擊'))this.start(self,target,'後置追擊','後置追擊',group)
    }
    if(this.phase!=='off'&&target){
      this.elapsed+=dt;this.elapsedTotal+=dt
      const floor=stallSpeed(self.spec,self.state.position.y,3)
      if(self.specificEnergy<this.entryEnergy-PURSUIT.energyBudget||this.elapsedTotal>9
        ||self.state.position.y<this.entryAltitude-100||this.sample.range>1800)
        this.finish(true,'達到能量／高度／時間護欄，交回正式 AI',true)
      else if(this.sample.shot&&this.progress.sustainedShot>0.2)this.finish(false,'取得射擊機會，交回正式瞄準')
      else if(this.phase.startsWith('高悠悠')&&self.state.velocity.length()<floor*1.03)this.finish(true,'速度不足，停止爬升',true)
      else if(this.phase==='高悠悠・拉高'&&(this.elapsed>3||self.state.position.y-this.entryAltitude>=this.gainTarget)){
        if(self.state.position.y-this.entryAltitude<15)this.finish(true,'沒有建立高度差，停止拉高',true)
        else{this.phase='高悠悠・轉向';this.elapsed=0}
      }else if(this.phase==='高悠悠・轉向'&&this.elapsed>2){this.phase='高悠悠・接回';this.elapsed=0}
      else if(this.phase==='高悠悠・接回'&&this.elapsed>2.5)this.finish(false,'完成短幅 high yo-yo，觀察進展')
      else if((this.phase==='後置追擊'||this.phase==='保高補速')&&this.elapsed>3)this.finish(false,'結束修正，觀察射擊機會')
      if((this.phase as Move)!=='off'){this.command(self,target,out);return true}
    }
    return false
  }
  private start(self:Aircraft,target:Aircraft,phase:Move,key:string,group?:DefenceThreats):void{
    this.phase=phase;this.selectedKey=key;this.elapsed=0;this.elapsedTotal=0;this.changes++
    this.entryAltitude=self.state.position.y;this.entryEnergy=self.specificEnergy;this.startError=this.sample.error;this.startTarget=target;this.maneuverTarget=target
    this.heading.copy(self.state.velocity).setY(0).normalize();this.desired.copy(target.state.position).sub(self.state.position)
    this.turnSign=(this.heading.x*this.desired.z-this.heading.z*this.desired.x)>=0?1:-1
    if(group)this.turnSign=-group.chooseTurn(self,-this.turnSign,25*RAD,phase==='高悠悠・拉高'?16*RAD:0)
    this.reason=`同向迴旋且缺乏進展 ${this.progress.pressure.toFixed(1)} 秒，嘗試${key}`
  }
  private finish(aborted:boolean,reason:string,failed=false):void{
    if(this.phase==='off')return
    if(this.startTarget)this.pending={key:this.selectedKey,age:0,target:this.startTarget,error:this.startError,energy:this.entryEnergy,shots:0,aborted}
    this.phase='off';this.cooldown=PURSUIT.cooldown;this.reason=reason
    if(failed){
      // 自身速度／能量或拉高失敗不依賴目標，可直接記錄，不被換人取消評分洗掉。
      this.blocked.set(this.selectedKey,this.time+PURSUIT.failedCooldown);this.pending=null
      this.learning=`${this.selectedKey}：${reason}；暫停重用 20 秒`
    }
  }
  private command(self:Aircraft,target:Aircraft,out:Command):void{
    this.heading.copy(self.state.velocity).setY(0).normalize()
    this.desired.copy(target.state.position).sub(self.state.position)
    if(this.phase==='後置追擊')this.desired.addScaledVector(target.state.velocity,-Math.min(1.3,this.sample.range/400))
    let turn=Math.atan2(this.heading.x*this.desired.z-this.heading.z*this.desired.x,this.heading.x*this.desired.x+this.heading.z*this.desired.z)
    if(Math.abs(turn)>150*RAD)turn=this.turnSign*45*RAD
    turn=Math.max(-45*RAD,Math.min(45*RAD,turn))
    let pitch=0
    if(this.phase==='保高補速')turn=Math.max(-8*RAD,Math.min(8*RAD,turn))
    if(this.phase==='高悠悠・拉高'){pitch=16*RAD;turn=this.turnSign*25*RAD}
    if(this.phase==='高悠悠・轉向')turn=this.turnSign*40*RAD
    if(this.phase==='高悠悠・接回')pitch=self.state.position.y+Math.min(0,self.state.velocity.y)*2>this.entryAltitude+20?-8*RAD:3*RAD
    else if(self.state.velocity.y<-3)pitch=Math.max(pitch,Math.min(8*RAD,-self.state.velocity.y/200))
    const x=this.heading.x,z=this.heading.z
    out.aimWorld.set((x*Math.cos(turn)-z*Math.sin(turn))*Math.cos(pitch),Math.sin(pitch),(x*Math.sin(turn)+z*Math.cos(turn))*Math.cos(pitch))
    out.throttle=1;out.brake=0;out.trackTurn=false
  }
}
