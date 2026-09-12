import { CAMPAIGNS, MISSIONS } from '../../src/battle/missions'
import type { MissionBattle, ReadyMissionCard } from '../../src/battle/missions'

/**
 * 測試與探針用的查卡工具。
 *
 * 【為什麼要有這一份】三條戰役上線之前，各處都寫
 * `MISSIONS.axis.find((m) => m.id === '…')!` —— 那個 `!` 在卡片改名或改組
 * 的時候會變成一個 `undefined` 一路傳下去，症狀是別的地方拋
 * 「Cannot read properties of undefined」。集中一處之後，找不到就當場說是
 * 哪一張卡找不到。
 */

/** 依 id 找一張打得起來的卡。找不到或還沒做就拋錯 */
export function readyCard(id: string): ReadyMissionCard {
  for (const c of CAMPAIGNS) {
    const m = MISSIONS[c].find((x) => x.id === id)
    if (m === undefined) continue
    if (m.battle === null) throw new Error(`任務卡 ${id} 還沒有戰鬥設定`)
    return m as ReadyMissionCard
  }
  const all = CAMPAIGNS.flatMap((c) => MISSIONS[c].map((m) => m.id)).join(', ')
  throw new Error(`找不到任務卡 ${id}。現有的是：${all}`)
}

/** 依 id 找一張卡，並覆寫戰鬥設定裡的幾格。**只給測試調場景用** */
export function cardWith(id: string, patch: Partial<MissionBattle>): ReadyMissionCard {
  const m = readyCard(id)
  return { ...m, battle: { ...m.battle, ...patch } }
}

/**
 * 一張現成的護送卡（藍隊帶轟炸機飛到終點）。
 * 攔截是它的另一側，見 `INTERCEPT_CARD`。
 */
export const ESCORT_CARD = 'allies-m1'
/** 一張現成的攔截卡（紅隊帶轟炸機，藍隊要在它抵達前打光） */
export const INTERCEPT_CARD = 'germany-m1'
/** 一張現成的殲滅卡 */
export const KILL_CARD = 'japan-m3'
