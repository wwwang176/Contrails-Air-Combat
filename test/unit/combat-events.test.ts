import { describe, expect, it } from 'vitest'
import { drainReports, type ReportEventState } from '../../src/battle/combatEvents'
import { createRoster } from '../../src/battle/pilots'
import { createBattleReport, REPORT_RELEASE_INTERVAL } from '../../src/battle/report'
import { createImpacts, clearImpacts, pushImpact } from '../../src/world/events'
import { createGroundTarget } from '../../src/world/groundTargets'
import { createShip, SHIP_CLASSES } from '../../src/world/ships'

/** 只供應事件消費所需的資料，無須建立物理世界、控制器或任務設定。 */
function state(): ReportEventState {
  return {
    world: {
      time: 0,
      groundKillEvents: createImpacts(),
      shipHitEvents: createImpacts(),
      shipKillEvents: createImpacts(),
      groundTargets: [createGroundTarget(0, 'truck', 'red', 0, 0, 0)],
      ships: [createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 0)],
    },
    roster: createRoster(['玩家', '僚機'], 0),
    report: createBattleReport(),
    groundKillsSeen: 0,
  }
}

describe('戰果事件緩衝的消費權', () => {
  it('地面事件保留給渲染層，重掃不重報，排空後的新事件仍被接收', () => {
    const b = state()
    const e = b.world.groundKillEvents
    pushImpact(e, 1, 2, 3, 0, 0, 1)
    drainReports(b)
    expect(e.count).toBe(1)
    expect(b.groundKillsSeen).toBe(1)
    expect(b.report.count).toBe(1)

    b.world.time += REPORT_RELEASE_INTERVAL
    drainReports(b)
    expect(b.report.count).toBe(1)
    expect(b.report.queueCount).toBe(0)

    clearImpacts(e)
    pushImpact(e, 4, 5, 6, 0, 0, 1)
    drainReports(b)
    expect(e.count).toBe(1)
    expect(b.groundKillsSeen).toBe(2)
    expect(b.report.count).toBe(2)
  })

  it('船的兩種事件消費後立即排空，先報命中再報擊沉', () => {
    const b = state()
    pushImpact(b.world.shipHitEvents, 1, 2, 3, 0, 0, 0)
    pushImpact(b.world.shipKillEvents, 1, 2, 3, 0, 0, 0)
    drainReports(b)
    expect(b.world.shipHitEvents.count).toBe(0)
    expect(b.world.shipKillEvents.count).toBe(0)
    expect(b.report.lines[0]!.kind).toBe('torpedo')
    expect(b.report.queueCount).toBe(1)

    b.world.time += REPORT_RELEASE_INTERVAL
    drainReports(b)
    expect(b.report.count).toBe(2)
    expect(b.report.lines[0]!.kind).toBe('ship')
    expect(b.report.lines[1]!.kind).toBe('torpedo')
    expect(b.report.queueCount).toBe(0)

    b.world.time += REPORT_RELEASE_INTERVAL
    drainReports(b)
    expect(b.report.count).toBe(2)
    expect(b.report.queueCount).toBe(0)
  })
})
