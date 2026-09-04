import { Vector3 } from 'three'
import type { GlbAircraft } from './glb'

/**
 * B-17G Flying Fortress 的 GLB 外型 —— 真機全長 22.66 m、翼展 31.62 m、
 * 每具三葉槳直徑 3.53 m。
 *
 * **來源是 `tools/blender/b17g.blend`，GLB 是它匯出的產物。** 底稿是程式版
 * `buildB17G()` 用 `test/tools/procedural-export.ts` 吐出來、在 Blender 裡
 * 焊過重複頂點（只焊 flatShading 的四種材質、重疊面的頂點不焊，頂點位置與
 * 畫面逐 byte 不變，見 `test/e2e/plane-identical-glb.e2e.ts`）；程式版留著當重匯來源。
 *
 * 座標是機體座標：X 翼展、Y 上、Z 機尾，原點在主翼四分之一弦線。
 * 眼點、翼尖、轉軸位置全部照抄 `b17g.ts` 的 `createHull` 與 `propeller`
 * 參數 —— 那邊的推導註解仍然是權威。
 */
export const B17G_MODEL: GlbAircraft = {
  url: '/models/b17g.glb',
  realLength: 22.66,

  // 正駕駛在座艙的左座
  eyePoint: new Vector3(-0.38, 1.05, -2.90),

  // 右翼尖弦的中點，由 `b17g.ts` 的 WING 推出
  wingTip: new Vector3(15.810, 0.969, 1.527),

  // 機腹中央（量測值，見 `belly-point.probe.ts`）
  bombPoint: new Vector3(0, -0.76, 0),

  bodyColor: 0x8d9299,
  accentColor: 0x3c4147,

  /** Blender 材質名 → 遊戲材質 */
  materials: {
    B17_Body: 'body',
    B17_Accent: 'accent',
    B17_Glass: 'glass',
    B17_Cockpit: 'cockpit',
    B17_Frame: 'frame',
    B17_Inner: 'inner',
  },

  /**
   * 四具螺旋槳。內艙 x = ±3.050、外艙 ±6.571（`NAC_X_INNER` / `NAC_X_OUTER`）；
   * 槳盤在各自艙首站前 0.18（內 −3.36、外 −2.96）；轉軸高跟著艙心走
   * （內 0.002、外 0.257，外艙整個高 0.25 是機翼上反角）；半徑 1.765。
   */
  props: [
    { node: 'B17_Prop1', hubX: 3.050, hubY: 0.002, hubZ: -3.36, radius: 1.765 },
    { node: 'B17_Prop2', hubX: 6.571, hubY: 0.257, hubZ: -2.96, radius: 1.765 },
    { node: 'B17_Prop3', hubX: -3.050, hubY: 0.002, hubZ: -3.36, radius: 1.765 },
    { node: 'B17_Prop4', hubX: -6.571, hubY: 0.257, hubZ: -2.96, radius: 1.765 },
  ],
}
