import { DEG } from '../core/math'
import { makeHitBox } from '../world/hit'
import { YAK1B_BATTERY } from '../weapons/yak1b'
import type { AircraftSpec, HistoricalReference } from './types'

const HP = 745.7
const KMH = 1 / 3.6

/**
 * Yak-1B。**只當德 M4 的蘇軍對手用，不給玩家操作**，所以不在 `ALL_SPECS`（遭遇戰與機庫的名單）。
 *
 * ══ 史實表的出處：一份機種資料 ═════════════════════════════
 *
 * ```
 *                          取值        其他來源
 *   戰鬥重量               2,885 kg    2,883 / 2,884 / 2,887
 *   翼面積                 17.15 m²    全部相同
 *   海平面極速（真速）      530 km/h    531
 *   海平面爬升率           17.0 m/s    —
 *   高空極速               592 km/h @ 4,900 m（600 @ 4,500 m）
 *   乾淨失速（指示）        161 km/h    153–169（取中間）
 *   實用升限               10,500 m    10,050 / 10,600
 *   引擎 M-105PF           1,240 hp 海平面、1,200 hp @ 2,700 m
 * ```
 *
 * 【這些不是試飛報告，是機種資料頁】沒有找到單一份附載重與出力狀態的試飛報告，所以沒有
 * 「同一個載重、同一個出力」的保證 —— 各項之間的互相印證只在 1–2% 內（質量四個來源差 4 kg）。
 * 升限三個來源差 5%，取中間值，±5% 的門檻剛好都包得住。
 */
