import { Vector3 } from 'three'
import type { GlbAircraft } from './glb'

/**
 * Ju 87 B-2 Stuka 的 GLB 外型 —— 真機全長 11.1 m、翼展 13.8 m、螺旋槳直徑 3.40 m。
 *
 * 網格：7,434 個三角形，翼展 13.80、全長 11.33、主翼面積 29.27 m²（不含襟副翼）。
 * 倒鷗翼：內段下反約 11°、折點在 x 1.5、外段上反約 8°。起落架是固定式的。
 *
 * GLB 的座標系就是機體座標：X 對稱於 0、Z 的原點落在機翼四分之一弦線（翼根前緣
 * 2.997、後緣 −0.263），與其他機種的約定相同。
 *
 * 材質名與下面 `materials` 的鍵一致（與 `ju87.glb` 的約定，GLB 換了要跟著對）；
 * 螺旋槳節點 `JU87_Prop`。
 */
export const JU87_MODEL: GlbAircraft = {
  url: '/models/ju87.glb',
  /** 史實全長 11.1 m。網格是整流罩尖 3.618 到方向舵後緣 −7.711 = 11.33。 */
  realLength: 11.1,

  /**
   * 眼點。前座（滑動罩 y −0.20…−0.90）的中段，罩緣 0.61、罩頂 1.18，取罩頂下 0.22。
   */
  eyePoint: new Vector3(0, 0.96, 0.55),

  /**
   * 右翼尖弦的中點：
   *   x = 6.900（半翼展）
   *   y = 最外站（x 6.78）30% 弦處上下表面的中點 0.305
   *   z = 該站前後緣的中點再往前 0.04 → −0.005
   */
  wingTip: new Vector3(6.9, 0.305, -0.005),

  /**
   * 沒有機腹瞄準視角：俯衝轟炸機沿機首把落點圈壓在目標上，按 B 直接放彈
   * （`InputState.bombRelease`，與掛彈戰鬥機同一條路）。炸彈本來就從質心投。
   */
  bombPoint: null,

  /** RLM 70/71 上表面色，與同時期的 He 111 同一組。 */
  bodyColor: 0x5a6350,
  accentColor: 0x2b3128,
  /**
   * 貼圖由 tools/livery/ju87.py 畫。版面：
   *   scale 70   上視那一格 1024 px 要裝下翼展 13.8 m（966 px）
   *   planZ 2.05 機首 −3.618 到方向舵後緣 7.711 的中點
   *   sideY −0.19 輪胎底 −2.315 到垂尾頂 1.93 的中點
   */
  livery: { url: '/textures/ju87.png', scale: 70, planZ: 2.05, sideY: -0.19 },
  /** 冬季：同一張版面，白色水性漆斑駁地蓋在原本的迷彩上（`tools/livery/ju87.py --winter`） */
  liveryVariants: { winter: '/textures/ju87_winter.png' },

  /** GLB 材質名 → 遊戲材質 */
  materials: {
    JU87_Body: 'body',
    JU87_Accent: 'accent',
    JU87_Glass: 'glass',
    JU87_Cockpit: 'cockpit',
    JU87_Frame: 'frame',
  },

  /**
   * 螺旋槳。Junkers VS 5 三葉、直徑 3.40 m。槳盤 Z −3.146；
   * 轉軸高度是推力線 0（整流罩軸心）。
   */
  props: [{ node: 'JU87_Prop', hubY: 0, hubZ: -3.146, radius: 1.70 }],
}
