import { Vector3 } from 'three'
import type { GlbAircraft } from './glb'

/**
 * P-51D Mustang 的 GLB 外型 —— 真機全長 9.83 m、翼展 11.286 m、螺旋槳直徑 3.40 m。
 *
 * 網格：翼尖站位 x ±5.640、尾錐末端 z 6.46、方向舵下後角 (6.465, 0.30)；整流罩是
 * 暗色，機鼻那段引擎罩與機身同色（真機如此）。
 *
 * 材質名與下面 `materials` 的鍵一致（與 `p51d.glb` 的約定，GLB 換了要跟著對）；
 * 螺旋槳節點 `P51_Prop`。
 *
 * 座標是機體座標：X 翼展、Y 上、Z 機尾，原點在主翼四分之一弦線。
 */
export const P51D_MODEL: GlbAircraft = {
  url: '/models/p51d.glb',
  realLength: 9.83,

  // 眼點：艙緣 0.520 上方 0.28（肩膀齊艙緣），罩頂在 z 0.685 為 1.029、
  // 頭部餘裕 0.23；z 0.70 落在風擋底框（0.085）後方 0.6 m
  eyePoint: new Vector3(0, 0.80, 0.70),

  // 右翼尖弦的中點：翼尖站位 x 5.640，前緣 −0.115、後緣 0.400，
  // y 是上反角 5° 到翼尖的高度
  wingTip: new Vector3(5.640, -0.1441, 0.1425),

  /** 掛不了彈 */
  bombPoint: null,

  bodyColor: 0x9aa7b4,
  accentColor: 0x2f3a46,
  // 貼圖由 tools/livery/p51d.py 畫。平尾（part wing2）搬到主翼後緣與機身之間的空位
  livery: {
    url: '/textures/p51d.png', scale: 88, planZ: 1.75, sideY: 0.25,
    moves: [{ part: 'wing2', plan: [0.5, -1.85] }],
  },

  /** GLB 材質名 → 遊戲材質 */
  materials: {
    P51_Body: 'body',
    P51_Accent: 'accent',
    P51_Glass: 'glass',
    P51_Cockpit: 'cockpit',
  },

  /**
   * 螺旋槳。轉軸高度＝整流罩軸心 0.008；槳盤 Z −2.82；半徑 1.70
   * （真機直徑 3.40 m）。
   */
  props: [{ node: 'P51_Prop', hubY: 0.008, hubZ: -2.82, radius: 1.70 }],
}
