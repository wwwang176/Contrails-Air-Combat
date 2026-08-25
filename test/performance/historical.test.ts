import { describe, it, expect } from 'vitest'
import {
  maxLevelSpeed, maxClimbRate, stallSpeed, serviceCeiling,
} from '../../src/analysis/envelope'
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109K4, BF109K4_HISTORICAL } from '../../src/specs/bf109k4'
import { HE111, HE111_HISTORICAL } from '../../src/specs/he111'
import { B17G, B17G_HISTORICAL } from '../../src/specs/b17g'
import type { AircraftSpec, HistoricalReference } from '../../src/specs/types'

const TOLERANCE = 0.05
const KMH = 3.6

/**
 * 海平面爬升率為什麼**兩台用不同的判準**。
 *
 * ```
 *   Bf 109 K-4   史實 ±5%              實測 1,452.9 m/min（−1.16%）
 *   P-51D        有號區間 [−15%, −12%]  實測   907.0 m/min（−14.45%）
 * ```
 *
 * 【P-51D 為什麼不能守 ±5%】它的史實 1,060 m/min 在本模型的螺旋槳模型下
 * **物理上達不到**。η(V) = etaMax·(1 − e^(−V/vRef)) 之下，命中 1,060 需要
 * vRef ≈ 26，此時 T = η(V)·P/V 在 V→0 的極限是 38.5 kN，而 3.4 m 槳盤在
 * 海平面吃下 1,490 hp 的動量理論理想靜推力只有 30.2 kN——即該螺旋槳必須
 * 產生理想值的 **1.27 倍**推力（等於機重的 0.91 倍），違反致動盤的動量
 * 守恆。把所有允許旋鈕推到物理極限（cd0 = 0.014 下限、oswald = 1.0、
 * figureOfMerit = 1.0）也只能到 1,029 m/min，且會讓 7,600 m 極速超標 10%。
 * 詳細數據見 task-14-report.md §4。這一項到今天為止沒有變。
 *
 * 【109 為什麼從區間搬到 ±5%——這是護欄重新定值】
 *
 * 2026-08-07 到 2026-08-24 之間，109（當時是 G-6）**也**待在這個區間裡，
 * 而且是刻意的：既然 P-51D 只能到 −14.5%，就把 109 同步降 14.5%，換取
 * 正確的**相對關係**。當時的理由寫得很直白——「絕對爬升率兩機同時低
 * 14.5% 玩家感覺不出來，但『109 比 P-51 爬得快多少』決定了每一場交戰」。
 *
 * 2026-08-25，專案負責人在把 109 換成 K-4 的同一輪裁決：**「海平面爬升要
 * 跟上史實」**。這推翻了上面那個取捨。K-4 於是改守自己的絕對值，P-51D
 * 留在原地，相對關係因此跑掉：
 *
 * ```
 *                        模型      史實      偏差
 *   K-4 ÷ P-51D 爬升比   1.6022   1.3868   +15.5%
 * ```
 *
 * **遊戲裡的 K-4 對 P-51D 的爬升優勢比史實再多 15.5%。** 這不是調參失手，
 * 是負責人在知道代價的情況下選的。下方的比值斷言因此從「必須等於史實
 * 比值」改成「必須大於史實比值，且不准再往上飄」——它守的性質變了，
 * 但沒有被刪掉。
 *
 * 【如果哪天要復原】把 specs/bf109k4.ts 的 vRef 由 50 調回 55.7，K-4 的
 * 爬升會回到 1,371 m/min（−6.70%，這條 ±5% 會紅），比值回到 1.512。
 * 注意 G-6 時代的 1.085 已經對不回來了——K-4 的發動機本來就多 525 匹。
 */

/**
 * **P-51D 專用**的海平面爬升率允許區間 [−15%, −12%]。
 *
 * 刻意做成**單邊有號**而非 ±15%：實測誤差是 −14.449%，偏低的方向是那次
 * 裁決的內容本身。若寫成雙邊 ±15%，一次把爬升率調到 **+14%**（高於史實）
 * 的迴歸也會通過——那顯然不是我們想允許的。
 *
 * 【2026-08-25 起只剩 P-51D 用它】109 已改為守 ±5%，見上方說明。
 */
const CLIMB_BAND = { min: -0.15, max: -0.12 }

function expectClimbInBand(actual: number, expected: number, label: string) {
  const err = (actual - expected) / expected
  if (err < CLIMB_BAND.min || err > CLIMB_BAND.max) {
    throw new Error(
      `${label}：實測 ${(actual * 60).toFixed(2)} m/min，史實 ${(expected * 60).toFixed(2)} m/min，` +
      `相對誤差 ${(err * 100).toFixed(2)}% 落在允許區間 ` +
      `[${CLIMB_BAND.min * 100}%, ${CLIMB_BAND.max * 100}%] 之外。` +
      `P-51D 的史實爬升率在本模型下物理上達不到，理由見本檔案上方說明。`,
    )
  }
  expect(err).toBeGreaterThanOrEqual(CLIMB_BAND.min)
  expect(err).toBeLessThanOrEqual(CLIMB_BAND.max)
}

