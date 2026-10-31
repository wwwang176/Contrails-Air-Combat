import type { Aircraft } from '../aircraft/Aircraft'

const RAD=Math.PI/180
export const PURSUIT={observe:2,stale:6,grace:1.5,initialGraceBudget:3,successHold:0.7,
  failedCooldown:20,cooldown:4,energyBudget:120,climbMin:40,climbMax:150} as const
export interface PursuitSample {target:Aircraft|null;range:number;error:number;aot:number;circling:boolean;shot:boolean;energy:number}
/** 每個目標的幾何重算；整體僵持、招式冷卻與能量不因換人消失。 */
export class PursuitProgress {
  target:Aircraft|null=null
  pressure=0
  localAge=0
  switches=0
  grace=0
  sustainedShot=0
  private graceBudget:number=PURSUIT.initialGraceBudget
  private windowAge=0
  private firstError=0
  private firstAot=0
  private firstRange=0
  reset():void {
    this.target=null;this.pressure=0;this.localAge=0;this.switches=0;this.grace=0;this.sustainedShot=0
    this.graceBudget=PURSUIT.initialGraceBudget;this.windowAge=0
    this.firstError=0;this.firstAot=0;this.firstRange=0
  }
  update(s:PursuitSample,dt:number,active:boolean):void {
    if(s.target!==this.target){
      if(this.target && s.target)this.switches++
      this.target=s.target;this.localAge=0;this.windowAge=0
      // 緩衝來自同一段接戰的有限預算，不能靠每兩秒換人無限延期。
      this.grace=Math.max(this.grace,Math.min(PURSUIT.grace,this.graceBudget))
      this.firstError=s.error;this.firstAot=s.aot;this.firstRange=s.range
      this.sustainedShot=0
    }
    if(this.grace>0){const used=Math.min(dt,this.grace);this.grace-=used;this.graceBudget=Math.max(0,this.graceBudget-used)}
    this.localAge+=dt;this.windowAge+=dt
    this.sustainedShot=s.shot?this.sustainedShot+dt:0
    if(!s.target||s.range>1800){this.pressure=Math.max(0,this.pressure-dt*2);return}
    if(!active){this.windowAge=0;this.firstError=s.error;this.firstAot=s.aot;this.firstRange=s.range;return}
    if(this.sustainedShot>=PURSUIT.successHold){this.pressure=Math.max(0,this.pressure-dt*4);return}
    if(s.circling&&!s.shot&&this.grace<=0)this.pressure=Math.min(16,this.pressure+dt)
    else if(!s.circling)this.pressure=Math.max(0,this.pressure-dt*0.3)
    if(this.windowAge>=2){
      const improved=s.error<this.firstError-4*RAD||s.aot<this.firstAot-8*RAD
        ||this.firstRange>800&&s.range<this.firstRange-120
      if(improved)this.pressure=Math.max(0,this.pressure-2)
      this.firstError=s.error;this.firstAot=s.aot;this.firstRange=s.range;this.windowAge=0
    }
  }
}
