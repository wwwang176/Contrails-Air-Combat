import { Vector3 } from 'three'
import type { GlbAircraft } from './glb'

/**
 * Ki-84 疾風（甲型）的 GLB 外型 —— 真機全長 9.92 m、翼展 11.24 m、翼面積 21.0 m²、
 * 四葉槳直徑 3.05 m。
 *
 * 網格：翼展 11.24、全長 9.91（機首 2.806、機尾 −7.10）、翼面積 21.6 m²，
 * 全機 3,924 個三角形。翼根四分之一弦線在原點（翼根前緣 0.62、後緣 −1.92）、
 * 引擎罩唇的圓心在 y = 0。
 *
 * 材質約定（與 `ki84.glb` 的材質名一致，GLB 換了要跟著對）：
 *   `KI84_Body`     機身、主翼、尾翼
 *   `KI84_Accent`   槳轂、槳葉
 *   `KI84_Glass`    座艙玻璃
 *   `KI84_Cockpit`  座艙內槽的切面與罩口裡的引擎面（暗色）
 *   `KI84_Frame`    貼在玻璃外的框條（機身色）
 * 螺旋槳節點 `KI84_Prop`。
 *
 * 座標是機體座標：X 翼展、Y 上、Z 機尾，原點在主翼四分之一弦線。
 */
export const KI84_MODEL: GlbAircraft = {
  url: '/models/ki84.glb',
  realLength: 9.92,

  // 眼點：艙緣 0.76 上方 0.29；z 1.2 落在滑罩前段（玻璃 z 0.56…2.72）
  eyePoint: new Vector3(0, 1.05, 1.2),

  // 右翼尖：翼尖扇的頂點（x 5.62、翼尖站中弦高 −0.02、前後緣中點往後 0.05 → z 0.07）
  wingTip: new Vector3(5.62, -0.02, 0.07),

  /** 掛不了彈 */
  bombPoint: null,

  bodyColor: 0x55603f,
  accentColor: 0x262829,
  // 貼圖由 tools/livery/ki84.py 畫
  livery: { url: '/textures/ki84.png', scale: 90, planZ: 2.15, sideY: 0.30 },

  /** GLB 材質名 → 遊戲材質 */
  materials: {
    KI84_Body: 'body',
    KI84_Accent: 'accent',
    KI84_Glass: 'glass',
    KI84_Cockpit: 'cockpit',
    KI84_Frame: 'frame',
  },

  /** 螺旋槳：軸心在推力線 y 0；槳盤 z −2.30；半徑 1.52 */
  props: [{ node: 'KI84_Prop', hubY: 0, hubZ: -2.3, radius: 1.52 }],
}
