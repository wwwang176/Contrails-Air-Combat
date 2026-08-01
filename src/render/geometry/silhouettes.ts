import { DEG } from '../../core/math'
import type { FuselageSection } from './fuselage'
import type { WingParams } from './wing'

/** 一個 lofting 部件：截面串 + 超橢圓指數 + 徑向分段數。 */
export interface LoftPart {
  sections: readonly FuselageSection[]
  /** 超橢圓指數：2 = 橢圓，越大越接近圓角矩形。見 buildFuselage。 */
  roundness: number
  segments: number
}

/** 垂直安定面／背鰭延伸板，以 WingParams 立起 90° 描述。 */
export interface FinParams {
  chordRoot: number
  chordTip: number
  height: number
  sweep: number
  z: number
}

/**
 * 凸起塊：進氣口、機槍鼓包（Beule）、翼下散熱器、尾翼支柱——這些在照片裡
 * 都是「貼在主體上的一小塊」，形狀差異在遊戲距離下看不出來，共用一個盒體
 * 即可，差別只在位置與尺寸。
 */
export interface Blister {
  x: number
  y: number
  z: number
  /** 翼展向 × 垂直 × 縱向 */
  width: number
  height: number
  length: number
  /** 繞 Z 軸傾斜（尾翼支柱用），rad */
  rotZ?: number
  /** true 時鏡像到 −X 側（位置與 rotZ 同時取負） */
  mirror?: boolean
  /** true 用機身色，預設用強調色 */
  bodyColor?: boolean
}

export interface Silhouette {
  bodyColor: number
  accentColor: number
  /**
   * 真機全長（含螺旋槳整流罩），m。這不是給幾何用的參數，而是**驗收基準**：
   * 測試會拿完成模型的包圍盒 Z 長度來比對，避免造型調著調著就跟真機脫節。
   */
  realLength: number
  fuselage: LoftPart
  canopy: LoftPart
  /** 機腹散熱器導管（P-51D 的招牌，Bf 109 沒有） */
  scoop?: LoftPart
  wing: WingParams
  tailplane: WingParams
  fin: FinParams
  /** 背鰭延伸（P-51D-10 以後的 dorsal fillet） */
  finFillet?: FinParams
  blisters: readonly Blister[]
  spinner: { radius: number; length: number }
  /** 槳葉數：P-51D 四葉、Bf 109 三葉 */
  propBlades: number
  propZ: number
  propRadius: number
}

