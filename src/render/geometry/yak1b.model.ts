import { Vector3 } from 'three'
import type { GlbAircraft } from './glb'

/**
 * Yak-1B（低模）。**只當德 M4 的蘇軍對手用**（關卡物件，玩家不能選），所以刻意做得比其他
 * 戰鬥機簡單、**尚未精細化**：約 1,700 個三角形（F6F-5 約 3,000），沒有起落架、天線、座艙內裝與
 * 舵面分縫；螺旋槳是三根薄長方體。
 *
 * `yak1b.glb` 的節點：`YAK_Fuselage`、`YAK_Spinner`、`YAK_Canopy`、
 * `YAK_WingR/L`、`YAK_TailR/L`、`YAK_Fin`、`YAK_Prop`。
 *
 * 【GLB 的座標系就是機體座標】X 對稱於 0（翼展 10.0 m）、Y 0 是推力線（槳轂中心）、
 * Z 的原點在**主翼翼根四分之一弦線**（距機鼻 2.618 m），機鼻朝 −Z：
 *
 *     X −5.000 … 5.000   Y −1.285 … 1.540   Z −2.618 … 5.862
 *
 * 全長 8.48 m（機鼻尖端到方向舵後緣）。
 */
export const YAK1B_MODEL: GlbAircraft = {
  url: '/models/yak1b.glb',
  realLength: 8.48,

  /** 眼點：座艙罩前緣（距機鼻 2.78）後約 0.5 m、艙緣上方 0.1 m */
  eyePoint: new Vector3(0, 0.62, 0.68),

  /**
   * 右翼尖弦的中點：x 5.000、y = 中弧高度（翼根 −0.555、上反 5.05°，到翼尖 −0.188）、
   * z = 翼尖弦中點（距機鼻 3.11）減翼根四分之一弦線再往前 0.04。
   */
  wingTip: new Vector3(5.000, -0.188, 0.45),

  /** 不掛彈 */
  bombPoint: null,

  /** 蘇軍 1943 年戰鬥機的上表面色（黃綠，與塗裝的底色相同）；窗框與打爆後的碎片取這個單色 */
  bodyColor: 0x768050,
  accentColor: 0x23271f,

  /**
   * 塗裝版面（`tools/livery/yak1b.py` 照這份畫）。機身色的面：x ±5.00、y −0.90…1.54、
   * z −2.12…5.84，所以 planZ 取 z 的中點 1.86、sideY 取 y 的中點 0.32；scale 100 時上下視
   * 一格半寬 5.12 m（翼展半寬 5.00），左右視一格半高 2.56 m。
   */
  livery: { url: '/textures/yak1b.png', scale: 100, planZ: 1.86, sideY: 0.32 },
  /** 冬季：白色水洗漆蓋在原本的迷彩上（`tools/livery/yak1b.py --winter`） */
  liveryVariants: { winter: '/textures/yak1b_winter.png' },

  materials: {
    YAK_Body: 'body',
    YAK_Accent: 'accent',
    YAK_Glass: 'glass',
  },

  /** 螺旋槳：三葉、直徑 2.57 m（半徑 1.285），槳盤距機鼻 0.485 → z −2.133 */
  props: [{ node: 'YAK_Prop', hubY: 0, hubZ: -2.133, radius: 1.285 }],
}
