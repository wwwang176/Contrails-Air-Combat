import { missionConfigFrom } from '../../src/battle/missions'
import { readyCard, ESCORT_CARD, INTERCEPT_CARD } from '../fixtures/mission'
import type { BattleConfig } from '../../src/battle/setup'

/**
 * 產生 `test/fixtures/mission-config-baseline.ts`。
 *
 * ```
 *   npx vite-node test/tools/mission-config-baseline.probe.ts > test/fixtures/mission-config-baseline.ts
 * ```
 *
 * 【為什麼要有這份基準】三條戰役那一輪把 `missionConfigFrom` 從
 * 「陣營 → 兩台飛機」改成「卡片直接指名機種」。**盟 M1 與德 M1 是唯二有實測
 * 基礎的關卡**（護送／攔截的幾何、偏置與編制是掃描定的），所以
 * 它們改寫之後產出的設定必須與改動前一模一樣。
 *
 * **這支探針必須在動 `missions.ts` 之前跑過一次。** 事後再跑等於拿改動後的
 * 自己比自己 —— 那一次已經跑過了（三條戰役之前），產物就是那份
 * fixture。這裡的程式碼後來跟著新 API 更新，所以它現在產的是**現況**的快照，
 * 只在「刻意重新定值」時才該用。
 *
 * 【為什麼是正規化的純量快照而不是物件】`BattleConfig` 是一張物件圖，含新建
 * 的 `Vector3`、共用的 `AircraftSpec` 參考與 `Infinity`。兩次**正確**生成也
 * 不會有相同的物件身分，所以「逐位元相同」對它沒有意義。這裡把它壓成純量：
 * 機種寫 `spec.id`、向量寫三個數字、`Infinity` 寫成一個明確的標記字串。
 *
 * 【產出的 fixture 不得 import 任何常數】全部是字面值。import 的話 spec 改壞
 * 時 fixture 跟著變，兩邊一起錯還是全綠。
 */

/** `Infinity` 在 JSON 裡會變成 null，所以換一個看得見的標記 */
const INF = '∞'

function num(v: number): number | string {
  if (v === Infinity) return INF
  if (v === -Infinity) return `-${INF}`
  return v
}

/** 把 `BattleConfig` 壓成純量。**機種只留 id。** */
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
  // 【守住艦隊沒有自己的欄位】要害艦由 `MissionFleet` 的 `vital` 指名
  if (r.kind === 'defend') return { kind: r.kind }
  return {
    kind: r.kind,
    owner: r.owner,
    point: [r.point.x, r.point.y, r.point.z],
    radius: r.radius,
  }
}

const escort = readyCard(ESCORT_CARD)
const intercept = readyCard(INTERCEPT_CARD)

console.log(`/**
 * 「三條戰役」那一輪之前，兩張有實測基礎的卡產出的設定。
 *
 * **重新產生**：見 \`test/tools/mission-config-baseline.probe.ts\` 的檔頭。
 * **不要手改這裡的數字** —— 手改一個位數就等於悄悄放寬了一條護欄。
 *
 * 【為什麼只有這兩張】它們是唯二有實測基礎的關卡（護送／攔截的幾何、偏置與
 * 編制是掃描定的）。改寫成新形狀之後產出的設定必須一模一樣。
 */
export const MISSION_CONFIG_BASELINE = ${JSON.stringify(
  { 'allies-escort': snapshot(missionConfigFrom(escort)),
    'axis-intercept': snapshot(missionConfigFrom(intercept)) },
  null, 2,
)} as const
`)