function expectWithin(actual: number, expected: number, label: string, tol = TOLERANCE) {
  const err = Math.abs(actual - expected) / expected
  if (err > tol) {
    throw new Error(
      `${label}：實測 ${actual.toFixed(2)}，史實 ${expected.toFixed(2)}，` +
      `誤差 ${(err * 100).toFixed(1)}% 超過 ±${tol * 100}%`,
    )
  }
  expect(err).toBeLessThanOrEqual(tol)
}

/**
 * 五項判準的名字。`CASES` 的 `checks` 逐機列出「這一台守哪幾項」。
 *
 * 【為什麼不是每台都守五項】兩台戰鬥機守滿五項（2026-08-07 那一輪把係數
 * 全部掃過）。兩台轟炸機是 2026-08-20 才第一次對史實校準的，還有四項落在
 * 5.6%–9.5%，超過 ±5% 但不到需要重做模型的程度。
 *
 * **沒有為了讓它們變綠而放寬門檻** —— 護欄重新定值是專案負責人的決定。
 * 這裡的做法是：對得上的**現在就守死**，對不上的逐條寫明「量到多少、為什麼
 * 還沒對上、要動哪個參數才會動」，讓下一位知道那不是沒人看過，是看過而且
 * 量過了。清單見下方 `PENDING`。
 */
type Check = 'vmaxCritical' | 'vmaxSeaLevel' | 'climb' | 'stall' | 'ceiling' | 'peak'

const ALL: readonly Check[] = [
  'vmaxCritical', 'vmaxSeaLevel', 'climb', 'stall', 'ceiling', 'peak']

/**
 * 兩台轟炸機**還沒守住**的四項，連同 2026-08-20 的實測偏差。
 *
 * 【He 111 的升限是這一輪**新降級**的】專案負責人裁定「5,000 m 極速與海平面
 * 爬升都要提高，可以超過史實」。那兩項各自的旋鈕（`powerCritical` 與
 * `powerSeaLevel`）都會連帶抬高升限，而升限只剩 1.5 點餘裕：
 *
 * ```
 *                 前      後
 *   5,000 m 極速  −3.6%   −0.1%   ← 目標達成，仍守死
 *   海平面爬升   −13.0%   +0.0%   ← 目標達成，本來就不斷言
 *   實用升限      +3.5%   +8.9%   ← 代價，由守死降級成 PENDING
 * ```
 *
 * **這是把一條護欄拿掉，不是調參沒調到位。** 拿掉的理由是負責人的取捨
 * （高空性能優先於升限的絕對值），不是因為做不到 —— 做得到，代價是那兩項
 * 回到原本的偏差。要復原就是把 `powerSeaLevel` 退回 2,680、
 * `powerCritical` 退回 2,216。
 *
 * ```
 *   He 111  實用升限      +8.9%   見上方
 *   He 111  失速          +5.6%   derivedClMax 1.313 對 HE111_HISTORICAL.clMax
 *                                 的 1.55 差 15%。要動 alphaCrit／clAlpha，
 *                                 而那兩個現在都貼著升力線理論值
 *   B-17G   失速          +7.3%   同上：derivedClMax 1.429 對 1.42 幾乎剛好，
 *                                 但史實的 145 km/h 要求 1.833 —— 那是**放
 *                                 襟翼**的值，淨形對不上是應該的
 *   B-17G   升限          −9.5%   質量取 22,000（負責人在 19,017 與 24,500
 *                                 之間裁定的中間值）。19,017 時是 −0.1%
 * ```
 *
 * 爬升率兩台都**不斷言**：史實值一個是「到 2,000 m 約 8.5 分」的平均值換算、
 * 一個是「到 20,000 ft 約 37 分 → 2.7，海平面較高，取 4.5」猜的，來源撐不起
 * 任何精度。實測 He 111 −13.0%、B-17G +12.4%（都是未套手感的值）。
 */
const PENDING = ['He111 升限', 'He111 失速', 'B17G 失速', 'B17G 升限'] as const

/**
 * 爬升率的判準。`'band'` = P-51D 的有號區間，`'strict'` = 一般的 ±5%。
 *
 * 【為什麼做成欄位而不是「109 特判」】兩台的判準不同是一個**會再變**的
 * 裁決（2026-08-25 剛翻過一次）。寫成欄位的話下一次改判只要動一個字，
 * 而且新機種加進來時看得到這個選擇存在。
 */
type ClimbMode = 'band' | 'strict'

const CASES: {
  spec: AircraftSpec; hist: HistoricalReference
  checks: readonly Check[]; climbMode?: ClimbMode
}[] = [
  { spec: P51D, hist: P51D_HISTORICAL, checks: ALL, climbMode: 'band' },
  { spec: BF109K4, hist: BF109K4_HISTORICAL, checks: ALL, climbMode: 'strict' },
  // 極速兩點守死；失速、升限與爬升見 PENDING
  { spec: HE111, hist: HE111_HISTORICAL,
    checks: ['vmaxCritical', 'vmaxSeaLevel', 'peak'] },
  // 極速兩點守死；失速、升限與爬升見 PENDING
  { spec: B17G, hist: B17G_HISTORICAL, checks: ['vmaxCritical', 'vmaxSeaLevel', 'peak'] },
]

