import { DEG } from '../core/math'
import { makeHitBox } from '../world/hit'
import { FW190_BATTERY } from '../weapons/fw190'
import type { AircraftSpec, HistoricalReference } from './types'

const PS = 735.5
const KMH = 1 / 3.6

/**
 * Fw 190 D-9，Jumo 213 A-1。
 *
 * ══ 史實表：Rechlin 實測，起飛／緊急出力、**不開 MW 50** ═══════════
 *
 * E-Stelle Rechlin, Erpr.Nr. 9003 Teilbericht 2「Flugleistungen Fw 190 D-9 mit Jumo 213 A」
 *（W.Nr. 210006，1945-03-02）。Start- und Notleistung：3,250 rpm、約 1.48 ata、B4 燃料。
 * 試飛機是量產機，帶 ETC 504 掛架、發動機罩縫隙未封。
 *
 * ```
 *   臨界高度極速   645–655 km/h @ 6.6 km   4,200 kg
 *   海平面極速     540–550 km/h            4,200 kg
 *   海平面爬升     17.0 m/s                4,300 kg
 *   實用升限       約 10.8 km（0.5 m/s）    4,300 kg
 * ```
 *
 * 模型的質量取 4,300 kg（爬升與升限的重量）。兩個極速取區間中點再照報告自己的重量圖
 * 換到 4,300 kg（4.2 → 4.4 t 約 −6 km/h，所以 −3）：647 與 542。
 *
 * 【不採 Focke-Wulf 的 MW 50 計算值】廠方的 1.8 ata + MW 50 曲線（海平面約 606、
 * 5.4 km 約 692 km/h、爬升約 21 m/s）是**算的**，而且廠方的不開 MW 50 計算值本身就比
 * Rechlin 實測高 25–35 km/h（掛架、縫隙、壓縮性）。兩組不可混用。
 */
