import { Vector3 } from 'three'
import type { Aircraft } from '../aircraft/Aircraft'
import { losBlocked, type LandField } from '../world/occlusion'

const RAD = Math.PI / 180
export const DEFENCE_THREATS = {
  range: 1800, tailRange: 1400, memory: 1, hold: 1.5,
  switchMargin: 0.15, switchConfirm: 0.6, emergencyRange: 400,
} as const

export interface DefenceThreat {
  aircraft: Aircraft
  range: number
  alarm: number
  angle: number
  closure: number
  tail: boolean
  active: boolean
  score: number
  /** 掃描時間，非遊戲全域時間。 */
  lastActive: number
  seen: boolean
}

/**
 * 10 Hz 蒐集同場來襲者。即時警戒與穩定機動參考分開；不改攻擊目標。
 * 紀錄數量受場上敵機數限制，240 Hz 操縱不再掃全場或重解全部預瞄。
 */
export class DefenceThreats {
  readonly records: DefenceThreat[] = []
  reference: Aircraft | null = null
  alarm = 0
  range = Infinity
  angle = 0
  closure = -Infinity
  tail = false
  activeCount = 0
  private time = 0
  private switchedAt = -Infinity
  private challenger: Aircraft | null = null
  private challengedSince = 0
  private direction = new Vector3()
  private nose = new Vector3()
  private relative = new Vector3()
  private heading = new Vector3()
  private endpoint = new Vector3()
  private enemyPoint = new Vector3()

  reset(): void {
    this.records.length = 0; this.reference = null; this.time = 0
    this.switchedAt = -Infinity; this.challenger = null; this.clearSummary()
  }
  private clearSummary(): void {
    this.alarm = 0; this.range = Infinity; this.angle = 0
    this.closure = -Infinity; this.tail = false; this.activeCount = 0
  }
  beginScan(dt: number): void {
    this.time += dt; this.clearSummary()
    for (const r of this.records) r.seen = false
  }
  observe(self: Aircraft, enemy: Aircraft, alarm: number, range: number, land: LandField | null): void {
    if (range > DEFENCE_THREATS.range || range < 1e-3) return
    const p=self.state.position, q=enemy.state.position
    if (land && losBlocked(p.x,p.y,p.z,q.x,q.y,q.z,land)) return
    this.direction.copy(q).sub(p).divideScalar(range)
    const angle=self.state.velocity.angleTo(this.direction)/RAD
    this.nose.set(0,0,-1).applyQuaternion(enemy.state.orientation)
    const tail=range<DEFENCE_THREATS.tailRange && angle>120 && this.nose.dot(this.direction)<-Math.cos(45*RAD)
    const active=alarm>0 || tail
    let r=this.records.find(r=>r.aircraft===enemy)
    if (!r) {
      if (!active) return
      r={aircraft:enemy,range,alarm,angle,closure:0,tail,active,score:0,lastActive:this.time,seen:true}
      this.records.push(r)
    }
    r.seen=true; r.range=range; r.alarm=alarm; r.angle=angle; r.tail=tail; r.active=active
    r.closure=-this.relative.copy(enemy.state.velocity).sub(self.state.velocity).dot(this.direction)
    r.score=0.65*alarm+(tail?0.25:0)+0.1*(1-range/DEFENCE_THREATS.range)
    if (active) r.lastActive=this.time
  }
  endScan(): void {
    let best:DefenceThreat|null=null, current:DefenceThreat|null=null, urgent:DefenceThreat|null=null
    for(let i=this.records.length-1;i>=0;i--){
      const r=this.records[i]!
      // 死亡、離場、地形遮蔽直接移除；短暫不在瞄準錐內才保留一秒。
      if(!r.seen || this.time-r.lastActive>DEFENCE_THREATS.memory){this.records.splice(i,1);continue}
      if(r.aircraft===this.reference)current=r
      if(!r.active)continue
      this.activeCount++;this.alarm=Math.max(this.alarm,r.alarm)
      this.range=Math.min(this.range,r.range);this.angle=Math.max(this.angle,r.angle)
      this.tail ||= r.tail
      if(r.tail || r.alarm>0.25)this.closure=Math.max(this.closure,r.closure)
      if(!best || r.score>best.score)best=r
      if(r.alarm>0.85 && r.range<DEFENCE_THREATS.emergencyRange
        && (!urgent || r.range<urgent.range))urgent=r
    }
    if(!current){this.switchTo(best?.aircraft??null);return}
    if(urgent && urgent!==current && (current.alarm<0.6 || urgent.range<current.range*0.65)){
      this.switchTo(urgent.aircraft);return
    }
    if(!best || best===current){this.challenger=null;return}
    // 一般交接必須明顯較危險並持續一段時間；近距離緊急威脅已在上面處理。
    if(best.score<=current.score+DEFENCE_THREATS.switchMargin){this.challenger=null;return}
    if(this.challenger!==best.aircraft){this.challenger=best.aircraft;this.challengedSince=this.time}
    if(this.time-this.switchedAt>=DEFENCE_THREATS.hold
      && this.time-this.challengedSince>=DEFENCE_THREATS.switchConfirm)this.switchTo(best.aircraft)
  }
  private switchTo(aircraft:Aircraft|null):void {
    if(this.reference!==aircraft)this.switchedAt=this.time
    this.reference=aircraft;this.challenger=null
  }
  /** 有另一架仍在近距離尾追，不為了一架衝過頭的敵人反轉回其隊友槍口。 */
  blocksReversal(reference:Aircraft):boolean {
    return this.records.some(r=>r.active && r.aircraft!==reference && r.tail && r.range<800)
  }
  permitsClimb(self:Aircraft):boolean {
    const speed=self.state.velocity.length()
    return this.records.every(r=>!r.active || !r.tail
      || speed>r.aircraft.state.velocity.length()*0.85 && self.specificEnergy>r.aircraft.specificEnergy-150)
  }

