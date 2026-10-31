import { Vector3 } from 'three'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import { maxLoadFactorAero, stallSpeed } from '../analysis/envelope'
import { recoveryAltitude } from './safety'
import { HeightDiscipline, HEIGHT_POLICY } from './defenceHeight'
import { ADAPTIVE, ManeuverMemory, StagedClimb, type OutcomeSnapshot } from './defenceAdaptive'
import { MANEUVER, PassWindow, chooseOpportunity, type OpportunityPhase } from './defenceSelection'
import type { DefenceThreats } from './defenceThreats'

const RAD = Math.PI / 180
const THREAT_MEMORY_SECONDS = 8
type Phase = 'off' | OpportunityPhase | '水平換位'

/**
 * 空戰防禦換招：所有相對幾何都取威脅來源，不改攻擊目標。
 * 只修改延遲前的操縱命令；地形、失速與防墜仍由正式輸出層最後接管。
 */
export class DefenceManeuvers {
  source: Aircraft | null = null
  readonly height = new HeightDiscipline()
  readonly memory = new ManeuverMemory(false)
  readonly climb = new StagedClimb()
  phase: Phase = 'off'
  reason = ''
  pressure = 0
  changes = 0
  private applied = false
  private remaining = 0
  private phaseTime = 0
  private cooldown = 0
  private stagnation = 0
  private aimedTime = 0
  private clearTime = 0
  private jinkCooldown = 0
  private jinkPitch = 0
  private turnSign = 1
  private firstRange = 0
  private firstAlarm = 0
  private maneuverEnergy = 0
  private pass = new PassWindow()
  private direction = new Vector3()
  private forward = new Vector3()
  private relative = new Vector3()
  private recoveryHeading = new Vector3()
  private snapshot: OutcomeSnapshot = {range:0, angle:0, alarm:0, tail:false, energy:0}
  get label(): string {
    if (!this.applied) return 'off'
    return this.climb.stage ?? (this.phase === 'off' ? '防禦保高' : this.phase)
  }

  reset(): void {
    this.source = null; this.remaining = 0; this.applied = false; this.height.reset(); this.resetManeuver()
  }

  /** 換威脅時清掉對舊對象的幾何記憶，但同一段防禦的高度預算不重置。 */
  private resetManeuver(): void {
    this.phase = 'off'; this.phaseTime = 0; this.cooldown = 0; this.pressure = 0
    this.stagnation = 0; this.aimedTime = 0; this.clearTime = 0; this.jinkCooldown = 0
    this.pass.reset(); this.memory.reset(); this.climb.stop(''); this.reason = ''
  }

  /** 安全層或既有反轉接管時只中止額外動作，不以換招重置保高基準。 */
  interrupt(): void {
    this.applied = false
    if (this.climb.stage || this.phase !== 'off') {
      this.memory.finish(true); this.climb.stop('讓位給安全保護／原版反轉')
      this.phase = 'off'; this.phaseTime = 0; this.cooldown = 2; this.stagnation = 0
    }
  }