describe('L2 史實性能（極速／失速／升限 ±5%，爬升率 [−15%, −12%] 並另有比值斷言）', () => {
  for (const { spec, hist, checks, climbMode } of CASES) {
    const has = (c: Check): boolean => checks.includes(c)
    describe(spec.name, () => {
      it.runIf(has('vmaxCritical'))(`臨界高度 ${hist.vmaxAtCritical.altitude} m 極速`, () => {
        const v = maxLevelSpeed(spec, hist.vmaxAtCritical.altitude)
        expectWithin(v * KMH, hist.vmaxAtCritical.speed * KMH, '臨界高度極速 (km/h)')
      })

      it.runIf(has('vmaxSeaLevel'))('海平面極速', () => {
        expectWithin(maxLevelSpeed(spec, 0) * KMH, hist.vmaxSeaLevel * KMH, '海平面極速 (km/h)')
      })

      // 兩台判準不同，理由見檔案上方的說明。
      it.runIf(has('climb'))(
        climbMode === 'band'
          ? '海平面爬升率落在 [−15%, −12%]（史實值在本模型下物理上達不到）'
          : '海平面爬升率（史實 ±5%）',
        () => {
          const rate = maxClimbRate(spec, 0).rate
          if (climbMode === 'band') {
            expectClimbInBand(rate, hist.climbRateSeaLevel, '海平面爬升率')
          } else {
            expectWithin(rate * 60, hist.climbRateSeaLevel * 60, '海平面爬升率 (m/min)')
          }
        },
      )

      it.runIf(has('stall'))('海平面失速速度', () => {
        expectWithin(stallSpeed(spec, 0, 1) * KMH, hist.stallSpeed * KMH, '失速速度 (km/h)')
      })

      it.runIf(has('ceiling'))('實用升限', () => {
        expectWithin(serviceCeiling(spec), hist.serviceCeiling, '實用升限 (m)')
      })

      it.runIf(has('peak'))('極速在臨界高度附近達到峰值', () => {
        const critical = hist.vmaxAtCritical.altitude
        const peak = maxLevelSpeed(spec, critical)
        expect(maxLevelSpeed(spec, critical - 3000)).toBeLessThan(peak)
        expect(maxLevelSpeed(spec, Math.min(critical + 3000, 11000))).toBeLessThan(peak)
      })
    })
  }

  // PENDING 是文件，但讓它進斷言，才不會有人把它刪掉之後沒人發現。
  it('還沒守住的四項有被逐條記錄', () => {
    expect(PENDING).toHaveLength(4)
    const covered = CASES.flatMap(({ spec, checks }) =>
      ALL.filter((c) => !checks.includes(c)).map((c) => `${spec.id}:${c}`))
      // He111 少 climb/stall、B17G 少 climb/stall/ceiling
    expect(covered.sort()).toEqual([
      'b17g:ceiling', 'b17g:climb', 'b17g:stall',
      'he111:ceiling', 'he111:climb', 'he111:stall',
    ])
  })

  /**
   * 【這條斷言在 2026-08-25 換了守護對象，沒有被刪掉】
   *
   * 從 2026-08-07 到 2026-08-24，它守的是「模型比值 = 史實比值」
   *（實測 1.084901 對 1.084906，餘裕約 1,000 倍）。負責人裁決 K-4 的
   * 爬升率改守史實絕對值之後，那個等式在物理上不可能同時成立——因為
   * P-51D 上不去（見檔案上方）。
   *
   * 現在守的是兩件仍然有意義的事：
   *   1. **方向**：K-4 必須爬得比 P-51D 快。這條翻掉就是空戰平衡壞了。
   *   2. **上界**：超出史實比值的幅度不准再往上飄。
   *
   * 目前的偏離幅度是 +15.5%，上界訂在 +20%（餘裕 3.9%）。這個 20% 不是
   * 物理界限，是**行政界限**——它的作用是：下一次有人動 vRef 或動力而
   * 把 K-4 的優勢再推高時，這裡會紅，逼他回來看這段說明、確認那也是一個
   * 裁決而不是順手調的。
   */
  it('K-4 的爬升優勢大於史實比值，且偏離幅度不超過 +20%', () => {
    const histRatio = BF109K4_HISTORICAL.climbRateSeaLevel / P51D_HISTORICAL.climbRateSeaLevel
    const modelRatio = maxClimbRate(BF109K4, 0).rate / maxClimbRate(P51D, 0).rate
    // 實測：模型 1.6022、史實 1.3868、超出 +15.53%
    expect(modelRatio).toBeGreaterThan(histRatio)
    expect(modelRatio).toBeLessThan(histRatio * 1.2)
  })
})
