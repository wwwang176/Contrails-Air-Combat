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
  /**
   * 翼根的垂直位置。省略即 0。
   *
   * 【為什麼需要】垂尾原本一律從 y=0 長起，但機身後段的中心線是抬高的
   * （109 抬到 0.44–0.62），下半截因此埋在機身裡。等它從背線冒出來時，
   * 前緣已被後掠角帶往機尾——實測 109 可見的垂尾根部落在全長 86.7%，
   * 設計值卻是 82%（線稿量到的也是 82%），看起來又小又靠後。
   * P-51D 的背鰭更嚴重：高 0.42 但該站位背線在 0.570，**整片看不見**。
   */
  rootY?: number
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
  /**
   * true 時用低多邊形橢球而非方盒。機槍鼓包（Beule）是圓的，方盒在俯視與
   * 側視都讀成「機首上黏了兩塊磚」；散熱器與進氣口本來就是方管，維持方盒。
   */
  round?: boolean
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
  /** y 為整流罩軸心的垂直位置，預設 0（機首環中心不在 0 時要一致） */
  spinner: { radius: number; length: number; y?: number }
  /** 槳葉數：P-51D 四葉、Bf 109 三葉 */
  propBlades: number
  propZ: number
  propRadius: number
}

/**
 * 造型座標 → 機體座標的 Z 位移：讓機翼四分之一弦線落在原點。
 *
 * 【為什麼需要】原點是物理模型的**重心**（`state.position` 就是重心）。
 * 上面那些站位是照著「機首在負 Z」手打的，重心落在哪裡是碰運氣——實測
 * P-51D 差了 0.81 m、Bf 109 差了 2.08 m。四分之一弦線是次音速氣動中心的
 * 標準近似，重心壓在它附近才是正常的飛機配置。
 *
 * 用位移而不是把站位全部重打，是為了讓造型數字保持可讀（機首負、機尾正），
 * 而且日後移動機翼不必連帶重算其他四十個座標。
 */
export function hullOffsetZ(sil: Silhouette): number {
  return -(sil.wing.rootZ + 0.25 * sil.wing.rootChord)
}

/**
 * DB 605 的排氣管：**每側 6 根**（倒立 V12，每側 6 缸），沿引擎罩下側排成
 * 一列。用產生器而不是手打六筆，是因為間距與尺寸要一致才會讀成鋸齒狀；
 * 手打很容易在某一根上打錯一個位數而不自覺。
 */
