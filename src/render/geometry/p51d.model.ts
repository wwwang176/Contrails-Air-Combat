import { Vector3 } from 'three'
import type { GlbAircraft } from './glb'

/**
 * P-51D Mustang 的 GLB 外型。
 *
 * **這一台是搬過來的，不是畫出來的。** `public/models/p51d.glb` 由
 * `test/tools/p51-export.ts` 從程式版 `buildP51D()` 用 `GLTFExporter` 吐出，
 * 逐頂點相同（`test/unit/p51d-glb.test.ts` 釘住）。程式版仍在 `p51d.ts` ——
 * 它是重匯 GLB 的來源，等 Blender 那邊的校正定案、GLB 成為唯一真相再退休。
 *
 * 底下每一個數字都照抄 `p51d.ts` 的 `createHull` 參數與 `propeller` 呼叫，
 * 沒有重訂。
 */
export const P51D_MODEL: GlbAircraft = {
  url: '/models/p51d.glb',
  realLength: 9.83,

  // 眼點：艙緣 0.520 上方 0.28（肩膀齊艙緣），罩頂在 z 0.685 為 1.029、
  // 頭部餘裕 0.23；z 0.70 落在風擋底框（0.085）後方 0.6 m
  eyePoint: new Vector3(0, 0.80, 0.70),

  // 右翼尖弦的中點，推導見 `p51d.ts`
  wingTip: new Vector3(5.640, -0.1441, 0.1636),

  bodyColor: 0x9aa7b4,
  accentColor: 0x2f3a46,

  /** GLB 材質名 → 遊戲材質。名字是匯出腳本依材質身分命的。 */
  materials: {
    P51_Body: 'body',
    P51_Accent: 'accent',
    P51_Glass: 'glass',
    P51_Cockpit: 'cockpit',
  },

  /**
   * 螺旋槳。轉軸高度＝整流罩軸心 `spinnerY` 0.008，槳盤 Z＝`propZ` −3.10，
   * 半徑 1.70（真機直徑 3.40 m）。
   */
  prop: { node: 'P51_Prop', hubY: 0.008, hubZ: -3.10, radius: 1.70 },
}