export const SILHOUETTES: Record<string, Silhouette> = {
  /**
   * P-51D Mustang —— 真機 全長 9.83 m、翼展 11.286 m、螺旋槳直徑 3.40 m。
   *
   * 照片上最能認出它的四件事，全部有對應幾何：
   *   1. 機首**上方**緊接整流罩的化油器進氣口（Merlin 型的標誌，Allison 型沒有）
   *   2. 機翼後緣下方那條又長又深的散熱器導管，進氣唇與機腹之間有段落差
   *   3. 淚滴形氣泡座艙罩，最寬處在駕駛座**後方**，往後收進薄背脊
   *   4. 垂直尾翼前方的背鰭延伸（dorsal fillet）
   */
  p51d: {
    bodyColor: 0x9aa7b4,
    accentColor: 0x2f3a46,
    realLength: 9.83,
    fuselage: {
      roundness: 2.4,   // 接近橢圓，側面略平
      segments: 10,
      sections: [
        { z: -4.55, halfWidth: 0.30, halfHeight: 0.30, centerY: 0.06 },  // 整流罩接合面
        { z: -4.05, halfWidth: 0.40, halfHeight: 0.50, centerY: 0.04 },
        { z: -3.25, halfWidth: 0.46, halfHeight: 0.60, centerY: 0.02 },
        { z: -2.35, halfWidth: 0.49, halfHeight: 0.66, centerY: 0.00 },  // 防火牆
        { z: -1.20, halfWidth: 0.50, halfHeight: 0.66, centerY: 0.00 },  // 機翼前緣
        { z: 0.00, halfWidth: 0.49, halfHeight: 0.62, centerY: 0.02 },   // 座艙下方
        { z: 1.30, halfWidth: 0.42, halfHeight: 0.50, centerY: 0.08 },   // 背脊起點
        { z: 2.50, halfWidth: 0.30, halfHeight: 0.36, centerY: 0.14 },
        { z: 3.60, halfWidth: 0.19, halfHeight: 0.24, centerY: 0.18 },
        { z: 4.35, halfWidth: 0.07, halfHeight: 0.12, centerY: 0.20 },   // 尾錐
      ],
    },
    canopy: {
      roundness: 2.2,
      segments: 8,
      sections: [
        { z: -1.40, halfWidth: 0.14, halfHeight: 0.08, centerY: 0.56 },  // 風擋前緣
        { z: -0.95, halfWidth: 0.34, halfHeight: 0.28, centerY: 0.58 },  // 風擋頂
        { z: -0.20, halfWidth: 0.44, halfHeight: 0.34, centerY: 0.58 },  // 泡罩最寬
        { z: 0.55, halfWidth: 0.42, halfHeight: 0.31, centerY: 0.58 },
        { z: 1.30, halfWidth: 0.16, halfHeight: 0.10, centerY: 0.48 },   // 頂 0.58 = 背線
      ],
    },
    scoop: {
      roundness: 3.0,   // 導管是方的，不是圓的
      segments: 6,
      // 【後半段原本是浮在空中的】機腹自機翼後緣起就往上收（boat-tail），
      // 導管卻一路平飛，到 z=2.4 已經離開機身 0.20 m——側面看是一根獨立
      // 漂浮的方管。
      //
      // 而且光把它抬高還不夠：機身是超橢圓剖面，導管**兩側**對應的機身
      // 表面比中線高得多，所以上緣兩角照樣懸空（實測在機身表面外 3.69 倍）。
      // 導管後段還一度比機身還寬（z=2.0 處 0.36 對 0.35），整個上蓋暴露。
      // 因此後段必須同時收窄**並**抬高，讓上緣整條都埋進機身裡。
      sections: [
        { z: -0.35, halfWidth: 0.30, halfHeight: 0.11, centerY: -0.58 }, // 進氣唇
        { z: 0.30, halfWidth: 0.40, halfHeight: 0.24, centerY: -0.68 },
        { z: 1.20, halfWidth: 0.36, halfHeight: 0.26, centerY: -0.58 },
        { z: 2.00, halfWidth: 0.28, halfHeight: 0.22, centerY: -0.44 },  // 出風斜板
        { z: 2.70, halfWidth: 0.16, halfHeight: 0.12, centerY: -0.22 },  // 併回機腹
      ],
    },
    wing: {
      // 厚度為**翼根**值：0.40 / 2.75 = 14.5% 厚弦比，真機 NAA/NACA 45-100
      // 層流翼根部 15.1%。翼尖由 buildWingPanel 按弦長比例收到 0.19 m。
      rootChord: 2.75, tipChord: 1.30, halfSpan: 5.64,
      sweep: 4 * DEG, dihedral: 5 * DEG, thickness: 0.40, rootZ: -1.5, rootY: -0.28,
    },
    tailplane: {
      rootChord: 1.35, tipChord: 0.70, halfSpan: 2.10,
      sweep: 8 * DEG, dihedral: 0, thickness: 0.14, rootZ: 3.3, rootY: 0.10,
    },
    fin: { chordRoot: 1.80, chordTip: 0.80, height: 1.75, sweep: 34 * DEG, z: 2.8 },
    // 背鰭：翼根很長、翼尖很短且幾乎貼在垂尾前緣，所以後掠角極大（73°）。
    finFillet: { chordRoot: 1.55, chordTip: 0.30, height: 0.42, sweep: 73 * DEG, z: 1.45 },
    blisters: [
      // 化油器進氣口，機首**上方**
      { x: 0, y: 0.56, z: -3.70, width: 0.32, height: 0.24, length: 1.00 },
    ],
    spinner: { radius: 0.30, length: 0.55 },
    propBlades: 4,
    propZ: -4.80,
    propRadius: 1.70,
  },

  /**
   * Bf 109 G-6 —— 真機 全長 8.95 m、翼展 9.925 m、螺旋槳直徑 3.00 m。
   *
   * 照片上最能認出它的四件事：
   *   1. 機身極窄且**側面平板**（真機最大寬度僅約 0.79 m，卻有 1.07 m 深）
   *   2. 機首上方兩顆 MG 131 機槍鼓包「Beulen」——G-6 型的識別特徵
   *   3. 兩具翼下散熱器，位在起落架艙外側
   *   4. 水平尾翼下方的斜撐桿（同期盟軍機沒有，側影一眼可辨）
   */
  bf109g6: {
    bodyColor: 0x7e8a73,
    accentColor: 0x33403a,
    realLength: 8.95,
    /**
     * 【機尾不是圓錐】兩個獨立的問題，都會讓後段讀起來像個錐體：
     *
     * 一、側視背線原本不是直的。頂線斜率是 −0.0615 → −0.0538 → −0.0750：
     *     中段變平、尾段又折下去。真機自座艙後方到垂尾根部是**一條直線**，
     *     腹線同樣筆直上收，側視是個楔形而不是收口的錐。下方三個站位改成
     *     由 z=0.30 與 z=4.10 的端點嚴格線性內插。
     *
     * 二、剖面形狀沿全機不變。真機的發動機罩接近圓形（要包住倒立 V12），
     *     尾段卻是明顯的平板側身。用逐站位的 roundness 表現這個變化。
     */
    fuselage: {
      roundness: 2.8,
      segments: 10,
      sections: [
        { z: -4.30, halfWidth: 0.28, halfHeight: 0.28, centerY: 0.04, roundness: 2.2 },
        { z: -3.80, halfWidth: 0.35, halfHeight: 0.44, centerY: 0.02, roundness: 2.4 },
        { z: -2.90, halfWidth: 0.39, halfHeight: 0.50, centerY: 0.00, roundness: 2.6 },
        { z: -2.00, halfWidth: 0.40, halfHeight: 0.550, centerY: 0.020 },  // 最大截面
        { z: -0.90, halfWidth: 0.40, halfHeight: 0.560, centerY: 0.045 },
        { z: 0.30, halfWidth: 0.350, halfHeight: 0.515, centerY: 0.125, roundness: 3.0 },
        { z: 1.60, halfWidth: 0.251, halfHeight: 0.375, centerY: 0.135, roundness: 3.2 },
        { z: 2.90, halfWidth: 0.152, halfHeight: 0.234, centerY: 0.146, roundness: 3.4 },
        { z: 4.10, halfWidth: 0.060, halfHeight: 0.105, centerY: 0.155, roundness: 3.4 },
      ],
    },
    /**
     * 【高背脊，座艙罩只是薄薄一片凸出物】原本罩頂 0.78、罩後背線只有
     * 0.456，落差 0.32 m——那是氣泡座艙罩擱在錐體上的樣子，不是 109。
     * 真機的後段機身背脊很高，幾乎與座艙罩玻璃頂齊平，這正是 109 後方
     * 視野惡名昭彰的原因（後期才換成 Erla Haube 清型罩，背脊依舊高）。
     *
     * 因此背脊抬到 0.64（見上方 z=0.30 站位），罩頂降到 0.74，兩者在
     * 罩尾 z=1.15 精確銜接於 0.557。後段固定風擋的斜率因此由 −0.259
     * 緩和到 −0.146，與背脊的 −0.100 幾乎連續。
     */
    canopy: {
      roundness: 3.5,   // 方框式座艙罩，稜線分明
      segments: 8,
      sections: [
        { z: -1.15, halfWidth: 0.13, halfHeight: 0.070, centerY: 0.480 }, // 風擋前緣
        { z: -0.80, halfWidth: 0.30, halfHeight: 0.220, centerY: 0.520 }, // 裝甲玻璃頂 0.74
        { z: -0.10, halfWidth: 0.33, halfHeight: 0.240, centerY: 0.500 }, // 罩頂 0.74
        { z: 0.50, halfWidth: 0.28, halfHeight: 0.190, centerY: 0.462 },  // 頂 0.652
        { z: 1.15, halfWidth: 0.16, halfHeight: 0.110, centerY: 0.447 },  // 頂 0.557 = 背線
      ],
    },
    wing: {
      // 0.32 / 2.30 = 13.9% 厚弦比，真機 NACA 2R1 翼根 14.2%
      rootChord: 2.30, tipChord: 1.05, halfSpan: 4.96,
      sweep: 6 * DEG, dihedral: 6.5 * DEG, thickness: 0.32, rootZ: -1.2, rootY: -0.26,
    },
    tailplane: {
      rootChord: 1.10, tipChord: 0.58, halfSpan: 1.65,
      sweep: 10 * DEG, dihedral: 0, thickness: 0.12, rootZ: 2.9, rootY: 0.18,
    },
    // 背脊抬高後垂尾露出的部分變短，高度隨之補回（露出約 0.96 m，合真機）
    fin: { chordRoot: 1.55, chordTip: 0.70, height: 1.38, sweep: 30 * DEG, z: 2.5 },
    blisters: [
      // MG 131 機槍鼓包，左右各一
      { x: 0.20, y: 0.44, z: -3.10, width: 0.30, height: 0.22, length: 0.85, mirror: true },
      // 機首下方滑油冷卻器
      { x: 0, y: -0.48, z: -2.90, width: 0.40, height: 0.20, length: 0.90 },
      // 翼下冷卻液散熱器
      { x: 1.50, y: -0.30, z: 0.30, width: 0.55, height: 0.22, length: 1.00, mirror: true },
      // 水平尾翼斜撐桿
      {
        x: 0.36, y: 0.05, z: 3.15, width: 0.55, height: 0.05, length: 0.10,
        rotZ: 20 * DEG, mirror: true, bodyColor: true,
      },
    ],
    spinner: { radius: 0.29, length: 0.55 },
    propBlades: 3,
    propZ: -4.55,
    propRadius: 1.50,
  },
}
