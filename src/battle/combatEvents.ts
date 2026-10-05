import type { World } from '../world/World'
import { KILL_STRIDE } from '../world/kills'
import { IMPACT_STRIDE, clearImpacts, type ImpactEvents } from '../world/events'
import { assistCredits } from '../world/assists'
import type { MessageKey } from '../i18n'
import { aircraftNameKey, groundUnitNameKey, shipNameKey } from '../i18n/names'
import type { FlightIndex } from './flights'
import { recordKill, swapPilots, type Roster } from './pilots'
import { pickTakeover, TAKEOVER_DELAY } from './takeover'
import { queueReport, stepBattleReport, type BattleReport, type ReportKind } from './report'

/** 擊墜記帳只需要事件、名冊與接手狀態；呼叫端直接傳入戰鬥，不建立轉接物件。 */
export interface KillEventState {
  readonly world: Pick<World, 'killEvents' | 'combatants' | 'damageTime' | 'damageStride' | 'time'>
  readonly roster: Roster
  readonly report: BattleReport
  readonly flights: FlightIndex
  readonly convoy: { readonly seats: readonly number[] } | null
  killsSeen: number
  redKilled: number
  redKilledBombers: number
  takeoverSeat: number
  takeoverTimer: number
  takeoverKiller: number
}

/** 船與地面戰果不依賴飛機編制或接手狀態。 */
export interface ReportEventState {
  readonly world: Pick<World,
    'groundKillEvents' | 'shipHitEvents' | 'shipKillEvents' | 'groundTargets' | 'ships' | 'time'>
  readonly roster: Pick<Roster, 'pilots'>
  readonly report: BattleReport
  groundKillsSeen: number
}

/** 助攻掃描重用同一份暫存；每筆事件由 assistCredits 重填。 */
const ASSISTS: number[] = []

/**
 * 依流水號記帳，保留事件給渲染層消費。玩家身分必須先移交再記錄擊墜，
 * 才不會把被接手前的陣亡記到玩家身上。
 */
export function drainKills(b: KillEventState): void {
  const ke = b.world.killEvents
  const w = b.world
  const first = ke.total - ke.count
  const seen = b.killsSeen
  b.killsSeen = ke.total
  for (let e = 0; e < ke.count; e++) {
    if (first + e < seen) continue
    const o = e * KILL_STRIDE
    const victim = ke.data[o + 6]!
    const killer = ke.data[o + 7]!

    // 自摔也算紅方損失；重生後再次陣亡會有新的流水號。
    const v = w.combatants[victim]
    if (v !== undefined && v.team === 'red') {
      b.redKilled++
      if (v.aircraft.spec.role === 'bomber') b.redKilledBombers++
    }
    // 延遲期間身分已搬到新座位，須讀名冊，不能讀尚未移交的 player。
    if (b.roster.pilots[victim]?.isPlayer === true) {
      const target = pickTakeover(b.flights, w.combatants, victim, b.convoy?.seats)
      if (target >= 0) {
        swapPilots(b.roster, victim, target)
        b.takeoverSeat = target
        b.takeoverTimer = TAKEOVER_DELAY
        b.takeoverKiller = killer
      }
    }

    // 自摔仍須接手，但沒有擊墜與助攻歸屬。
    if (killer >= 0) {
      assistCredits(w.damageTime, w.damageStride, victim, killer, w.time, ASSISTS)
    } else {
      ASSISTS.length = 0
    }
    recordKill(b.roster, victim, killer, ASSISTS)

    // 記分與通報讀同一份已完成身分移交的名冊。
    if (b.roster.pilots[killer]?.isPlayer === true) {
      const spec = w.combatants[victim]?.aircraft.spec
      const nameKey = spec === undefined ? undefined : aircraftNameKey(spec.id)
      if (nameKey !== undefined) queueReport(b.report, 'air', nameKey)
    }
  }
}

/** 消費相同格式的戰果緩衝，回傳已處理到的流水號；不配置回呼或事件物件。 */
function drainReportBuffer(
  b: ReportEventState, e: ImpactEvents, kind: ReportKind, seen: number,
): number {
  const first = e.total - e.count
  for (let i = 0; i < e.count; i++) {
    if (first + i < seen) continue
    const o = i * IMPACT_STRIDE
    const killer = e.data[o + 4]!
    if (b.roster.pilots[killer]?.isPlayer !== true) continue
    const nameKey = reportNameKey(b, kind, e.data[o + 3]!)
    if (nameKey !== undefined) queueReport(b.report, kind, nameKey)
  }
  return e.total
}

/** 找不到目標或炸到友軍地面單位時不通報。 */
function reportNameKey(b: ReportEventState, kind: ReportKind, index: number): MessageKey | undefined {
  if (kind === 'ground') {
    const t = b.world.groundTargets[index]
    return t === undefined || t.team === 'blue' ? undefined : groundUnitNameKey(t.unit.id)
  }
  const s = b.world.ships[index]
  return s === undefined ? undefined : shipNameKey(s.cls.id)
}

/** 消費船與地面戰果，再推進通報的出場與過期時間。 */
export function drainReports(b: ReportEventState): void {
  const w = b.world
  // 地面事件也供渲染層點火，保留緩衝並以流水號避免重複；船的事件由這裡獨佔。
  b.groundKillsSeen = drainReportBuffer(b, w.groundKillEvents, 'ground', b.groundKillsSeen)
  // 同一枚魚雷同時命中並擊沉時，必須先出現命中通報。
  drainReportBuffer(b, w.shipHitEvents, 'torpedo', 0)
  clearImpacts(w.shipHitEvents)
  drainReportBuffer(b, w.shipKillEvents, 'ship', 0)
  clearImpacts(w.shipKillEvents)
  stepBattleReport(b.report, w.time)
}
