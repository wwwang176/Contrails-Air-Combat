import { Vector3 } from 'three'
import type { GlbAircraft } from './glb'

/**
 * Fw 190 D-9 的 GLB 外型。
 *
 * 網格：翼展 10.50、全長 10.05（整流罩尖端到方向舵後緣）、3,344 個三角形。
 * 原點在主翼翼根四分之一弦線，螺旋槳軸高 0。關鍵座標：
 *
 *   整流罩尖端 z −2.880、環形散熱器前緣 −2.35、方向舵後緣 7.17、垂尾頂 y 1.50
 *   風擋前緣 z 0.66、座艙罩 z 0.66…2.395、罩頂 y 0.969
 *   翼尖 x ±5.25，翼尖弦（x 5.18）z 0.128…0.940
 *
 * 節點：`FW190_Fuselage`、`FW190_Wing`、`FW190_Tailplane`、`FW190_Fin`、
 * `FW190_Glass`、`FW190_Frames`、`FW190_Spinner`、`FW190_Prop`、`FW190_Intake`、
 * `FW190_Exhaust`。`FW190_Wing` 要帶 glTF extras `part = 'wing0'` —— 少了它
 * `glb.ts` 標不出主翼，`geometry.test.ts` 的「四分之一弦線落在原點」量不到任何 mesh。
 *
 * 【增壓器進氣口只在右側】`FW190_Intake` 在 +X（x 0.47…0.87），左側沒有對應的
 * 零件，是機體本身的不對稱。
 *
 * 【整流罩不轉】`FW190_Spinner` 是靜態零件，轉的只有 `FW190_Prop` 的三片槳葉。
 *
 * 座標是機體座標：X 翼展（+X 右翼）、Y 上、Z 機尾，原點在主翼四分之一弦線。
 */
export const FW190_MODEL: GlbAircraft = {
  url: '/models/fw190.glb',
  realLength: 10.05,

  // 眼點：艙緣（z 1.1…1.4 的開口邊）0.50 上方 0.28，罩頂在 z 1.3 為 0.959、
  // 頭部餘裕 0.18；z 1.26 落在風擋前緣（0.66）後方 0.6 m
  eyePoint: new Vector3(0, 0.78, 1.26),

  // 右翼尖：x 5.25 是半翼展；y、z 取翼尖弦（x 5.18）的中線
  wingTip: new Vector3(5.25, 0.07, 0.53),

  /** 不掛彈 */
  bombPoint: null,

  /** 上表面 RLM 81／82 的中間色；窗框與打爆後的碎片取這個單色 */
  bodyColor: 0x6c705a,
  accentColor: 0x2a2e28,

  /**
   * 塗裝版面（`tools/livery/fw190.py` 照這份畫）。機身色的面：x ±5.25、
   * y −0.70…1.50、z −2.88…7.17，所以 planZ 取 z 的中點 2.15、sideY 取 y 的中點 0.40。
   *
   * 【scale 95】上下視一格半寬 512 px，翼尖 5.25 m × 95 = 499 px 才放得下；
   * scale 100 會讓翼尖 13 px 跨進隔壁的視圖、取到別處的漆，不會報錯。
   */
  livery: { url: '/textures/fw190.png', scale: 95, planZ: 2.15, sideY: 0.40 },

  /** GLB 材質名 → 遊戲材質 */
  materials: {
    FW190_Body: 'body',
    FW190_Accent: 'accent',
    FW190_Glass: 'glass',
    // 座艙罩底下的暗色、環形散熱器正面、增壓器進氣口的凹槽內壁
    FW190_Cockpit: 'cockpit',
    FW190_Frame: 'frame',
  },

  /** 螺旋槳：VS 111 三葉、直徑 3.50 m，槳盤 z −2.47 */
  props: [{ node: 'FW190_Prop', hubY: 0, hubZ: -2.47, radius: 1.75 }],
}
