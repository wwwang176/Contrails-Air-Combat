import { CAMPAIGNS, MISSIONS } from '../../src/battle/missions'
import { BF109K4 } from '../../src/specs/bf109k4'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
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
  if (id === INTERCEPT_CARD) return interceptCard()
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
/**
 * 一張攔截卡的 id（紅隊帶轟炸機，藍隊要在它抵達前打光）。**`readyCard` 認得它。**
 *
 * 【出貨的九關沒有攔截卡，這一張只給測試用】convoy 規則 owner 是紅隊的那一側
 * 仍然是 `missionRules` 走得到的路，要有人守。卡片由 `interceptCard` 從護送卡
 * 鏡像出來，不在 `MISSIONS` 裡。
 */
export const INTERCEPT_CARD = 'test-intercept'

/**
 * 從護送卡鏡像出攔截卡：藍隊 10 架 K-4 攔、紅隊 4 架 P-51 護航 4 架 B-17。
 * 波次、重生與門檻不帶過來 —— 用它的測試量的是規則本身。
 */
function interceptCard(): ReadyMissionCard {
  const base = readyCard(ESCORT_CARD)
  const { waves: _w, recycle: _r, need: _n, ...battle } = base.battle
  return {
    ...base, id: INTERCEPT_CARD, type: '攔截',
    battle: {
      ...battle,
      blueSpec: BF109K4, redSpec: P51D, convoySpec: B17G,
      blueCount: 10, redCount: 4, convoyCount: 4,
    },
  }
}
/** 一張現成的殲滅卡 */
export const KILL_CARD = 'japan-m1'
