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
    /**
     * 【機身原本全段偏瘦】把正交側視／俯視算圖與 G-10 三視圖做歸一化量測
     * （以全長為 1.0），結果是全段一致偏瘦，不是局部造型誤差：
     *
     *   最大深度  0.123 L 對 0.140 L   −12%
     *   最大寬度  0.088 L 對 0.114 L   −23%
     *   斷面積                          −33%
     *
     * 25/40/55/70% 四個站位的深度分別薄 14/12/14/17%，沒有任何一站較厚；
     * 整流罩底徑也薄 21%，量級一致——等於整條筒身被等比例削細。
     *
     * 而且**最寬處的位置錯了**：線稿在 13–23%（發動機罩，要塞下 DB 605 與
     * 兩挺 MG 131），模型在 20–54%。真機是罩寬、防火牆之後急縮；模型做成了
     * 均勻的粗管。所以這次不是整體放大，而是重新配置：罩加寬到半寬 0.50、
     * 座艙處收到 0.42、之後線性收到尾錐。座艙處 0.84 m 寬也才對得上 109
     * 座艙狹窄的事實——那兩件事並不衝突，寬的是發動機罩。
     *
     * 【第二輪複驗後的追加】後段機身整條比線稿低約 0.09 m，水平尾翼是
     * 跟著整段下沉、不是單獨裝低。z ≥ 0.07 的站位一併抬升 0.09（0.07 站位
     * 只抬 0.04，因為座艙罩尾端要在該處銜接），平尾與垂尾隨之調整。
     *
     * 深度直接採線稿在 25/42.4/55/70/85% 的量測值。站位數由 10 降為 8
     * （−40 三角形），因為新的深度曲線比較單純。
     */
    fuselage: {
      roundness: 2.8,
      segments: 14,
      sections: [
        // 【側視骨架依 E-4 參考模型的剪影量測重排】（專案負責人裁決以該模型
        // 為準，見下方「兩個來源的衝突」）。作法：把參考模型與程序化模型
        // 對齊後各自算一張正交側視，直接從畫面抽輪廓——每一欄取**最長的
        // 連續區段**，天線拉線與放下的起落架支柱就自動被濾掉。
        //
        // 【兩個來源的衝突】G-10 三視圖線稿與 E-4 模型對「機尾收口由誰負擔」
        // 給出相反答案。兩者對總收口量幾乎一致（−0.62 / −0.635 m），分歧在
        // 分配：線稿說背線降 0.10、腹線升 0.52（比值 5.1）；模型說背線降
        // 0.37、腹線升 0.21（比值 0.58）。我先前的版本是 8.0，比兩個來源
        // 都極端。裁決採用模型的分配——中心線因此幾乎水平，機尾錐收在機身
        // 中間高度，而不是被向上抽尖。
        { z: -4.50, halfWidth: 0.340, halfHeight: 0.360, centerY: 0.374, roundness: 2.2 },
        { z: -4.00, halfWidth: 0.420, halfHeight: 0.465, centerY: 0.326, roundness: 2.3 },
        { z: -3.50, halfWidth: 0.480, halfHeight: 0.546, centerY: 0.268, roundness: 2.4 },
        { z: -2.90, halfWidth: 0.490, halfHeight: 0.570, centerY: 0.259, roundness: 2.5 },
        { z: -2.10, halfWidth: 0.460, halfHeight: 0.594, centerY: 0.234, roundness: 2.6 },
        { z: -1.06, halfWidth: 0.420, halfHeight: 0.655, centerY: 0.215 },  // 最大深度
        { z: 0.07, halfWidth: 0.370, halfHeight: 0.601, centerY: 0.265, roundness: 2.9 },
        { z: 1.42, halfWidth: 0.280, halfHeight: 0.472, centerY: 0.224, roundness: 3.2 },
        { z: 2.76, halfWidth: 0.165, halfHeight: 0.284, centerY: 0.201, roundness: 3.4 },
        { z: 4.10, halfWidth: 0.060, halfHeight: 0.100, centerY: 0.250, roundness: 3.4 },
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
    /**
     * 【平頂段太短、後整流太長】量測：模型的平頂段只有 0.078 L，線稿是
     * 0.175 L（差 55%）；反過來後整流段模型 0.066 L、線稿 0.039 L。也就是
     * 我做成「短頂＋長淚滴尾」，真機是「長平頂＋短收尾」——那正是 109
     * 那個方盒子座艙罩的樣子。座艙罩總長 0.154 L 對 0.197 L，短了 22%。
     *
     * 罩頂高度隨機身加深一併抬到 0.81（線稿 0.152 L，自腹線量起）。
     * 風擋維持陡峭：0.15 m 內升 0.26 m，60°。
     */
    /**
     * 座艙罩：罩頂 1.00（參考模型量到 1.002），高出其下方甲板 0.13。
     * 風擋維持陡峭：0.15 m 內升 0.26 m，60°。罩尾在 z=−0.25 與背線
     * 精確銜接於 0.867。
     */
    canopy: {
      roundness: 3.5,   // 方框式座艙罩，稜線分明
      segments: 10,
      sections: [
        { z: -1.75, halfWidth: 0.17, halfHeight: 0.06, centerY: 0.680 }, // 風擋底框 0.74
        { z: -1.60, halfWidth: 0.30, halfHeight: 0.21, centerY: 0.790 }, // 風擋頂 1.00（60°）
        { z: -0.95, halfWidth: 0.33, halfHeight: 0.24, centerY: 0.760 }, // 罩頂 1.00
        { z: -0.55, halfWidth: 0.28, halfHeight: 0.19, centerY: 0.780 }, // 0.97
        { z: -0.25, halfWidth: 0.18, halfHeight: 0.13, centerY: 0.738 }, // 0.868 = 背線
      ],
    },
    wing: {
      // 0.32 / 2.30 = 13.9% 厚弦比，真機 NACA 2R1 翼根 14.2%
      // 【三項都量自參考模型的正交剪影】
      //   rootY −0.25 → −0.37：側視上參考模型的整條上緣都比我高 0.08–0.15 m，
      //     幅度均勻——那不是形狀差異，是垂直註冊差。對齊基準是翼尖，所以
      //     它代表機翼在機身上裝得太高。修正後機首、座艙罩、背線三處的
      //     殘差同時收斂到 ±0.05 m 以內。
      //   rootZ −2.65 → −2.86：俯視量到參考模型的機翼整體往前 0.21 m。
      //   sweep 6° → 3°：俯視的前緣差由 20% 半翼展的 −0.21 擴大到 90% 的
      //     −0.42，越往翼尖差越多，那是後掠角過大；反推差約 3.5°。
      rootChord: 2.30, tipChord: 1.05, halfSpan: 4.96,
      sweep: 3 * DEG, dihedral: 6.5 * DEG, thickness: 0.32, rootZ: -2.86, rootY: -0.37,
      tipRound: 0.30,
    },
    // 【水平尾翼裝在垂尾上，不在機身側面】109 的平尾明顯高於機身背線，
    // 並由下方斜撐桿支撐——這是它側影一眼可辨的特徵，同期盟軍機沒有。
    // 原本 rootY 0.18，比該站位的背線（0.362）還低 0.18 m，等於從機身
    // 側面中段長出來。
    tailplane: {
      rootChord: 1.10, tipChord: 0.58, halfSpan: 1.65,
      sweep: 10 * DEG, dihedral: 0, thickness: 0.12, rootZ: 2.9, rootY: 0.55, tipRound: 0.35,
    },
    // 背脊抬高後垂尾露出的部分變短，高度隨之補回（露出約 0.96 m，合真機）
    // 翼根抬到背線之下一點點，讓可見的前緣根部落在設計站位（全長 82%）
    fin: { chordRoot: 1.55, chordTip: 0.70, height: 1.05, sweep: 30 * DEG, z: 2.5, rootY: 0.40 },
    blisters: [
      // MG 131 機槍鼓包，左右各一
      { x: 0.20, y: 0.79, z: -3.10, width: 0.30, height: 0.22, length: 0.85, mirror: true },
      // 機首下方滑油冷卻器
      { x: 0, y: -0.26, z: -2.90, width: 0.40, height: 0.20, length: 0.90 },
      // 翼下冷卻液散熱器
      { x: 1.50, y: -0.41, z: -1.51, width: 0.55, height: 0.22, length: 1.00, mirror: true },
    ],
    // 底徑實測 0.0827 L = 0.740 m；y 與機首環中心一致（機首低於機尾）
    spinner: { radius: 0.35, length: 0.35, y: 0.374 },
    propBlades: 3,
    propZ: -4.62,
    propRadius: 1.50,
  },
}