export const FW190: AircraftSpec = {
  id: 'fw190',
  name: 'Fw 190 D-9',
  faction: 'axis',
  role: 'fighter',

  /** Rechlin 爬升與升限的試飛重量；起飛重量 4,350 kg */
  mass: 4300,

  /**
   * 慣量：沒有實測值，照 P-51D 的迴轉半徑比例外推（與 `specs/ki84.ts` 同一個做法），
   * 翼展 10.50、全長 10.05 用量到的網格尺寸：
   *
   * ```
   *   滾轉  k/(b/2)      0.2536 × 5.25   = 1.331
   *   俯仰  k/L          0.1627 × 10.05  = 1.635
   *   偏航  k/((b+L)/4)  0.4085 × 5.1375 = 2.099
   * ```
   *
   * I = m·k²，4,300 kg 得 7,620 / 11,500 / 18,950。
   */
  inertia: { pitch: 11500, yaw: 18950, roll: 7620 },

  /**
   * 翼面積 18.3 m²（Rechlin 諸元表）、翼展 10.50 m（網格；Rechlin 表寫 10.46）。
   * chord 取幾何平均弦 18.3 ÷ 10.5 = 1.74。oswald 0.78 與 Bf 109 K-4 同一檔。
   */
  wing: { area: 18.3, span: 10.5, chord: 1.74, oswald: 0.78 },

  /**
   * 推導 CL_max = 4.5 × (16.5° + 1.5°) = 1.414，對 `FW190_HISTORICAL.clMax` 的 1.425
   * 是 −0.8%。翼型 NACA 23015.3／23009，無縫翼。
   */
  lift: {
    clAlpha: 4.5,
    alphaZero: -1.5 * DEG,
    alphaCrit: 16.5 * DEG,
    stallBlend: 6 * DEG,
    postStallFactor: 0.6,
    slatAlphaBonus: 0,
    slatDeployAlpha: Infinity,   // 無縫翼
    slatRetractAlpha: Infinity,
  },

  /**
   * 【0.027 是帶 ETC 504 掛架、縫隙未封的那一台】史實表就是那個構型。報告把它與乾淨機的
   * 差距歸給掛架與固定輪艙門（約 8–10 km/h）和未封的發動機罩縫隙（約 15 km/h）。
   *
   * ```
   *   cd0     臨界極速   海面極速   爬升    升限       （etaMax 0.88、vRef 38、ram 0.5）
   *   0.027    +0.8%      +0.7%     0.0%   +2.8%   ← 出貨
   *   0.028    −0.7%      −0.6%    −0.7%   +2.4%
   *   0.029    −2.1%      −1.8%    −1.4%   +2.0%
   * ```
   *
   * 掃描：`npx vite-node test/tools/fw190-tune.probe.ts`
   */
  drag: { cd0: 0.027, cdBeta: 0.7, machCrit: 0.70, machDragFactor: 60 },

  side: { cyBeta: -0.7 },

  /**
   * 滿舵螺旋角 pb/2V = clDa ÷ (−clP) = 0.035 ÷ 0.45 = 0.078，P-51D 是 0.073。
   */
  moments: {
    cm0: 0.02, cmAlpha: -0.8, cmQ: -11, cmDe: 1.15,
    clBeta: -0.08, clP: -0.45, clDa: 0.035,
    cnBeta: 0.1, cnR: -0.12, cnDr: 0.065,
  },

  /**
   * 副翼在高速仍輕（aileronK 0.25，全場戰鬥機最小）：Fw 190 的副翼走推桿傳動、
   * 以高速滾轉著稱。升降舵較重（0.30）：美方對繳獲機 FE-121 的評語是 375 mph IAS
   * 以上抖振、桿力變重。
   */
  controlStiffening: { qRef: 10884, aileronK: 0.25, elevatorK: 0.30, rudderK: 0.25 },

  engine: {
    /**
     * Jumo 213 A，**二速增壓器＋液壓耦合**。填 Start- und Notleistung（3,250 rpm、約 1.5 ata），
     * 與史實表同一個出力狀態。Jumo 出力圖 Bl. 2610（1944-10-09），不含衝壓：
     *
     * ```
     *   海平面        約 1,770 PS
     *   一速全開      約 1,760 PS @ 約 2.5 km
     *   二速全開      約 1,600 PS @ 約 5.5 km
     * ```
     *
     * 二速的海平面出力 1,450 PS 沒有直接來源，是換檔曲線的形狀參數。
     */
    gears: [
      { powerSeaLevel: 1770 * PS, powerCritical: 1760 * PS, altCritical: 2500 },
      { powerSeaLevel: 1450 * PS, powerCritical: 1600 * PS, altCritical: 5500 },
    ],
    /**
     * 0.5：平飛時的二速全開高度實測 5.8–6.6 km，比無衝壓的 5.5 km 高；模型的極速峰值因此
     * 落在 6.6 km 附近。
     */
    ramEfficiency: 0.5,
  },

  /**
   * 三葉、直徑 3.5 m（Rechlin 諸元表）。
   *
   * 【vRef 38 把爬升對到 17.0 m/s】vRef 34／38／42 的爬升是 +4.5%／0.0%／−4.3%，
   * 極速只差 0.3%。
   *
   * 【靜推力由 figureOfMerit 夾制】η_max·P/vRef 在海平面是 30.1 kN；3.5 m 槳盤吃
   * 1,770 PS 的動量理論理想靜推力是 34.2 kN，0.8 倍是 27.4 kN，所以海平面 8 m/s 以下的
   * 推力被夾在 27.4 kN。驗收裡最慢的是海平面最佳爬升速度 78 m/s，不受影響。
   */
  prop: { diameter: 3.5, etaMax: 0.88, vRef: 38, figureOfMerit: 0.8 },

  /** vne 850 km/h：二手來源（A 系列的值），沒有找到 D-9 手冊的數字 */
  limits: { gPositive: 7.5, gNegative: -3.5, vne: 850 * KMH },

  /** 血量正比於質量：4,300 ÷ 4,427 × 1,000 */
  hp: 970,

  /**
   * 各部位的防護力。1.0 = 基準，扣血 = 傷害 × 部位倍率 ÷ 這裡的值。
   *
   * ```
   *   cockpit  1.15   座椅背板與頭靠鋼板、防彈風擋，與 Bf 109 K-4 同一格
   *   engine   0.95   液冷 Jumo 213，但散熱器是機首的環形散熱器，前方有一圈裝甲環；
   *                   比散熱器在翼下的 Bf 109（0.85）好、比氣冷機（1.20）差
   *   wing     1.00   翼內沒有散熱器也沒有油箱（油箱在座艙下方的機身內）
   *   fuselage 1.00   沒有特別之處
   *   tail     1.00   沒有特別之處
   * ```
   *
   * 裝甲厚度只有二手來源，所以格子取保守的一端。
   */
  protection: {
    cockpit: 1.15, engine: 0.95, tail: 1.00,
    fuselage: 1.00, wingLeft: 1.00, wingRight: 1.00,
  },

  /**
   * 命中盒。機翼三段、尾段三盒；發動機、座艙、機身三盒照網格的逐 z 剖面定界。
   * 重算機翼與尾段：`npx vite-node test/tools/hitbox-emit.probe.ts`
   *
   * ```
   *   機翼正後方投影  1段 6.7(2盒)  2段 5.9  3段 5.2  4段 4.9 …
   *   → 取 3 段（再切一段的改善 < 10%）
   *   尾段切分 |x| = 0.25　正後方 6.0 → 1.4 m²
   *
   *   正投影 m²      正後方  後上方30°  側方90°  正上方
   *   真實外形         4.2     14.4     12.0     26.9
   *   命中盒合計       8.0     22.5     16.7     33.8
   *   放大倍數        1.91×    1.56×    1.40×    1.26×
   * ```
   *
   * 【右側進氣口自成一盒】增壓器進氣口在 +X、伸到 z −0.08，在主發動機盒（到 z −0.50）之後；
   * 少了這一盒，那一塊會被併進右翼第 1 段。
   *
   * 【機首兩挺 MG 131 靠 engine 盒接住】`hitbox-emit` 只把展向落在機翼段範圍內的掛架
   * 併進機翼盒；翼根兩門 MG 151/20（x ±0.70）落在第 1 段裡。
   */
  hitBoxes: [
    makeHitBox('engine', [-0.68, -0.70, -2.90], [0.68, 0.66, -0.50]),     // 整流罩＋環形散熱器＋引擎罩
    makeHitBox('engine', [0.47, 0.03, -0.80], [0.88, 0.32, -0.08]),       // 右側增壓器進氣口
    makeHitBox('cockpit', [-0.33, 0.45, 0.66], [0.33, 0.97, 2.40]),       // 座艙罩與框條
    makeHitBox('fuselage', [-0.63, -0.71, -0.50], [0.63, 0.84, 4.90]),    // 機身＋中央翼
    makeHitBox('tail', [-1.90, 0.15, 5.53], [1.90, 0.30, 6.43]),          // 平尾
    makeHitBox('tail', [-0.27, 0.09, 4.88], [0.27, 1.68, 7.20]),          // 垂尾＋尾錐上半
    makeHitBox('tail', [-0.28, -0.44, 4.57], [0.28, 0.23, 7.16]),         // 尾錐下半
    makeHitBox('wingRight', [0.56, -0.65, -0.72], [2.17, 0.12, 1.92]),    // 右翼第 1 段
    makeHitBox('wingRight', [2.12, -0.48, -0.38], [3.72, 0.03, 1.60]),    // 右翼第 2 段
    makeHitBox('wingRight', [3.68, -0.24, -0.21], [5.27, 0.12, 1.46]),    // 右翼第 3 段
    makeHitBox('wingLeft', [-2.17, -0.65, -0.72], [-0.56, 0.12, 1.92]),   // 左翼第 1 段
    makeHitBox('wingLeft', [-3.72, -0.48, -0.38], [-2.12, 0.03, 1.60]),   // 左翼第 2 段
    makeHitBox('wingLeft', [-5.27, -0.24, -0.21], [-3.68, 0.12, 1.46]),   // 左翼第 3 段
  ],

  /** 機首兩挺 MG 131 ＋ 翼根兩門 MG 151/20，四挺都同調。見 `weapons/fw190.ts` */
  battery: FW190_BATTERY,
  turrets: [],
}

/**
 * 史實驗收值。四項出自 Rechlin 1945-03-02 的同一份報告（見 `FW190` 檔頭），失速是二手。
 */
export const FW190_HISTORICAL: HistoricalReference = {
  // 645–655 @ 4,200 kg，換到 4,300 kg −3
  vmaxAtCritical: { speed: 647 * KMH, altitude: 6600 },
  // 540–550 @ 4,200 kg，換到 4,300 kg −3
  vmaxSeaLevel: 542 * KMH,
  // 散熱器鰓片全開、爬升表速 280 km/h
  climbRateSeaLevel: 17.0,
  /**
   * **二手，沒有一手來源。** 流傳的乾淨失速 174–197 km/h 取中點；`historical.test.ts`
   * 不斷言這一項。美方對繳獲機 FE-121 的評語只有定性的「失速溫和、有抖振預警」。
   */
  stallSpeed: 185 * KMH,
  // 報告寫 10.2 km 時爬升 2.0 m/s；0.5 m/s 的實用升限由同一張圖讀出約 10.8 km
  serviceCeiling: 10800,
  clMax: 2 * (4300 * 9.80665) / (1.225 * 18.3 * (185 * KMH) ** 2),
}
