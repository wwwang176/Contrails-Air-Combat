/** 防禦換招的效果記憶與分段斜爬；正式 AI 與展示區共用。 */
import { Vector3 } from 'three'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import { stallSpeed } from '../analysis/envelope'

const RAD = Math.PI / 180
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
export interface OutcomeSnapshot { range: number; angle: number; alarm: number; tail: boolean; energy: number }
export const ADAPTIVE = { observeSeconds: 2, failedCooldown: 20, stagnationSeconds: 8,
  climbSeconds: 2.8, topSeconds: 2.5, topAngle: 55 * RAD, returnSeconds: 3, climbPitch: 22 * RAD,
  returnPitch: -10 * RAD, lossBudget: 180, gainTarget: 65 } as const

export class ManeuverMemory {
  time = 0
  message = ''
  readonly reports: {t: number; label: string; reason: string}[] = []
  private blocked = new Map<string, number>()
  private start: {key: string; snapshot: OutcomeSnapshot} | null = null
  private pending: {key: string; snapshot: OutcomeSnapshot; elapsed: number; range: number; angle: number; alarm: number; clear: number; aborted: boolean}[] = []
  constructor(private readonly recordReports = true) {}
  reset(): void {
    this.time = 0; this.message = ''; this.blocked.clear(); this.start = null
    this.pending.length = 0; this.reports.length = 0
  }
  get observing(): boolean { return this.pending.length > 0 }
  available(key: string): boolean { return this.time >= (this.blocked.get(key) ?? 0) }
  begin(key: string, snapshot: OutcomeSnapshot): void {
    // 新機動插入會污染上一招的觀察窗，不能把後續招式的成果記在上一招。
    for (const p of this.pending) p.aborted = true
    this.start = {key, snapshot: {...snapshot}}
  }
  finish(aborted = false): void {
    if (!this.start) return
    this.pending.push({...this.start, elapsed:0, range:0, angle:0, alarm:0, clear:0, aborted})
    this.start = null
  }
  update(snapshot: OutcomeSnapshot, dt: number): void {
    this.time += dt
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]!
      p.elapsed += dt; p.range += snapshot.range * dt; p.angle += snapshot.angle * dt
      p.alarm += snapshot.alarm * dt; p.clear += snapshot.tail ? 0 : dt
      if (p.elapsed < ADAPTIVE.observeSeconds) continue
      // 看完整觀察窗，不把一瞬間的視線偏離或剛好不在射擊錐內算成功。
      const positionBetter = p.clear / p.elapsed > 0.75
        || (p.range / p.elapsed > p.snapshot.range + 120 && p.alarm / p.elapsed < 0.3)
        || (p.angle / p.elapsed < p.snapshot.angle - 35 && p.angle / p.elapsed < 120)
      const threatBetter = p.snapshot.alarm > 0.65 && p.alarm / p.elapsed < 0.2
      const useful = !p.aborted && (positionBetter || threatBetter) && snapshot.energy > p.snapshot.energy - ADAPTIVE.lossBudget
      if (!useful) this.blocked.set(p.key, this.time + ADAPTIVE.failedCooldown)
      this.message = useful ? `${p.key}：觀察窗內有改善` : `${p.key}：${p.aborted ? '中止' : '未見持續改善'}，暫停重用 ${ADAPTIVE.failedCooldown} 秒`
      // 正式遊戲只保留目前結果，避免長時間作戰不斷累積展示區事件。
      if (this.recordReports) this.reports.push({t:this.time, label:useful ? '換招有改善' : '暫停無效招式', reason:this.message})
      this.pending.splice(i, 1)
    }
  }
}

export type ClimbStage = '斜爬・拉高' | '斜爬・上方轉向' | '斜爬・回到接戰'
/** 只發出瞄準方向，不直接改姿態。每段有幾何出口、速度護欄與時間上限。 */
export class StagedClimb {
  stage: ClimbStage | null = null
  reason = ''
  entryAltitude = 0
  gained = 0
  private elapsed = 0
  private dangerTime = 0
  private entryEnergy = 0
  private sign = 1
  private topHeading = new Vector3()
  private heading = new Vector3()
  private lift = new Vector3()
  private los = new Vector3()
  static readonly key = '分段斜爬'

  static eligible(self: Aircraft, enemy: Aircraft, alarm: number, range: number): boolean {
    const speed = self.state.velocity.length(), floor = stallSpeed(self.spec, self.state.position.y, 3)
    // 用當下速度餘裕支付短爬升；不再要求一定比敵人多 80 m 能量，仍拒絕明顯劣勢。
    return speed > floor * 1.15 && speed > enemy.state.velocity.length() * 0.85
      && self.specificEnergy > enemy.specificEnergy - 150 && alarm < 0.65 && range > 120
  }

