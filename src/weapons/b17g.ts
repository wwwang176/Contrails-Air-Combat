import { Vector3 } from 'three'
import type { Battery } from './types'
import { M2_BROWNING } from './p51d'

/**
 * B-17G 的**前射**武裝 —— 機首下方的 Bendix 下巴砲塔，雙聯 .50。
 *
 * 【為什麼只有這兩挺】真機 G 型有十三挺 .50：下巴 ×2、機首兩側頰槍 ×2、
 * 上部砲塔 ×2、球形腹部砲塔 ×2、腰部 ×2、無線電艙 ×1、尾部 ×2。其中只有
 * 下巴砲塔能穩定朝正前方射擊。
 *
 * 自衛砲塔要等 `Mount` 長出射界與旋轉之後才做 —— 現有的 `mountDirection`
 * 是純幾何、所有掛架同向，表達不了「這一挺朝後」。這一點與 He 111 的處境
 * 完全相同，見 `weapons/he111.ts`。
 *
 * 【彈藥與 P-51D 共用】兩邊都是 M2 白朗寧 .50，同一支 `WeaponSpec` ——
 * 傷害 18、初速 887、射速 800。轟炸機的難度**不該**來自它的槍比較弱
 * （B-17 的槍與野馬是同一款），而該來自射界與數量，那要等炮塔做出來。
 *
 * 【位置】下巴砲塔的球心量自參考模型：機體 z −4.98、腹線 −1.056（旁邊
 * 各站是 −0.60）。槍口取球心前方 0.45、略低 0.15。
 */
export const B17G_BATTERY: Battery = {
  mounts: [
    { weapon: M2_BROWNING, position: new Vector3(0.18, -0.70, -5.43) },
    { weapon: M2_BROWNING, position: new Vector3(-0.18, -0.70, -5.43) },
  ],
  /**
   * 【convergence 取 300】與 He 111、Bf 109 同 —— 兩挺槍相距只有 0.36 m，
   * 匯聚幾何在這個間距下產生不了可見的偏折，但欄位是必填的。
   */
  convergence: 300,
  sight: M2_BROWNING,
}
