import { Vector3 } from 'three'
import type { Battery, WeaponSpec } from './types'

/**
 * MK 108 30 mm —— K-4 的中軸砲，取代 G-6 的 MG 151/20。
 *
 * 【單發傷害 250 怎麼定的】三條線索，取最保守的一條：
 *
 * ```
 *   史實「四發擊落一架戰鬥機」   hp 1000 ÷ 4 = 250      ← 採用
 *   炸藥量比（85 g ÷ 20 g）      MG151/20 的 84 × 4.25 = 357
 *   彈重比（330 g ÷ 92 g）       84 × 3.59 = 301
 * ```
 *
 * MK 108 的 Minengeschoss 薄殼榴彈公認需要約 4 發解決單發戰鬥機、
 * 約 20 發解決四發轟炸機——250 讓兩者在本模型裡都成立
 *（B-17G 的 hp 見 `specs/b17g.ts`）。
 *
 * 【為什麼取最低的一條】**本專案沒有彈藥模型。** MK 108 真正的代價是
 * 每門只有 65 發、約 6 秒的持續射擊時間，用完就只剩兩挺 13 mm。這個
 * 缺點在遊戲裡不存在，所以傷害取區間下緣當作補償。哪天加了彈藥量，
 * 這個值可以往 300 走。
 *
 * 【初速 505 是真正的代價，而且有在模型裡】比 MG 151/20 慢 200 m/s。
 * 400 m 外飛行時間 0.79 s 對 0.57 s，提前量要多給四成——這一項會直接
 * 反映在 `sight` 算出來的預瞄環上。
 *
 * 【單發傷害的 ×3 慣例】三個單發傷害一律 ×3（見 weapons.test.ts）。
 * 250 已經是 ×3 之後的值，等價基準值 83.3。
 */
export const MK108: WeaponSpec = {
  id: 'mk108',
  name: 'MK 108',
  muzzleVelocity: 505,
  caliber: 30,
  roundsPerMinute: 650,
  damage: 250,
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
 * 109 的武裝全部在中軸線附近，任何距離都不必修正匯聚——這個史實優勢
 * 從資料自然落出來，不需要另外設計（spec §5.3）。
 *
 * 【位置怎麼來的】取自 M1 量出來的造型（`src/render/geometry/bf109e.ts`）。
 * **造型是 E-4：**
 *   MK 108     穿槳轂（Motorkanone），所以在整流罩軸心上。整流罩軸心
 *              y = 0.36，錐尖在 z = −2.575；砲口取 −2.58（錐尖處）。
 *   MG 131 ×2  機首上方，鼓包（Beulen）底下。引擎罩在 z = −1.6 附近的
 *              背線約 y = 0.81，兩挺分置 x = ±0.20、y = 0.72。
 *
 * 【外型是 E-4、武裝是 K-4】飛行模型與武裝用 K-4，參考模型與造型是 E-4
 * （見 specs/bf109k4.ts 檔頭）。E-4 的機首是兩挺 MG 17、
 * 翼上兩門 MG FF/M，跟這裡完全不是同一回事。
 */
const MOUNTS = [
  { weapon: MK108, position: new Vector3(0, 0.36, -2.58) },
  { weapon: MG131, position: new Vector3(0.20, 0.72, -1.60) },
  { weapon: MG131, position: new Vector3(-0.20, 0.72, -1.60) },
]

export const BF109K4_BATTERY: Battery = {
  mounts: MOUNTS,
  convergence: 300,
  /**
   * 預瞄環的基準槍：取所有掛架中**初速最快**的那一挺（此處是 MG 131，
   * 750 m/s）。寫成從 `mounts` 挑最大值而不是硬指 `MG131`，是為了讓它跟著
   * 資料走——日後換槍，基準自動落在當下最快的那挺。
   *
   * 【取捨：主砲會偏後】對準環算出的提前點開火時，較慢的 MK 108
   *（505 m/s）飛得慢、需要更大的提前量，於是落在環的**後方**——主砲在
   * 中遠距離會偏後。代價集中在遠距離；MK 108 本來就是近戰武器（65 發、
   * 初速低），近距離受影響小。選最快而非最慢，讓環更貼目標、好瞄。
   */
  sight: MOUNTS.reduce((a, b) =>
    (b.weapon.muzzleVelocity > a.weapon.muzzleVelocity ? b : a)).weapon,
}
