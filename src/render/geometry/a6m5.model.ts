import { Vector3 } from 'three'
import type { GlbAircraft } from './glb'

/**
 * A6M5 零式五二型的 GLB 外型 —— 真機全長 9.12 m、翼展 11.00 m、螺旋槳直徑 3.05 m。
 *
 * 網格：翼展 11.00、全長 9.37（機首 2.443、機尾 −6.93）、翼面積 21.9 m²，
 * 全機 3,393 個三角形。翼根四分之一弦線在原點、整流罩軸在 y = 0。
 *
 * 材質約定（與 `a6m5.glb` 的材質名一致，GLB 換了要跟著對）：
 *   `A6M5_Body`     機身、主翼、尾翼
 *   `A6M5_Accent`   引擎罩、槳葉
 *   `A6M5_Glass`    座艙玻璃
 *   `A6M5_Cockpit`  座艙內槽的切面，透過玻璃看是黑的
 *   `A6M5_Frame`    貼在玻璃外的框條（機身色）
 * 螺旋槳節點 `A6M5_Prop`。
 *
 * 座標是機體座標：X 翼展、Y 上、Z 機尾，原點在主翼四分之一弦線。
 */
export const A6M5_MODEL: GlbAircraft = {
  url: '/models/a6m5.glb',
  realLength: 9.12,

  // 眼點：艙緣 0.585 上方 0.28；z 1.0 落在滑罩中段（玻璃 z −0.16…2.19）
  eyePoint: new Vector3(0, 0.87, 1.0),

  // 右翼尖：翼尖扇的頂點（x 5.5、翼尖站中弦高 0.10、前後緣中點往後 0.10 → z 0.46）
  wingTip: new Vector3(5.5, 0.10, 0.46),

  /** 掛不了彈 */
  bombPoint: null,

  bodyColor: 0x5b6650,
  accentColor: 0x262829,
  // 貼圖由 tools/livery/a6m5.py 畫
  livery: { url: '/textures/a6m5.png', scale: 92, planZ: 2.15, sideY: 0.45 },

  /** GLB 材質名 → 遊戲材質 */
  materials: {
    A6M5_Body: 'body',
    A6M5_Accent: 'accent',
    A6M5_Glass: 'glass',
    A6M5_Cockpit: 'cockpit',
    A6M5_Frame: 'frame',
  },

  /** 螺旋槳：軸心在推力線 y 0；槳盤 z −1.95；半徑 1.525 */
  props: [{ node: 'A6M5_Prop', hubY: 0, hubZ: -1.95, radius: 1.525 }],
}
