import { Vector3 } from 'three'
import type { GlbAircraft } from './glb'

/**
 * B-17G Flying Fortress 的 GLB 外型 —— 真機全長 22.66 m、翼展 31.62 m、
 * 每具三葉槳直徑 3.53 m。
 *
 * 網格：翼展 31.62、13,251 個三角形。
 *
 * 座標是機體座標：X 翼展、Y 上、Z 機尾，原點在主翼四分之一弦線。
 *
 * 材質約定（與 `b17g.glb` 的材質名一致，GLB 換了要跟著對）：
 *   `B17_Body`／`B17_Accent`  機身色與深色件
 *   `B17_Glass`               座艙、機首罩、腰窗等玻璃
 *   `B17_Cockpit`             透過玻璃看到的暗色內面
 *   `B17_Frame`               玻璃框（機身色）
 *   `B17_Inner`               窗後的內殼。少了它，從一側的窗直接看穿到另一側的天空
 *
 * 節點約定：螺旋槳是 `B17_Prop1`…`B17_Prop4`。槳轂整流罩**不能取名
 * `B17_PropN`** —— `glb.ts` 的 isNamed 認「名字 + 可有可無的分隔符 + 數字」，
 * 取那個名字就會被歸進轉軸底下，`multi-engine-glb.test.ts` 檢查「每一具正好三片
 * 槳葉」那一格會讀到 4。
 */
export const B17G_MODEL: GlbAircraft = {
  url: '/models/b17g.glb',
  realLength: 22.66,

  // 正駕駛在座艙的左座
  eyePoint: new Vector3(-0.38, 1.05, -2.90),

  // 右翼尖弦的中點（`B17_Wing` 的翼尖環）
  wingTip: new Vector3(15.810, 0.916, 1.894),

  // 機腹中央（`B17_Fuselage` 機體 z ≈ 0 的最低頂點）
  bombPoint: new Vector3(0, -0.742, 0),

  bodyColor: 0x8d9299,
  accentColor: 0x3c4147,
  // 貼圖由 tools/livery/b17g.py 畫。低模 b17g_lod2 共用同一份版面與貼圖
  livery: { url: '/textures/b17g.png', scale: 32, planZ: 5.05, sideY: 2.20 },

  /** GLB 材質名 → 遊戲材質 */
  materials: {
    B17_Body: 'body',
    B17_Accent: 'accent',
    B17_Glass: 'glass',
    B17_Cockpit: 'cockpit',
    B17_Frame: 'frame',
    B17_Inner: 'inner',
  },

  /**
   * 四具螺旋槳。內艙 x = ±3.050、外艙 ±6.571；
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
