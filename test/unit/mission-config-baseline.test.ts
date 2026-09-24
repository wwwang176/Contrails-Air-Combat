import { describe, it, expect } from 'vitest'
import { missionConfigFrom } from '../../src/battle/missions'
import { readyCard, ESCORT_CARD, INTERCEPT_CARD } from '../fixtures/mission'
import { MISSION_CONFIG_BASELINE } from '../fixtures/mission-config-baseline'
import type { BattleConfig } from '../../src/battle/setup'

/**
 * # 護送卡與攔截卡產出的設定不會悄悄漂移
 *
 * 【它守的東西在九關改版之後換了】上一版釘的是三條戰役那一輪掃描定出來的
 * 幾何、偏置與編制 —— 那時的理由是「重新調數值等於把那次掃描的結果丟掉」。
 * 九關改版把盟 M1 換成柏林的十六架箱型、德 M1 換成擊落規則，**那次掃描就是
 * 這一輪刻意丟掉的東西**。現在的每一個數字都是起始值、待試飛裁定，所以這一份
 * 守的是「沒有人打算改卡片的時候，設定不該變」。
 *
 * 【攔截那一張是合成卡】出貨的九關沒有攔截卡了（德 M1 的規則是 hunt）。
 * 它由 `test/fixtures/mission.ts` 從護送卡鏡像出來 —— 改盟 M1 會讓兩張一起動。
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
  if (r.kind === 'sink' || r.kind === 'destroy') return { kind: r.kind, count: r.count }
  if (r.kind === 'interdict') return { kind: r.kind, count: r.count, leak: r.leak, unit: r.unit }
  // 【擊落要連 role 一起記】少了它，把 `huntRole` 從轟炸機改成戰鬥機不會
  // 動到基準，而那是換掉整關的內容
  if (r.kind === 'hunt') return { kind: r.kind, count: r.count, role: r.role }
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
