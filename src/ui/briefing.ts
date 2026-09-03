import { missionConfigFrom } from '../battle/missions'
import type {
  MissionCard, ReadyMissionCard, MissionWave, MissionWithdraw, MissionTrigger,
} from '../battle/missions'
import type { AircraftSpec } from '../specs/types'
import type { TerrainKind } from '../world/terrainKind'

/**
 * 簡報頁右欄要畫的東西（2026-09-04 選單重做 spec §2.4）。**純資料，沒有 DOM。**
 *
 * 【為什麼不讓 `menu.ts` 直接讀卡】「出擊前完全不知道我開什麼、對面幾架、
 * 什麼地形」是舊任務頁最大的問題，而這些資料 `missions.ts` 裡全都有 ——
 * 只是沒拿出來。把「卡 → 簡報」寫成純函數，每一關的欄位就釘得住；
 * `menu.ts` 沒有測試（要 DOM），這裡有。
 */
export interface BriefingUnit {
  readonly name: string
  readonly role: AircraftSpec['role']
  readonly count: number
  /** 「要護送的」「要攔下的」—— 被護送的那一列 */
  readonly note?: string
}

export interface BriefingFact {
  readonly label: string
  readonly value: string
}

export interface Briefing {
  /** `false` = 準備中的卡：只有標題、類型、說明 */
  readonly ready: boolean
  readonly title: string
  readonly kind: string
  readonly summary: string
  readonly objective?: string
  readonly mine?: readonly BriefingUnit[]
  readonly foe?: readonly BriefingUnit[]
  /** 順序固定：戰場、時限、增援（每批一列）、中途變更、撤離點 */
  readonly facts?: readonly BriefingFact[]
}

const TERRAIN_LABEL: Record<TerrainKind, string> = {
  archipelago: '群島',
  farmland: '內陸農地',
  sea: '純海面',
}

/**
 * 機種在畫面上的短名。**找不到就用 `spec.name`。**
 *
 * 【為什麼不直接用 `spec.name`】「B-17G Flying Fortress」在一列裡是 22 個字。
 * 漏填的代價只是那一列比別人長，看得見、修得快。
 */
export const SHORT_NAME: Record<string, string> = {
  p51d: 'P-51D', bf109k4: 'Bf 109 K-4', f6f5: 'F6F-5', ki84: 'Ki-84', a6m5: 'A6M5',
  b17g: 'B-17G', he111: 'He 111', g4m: 'G4M',
}

export const shortName = (spec: AircraftSpec): string => SHORT_NAME[spec.id] ?? spec.name

const SIDE_WORD = { mine: '我方', theirs: '敵方' } as const
const ROLE_WORD: Record<AircraftSpec['role'], string> = { fighter: '戰鬥機', bomber: '轟炸機' }

/**
 * 觸發條件的白話。`lead` 是預警到進場的秒數 —— 增援有，撤離沒有。
 *
 * 【`at + warnLead` 才是進場】`at` 秒發警告，`warnLead` 秒後才 `reinforce`
 * （`setup.ts` 的 `stepBeats`）。德 M1 是 60 秒預警、64 秒進場，不是第 60 秒
 * —— Codex 審查 2026-09-04 抓到的。
 */
function whenWord(t: MissionTrigger, lead: number): string {
  if (t.kind === 'clock') return `第 ${t.at + lead} 秒`
  const role = t.role === undefined ? '' : ROLE_WORD[t.role]
  return `${SIDE_WORD[t.side]}${role}剩 ≤ ${t.atMost} 架時（最晚第 ${t.byLatest + lead} 秒）`
}

function waveFact(w: MissionWave): BriefingFact {
  return {
    label: w.side === 'theirs' ? '敵方增援' : '我方增援',
    value: `${whenWord(w.when, w.warnLead)}　${shortName(w.spec)} ×${w.count}`,
  }
}

function withdrawFacts(w: MissionWithdraw): BriefingFact[] {
  const km = Math.round(w.distance / 1000)
  return [
    { label: '中途變更', value: `${whenWord(w.when, 0)}→ ${w.message}` },
    { label: '撤離點', value: `後方 ${km} km，${Number.isFinite(w.seconds) ? `倒數 ${w.seconds} 秒` : '無倒數'}` },
  ]
}

function readyBriefing(card: ReadyMissionCard): Briefing {
  const b = card.battle
  const mine: BriefingUnit[] = [{ name: shortName(b.blueSpec), role: b.blueSpec.role, count: b.blueCount }]
  const foe: BriefingUnit[] = [{ name: shortName(b.redSpec), role: b.redSpec.role, count: b.redCount }]

  // 【護送／攔截由規則的 owner 決定】`missions.ts` 就是用它決定 convoy 放哪一隊
  // （護送 `owner: 'blue'`、攔截 `owner: 'red'`）。不另寫一套判斷。
  const rules = missionConfigFrom(card).rules
  if (b.convoySpec !== null && rules.kind === 'convoy') {
    const unit: BriefingUnit = {
      name: shortName(b.convoySpec), role: b.convoySpec.role, count: b.convoyCount,
      note: rules.owner === 'blue' ? '要護送的' : '要攔下的',
    }
    if (rules.owner === 'blue') mine.push(unit)
    else foe.push(unit)
  }

  const facts: BriefingFact[] = [
    { label: '戰場', value: TERRAIN_LABEL[b.terrain] },
    { label: '時限', value: Number.isFinite(b.seconds) ? `${b.seconds} 秒` : '無' },
  ]
  for (const w of b.waves ?? []) facts.push(waveFact(w))
  if (b.withdraw !== undefined) facts.push(...withdrawFacts(b.withdraw))

  return {
    ready: true,
    title: card.title, kind: card.type, summary: card.summary,
    objective: b.withdraw === undefined ? b.objective : `${b.objective} → ${b.withdraw.message}`,
    mine, foe, facts,
  }
}

/** 卡 → 簡報。準備中的卡只帶標題、類型、說明。 */
export function briefingOf(card: MissionCard): Briefing {
  if (card.battle === null) {
    return { ready: false, title: card.title, kind: card.type, summary: card.summary }
  }
  return readyBriefing(card as ReadyMissionCard)
}