  start(self: Aircraft, turnSign?: number): void {
    this.stage = '斜爬・拉高'; this.elapsed = 0; this.dangerTime = 0
    this.entryAltitude = self.state.position.y; this.entryEnergy = self.specificEnergy; this.gained = 0
    this.heading.copy(self.state.velocity); this.heading.y = 0; this.heading.normalize()
    this.lift.set(0, 1, 0).applyQuaternion(self.state.orientation)
    this.sign = (-this.heading.z * this.lift.x + this.heading.x * this.lift.z) >= 0 ? 1 : -1
    if (turnSign !== undefined) this.sign = turnSign
    this.reason = '持續被咬尾且有速度餘裕：先斜爬，改變交戰平面'
  }

  /** true 表示本次已結束；aborted 區分完整機動與緊急中止。 */
  update(self: Aircraft, enemy: Aircraft, alarm: number, range: number, dt: number): {ended: boolean; aborted: boolean} {
    if (!this.stage) return {ended:false, aborted:false}
    this.elapsed += dt
    this.dangerTime = alarm > 0.85 && range < 350 ? this.dangerTime + dt : 0
    this.gained = Math.max(this.gained, self.state.position.y - this.entryAltitude)
    const speed = self.state.velocity.length(), floor = stallSpeed(self.spec, self.state.position.y, 3)
    if (speed < floor * 1.04 || self.specificEnergy < this.entryEnergy - ADAPTIVE.lossBudget || this.dangerTime > 0.3) {
      this.stop('斜爬中止：速度／能量不足或敵人重新取得持續射擊解')
      return {ended:true, aborted:true}
    }
    this.heading.copy(self.state.velocity); this.heading.y = 0; this.heading.normalize()
    if (this.stage === '斜爬・拉高' && (this.elapsed > ADAPTIVE.climbSeconds || this.gained > ADAPTIVE.gainTarget)) {
      if (this.gained < 15) {
        this.stop('沒有建立高度差，停止重複拉高'); return {ended:true, aborted:true}
      }
      this.stage = '斜爬・上方轉向'; this.elapsed = 0; this.topHeading.copy(this.heading)
      this.reason = '已取得高度差，在上方繼續轉向，觀察追擊者是否跟上'
    } else if (this.stage === '斜爬・上方轉向'
      && (this.elapsed > ADAPTIVE.topSeconds || this.heading.angleTo(this.topHeading) > ADAPTIVE.topAngle)) {
      this.stage = '斜爬・回到接戰'; this.elapsed = 0
      this.reason = '轉向後重新接戰；回程只能使用本次剛取得的高度'
    } else if (this.stage === '斜爬・回到接戰') {
      this.los.copy(enemy.state.position).sub(self.state.position)
      const inFront = this.heading.dot(this.los) > this.los.length() * Math.cos(45 * RAD)
      const nearFloor = self.state.position.y + Math.min(0, self.state.velocity.y) * 2 < this.entryAltitude + 10
      if (this.elapsed > ADAPTIVE.returnSeconds || this.elapsed > 0.8 && (inFront || nearFloor)) {
        this.stop('分段斜爬完成，觀察相對位置是否改善'); return {ended:true, aborted:false}
      }
    }
    return {ended:false, aborted:false}
  }

  stop(reason: string): void { this.stage = null; this.reason = reason }

  command(self: Aircraft, enemy: Aircraft, out: Command): void {
    if (!this.stage) return
    this.heading.copy(self.state.velocity); this.heading.y = 0; this.heading.normalize()
    let turn = (this.stage === '斜爬・拉高' ? 30 : 70) * RAD * this.sign
    let pitch = this.stage === '斜爬・拉高' ? ADAPTIVE.climbPitch : 0
    if (this.stage === '斜爬・回到接戰') {
      this.los.copy(enemy.state.position).sub(self.state.position)
      const error = Math.atan2(this.heading.x * this.los.z - this.heading.z * this.los.x, this.heading.x * this.los.x + this.heading.z * this.los.z)
      // 目標在正後方時沿原側轉，避免 atan2 跨 ±π 造成左右抖動。
      turn = Math.abs(error) > 150 * RAD ? this.sign * 65 * RAD : clamp(error, -65 * RAD, 65 * RAD)
      const room = self.state.position.y + Math.min(0, self.state.velocity.y) * 2 - this.entryAltitude
      pitch = room > 20 ? ADAPTIVE.returnPitch : 3 * RAD
    }
    const x = this.heading.x, z = this.heading.z
    out.aimWorld.set((x * Math.cos(turn) - z * Math.sin(turn)) * Math.cos(pitch), Math.sin(pitch),
      (x * Math.sin(turn) + z * Math.cos(turn)) * Math.cos(pitch))
    out.throttle = 1; out.brake = 0; out.trackTurn = false
  }
}
