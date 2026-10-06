import { Vector3 } from 'three'
import type { GlbAircraft } from './glb'

/**
 * F6F-5 Hellcat 的 GLB 外型 —— 真機全長 10.24 m、翼展 13.06 m、螺旋槳直徑 3.99 m。
 *
 * 網格：3,178 個三角形。GLB 的座標系就是機體座標（X 翼展、Y 上、Z 機尾），包圍盒：
 *
 *     X −6.530 … 6.530   Y −1.046 … 2.167   Z −2.932 … 7.190
 *
 * X 對稱於 0（翼展 13.06）、Z 的原點落在**機翼四分之一弦線**（翼根前緣 −0.809、
 * 弦長 3.235），與其他機種的約定相同，不必平移。
 *
 * 座艙玻璃與龜背是同一片外皮切開的兩塊，接縫沒有落差。
 * 螺旋槳節點 `F6F_Prop`；材質名與下面 `materials` 的鍵一致，GLB 換了要跟著對。
 */
export const F6F5_MODEL: GlbAircraft = {
  url: '/models/f6f5.glb',
  realLength: 10.24,

  /**
   * 眼點。艙緣（玻璃下緣）量到是水平的 y = 0.812，取其上 0.29 當肩→眼；
   * z 0.90 落在風擋前框（0.300）後方 0.60 m，與 P-51D 同一個訂法。
   * 罩頂在 z 0.90 是 1.50，頭部餘裕 0.40。
   */
  eyePoint: new Vector3(0, 1.10, 0.90),

  /**
   * 右翼尖弦的中點：半翼展 x 6.530、高度 0.227；翼尖弦長 0.182、前緣 z 0.123，
   * 弦中點 z 0.214。
   */
  wingTip: new Vector3(6.530, 0.227, 0.214),

  /** 掛不了彈 */
  bombPoint: null,

  /**
   * Glossy Sea Blue（ANA 623）—— 1944 年之後的美國海軍艦載機塗裝，F6F-5
   * 全機單色。比另外四台都暗，但那是真的；而且它讓敵我在空中好分辨。
   */
  bodyColor: 0x3f5266,
  accentColor: 0x232a31,
  // 貼圖由 tools/livery/f6f5.py 畫
  livery: { url: '/textures/f6f5.png', scale: 76, planZ: 2.13, sideY: 0.56 },

  /** GLB 材質名 → 遊戲材質 */
  materials: {
    F6F_Body: 'body',
    F6F_Accent: 'accent',
    F6F_Glass: 'glass',
  },

  /**
   * 螺旋槳。轉軸高度取整流罩軸心 0.038；槳盤 Z −2.52。半徑照史實：
   * Hamilton Standard 13 ft 1 in = 3.987 m。
   */
  props: [{ node: 'F6F_Prop', hubY: 0.038, hubZ: -2.52, radius: 1.995 }],
}