  update(
    self: Aircraft, enemy: Aircraft, alarm: number, dt: number, out: Command,
    allowed: boolean, floor: number, safetyHold: boolean, legacyReversal: boolean,
    group?: DefenceThreats,
  ): boolean {
    this.applied = false
    if (!allowed) { if (this.source) this.reset(); return false }
    this.direction.copy(enemy.state.position).sub(self.state.position)
    const range = this.direction.length()
    if (range < 1e-3) { this.reset(); return false }
    this.direction.divideScalar(range)
    this.forward.copy(self.state.velocity).normalize()
    const angle = this.forward.angleTo(this.direction) / RAD
    this.forward.set(0,0,-1).applyQuaternion(enemy.state.orientation)
    const tail = group ? group.tail : range < 1400 && angle > 120 && this.forward.dot(this.direction) < -Math.cos(45 * RAD)
    const threatRange = group && group.activeCount > 0 ? group.range : range
    const threatAngle = group && group.activeCount > 0 ? group.angle : angle
    if (this.source !== enemy) {
      if (!this.source) {
        if (!tail && alarm <= 0) { this.reset(); return false }
        this.resetManeuver()
      } else {
        // 交接只清掉對單架敵機的通過判定；群體壓力、冷卻與保高紀錄繼續。
        this.pass.reset()
        if (this.phase === '反向轉彎') this.finish(true)
      }
      this.source = enemy
    }
    this.remaining = tail || alarm > 0 ? THREAT_MEMORY_SECONDS : Math.max(0, this.remaining - dt)
    if (this.remaining === 0) { this.reset(); return false }

    this.height.observe(self.state.position.y, self.state.velocity.y, dt)
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.jinkCooldown = Math.max(0, this.jinkCooldown - dt)
    this.phaseTime += dt
    if (tail) {
      if (this.pressure <= 0) { this.firstRange = threatRange; this.firstAlarm = alarm }
      this.pressure = Math.min(8, this.pressure + dt)
    } else this.pressure = Math.max(0, this.pressure - dt * 2)
    this.stagnation = tail ? Math.min(15, this.stagnation + dt) : Math.max(0, this.stagnation - dt * 2)
    this.aimedTime = alarm > 2 / 3 && threatRange < 800 ? this.aimedTime + dt : 0
    this.clearTime = alarm < 0.05 ? this.clearTime + dt : 0
    this.snapshot.range = threatRange; this.snapshot.angle = threatAngle; this.snapshot.alarm = alarm
    this.snapshot.tail = tail; this.snapshot.energy = self.specificEnergy
    this.memory.update(this.snapshot, dt)

    if (safetyHold || legacyReversal && this.phase !== '反向轉彎') {
      this.interrupt(); return false
    }
    const ended = this.climb.update(self, enemy, alarm, threatRange, dt)
    if (ended.ended) {
      this.memory.finish(ended.aborted); this.cooldown = 2; this.stagnation = 0; this.reason = this.climb.reason
    }
    if (!this.climb.stage && this.phase === 'off' && this.cooldown === 0 && !this.memory.observing
      && this.stagnation > ADAPTIVE.stagnationSeconds && this.memory.available(StagedClimb.key)
      && StagedClimb.eligible(self, enemy, alarm, threatRange) && (!group || group.permitsClimb(self))) {
      this.climb.start(self)
      if (group && group.activeCount > 1) {
        this.forward.set(0,1,0).applyQuaternion(self.state.orientation)
        const preferred=(-self.state.velocity.z*this.forward.x+self.state.velocity.x*this.forward.z)>=0?1:-1
        this.climb.start(self,group.chooseTurn(self,preferred,30*RAD,ADAPTIVE.climbPitch))
      }
      this.memory.begin(StagedClimb.key, this.snapshot); this.changes++
    }

    const tas = self.state.velocity.length(), turnFloor = stallSpeed(self.spec, self.state.position.y, 3)
    this.relative.copy(enemy.state.velocity).sub(self.state.velocity)
    const closure = -this.relative.dot(this.direction)
    const passed = this.pass.update(range, closure, angle, dt) && !group?.blocksReversal(enemy)
    const groupClosure = group && Number.isFinite(group.closure) ? group.closure : closure
    const gamma = Math.asin(Math.max(-1, Math.min(1, self.state.velocity.y / Math.max(1, tas))))
    const nMax = Math.min(maxLoadFactorAero(self.spec, self.state.position.y, tas), self.spec.limits.gPositive)
    // 展示區以海平面算；正式遊戲改取當前地形高度，最後仍由前方地形預測保護。
    const reserve = self.state.position.y - floor - recoveryAltitude(tas, Math.min(gamma, -18 * RAD), nMax) * 1.5
      - Math.max(0, -self.state.velocity.y) * 5
    const opportunity = chooseOpportunity({recentThreat:true, speed:tas, turnFloor,
      enemySpeed:enemy.state.velocity.length(), range:threatRange, closure:groupClosure, alarm, clearTime:this.clearTime,
      aimedTime:this.aimedTime, passed, descentReserve:reserve, jinkReady:this.jinkCooldown === 0})
    const urgent = opportunity?.phase === '短促換面' || opportunity?.phase === '反向轉彎'
    const canInterrupt = opportunity?.phase === '短促換面' && this.phase !== '短促換面' && this.phase !== '反向轉彎'
      || opportunity?.phase === '反向轉彎' && (this.phase !== '反向轉彎' || this.phaseTime > 1.2)
    if (!this.climb.stage && opportunity && (urgent || !this.memory.observing && this.memory.available(opportunity.phase))
      && (canInterrupt || this.phase === 'off' && this.cooldown === 0)) {
      this.start(self, opportunity.phase, opportunity.reason)
      if (this.phase === '反向轉彎') this.turnSign *= -1
      if (this.phase === '短促換面') {
        const up = this.height.debt >= HEIGHT_POLICY.budget || reserve < 800 || tas > turnFloor * 1.25
        this.jinkPitch = Math.max(-20 * RAD, Math.min(20 * RAD, gamma + (up ? 1 : -1) * MANEUVER.jinkPitch))
        this.jinkCooldown = MANEUVER.jinkCooldown
      }
      if (group) this.turnSign = group.chooseTurn(self,this.turnSign,
        (this.phase === '反向轉彎' ? 65 : this.phase === '短促換面' ? 35 : 0)*RAD,
        this.phase === '短促換面' ? this.jinkPitch : 0)
    }
    const improving = threatRange > this.firstRange + 100 || alarm < this.firstAlarm - 0.3
    if (!this.climb.stage && this.phase === 'off' && this.cooldown === 0 && !this.memory.observing
      && this.pressure >= 5 && !improving && tas > turnFloor * 1.08 && this.memory.available('水平換位')) {
      this.start(self, '水平換位', '持續被追且原動作沒有改善，優先保高換位')
      if(group)this.turnSign=group.chooseTurn(self,this.turnSign,45*RAD)
    }
    if (this.phase !== 'off' && this.maneuverEnergy - self.specificEnergy > MANEUVER.lossBudget) this.finish(true)
    if (this.phase === '恢復速度' && (alarm > 0.25 || groupClosure > 15 || threatRange < 300 || reserve < 300)
      || this.phase === '反向轉彎' && (tas < turnFloor * 1.08 || range > 600 || group?.blocksReversal(enemy))) this.finish(true)
    if (this.phase === '水平換位' && this.phaseTime > 3
      || this.phase === '恢復速度' && this.phaseTime > MANEUVER.recoverySeconds
      || this.phase === '反向轉彎' && this.phaseTime > MANEUVER.reversalSeconds
      || this.phase === '短促換面' && this.phaseTime > MANEUVER.jinkSeconds) this.finish(false)

    let changed = false
    if (this.phase !== 'off') {
      this.direction.copy(this.phase === '恢復速度' ? this.recoveryHeading : self.state.velocity).setY(0).normalize()
      const turn = (this.phase === '水平換位' ? 45 : this.phase === '反向轉彎' ? 65 : this.phase === '短促換面' ? 35 : 0) * RAD * this.turnSign
      const x = this.direction.x, z = this.direction.z, pitch = this.phase === '短促換面' ? this.jinkPitch : 0
      this.direction.set((x * Math.cos(turn) - z * Math.sin(turn)) * Math.cos(pitch), Math.sin(pitch),
        (x * Math.sin(turn) + z * Math.cos(turn)) * Math.cos(pitch))
      out.aimWorld.lerp(this.direction, Math.min(1, this.phaseTime / (this.phase === '短促換面' ? 0.15 : 0.7))).normalize()
      out.throttle = 1; out.brake = 0; out.trackTurn = false; changed = true
    }
    if (this.climb.stage) { this.climb.command(self, enemy, out); changed = true }
    const heightAdjusted = this.height.apply(self, enemy, out, alarm > 2 / 3 && threatRange < 800,
      this.climb.stage === '斜爬・回到接戰' ? this.climb.entryAltitude : undefined)
    this.applied = changed || heightAdjusted
    return this.applied
  }

  private start(self: Aircraft, phase: Exclude<Phase, 'off'>, reason: string): void {
    this.memory.finish(true); this.memory.begin(phase, this.snapshot)
    this.phase = phase; this.phaseTime = 0; this.reason = reason; this.changes++
    this.maneuverEnergy = self.specificEnergy
    this.recoveryHeading.copy(self.state.velocity).setY(0).normalize()
    this.forward.set(0,1,0).applyQuaternion(self.state.orientation)
    this.relative.set(-this.recoveryHeading.z,0,this.recoveryHeading.x)
    this.turnSign = this.relative.dot(this.forward) >= 0 ? 1 : -1
  }
  private finish(aborted: boolean): void {
    this.memory.finish(aborted)
    this.cooldown = this.phase === '水平換位' ? 5 : MANEUVER.opportunityCooldown
    this.phase = 'off'; this.phaseTime = 0; this.pressure = 0
  }
}
