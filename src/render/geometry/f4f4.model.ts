import { Vector3 } from 'three'
import type { GlbAircraft } from './glb'

/**
 * F4F-4 Wildcat 的 GLB 外型 —— 真機全長 8.76 m、翼展 11.58 m、螺旋槳直徑 2.97 m。
 *
 * 網格：4,602 個三角形。GLB 的座標系就是機體座標，包圍盒：
 *
 *     X −5.790 … 5.790   Y −0.816 … 1.790   Z −2.380 … 6.142
 *
 * X 對稱於 0（翼展 11.58）、Z 的原點落在**機翼四分之一弦線**，與其他機種的約定相同。
 *
 * 節點約定：`F4F_Fuselage` 是機身本體，`F4F_Dorsal` 是風擋（y −0.02）到垂尾根的
 * 機背整流，兩件共用一圈邊；座艙玻璃在機背那一件上。螺旋槳是 `F4F_Prop`，
 * 槳轂是 `F4F_Hub`。材質名與下面 `materials` 的鍵一致，GLB 換了要跟著對。
 */
export const F4F4_MODEL: GlbAircraft = {
  url: '/models/f4f4.glb',
  /** 真機全長 28 ft 9 in = 8.76 m。網格是 8.52（機首是槳轂罩尖端，尾端是方向舵後緣 6.142）。 */
  realLength: 8.76,

  /**
   * 眼點。艙緣（玻璃最低 z）在飛行員站位量到 0.730，取其上 0.26 當肩→眼。
   * z 0.60 落在風擋前框（0.000）後方 0.60 m，與 P-51D／F6F 同一個訂法。
   *
   * 【頭部餘裕只有 0.16，比 F6F 的 0.40 小得多，而那是對的】F4F 的罩子矮：
   * 該站的罩頂 1.149、艙緣 0.730，整個罩子只有 0.42 高（F6F 是 0.69）。
   */
  eyePoint: new Vector3(0, 0.99, 0.60),

  /**
   * 右翼尖弦的中點：
   *   x = 5.790（半翼展）
   *   y = 最外站（x 5.60）上下表面 30% 弦處的中點 = (0.437 + 0.310)/2 = 0.374
   *   z = 該站前後緣的中點再往前 0.04 = −(0.412 − 1.169)/2 − 0.04 → 0.419
   */
  wingTip: new Vector3(5.790, 0.374, 0.419),

  /**
   * 掛不了彈。
   *
   * 【誠實揭露】F4F-4 真機翼下可以各掛一枚 100 lb 炸彈，但遊戲的投彈是為
   * 轟炸機做的（`bombPoint` 在機腹中央、瞄具走投彈視角），戰鬥機掛小彈是
   * 另一件事。要不要開是負責人的決定，不是這裡偷偷加。
   */
  bombPoint: null,

  /**
   * Blue Gray（ANA 603）—— 1942–43 年美國海軍艦載機的上表面色。
   *
   * **【誠實揭露：真機是雙色，這裡只有一色】** F4F-4 在中途島與瓜島時期是
   * 上 Blue Gray／下 Light Gray 的兩色塗裝，而 `GlbAircraft` 只有一個
   * `bodyColor`。這裡取上表面色 —— 空中看到的絕大多數是上表面，而且它比
   * F6F-5 的 Glossy Sea Blue（0x3f5266）亮一階，兩台美國艦載機在空中分得
   * 出來。要不要支援分色線是負責人的決定。
   */
  bodyColor: 0x54626b,
  accentColor: 0x22282c,
  // 貼圖由 tools/livery/f4f4.py 畫
  livery: { url: '/textures/f4f4.png', scale: 86, planZ: 1.90, sideY: 0.50 },

  /** GLB 材質名 → 遊戲材質 */
  materials: {
    F4F_Body: 'body',
    F4F_Accent: 'accent',
    F4F_Glass: 'glass',
    F4F_Cockpit: 'cockpit',
    F4F_Frame: 'frame',
  },

  /**
   * 螺旋槳。Curtiss Electric 三葉、9 ft 9 in = 2.97 m（半徑 1.485）。
   * 槳盤 Z −2.20；轉軸高度取推力線 0（整流罩軸心）。
   *
   * 【F4F 沒有整流罩錐】Curtiss Electric 的槳轂直接露在外面，`F4F_Hub` 是那顆轂罩。
   */
  props: [{ node: 'F4F_Prop', hubY: 0, hubZ: -2.20, radius: 1.485 }],
}