export const YAK1B: AircraftSpec = {
  id: 'yak1b',
  name: 'Yak-1B',
  faction: 'soviet',
  role: 'fighter',

  mass: 2885,

  /**
   * 慣量 —— 沒有實測值，由 P-51D 的迴轉半徑比例外推（與 F4F-4、F6F-5 同法）：
   *   滾轉  0.2536 × 5.00 = 1.268 m   俯仰  0.1627 × 8.48 = 1.380 m   偏航  0.4085 × 4.62 = 1.887 m
   * 乘上 2,885 kg。
   */
  inertia: { pitch: 5494, yaw: 10273, roll: 4639 },

  /**
   * 翼展 10.0 m、翼面積 17.15 m²（真機值；造型檔的平面形積分得 17.03，−0.7%）。
   * 平均氣動弦 1.94 m 是由造型檔的平面形算的（MAC = ∫c² dx ÷ (S/2)）。
   */
  wing: { area: 17.15, span: 10.0, chord: 1.94, oswald: 0.80 },

  /**
   * CL_max 由失速反推：161 km/h（44.7 m/s）、2,885 kg、海平面 →
   *   2W / (ρ S V²) = 2 × 28,292 / (1.225 × 17.15 × 44.7²) = 1.348
   * 推導值 clAlpha × (alphaCrit − alphaZero) = 4.6 × 16.8° = 1.349。
   */
  lift: {
    clAlpha: 4.6,
    alphaZero: -1.2 * DEG,
    alphaCrit: 15.6 * DEG,
    stallBlend: 8 * DEG,
    postStallFactor: 0.6,
    slatAlphaBonus: 0,
    slatDeployAlpha: Infinity,
    slatRetractAlpha: Infinity,
  },

  /**
   * cd0 0.022 由 `envelope` 對高空極速與海平面極速反解（槳與引擎用下面兩格的值）。
   * 五項驗收（高空極速、海平面極速、爬升、升限、失速）全部落在 ±1%：
   *
   * ```
   *            模型      史實      差
   *   4,900 m  592 km/h  592       0.0%
   *   海平面    534       530      +0.8%
   *   爬升     17.0 m/s  17.0      0.0%
   *   升限     10,501 m  10,500    0.0%
   *   失速     160.9      161     −0.1%
   * ```
   *
   * 交叉驗證（沒有參與校準）：2,000 m 568 對 567、4,500 m 595 對 600（IL-2 資料頁）。
   * 唯一對不上的是 3,000 m 的爬升率：模型 16.6 m/s，資料頁 15.0（+10.7%）—— 模型的出力
   * 隨高度爬到 2,700 m 才開始掉，資料頁的爬升率由海平面 17.0 一路單調掉。
   */
  drag: { cd0: 0.022, cdBeta: 0.65, machCrit: 0.72, machDragFactor: 60 },

  side: { cyBeta: -0.75 },

  moments: {
    cm0: 0.02, cmAlpha: -0.85, cmQ: -13, cmDe: 1.15,
    clBeta: -0.09, clP: -0.48, clDa: 0.030,
    cnBeta: 0.11, cnR: -0.14, cnDr: 0.07,
  },

  controlStiffening: { qRef: 10000, aileronK: 0.35, elevatorK: 0.25, rudderK: 0.25 },

  /**
   * M-105PF，單速增壓器：海平面 1,240 hp（2,550 rpm）、2,700 m 臨界 1,200 hp（2,700 rpm）。
   * 衝壓效率 0.6 與同級的 Bf 109 K-4 一樣（小機頭、進氣口在引擎罩下）。
   */
  engine: {
    gears: [
      { powerSeaLevel: 1240 * HP, powerCritical: 1200 * HP, altCritical: 2700 },
    ],
    ramEfficiency: 0.6,
  },

  /**
   * VISh-105SV 三葉定速槳。直徑 2.8 m 是一般資料，**沒有逐筆查證**（造型檔量到槳盤 2.57 m）。
   * etaMax 是上界不是工作值，不能拿它反推 cd0。
   */
  prop: { diameter: 2.8, etaMax: 0.90, vRef: 50, figureOfMerit: 0.8 },

  limits: { gPositive: 8.0, gNegative: -3.5, vne: 720 * KMH },

  /** 正比於質量：P-51D 4,427 kg → 1,000，這一台 2,885 kg → 650 */
  hp: 650,

  /**
   * ```
   *   cockpit  1.10   駕駛員背後與頭部有裝甲板
   *   engine   0.85   **液冷** M-105PF，散熱器與冷卻液管路一發就漏（與 Ju 87、He 111 同）
   *   其餘     1.00
   * ```
   */
  protection: {
    cockpit: 1.10, engine: 0.85, tail: 1.00,
    fuselage: 1.00, wingLeft: 1.00, wingRight: 1.00,
  },

  /**
   * 命中盒 —— **全部由當下的網格量出來**，產生腳本 `test/tools/hitbox-emit.probe.ts`
   * （`ID=yak1b npx vite-node test/tools/hitbox-emit.probe.ts`）。
   *
   * ```
   *   機翼正後方投影  1段 6.9(2盒) 2段 5.2 3段 4.6 4段 4.2 5段 3.9 6段 3.8 ...
   *   → 取 4 段（再切一段的改善 < 10%）
   *   尾段切分 |x| = 0.25
   *
   *   正投影 m²      正後方  後上方30°   側方90°    正上方
   *   真實外形       3.4     11.6       10.2      23.0
   *   拆之後         6.5     19.7       14.7      29.7
   *   放大倍數      1.93×    1.70×      1.44×     1.29×
   * ```
   *
   * 覆蓋率檢查漏網 0 點，兩個槍口都落在自己所在的盒內。
   */
  hitBoxes: [
    makeHitBox('cockpit', [-0.35, 0.40, 0.10], [0.35, 0.80, 2.10]),               // 座艙
    makeHitBox('engine', [-0.55, -0.85, -2.65], [0.55, 0.50, -0.45]),             // 發動機
    makeHitBox('fuselage', [-0.55, -0.95, -0.45], [0.55, 0.65, 5.60]),            // 機身
    makeHitBox('tail', [-1.75, 0.26, 4.23], [1.75, 0.40, 5.22]),                  // 平尾
    makeHitBox('tail', [-0.27, 0.26, 4.20], [0.27, 1.56, 5.87]),                  // 垂尾＋尾錐
    makeHitBox('wingRight', [0.27, -0.80, -0.65], [1.51, -0.08, 2.00]),           // 右翼第 1 段
    makeHitBox('wingRight', [1.46, -0.66, -0.45], [2.70, -0.26, 1.72]),           // 右翼第 2 段
    makeHitBox('wingRight', [2.65, -0.53, -0.27], [3.89, -0.19, 1.45]),           // 右翼第 3 段
    makeHitBox('wingRight', [3.84, -0.39, -0.08], [5.07, -0.15, 1.18]),           // 右翼第 4 段
    makeHitBox('wingLeft', [-1.51, -0.80, -0.65], [-0.27, -0.08, 2.00]),          // 左翼第 1 段
    makeHitBox('wingLeft', [-2.70, -0.66, -0.45], [-1.46, -0.26, 1.72]),          // 左翼第 2 段
    makeHitBox('wingLeft', [-3.89, -0.53, -0.27], [-2.65, -0.19, 1.45]),          // 左翼第 3 段
    makeHitBox('wingLeft', [-5.07, -0.39, -0.08], [-3.84, -0.15, 1.18]),          // 左翼第 4 段
    makeHitBox('tail', [0.18, 0.29, 5.04], [1.63, 0.38, 5.51]),                   // 補漏 1（tail）
    makeHitBox('tail', [-1.63, 0.28, 5.04], [-0.18, 0.37, 5.51]),                 // 補漏 2（tail）
    makeHitBox('fuselage', [-0.10, -0.15, 5.46], [0.10, 0.33, 5.76]),             // 補漏 3（fuselage）
  ],

  battery: YAK1B_BATTERY,
  turrets: [],
}

/** 史實驗收值，出處見 `YAK1B` 檔頭。 */
export const YAK1B_HISTORICAL: HistoricalReference = {
  vmaxAtCritical: { speed: 592 * KMH, altitude: 4900 },
  vmaxSeaLevel: 530 * KMH,
  climbRateSeaLevel: 17.0,
  stallSpeed: 161 * KMH,
  serviceCeiling: 10500,
  // 由失速速度與戰鬥重量反解，見 `lift` 的說明
  clMax: (2 * 2885 * 9.80665) / (1.225 * 17.15 * (161 * KMH) ** 2),
}
