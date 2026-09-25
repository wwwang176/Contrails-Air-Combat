import { Vector3 } from 'three'
import type { GlbAircraft } from './glb'

/**
 * He 111 H-6 的 GLB 外型 —— 真機全長 16.40 m、翼展 22.60 m、每具螺旋槳直徑 3.50 m。
 *
 * **來源是 `tools/blender/he111.blend`，GLB 是它匯出的產物。** 底稿是程式版
 * `buildHe111()` 用 `test/tools/procedural-export.ts` 吐出來、在 Blender 裡
 * 焊過重複頂點（只焊 flatShading 的四種材質、重疊面的頂點不焊，頂點位置與
 * 畫面逐 byte 不變，見 `test/e2e/plane-identical-glb.e2e.ts`）；程式版留著當重匯來源。
 *
 * 座標是機體座標：X 翼展、Y 上、Z 機尾，原點在主翼四分之一弦線。
 * 眼點、翼尖、轉軸位置全部照抄 `he111.ts` 的 `createHull` 與 `propeller`
 * 參數 —— 那邊的推導註解仍然是權威。
 */
export const HE111_MODEL: GlbAircraft = {
  url: '/models/he111.glb',
  realLength: 16.40,

  // 駕駛座在玻璃機首的後上方、偏左（真機的駕駛座偏左，機首機槍座偏右）
  eyePoint: new Vector3(-0.25, 0.85, -1.95),

  // 右翼尖弦的中點，由 `he111.ts` 的 WING 推出
  wingTip: new Vector3(11.300, 0.888, 1.883),

  // 機腹中央（量測值，見 `belly-point.probe.ts`）
  bombPoint: new Vector3(0, -0.84, 0),

  bodyColor: 0x5a6350,
  accentColor: 0x2b3128,
  // 貼圖由 tools/livery/he111.py 畫。低模 he111_lod2 共用同一份版面與貼圖
  livery: { url: '/textures/he111.png', scale: 44, planZ: 4.90, sideY: 0.70 },

  /** Blender 材質名 → 遊戲材質 */
  materials: {
    HE111_Body: 'body',
    HE111_Accent: 'accent',
    HE111_Glass: 'glass',
    HE111_Cockpit: 'cockpit',
    HE111_Frame: 'frame',
    HE111_Inner: 'inner',
  },

  /**
   * 兩具螺旋槳，掛在機翼上 x = ±2.6（`NACELLE_X`）。轉軸高 −0.01、槳盤
   * Z −2.64、半徑 1.75（真機每具 VDM 三葉槳直徑 3.50 m）。
   */
  props: [
    { node: 'HE111_Prop1', hubX: 2.6, hubY: -0.01, hubZ: -2.64, radius: 1.75 },
    { node: 'HE111_Prop2', hubX: -2.6, hubY: -0.01, hubZ: -2.64, radius: 1.75 },
  ],
}
