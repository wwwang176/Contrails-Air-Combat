import { Vector3 } from 'three'
import type { GlbAircraft } from './glb'

/**
 * Bf 109（E-4 外型 + K-4 性能）的 GLB 外型。
 *
 * 網格：翼展 9.87、全機 1,123 個頂點、2,108 個三角形。翼根四分之一弦線在原點，
 * 螺旋槳軸高 0.36。關鍵座標：
 *
 *   機身 z −2.17…5.80、方向舵尾端 6.32
 *   整流罩尖端 z −2.578
 *   翼根前緣 −0.518、翼尖 x ±4.934
 *
 * 機翼沿展向有 5 條環線（每 0.8 m）—— 命中盒要切得下去，正後方的放大倍數才壓得到
 * 2.05×（見 `specs/bf109k4.ts` 的 `hitBoxes`）。
 *
 * 材質約定（與 `bf109k4.glb` 的材質名一致，GLB 換了要跟著對）：`BF109_Body`、
 * `BF109_Accent`、`BF109_Glass`、`BF109_Cockpit`（玻璃與機身接觸面的黑色）。
 *
 * 節點約定：螺旋槳是 `BF109_Prop`。`BF109_Wing` 要帶 glTF extras
 * `part = 'wing0'` —— 少了它 `glb.ts` 標不出主翼，`geometry.test.ts` 的「四分之一
 * 弦線落在原點」量不到任何 mesh、算出 NaN。
 *
 * 座標是機體座標：X 翼展、Y 上、Z 機尾，原點在主翼四分之一弦線。
 */
export const BF109K4_MODEL: GlbAircraft = {
  url: '/models/bf109k4.glb',
  realLength: 8.64,

  // 眼點：艙緣（甲板切線）0.547 上方 0.26；z 0.95 落在風擋前緣（0.36）
  // 後方 0.6 m，與 P-51D / F6F-5 同一個訂法
  eyePoint: new Vector3(0, 0.80, 0.95),

  // 右翼尖弦的中點：翼尖站位 x 4.935（= spec 半翼展）、前緣 −0.196、
  // 後緣 0.594，y 是上反角線到翼尖的高度
  wingTip: new Vector3(4.935, 0.225, 0.199),

  /** 掛不了彈 */
  bombPoint: null,

  bodyColor: 0x7e8a73,
  accentColor: 0x33403a,
  // 貼圖由 tools/livery/bf109k4.py 畫。UV 在載入時算，GLB 不動
  livery: { url: '/textures/bf109k4.png', scale: 100, planZ: 1.87, sideY: 0.70 },
  /** 冬季：白色水性漆蓋在原本的迷彩上（`tools/livery/bf109k4.py --winter`）；德 M4 的護航用 */
  liveryVariants: { winter: '/textures/bf109k4_winter.png' },

  /** GLB 材質名 → 遊戲材質 */
  materials: {
    BF109_Body: 'body',
    BF109_Accent: 'accent',
    BF109_Glass: 'glass',
    BF109_Cockpit: 'cockpit',
  },

  /**
   * 螺旋槳。轉軸高度 = 整流罩軸心 0.36；槳盤 z −2.29；
   * 半徑照史實 VDM 螺旋槳直徑 3.10 m（槳葉也是同一半徑）。
   */
  props: [{ node: 'BF109_Prop', hubY: 0.36, hubZ: -2.29, radius: 1.55 }],
}
