import { Vector3 } from 'three'
import type { GlbAircraft } from './glb'

/**
 * He 111 H-6 的 GLB 外型 —— 真機全長 16.40 m、翼展 22.60 m、每具螺旋槳直徑 3.50 m。
 *
 * 座標是機體座標：X 翼展、Y 上、Z 機尾，原點在主翼四分之一弦線。
 *
 * 材質名與下面 `materials` 的鍵一致（與 `he111.glb` 的約定，GLB 換了要跟著對）；
 * `HE111_Inner` 是窗後的內殼。螺旋槳節點 `HE111_Prop1`／`HE111_Prop2`。
 */
export const HE111_MODEL: GlbAircraft = {
  url: '/models/he111.glb',
  realLength: 16.40,

  // 駕駛座在玻璃機首的後上方、偏左（真機的駕駛座偏左，機首機槍座偏右）
  eyePoint: new Vector3(-0.25, 0.85, -1.95),

  // 右翼尖弦的中點
  wingTip: new Vector3(11.300, 0.888, 1.883),

  // 機腹中央（量測值，見 `belly-point.probe.ts`）
  bombPoint: new Vector3(0, -0.84, 0),

  bodyColor: 0x5a6350,
  accentColor: 0x2b3128,
  // 貼圖由 tools/livery/he111.py 畫。低模 he111_lod2 共用同一份版面與貼圖
  livery: { url: '/textures/he111.png', scale: 44, planZ: 4.90, sideY: 0.70 },

  /** GLB 材質名 → 遊戲材質 */
  materials: {
    HE111_Body: 'body',
    HE111_Accent: 'accent',
    HE111_Glass: 'glass',
    HE111_Cockpit: 'cockpit',
    HE111_Frame: 'frame',
    HE111_Inner: 'inner',
  },

  /**
   * 兩具螺旋槳，掛在機翼上 x = ±2.6。轉軸高 −0.01、槳盤
   * Z −2.64、半徑 1.75（真機每具 VDM 三葉槳直徑 3.50 m）。
   */
  props: [
    { node: 'HE111_Prop1', hubX: 2.6, hubY: -0.01, hubZ: -2.64, radius: 1.75 },
    { node: 'HE111_Prop2', hubX: -2.6, hubY: -0.01, hubZ: -2.64, radius: 1.75 },
  ],
}
