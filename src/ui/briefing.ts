import { missionConfigFrom } from '../battle/missions'
import type { MissionCard, MissionType, ReadyMissionCard } from '../battle/missions'
import type { AircraftSpec } from '../specs/types'
import { formatMonth, t, type MessageKey } from '../i18n'

/** 任務類型的顯示名稱。少一種類型是編譯錯誤 */
const TYPE_KEY: Readonly<Record<MissionType, MessageKey>> = {
  annihilate: 'mission.type.annihilate',
  intercept: 'mission.type.intercept',
  strike: 'mission.type.strike',
  escort: 'mission.type.escort',
  withdraw: 'mission.type.withdraw',
}

/** 任務類型在目前語言的名稱 */
export const missionTypeName = (type: MissionType): string => t(TYPE_KEY[type])

/**
 * 簡報頁右欄要畫的東西（選單 spec §2.4）。**純資料，沒有 DOM。**
 *
 * 【為什麼不讓 `menu.ts` 直接讀卡】玩家出擊前要知道自己開什麼、對面幾架、
 * 什麼地形，而這些資料 `missions.ts` 裡全都有。把「卡 → 簡報」寫成純函數，
 * 每一關的欄位就釘得住；
 * `menu.ts` 沒有測試（要 DOM），這裡有。
 */
export interface BriefingUnit {
  /** 機種 id。畫面用它挑側影圖與陣營章，`name` 是給人看的 */
  readonly id: string
  readonly name: string
  readonly role: AircraftSpec['role']
  readonly count: number
  /** 「要護送的」「要攔下的」—— 被護送的那一列 */
}

export interface BriefingFact {
  /** 這一列是什麼。程式與測試認它，`label` 是給人看的 */
  readonly id: 'place' | 'period'
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
  b17g: 'B-17G', he111: 'He 111', ju87: 'Ju 87', g4m: 'G4M',
}

export const shortName = (spec: AircraftSpec): string => SHORT_NAME[spec.id] ?? spec.name


/** 加一架機種進這一欄；已經有同機種就併進那一列 */
function addUnit(rows: BriefingUnit[], spec: AircraftSpec, count: number): void {
  const at = rows.findIndex((u) => u.id === spec.id)
  if (at < 0) rows.push({ id: spec.id, name: shortName(spec), role: spec.role, count })
  else rows[at] = { ...rows[at]!, count: rows[at]!.count + count }
}

function readyBriefing(card: ReadyMissionCard): Briefing {
  const b = card.battle
  const mine: BriefingUnit[] = [
    { id: b.blueSpec.id, name: shortName(b.blueSpec), role: b.blueSpec.role, count: b.blueCount },
  ]
  // 【沒有敵機就不列】零架的那一列是「一支根本沒起飛的敵軍」
  const foe: BriefingUnit[] = b.redCount === 0
    ? []
    : [{ id: b.redSpec.id, name: shortName(b.redSpec), role: b.redSpec.role, count: b.redCount }]

  // 【護送／攔截由規則的 owner 決定】`missions.ts` 就是用它決定 convoy 放哪一隊
  // （護送 `owner: 'blue'`、攔截 `owner: 'red'`）。不另寫一套判斷。
  //
  // 【攻擊隊恆在我方、轟炸機流恆在敵方】`convoyDuty` 是 `strike`／`stream` 時規則
  // 不是護送，沒有 owner 可讀；`missionConfigFrom` 就是照這兩個值排隊伍的
  const rules = missionConfigFrom(card).rules
  if (b.convoySpec !== null) {
    const unit: BriefingUnit = {
      id: b.convoySpec.id, name: shortName(b.convoySpec),
      role: b.convoySpec.role, count: b.convoyCount,
    }
    if (rules.kind === 'convoy') (rules.owner === 'blue' ? mine : foe).push(unit)
    else if (b.convoyDuty === 'strike') mine.push(unit)
    else if (b.convoyDuty === 'stream') foe.push(unit)
  }

  if (b.briefsOpening === true) {
    const escort = b.blueWaves?.escort
    if (escort !== undefined) addUnit(mine, escort.spec, escort.count)
    for (const w of b.waves ?? []) {
      const onField = w.departs !== undefined || (w.when.kind === 'clock' && w.when.at === 0)
      if (w.side === 'theirs' && onField) addUnit(foe, w.spec, w.count)
    }
  }

  const facts: BriefingFact[] = [
    { id: 'place', label: t('brief.place'), value: t(card.placeKey) },
    { id: 'period', label: t('brief.period'), value: formatMonth(card.period.year, card.period.month) },
  ]

  const objective = t(b.objectiveKey)
  return {
    ready: true,
    title: t(card.titleKey), kind: missionTypeName(card.type), summary: t(card.summaryKey),
    objective: b.withdraw === undefined ? objective : `${objective} → ${t(b.withdraw.messageKey)}`,
    mine, foe, facts,
  }
}

/** 卡 → 簡報，照目前的語言。準備中的卡只帶標題、類型、說明。 */
export function briefingOf(card: MissionCard): Briefing {
  if (card.battle === null) {
    return {
      ready: false, title: t(card.titleKey), kind: missionTypeName(card.type), summary: t(card.summaryKey),
    }
  }
  return readyBriefing(card as ReadyMissionCard)
}