  /**
   * 開始一招時比較左右兩條短期路線：最危險槍口與全體暴露量都計分。
   * 這是兩秒幾何預估，不預知敵方下一步，也不直接改變飛機位置。
   */
  chooseTurn(self:Aircraft, preferred:number, turn:number, pitch=0):number {
    if(this.activeCount<2)return preferred
    const current=this.routeRisk(self,preferred*turn,pitch)
    const opposite=this.routeRisk(self,-preferred*turn,pitch)
    return opposite+0.12<current ? -preferred : preferred
  }
  private routeRisk(self:Aircraft,turn:number,pitch:number):number {
    this.heading.copy(self.state.velocity).setY(0).normalize()
    const speed=self.state.velocity.length()
    let total=0,worst=0
    for(const r of this.records){
      if(!r.active)continue
      this.nose.set(0,0,-1).applyQuaternion(r.aircraft.state.orientation)
      let exposure=0
      for(const t of [0.6,1.2,2]){
        // 平均航向使用半個預期轉角，避免把轉彎當成瞬間折線。
        const yaw=turn*Math.min(1,t/2)*0.5, x=this.heading.x,z=this.heading.z
        this.endpoint.set((x*Math.cos(yaw)-z*Math.sin(yaw))*Math.cos(pitch),Math.sin(pitch),
          (x*Math.sin(yaw)+z*Math.cos(yaw))*Math.cos(pitch)).multiplyScalar(speed*t).add(self.state.position)
        this.enemyPoint.copy(r.aircraft.state.position).addScaledVector(r.aircraft.state.velocity,t)
        this.direction.copy(this.endpoint).sub(this.enemyPoint)
        const distance=this.direction.length()
        const aim=distance>1e-3?Math.max(0,(this.nose.dot(this.direction)/distance-Math.cos(25*RAD))/(1-Math.cos(25*RAD))):1
        exposure+=aim*Math.max(0,1-distance/1800)+Math.max(0,1-distance/180)*2
      }
      exposure*=0.5+r.alarm*0.5
      total+=exposure;worst=Math.max(worst,exposure)
    }
    return worst+total*0.35
  }
}
