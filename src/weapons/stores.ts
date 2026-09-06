/**
 * 掛載：每一台帶什麼、帶幾枚、一枚多痛、空了要補多久。
 *
 * 【為什麼是一張表而不是四張】容量、傷害、裝填秒數各自一張表時，同一台在
 * 不同表上會不同步 —— 彈艙表寫 G4M「500 kg × 2」而傷害表填著 800 kg 的
 * 數字，兩張表各自看都對，要到有人把它們並排才發現。併成一筆之後那個
 * 失效不存在。
 *
 * 【為什麼這個檔案不 import three 也不 import 機種】它同時被 `main.ts`、
 * 任務卡片與 headless 的單元測試讀。鍵是機種代號字串，表的完整性由測試對
 * `ALL_SPECS` 守。
 */

/** 掛的是什麼。決定彈道、命中判定與表現走哪一條路 */
export type OrdnanceKind = 'bomb' | 'torpedo'

export interface Loadout {
  readonly kind: OrdnanceKind
  /** 滿艙幾枚 */
  readonly count: number
  /**
   * 一枚多痛。炸彈是**爆心**傷害（有距離衰減），魚雷是**接觸**傷害
   * （直接命中才算，見 `world/torpedo.ts`）。
   */
  readonly damage: number
  /** 空艙補滿要幾秒 */
  readonly reloadSeconds: number
}

/**
 * 每一台掛什麼。**列在這裡的才掛得了東西** —— 沒有的按 `B` 沒有作用。
 *
 * ```
 *              掛載                    枚數   單枚傷害   裝填   一趟總量
 *   B-17G      AN-M64 500 lb           10      9,000     20 s    90,000
 *   He 111     SC 250                   8      9,300     20 s    74,400
 *   G4M        九一式改三 航空魚雷      1     15,000     45 s    15,000
 * ```
 *
 * 【載彈量才是兩台轟炸機的差別】單顆彈的當量它們差不多（B-17G 的 227 kg
 * 對 He 111 的 250 kg），重轟炸機的優勢在帶得多。
 *
 * 【G4M 掛雷】一式陸攻的彈艙上限 1,000 kg 是**擇一**：800 kg 魚雷一枚、
 * 500 kg 兩枚、250 kg 四枚。取魚雷 —— 一趟只有一次機會，而那一次是艦隊的
 * 水線下。任務卡片可以用 `MissionBattle.blueLoadout` 換回炸彈。
 *
 * 【15,000 是照船的血量訂的】Fletcher 20,000／Wichita 40,000／Essex 60,000
 * 之下是 2／3／4 枚。**起始值，由試飛裁定。**
 */
export const LOADOUT_BY_AIRCRAFT: Readonly<Record<string, Loadout>> = {
  b17g: { kind: 'bomb', count: 10, damage: 9_000, reloadSeconds: 20 },
  he111: { kind: 'bomb', count: 8, damage: 9_300, reloadSeconds: 20 },
  g4m: { kind: 'torpedo', count: 1, damage: 15_000, reloadSeconds: 45 },
}

/** 這一台掛什麼。掛不了東西的回 `null` */
export function loadoutOf(aircraftId: string): Loadout | null {
  return LOADOUT_BY_AIRCRAFT[aircraftId] ?? null
}