function exhaustStubs(startZ: number, pitch: number, count: number): Blister[] {
  return Array.from({ length: count }, (_, i) => ({
    x: 0.50, y: 0.15, z: startZ + i * pitch,
    width: 0.10, height: 0.12, length: 0.14,
    mirror: true,
  }))
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
      segments: 14,
      sections: [
        { z: -4.55, halfWidth: 0.30, halfHeight: 0.30, centerY: 0.06 },  // 整流罩接合面
        { z: -4.05, halfWidth: 0.38, halfHeight: 0.45, centerY: 0.04 },
        { z: -3.25, halfWidth: 0.45, halfHeight: 0.58, centerY: 0.02 },
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
      segments: 10,
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
      segments: 8,
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
      tipRound: 0.30,
    },
    tailplane: {
      rootChord: 1.35, tipChord: 0.70, halfSpan: 2.10,
      sweep: 8 * DEG, dihedral: 0, thickness: 0.14, rootZ: 3.3, rootY: 0.10, tipRound: 0.35,
    },
    fin: { chordRoot: 1.80, chordTip: 0.80, height: 1.40, sweep: 34 * DEG, z: 2.8, rootY: 0.35 },
    // 背鰭：翼根坐在背線上（0.57），頂端要**恰好**落在垂尾前緣線上——
    // 解 1.45 + tan(sw)·h = 2.8 + tan(34°)·(0.57 + h − 0.35)，取 h=0.30
    // 得 sw=80°，交會於 (z=3.15, y=0.87)。後掠角這麼大時，翼根只要埋進
    // 機身幾公分，可見根部就會被帶往機尾好幾十公分，所以 rootY 必須齊平。
    finFillet: {
      chordRoot: 1.55, chordTip: 0.30, height: 0.30, sweep: 80 * DEG, z: 1.45, rootY: 0.57,
    },
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
   *   4. **沒有**尾翼支撐桿——F 型起改為懸臂式平尾並把支柱取消，G 系列
   *      沿用。支柱是 E 型的特徵，早期我誤加在 G-6 上。
   */
  /**
   * Bf 109 **E-4** —— 真機 全長 8.64 m、翼展 9.87 m、螺旋槳直徑 3.10 m。
   *
   * 【型號更正】這個外型原本是照 G-6 做的，專案負責人指定目標為 E 型，
   * 全部改回 E-4。E 與 G 在外觀上的關鍵差異：
   *
   *   方翼尖    ── F 型才改成圓翼尖，E 是方的（tipRound 因此移除）
   *   尾翼支柱  ── F 型起改懸臂式取消支柱，E 有（先前誤刪，已還原）
   *   無 Beulen ── 13 mm MG 131 的鼓包是 G-6 的特徵；E 用 7.92 mm MG 17
   *   機首較短  ── 8.64 對 8.95 m，站位依 0.9654 比例對機首尖端縮放
   *
   * 側視剖面是照同一架 E-4 參考模型的正交剪影量測配出來的，因此**不必**
   * 重新調整，只需按長度比例縮放——這也是這次改型號改得動的原因。
   *
   * 保留的 E 型識別特徵：左舷單側增壓器進氣口、每側 6 根 DB 601 排氣管、
   * 兩具翼下散熱器、機首下方滑油冷卻器、方框式座艙罩。
   */
  bf109g6: {
    bodyColor: 0x7e8a73,
    accentColor: 0x33403a,
    realLength: 8.64,
    fuselage: {
      roundness: 2.8,
      segments: 14,
      sections: [
        // 側視骨架量自 E-4 參考模型剪影（見 progress ledger）。背線明顯下降、
        // 腹線小幅抬升，中心線幾乎水平——機尾錐收在機身中間高度。
        { z: -4.51, halfWidth: 0.340, halfHeight: 0.360, centerY: 0.374, roundness: 2.2 },
        { z: -4.03, halfWidth: 0.420, halfHeight: 0.465, centerY: 0.326, roundness: 2.3 },
        { z: -3.55, halfWidth: 0.480, halfHeight: 0.546, centerY: 0.268, roundness: 2.4 },
        { z: -2.97, halfWidth: 0.490, halfHeight: 0.570, centerY: 0.259, roundness: 2.5 },
        { z: -2.20, halfWidth: 0.460, halfHeight: 0.594, centerY: 0.234, roundness: 2.6 },
        { z: -1.19, halfWidth: 0.420, halfHeight: 0.655, centerY: 0.215 },  // 最大深度
        { z: -0.10, halfWidth: 0.370, halfHeight: 0.601, centerY: 0.265, roundness: 2.9 },
        { z: 1.20, halfWidth: 0.280, halfHeight: 0.472, centerY: 0.224, roundness: 3.2 },
        { z: 2.55, halfWidth: 0.165, halfHeight: 0.284, centerY: 0.201, roundness: 3.4 },
        { z: 3.79, halfWidth: 0.060, halfHeight: 0.100, centerY: 0.250, roundness: 3.4 },
      ],
    },
    canopy: {
      // 【方正的關鍵是分段數，不只是 roundness】6 段的頂點落在 60°/120°，
      // 中間形成一條**平頂**，兩側是傾斜的肩面、再往下接近垂直——那正是
      // 109 那個平頂玻璃罩的剖面。8 或 10 段會在 90° 出現頂點做成尖屋脊，
      // roundness 調再高也救不回來。
      roundness: 4.0,
      segments: 6,
      sections: [
        { z: -1.86, halfWidth: 0.17, halfHeight: 0.06, centerY: 0.680 }, // 風擋底框 0.74
        { z: -1.71, halfWidth: 0.30, halfHeight: 0.21, centerY: 0.790 }, // 風擋頂 1.00（60°）
        { z: -1.08, halfWidth: 0.33, halfHeight: 0.24, centerY: 0.760 }, // 罩頂 1.00
        { z: -0.70, halfWidth: 0.28, halfHeight: 0.19, centerY: 0.780 }, // 0.97
        { z: -0.41, halfWidth: 0.18, halfHeight: 0.13, centerY: 0.738 }, // 0.868 = 背線
      ],
    },
    wing: {
      // E 型是**方翼尖**（F 型才改圓），所以沒有 tipRound。
      // 0.32 / 2.22 = 14.4% 厚弦比，真機 NACA 2R1 翼根 14.2%。
      rootChord: 2.22, tipChord: 1.01, halfSpan: 4.935,
      sweep: 3 * DEG, dihedral: 6.5 * DEG, thickness: 0.32, rootZ: -2.93, rootY: -0.37,
    },
    tailplane: {
      rootChord: 1.06, tipChord: 0.56, halfSpan: 1.65,
      sweep: 10 * DEG, dihedral: 0, thickness: 0.12, rootZ: 2.63, rootY: 0.55, tipRound: 0.35,
    },
    fin: { chordRoot: 1.50, chordTip: 0.68, height: 1.05, sweep: 30 * DEG, z: 2.25, rootY: 0.40 },
    blisters: [
      // 機首機槍：兩根 MG 17 槍管自引擎罩上方伸出
      { x: 0.16, y: 0.74, z: -4.46, width: 0.06, height: 0.06, length: 0.53, mirror: true },

      /**
       * 增壓器進氣口 —— **只在左舷（−X）**，不鏡像。
       *
       * DB 601 的機械增壓器裝在引擎左側，進氣口因此是單邊的；這是 109 少數
       * 左右不對稱的外觀特徵，從正面或俯視一眼可辨。
       */
      { x: -0.54, y: 0.35, z: -2.82, width: 0.22, height: 0.28, length: 0.58, round: true },

      // DB 601 排氣管，每側 6 根
      ...exhaustStubs(-3.45, 0.193, 6),

      // 機首下方滑油冷卻器
      { x: 0, y: -0.26, z: -2.97, width: 0.40, height: 0.20, length: 0.87 },
      // 翼下冷卻液散熱器
      { x: 1.50, y: -0.41, z: -1.63, width: 0.55, height: 0.22, length: 0.97, mirror: true },
      /**
       * 水平尾翼斜撐桿 —— **E 型有**。
       *
       * F 型起平尾改為懸臂式、支柱取消，G 系列沿用。我先前把這台當成 G-6
       * 而刪掉了支柱，現在改回 E 型必須還原。自機身下緣（0.09, 0.00）拉到
       * 平尾下表面（0.62, 0.49），長 0.722、仰角 42.8°。
       */
      {
        x: 0.355, y: 0.245, z: 2.85, width: 0.722, height: 0.05, length: 0.10,
        rotZ: 42.8 * DEG, mirror: true, bodyColor: true,
      },
    ],
    // 底徑實測 0.0827 L；y 與機首環中心一致
    spinner: { radius: 0.35, length: 0.34, y: 0.374 },
    propBlades: 3,
    propZ: -4.63,
    propRadius: 1.55,   // 真機 VDM 螺旋槳直徑 3.10 m
  },
}
