import type { WeaponSpec } from './types'

export const M2_BROWNING: WeaponSpec = {
  id: 'm2-50cal',
  name: 'M2 Browning .50 cal',
  muzzleVelocity: 887,
  caliber: 12.7,
  roundsPerMinute: 800,
  damage: 18,
}

/**
 * MG 131 13 mm。K-4 的機首兩挺與 G-6 相同（鼓包更大，但槍是同一款），
 * He 111 的背部與腹部槍座也用同一份物件。
 */
export const MG131: WeaponSpec = {
  id: 'mg131',
  name: 'MG 131',
  muzzleVelocity: 750,
  caliber: 13,
  roundsPerMinute: 900,
  damage: 30,
}

/**
 * MG 15，7.92 mm。**步槍口徑**，這件事是整個轟炸機難度的關鍵。
 *
 * 【傷害怎麼定的】專案裡最接近的是 P-51D 的 M2 .50（12.7 mm，傷害 18）與
 * 109 的 MG 131（13 mm，傷害 30）。MG 15 的彈頭質量約是 .50 的四分之一
 * （12.8 g 對 46 g），動能約 3.7 kJ 對 17 kJ。依動能等比推得 18 × 0.22 ≈ 4，
 * 取 **5** —— 略高於等比，因為機槍座打的是掠過的戰鬥機側面而不是正面裝甲。
 *
 * 【為什麼這件事重要】沒有散佈的模型裡，一挺零延遲的機槍是必殺的（見
 * `docs/superpowers/specs/` 的轟炸機 spec §4）。轟炸機的壓力必須來自
 * 「你不能久留」而不是「你進來就死」，而那個分寸完全由這個數字與射速決定。
 *
 * **這是起始值，由試飛裁定。**
 *
 * 【砲塔實際打出來的傷害不是這個數字】它還要乘上 `turret.ts` 的
 * `TURRET_DAMAGE_SCALE` —— 那個倍率統一調整全部轟炸機的自衛火力，而
 * `WeaponSpec.damage` 是「這款槍本身多痛」。
 */
export const MG15: WeaponSpec = {
  id: 'mg15',
  name: 'MG 15',
  muzzleVelocity: 765,
  caliber: 7.92,
  roundsPerMinute: 1050,
  damage: 5,
}
