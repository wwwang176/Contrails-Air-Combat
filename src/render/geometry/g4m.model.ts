import { Vector3 } from 'three'
import type { GlbAircraft } from './glb'

/**
 * G4M2 一式陸攻（二四型）的 GLB 外型 —— 真機全長 19.63 m、翼展 24.89 m、翼面積 78.13 m²、
 * 每具四葉槳直徑 3.40 m。
 *
 * 網格：翼展 24.89、全長 19.75（機首 6.10、機尾 −13.65）、翼面積 78.2 m²；翼根弦 5.12
 * （前緣 1.354、後緣 −3.762）。沒有炸彈艙。發動機艙軸在 (±2.95, −0.24)。
 *
 * 材質約定（與 `g4m.glb` 的材質名一致，GLB 換了要跟著對）：
 *   `G4M_Body`     機身、主翼、尾翼、發動機艙
 *   `G4M_Accent`   槳葉
 *   `G4M_Glass`    座艙、機首罩、尾砲座、背部與腰部圓罩
 *   `G4M_Cockpit`  座艙切面的暗色，透過玻璃看是黑色艙內
 *   `G4M_Frame`    玻璃框條
 * 螺旋槳節點 `G4M_Prop1`／`G4M_Prop2`。
 *
 * 座標是機體座標：X 翼展、Y 上、Z 機尾，原點在主翼四分之一弦線。
 */
export const G4M_MODEL: GlbAircraft = {
  url: '/models/g4m.glb',
  realLength: 19.63,

  // 駕駛座：座艙玻璃 z −3.7…−0.95 的前段、偏左（真機正駕駛在左）；艙緣 0.52 上方 0.8
  eyePoint: new Vector3(-0.35, 1.30, -2.4),

  // 右翼尖：翼尖扇的頂點（x 12.445、翼尖站中弦高 0.865、前後緣中點往後 0.10 → z 1.15）
  wingTip: new Vector3(12.445, 0.865, 1.15),

  // 機腹中央（量測值，見 `belly-point.probe.ts`）
  bombPoint: new Vector3(0, -1.25, 0),

  bodyColor: 0x4b5a44,
  accentColor: 0x262829,
  // 貼圖由 tools/livery/g4m.py 畫
  livery: { url: '/textures/g4m.png', scale: 40, planZ: 3.80, sideY: 1.10 },

  /** GLB 材質名 → 遊戲材質 */
  materials: {
    G4M_Body: 'body',
    G4M_Accent: 'accent',
    G4M_Cockpit: 'cockpit',
    G4M_Glass: 'glass',
    G4M_Frame: 'frame',
  },

  /**
   * 兩具螺旋槳，掛在發動機艙上 x = ±2.95。轉軸高 −0.24、槳盤 Z −3.37、半徑 1.70
   * （史實四葉槳直徑 3.40 m）。
   */
  props: [
    { node: 'G4M_Prop1', hubX: 2.95, hubY: -0.24, hubZ: -3.37, radius: 1.70 },
    { node: 'G4M_Prop2', hubX: -2.95, hubY: -0.24, hubZ: -3.37, radius: 1.70 },
  ],
}
