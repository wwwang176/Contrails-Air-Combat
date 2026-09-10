import { missionConfigFrom } from '../battle/missions'
import type { MissionCard, ReadyMissionCard } from '../battle/missions'
import type { AircraftSpec } from '../specs/types'

/**
 * 簡報頁右欄要畫的東西（選單 spec §2.4）。**純資料，沒有 DOM。**
 *
 * 【為什麼不讓 `menu.ts` 直接讀卡】玩家出擊前要知道自己開什麼、對面幾架、
 * 什麼地形，而這些資料 `missions.ts` 裡全都有。把「卡 → 簡報」寫成純函數，
 * 每一關的欄位就釘得住；
 * `menu.ts` 沒有測試（要 DOM），這裡有。
 */
export interface BriefingUnit {
  readonly name: string
  readonly role: AircraftSpec['role']
  readonly count: number
  /** 「要護送的」「要攔下的」—— 被護送的那一列 */
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
  /**
   * 兩列：空域、時期。
   *
   * 【為什麼只有這兩列】時限、敵方增援、中途變更、撤離點都是遊戲內容 ——
   * 玩家還沒進入戰鬥，不會知道那些。出擊前寫得出來的是空域、時期、任務
   * 目標；寫不出
   * 「敵人第 64 秒會來四架」，也寫不出「我方剩 ≤ 4 架時最晚第 40 秒撤」——
   * 那是規則的內部數字，不是簡報的語言。
   *
   * 那幾項一個都沒從資料裡拿掉（`waves`／`seconds`／`withdraw` 照樣驅動
   * 戰鬥），只是不上簡報；撤退這件事本身仍然寫在目標列的「→ 返航」。
   */
  readonly facts?: readonly BriefingFact[]
}

/**
 * 機種在畫面上的短名。**找不到就用 `spec.name`。**
 *
 * 【為什麼不直接用 `spec.name`】「B-17G Flying Fortress」在一列裡是 22 個字。
 * 漏填的代價只是那一列比別人長，看得見、修得快。
 */
export const SHORT_NAME: Record<string, string> = {
  p51d: 'P-51D', bf109k4: 'Bf 109 K-4', f6f5: 'F6F-5', f4f4: 'F4F-4', ki84: 'Ki-84', a6m5: 'A6M5',
  b17g: 'B-17G', he111: 'He 111', g4m: 'G4M',
}

export const shortName = (spec: AircraftSpec): string => SHORT_NAME[spec.id] ?? spec.name


function readyBriefing(card: ReadyMissionCard): Briefing {
  const b = card.battle
  const mine: BriefingUnit[] = [{ name: shortName(b.blueSpec), role: b.blueSpec.role, count: b.blueCount }]
  // 【沒有敵機就不列】零架的那一列是「一支根本沒起飛的敵軍」
  const foe: BriefingUnit[] = b.redCount === 0
    ? []
    : [{ name: shortName(b.redSpec), role: b.redSpec.role, count: b.redCount }]

  // 【護送／攔截由規則的 owner 決定】`missions.ts` 就是用它決定 convoy 放哪一隊
  // （護送 `owner: 'blue'`、攔截 `owner: 'red'`）。不另寫一套判斷。
  const rules = missionConfigFrom(card).rules
  if (b.convoySpec !== null && rules.kind === 'convoy') {
    const unit: BriefingUnit = {
      name: shortName(b.convoySpec), role: b.convoySpec.role, count: b.convoyCount,
    }
    if (rules.owner === 'blue') mine.push(unit)
    else foe.push(unit)
  }

  const facts: BriefingFact[] = [
    { label: '空域', value: card.place },
    { label: '時期', value: card.period },
  ]

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
