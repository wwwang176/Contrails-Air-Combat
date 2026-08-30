import { describe, it, expect } from 'vitest'
import {
  maxLevelSpeed, maxClimbRate, stallSpeed, serviceCeiling,
} from '../../src/analysis/envelope'
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109K4, BF109K4_HISTORICAL } from '../../src/specs/bf109k4'
import { HE111, HE111_HISTORICAL } from '../../src/specs/he111'
import { B17G, B17G_HISTORICAL } from '../../src/specs/b17g'
import { F6F5, F6F5_HISTORICAL } from '../../src/specs/f6f5'
import type { AircraftSpec, HistoricalReference } from '../../src/specs/types'

const TOLERANCE = 0.05
const KMH = 3.6

/**
 * 兩台戰鬥機的海平面爬升率**用同一個判準**：史實 ±5%。
 *
 * ```
 *   Bf 109 K-4   1,452.9 m/min（−1.16%）
 *   P-51D        1,023.1 m/min（−3.48%）
 * ```
 *
 * 【這裡曾經有一個 P-51D 專用的例外，2026-08-27 移除】那個例外是有號區間
 * [−15%, −12%]，理由寫的是「1,060 m/min 在本模型的螺旋槳模型下物理上
 * 達不到」——推導是：命中 1,060 需要 vRef ≈ 26，而那會讓 V→0 的靜推力
 * 達到動量理論理想值的 1.27 倍，違反致動盤的動量守恆。
 *
 * **那個推導本身沒錯，錯的是它假設了質量是對的。** 真正的成因是 P-51D 的
 * 質量比它的史實表所描述的載重狀態重約 10%：只動質量去反解，爬升／升限／
 * 失速三項各自要求 3,804／3,841／3,906 kg，聚在 2.7% 之內；同樣的反解在
 * K-4 身上散開 10% 且跨在出貨值兩側。失速那一項完全不吃出力，卻和另外
 * 兩項指到同一個地方——這排除了「模型出力不足」的解釋。完整推論寫在
 * `specs/p51d.ts` 的 `mass` 說明裡。
 *
 * 質量由 4,300 改為 3,900 kg 之後，六項驗收全部進 ±5%，而且 `ram`、
 * `oswald`、`alphaCrit` 三項當初為了硬撐升限與失速而推過頭的值都退了回來。
 *
 * 【教訓，留給下一位】「模型物理上做不到」這個結論下得太早。當時所有旋鈕
 * 都在螺旋槳上掃，因為紅的是爬升率；沒有人回頭問「這三項紅的東西是不是
 * 同一個成因」。**多項驗收同時偏向同一邊時，先反解它們指不指向同一個
 * 參數，再去推單一旋鈕的物理極限。**
 */

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

const CASES: {
  spec: AircraftSpec; hist: HistoricalReference
  checks: readonly Check[]
}[] = [
  { spec: P51D, hist: P51D_HISTORICAL, checks: ALL },
  { spec: BF109K4, hist: BF109K4_HISTORICAL, checks: ALL },
  /**
   * 【五項全守，而且質量沒有校準過】四項驗收值出自同一份試飛報告（Patuxent
   * River 1944-09-07、F6F-5 No. 58310、12,420 lb、軍用出力），所以「三項各自
   * 反解要求多重」聚在 1.2% 之內、位置就是試飛重量本身。詳見 `specs/f6f5.ts`
   * 的 `mass`。海平面極速是另一個來源，沒有參與校準，打出 +1.2%。
   */
  { spec: F6F5, hist: F6F5_HISTORICAL, checks: ALL },
  // 極速兩點守死；失速、升限與爬升見 PENDING
  { spec: HE111, hist: HE111_HISTORICAL,
    checks: ['vmaxCritical', 'vmaxSeaLevel', 'peak'] },
  // 極速兩點守死；失速、升限與爬升見 PENDING
  { spec: B17G, hist: B17G_HISTORICAL, checks: ['vmaxCritical', 'vmaxSeaLevel', 'peak'] },
]

describe('L2 史實性能（極速／失速／升限／爬升率 ±5%，並另有比值斷言）', () => {
  for (const { spec, hist, checks } of CASES) {
    const has = (c: Check): boolean => checks.includes(c)
    describe(spec.name, () => {
      it.runIf(has('vmaxCritical'))(`臨界高度 ${hist.vmaxAtCritical.altitude} m 極速`, () => {
        const v = maxLevelSpeed(spec, hist.vmaxAtCritical.altitude)
        expectWithin(v * KMH, hist.vmaxAtCritical.speed * KMH, '臨界高度極速 (km/h)')
      })

      it.runIf(has('vmaxSeaLevel'))('海平面極速', () => {
        expectWithin(maxLevelSpeed(spec, 0) * KMH, hist.vmaxSeaLevel * KMH, '海平面極速 (km/h)')
      })

      it.runIf(has('climb'))('海平面爬升率（史實 ±5%）', () => {
        expectWithin(
          maxClimbRate(spec, 0).rate * 60, hist.climbRateSeaLevel * 60, '海平面爬升率 (m/min)')
      })

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
   * 「109 比 P-51 爬得快多少」決定了每一場交戰，所以它自己是一條護欄，
   * 不只是上面兩條絕對值斷言的副產品。
   *
   * 【為什麼是雙邊 ±5%】兩台的絕對值各自守 ±5%，最壞情況下比值可以差
   * 到約 ±10% 而兩條絕對值斷言都還是綠的。這條把它收回 ±5%，也就是說
   * **兩台的誤差不准往相反方向跑**。實測 +2.40%，餘裕 2.6 點。
   *
   * 【它曾經是單邊的】有一段時間這條寫的是「模型比值必須**大於**史實
   * 比值，且超出不到 +20%」——因為當時 P-51D 的爬升差史實 14.45%，比值
   * 被推到 +15.5%，等式不可能成立。那個成因（質量）已於 2026-08-27 修掉，
   * 所以這條回到它原本該守的形狀。若哪天又要放寬成單邊，請先確認那是
   * 一個裁決，而不是又有一個成因沒查出來。
   */
  it('K-4 對 P-51D 的爬升優勢比值落在史實 ±5%', () => {
    const histRatio = BF109K4_HISTORICAL.climbRateSeaLevel / P51D_HISTORICAL.climbRateSeaLevel
    const modelRatio = maxClimbRate(BF109K4, 0).rate / maxClimbRate(P51D, 0).rate
    // 實測：模型 1.4201、史實 1.3868、+2.40%
    expectWithin(modelRatio, histRatio, 'K-4 ÷ P-51D 海平面爬升比')
  })
})
