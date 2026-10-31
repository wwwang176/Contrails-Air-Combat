import { G0 } from '../core/math'
const RAD = Math.PI / 180
export type Policy = 'auto' | 'descent' | 'height' | 'adaptive'
export type OpportunityPhase = '恢復速度' | '反向轉彎' | '短促換面'
/** 與展示區共用的試玩參數；爬升拿速度換高度，不會憑空增加能量。 */
export const MANEUVER = {
  climbPitch: 12 * RAD, climbTurn: 45 * RAD, climbSeconds: 3,
  climbSpeedMargin: 1.2, climbExitMargin: 1.08, relativeEnergyEnter: 80,
  relativeEnergyExit: -40, climbEnergyCushion: 80, lossBudget: 120,
  descentHeightBudget: 180, descentPitch: -18 * RAD, descentTurn: 60 * RAD,
  recoverySeconds: 2, reversalSeconds: 2.4, jinkSeconds: 1.2,
  opportunityCooldown: 3, jinkCooldown: 6, jinkPitch: 12 * RAD,
} as const
export interface ChoiceFacts {
  speed: number; turnFloor: number; enemySpeed: number; energyAdvantage: number;
  altitude: number; descentReserve: number; alarm: number;
}
export interface Choice { phase: '原版判斷' | '斜降換面' | '斜向爬升' | '水平換位'; reason: string }
/** 單一選招入口，允許沒有合適招式；不以輪流播放動作冒充戰術。 */
export function chooseManeuver(f: ChoiceFacts, policy: Policy): Choice {
  const speedReserve = (f.speed * f.speed - f.turnFloor * f.turnFloor) / (2 * G0)
  const climbCost = f.speed * Math.sin(MANEUVER.climbPitch) * MANEUVER.climbSeconds + MANEUVER.climbEnergyCushion
  const climbSpeedOK = f.speed >= f.turnFloor * MANEUVER.climbSpeedMargin && speedReserve >= climbCost
  const relativeOK = f.energyAdvantage >= MANEUVER.relativeEnergyEnter && f.speed >= f.enemySpeed * 0.95
  if (policy !== 'descent' && policy !== 'adaptive' && climbSpeedOK && relativeOK && f.alarm < 2 / 3) {
    return { phase: '斜向爬升', reason: '有速度餘裕、總能量領先，且對方暫無精準射擊解' }
  }
  if (policy === 'height' || policy === 'adaptive') return f.speed > f.turnFloor * 1.08
    ? { phase: '水平換位', reason: '爬升條件不足，優先水平換位，不以斜降作為預設替代' }
    : { phase: '原版判斷', reason: '機動速度不足，交給保高紀律收彎補速' }
  let reason = policy === 'descent' ? '只用上一版斜降' : !climbSpeedOK ? '速度餘裕不足，不爬升'
    : !relativeOK ? '敵我速度／能量條件不利，不爬升' : '對方正瞄準，不冒險爬升'
  if (f.altitude > 1500 && f.descentReserve > 1000 && f.speed > 85) {
    return { phase: '斜降換面', reason: `${reason}；高度足夠，改變轉彎平面` }
  }
  reason += '；下降餘裕也不足，維持原版防禦'
  return { phase: '原版判斷', reason }
}
export interface OpportunityFacts {
  recentThreat: boolean; speed: number; turnFloor: number; enemySpeed: number;
  range: number; closure: number; alarm: number; clearTime: number; aimedTime: number;
  passed: boolean; descentReserve: number; jinkReady: boolean;
}
/** 先處理正在發生的機會；沒有條件就不插入動作，持續咬尾另外交給長時選招。 */
export function chooseOpportunity(f: OpportunityFacts): { phase: OpportunityPhase; reason: string } | null {
  if (!f.recentThreat || f.speed < f.turnFloor * 1.08) return null
  if (f.passed && f.range < 450) return { phase: '反向轉彎', reason: '敵機近距離由逼近轉為遠離，且已交錯到側前方；反轉爭取位置' }
  if (f.jinkReady && f.range < 800 && f.alarm > 2 / 3 && f.aimedTime > 0.18) {
    return { phase: '短促換面', reason: '敵人持續取得近距離射擊窗口，短促改變飛行平面打亂預瞄' }
  }
  if (f.clearTime > 0.6 && f.range > 350 && f.closure < 5 && f.speed >= f.enemySpeed * 0.95
    && f.descentReserve > 300) {
    return { phase: '恢復速度', reason: '敵方瞄準已偏離、尾距沒有快速縮小；放鬆轉彎，全油門爭取速度' }
  }
  return null
}

/** 以真實相對速度確認近距離通過，避免把自己轉彎造成的視線掃動當成衝過頭。 */
export class PassWindow {
  private approaching = 0
  reset(): void { this.approaching = 0 }
  update(range: number, closure: number, angle: number, dt: number): boolean {
    this.approaching = Math.max(0, this.approaching - dt)
    if (range < 450 && closure > 15) this.approaching = 2
    if (this.approaching > 0 && closure < -5 && range < 450 && angle < 110) {
      this.approaching = 0
      return true
    }
    return false
  }
}
