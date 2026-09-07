import { describe, it, expect } from 'vitest'
import { missionConfigFrom } from '../../src/battle/missions'
import { readyCard, ESCORT_CARD, INTERCEPT_CARD } from '../fixtures/mission'
import { MISSION_CONFIG_BASELINE } from '../fixtures/mission-config-baseline'
import type { BattleConfig } from '../../src/battle/setup'

/**
 * # 兩張有實測基礎的卡，改寫前後產出的設定必須相同
 *
 * 三條戰役那一輪把 `missionConfigFrom` 從「陣營 → 兩台飛機」改成「卡片直接
 * 指名機種」。護送與攔截的幾何、偏置與編制是掃描定出來的，
 * **重新調數值等於把那次掃描的結果丟掉**。
 *
 * 【為什麼比的是正規化的純量快照】`BattleConfig` 是一張物件圖，含新建的
 * `Vector3`、共用的 `AircraftSpec` 參考與 `Infinity`。兩次**正確**生成也不會
 * 有相同的物件身分 —— 「逐位元相同」對它沒有意義。
 *
 * 【`beats` 不在快照裡】德 M1 會多一個波次，那是刻意的新增。其餘每一格
 * 逐項相等。
 */

/** 與 `mission-config-baseline.probe.ts` 的 `snapshot` 必須逐字相同 */
const INF = '∞'

function num(v: number): number | string {
  if (v === Infinity) return INF
  if (v === -Infinity) return `-${INF}`
  return v
}

function rules(r: BattleConfig['rules']): unknown {
  if (r.kind === 'annihilate') return { kind: r.kind }
  if (r.kind === 'evacuate') {
    return {
      kind: r.kind,
      point: [r.point.x, r.point.y, r.point.z],
      radius: r.radius,
      seconds: num(r.seconds),
    }
  }
  if (r.kind === 'sink') return { kind: r.kind, count: r.count }
  // 【守住艦隊沒有自己的欄位】要害艦由 `MissionFleet` 的 `vital` 指名，
  // 規則本身只有 `kind`
  if (r.kind === 'defend') return { kind: r.kind }
  return {
    kind: r.kind,
    owner: r.owner,
    point: [r.point.x, r.point.y, r.point.z],
    radius: r.radius,
  }
}

function snapshot(cfg: BattleConfig): unknown {
  return {
    units: cfg.units.map((u) => ({
      team: u.team,
      members: u.members.map((s) => s.id),
      entry: {
        along: u.entry.along, across: u.entry.across, gap: u.entry.gap,
        climb: u.entry.climb, heading: u.entry.heading, speed: u.entry.speed,
      },
      duty: u.duty,
      lane: u.lane,
      tier: u.tier,
      player: u.player === true,
    })),
    altitude: cfg.altitude,
    tas: cfg.tas,
    entryRange: cfg.entryRange,
    schwarmSpacing: cfg.schwarmSpacing,
    lateralOffset: cfg.lateralOffset,
    altitudeSpread: cfg.altitudeSpread,
    aiProfile: { ...cfg.aiProfile },
    rules: rules(cfg.rules),
    tuning: { ...cfg.tuning },
  }
}

describe('任務設定的基準', () => {
  it('護送卡（盟 M1）產出的設定與掃描定值時相同', () => {
    expect(snapshot(missionConfigFrom(readyCard(ESCORT_CARD))))
      .toEqual(MISSION_CONFIG_BASELINE['allies-escort'])
  })

  it('攔截卡（德 M1）產出的設定與掃描定值時相同', () => {
    expect(snapshot(missionConfigFrom(readyCard(INTERCEPT_CARD))))
      .toEqual(MISSION_CONFIG_BASELINE['axis-intercept'])
  })

  it('基準本身不是空的 —— 對照組', () => {
    // 【為什麼要這一條】上面兩條在 fixture 意外變成 `{}` 而 snapshot 也回
    // `{}` 時會一起綠。這裡釘住基準確實含編制與規則
    for (const key of ['allies-escort', 'axis-intercept'] as const) {
      expect(MISSION_CONFIG_BASELINE[key].units.length, key).toBeGreaterThan(2)
    }
  })
})
