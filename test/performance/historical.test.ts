import { describe, it, expect } from 'vitest'
import {
  maxLevelSpeed, maxClimbRate, stallSpeed, serviceCeiling,
} from '../../src/analysis/envelope'
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109K4, BF109K4_HISTORICAL } from '../../src/specs/bf109k4'
import { HE111, HE111_HISTORICAL } from '../../src/specs/he111'
import { B17G, B17G_HISTORICAL } from '../../src/specs/b17g'
import { F6F5, F6F5_HISTORICAL } from '../../src/specs/f6f5'
import { KI84, KI84_HISTORICAL } from '../../src/specs/ki84'
import { A6M5, A6M5_HISTORICAL } from '../../src/specs/a6m5'
import { G4M, G4M_HISTORICAL } from '../../src/specs/g4m'
import type { AircraftSpec, HistoricalReference } from '../../src/specs/types'

const TOLERANCE = 0.05
const KMH = 3.6

/**
 * 三台戰鬥機的海平面爬升率**用同一個判準**：史實 ±5%。
 *
 * ```
 *   Bf 109 K-4   1,452.9 m/min（−1.16%）
 *   P-51D        1,079.2 m/min（−1.65%）
 *   F6F-5          806   m/min（−0.60%）
 * ```
 *
 * ── 【留給下一位的教訓：一個假的「排除證據」】────────────────────
 *
 * P-51D 的爬升曾經差史實 14.45%，當時的結論是「1,060 m/min 在本模型的
 * 螺旋槳模型下物理上達不到」——推導是：命中 1,060 需要 vRef ≈ 26，而那會
 * 讓 V→0 的靜推力達到動量理論理想值的 1.27 倍，違反致動盤的動量守恆。
 * 那個推導本身沒錯。
 *
 * 接著做了質量反解：只動質量，爬升／升限／失速三項各自要求 3,804／3,841／
 * 3,906 kg，聚在 2.7% 之內。**而且失速那一項完全不吃出力** —— 於是它被
 * 當成「排除了模型出力不足」的證據，質量因此由 4,300 校準到 3,900 kg。
 *
 * **那個排除是假的。** 失速那一項只證明「史實表裡那個失速數字屬於一架
 * 3,900 kg 的 P-51」。它跟另外兩項指到同一個地方是巧合 —— 因為那張史實表
 * 本身混了載重狀態：極速／爬升／升限來自 9,760 lb 的試飛（AAF 44-15342），
 * 失速那個數字來自約 8,600 lb。**失速不是速度／爬升那一組的證人。**
 *
 * 真正的成因是 `specs/p51d.ts` 的 `engine.gears` 混了兩個出力狀態：低增壓
 * 檔的海平面填了 61″Hg 的軍用值（1,490 hp）而不是 67″Hg 的 WEP 值，高增壓
 * 檔的臨界也偏低。海平面短少 9.4%、高增壓臨界短少 13.5% —— 剛好就是那
 * 14% 的量。修好之後質量回到試飛重量 4,427 kg，五項全部進 ±5%。
 *
 * 【所以「多項驗收指向同一個參數」要怎麼讀】它成立的前提是**那幾項本來就
 * 屬於同一個載重狀態**。先確認史實表的每一項出自同一份文件，再去反解；
 * 不然反解出來的一致性可能只是兩個錯誤剛好抵銷。F6F-5 那一台從一開始就
 * 只用一份報告，三項反解聚在 1.2% 之內，質量一公斤都不用改。
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
const PENDING: readonly { id: string; check: Check; reason: string }[] = [
  { id: 'he111', check: 'ceiling', reason: '+8.9%。負責人取捨：高空性能優先於升限的絕對值' },
  { id: 'he111', check: 'stall', reason: '+5.6%。derivedClMax 1.313 對史實 1.55 差 15%' },
  { id: 'he111', check: 'climb', reason: '史實值是「到 2,000 m 約 8.5 分」的平均換算，撐不起精度' },
  { id: 'b17g', check: 'ceiling', reason: '−9.5%。質量取 22,000（負責人的中間值）；19,017 時是 −0.1%' },
  { id: 'b17g', check: 'stall', reason: '+7.3%。史實的 145 km/h 是**放襟翼**的值，淨形對不上是應該的' },
  { id: 'b17g', check: 'climb', reason: '史實值是「到 20,000 ft 約 37 分」猜的，撐不起精度' },
  {
    id: 'g4m',
    check: 'stall',
    /**
     * 【這一項的缺口不是資料，是模型】沒有任何來源直接給 G4M 的失速，但
     * **著陸速度有**（モデルアート『日本航空機辞典』129.6 km/h @ 12,500 kg，
     * 原始單位是 70 節），兩條互不相干的路反推得 150.5 km/h、差 0.21%。
     * 詳見 `specs/g4m.ts` 的 `stallSpeed`。
     *
     * 不進斷言的理由是**本模型對轟炸機的失速有 5–7% 的系統性偏高**
     *（He 111 +5.6%、B-17G +7.3%），而路徑 B 的錨點正是 He 111。
     * **三台轟炸機同方向偏一樣的量，那本身是一條值得單獨查的線索。**
     *
     * 【2026-09-03 專案負責人裁定：接受，不修】「飛起來 OK，記錄起來不再問。」
     * 那條線索記在 `docs/backlog.md` §1.2 —— 留著是為了下一個人量到同樣的
     * 偏差時不必重查，**不是**一個待辦。
     */
    reason: '失速值是由著陸速度反推的；而且三台轟炸機的失速在本模型裡同方向偏高 5–7%',
  },
]

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
  /**
   * 【主幹是日方三次試飛的平均，不是那個 687 km/h】那個數字從來沒有人量過
   *（1946 年繳獲機報告的數據欄逐字照抄 1945 年的 TAIC 估算表，而同一份報告
   * 第 11 頁寫著「Performance — None obtained」）。專案負責人 2026-09-03
   * 裁決改用日方實測的平均，詳見 `specs/ki84.ts` 的檔頭。
   *
   * 換來源之後兩點反解把 cd0 夾在 0.0212–0.0240，出貨 0.023 落在中間 ——
   * 與 He 111 對照組（0.0202／0.0222，出貨 0.0206）同一個形狀。
   */
  { spec: KI84, hist: KI84_HISTORICAL, checks: ALL },
  /**
   * 【主幹走日方栄二一型，不走 TAIC 102D】理由不是精度是引擎：TAIC 認定的
   * Sakae 31A 二速全開高度是 6,584 m，栄二一型是 6,000 m，差 584 m —— 而
   * `peak` 那一條守的正是峰值落在哪裡。詳見 `specs/a6m5.ts` 的檔頭。
   *
   * 三項跨源（海面極速、海面爬升、失速），逐條標在 `A6M5_HISTORICAL`。
   */
  { spec: A6M5, hist: A6M5_HISTORICAL, checks: ALL },
  // 極速兩點守死；失速、升限與爬升見 PENDING
  { spec: HE111, hist: HE111_HISTORICAL,
    checks: ['vmaxCritical', 'vmaxSeaLevel', 'peak'] },
  // 極速兩點守死；失速、升限與爬升見 PENDING
  { spec: B17G, hist: B17G_HISTORICAL, checks: ['vmaxCritical', 'vmaxSeaLevel', 'peak'] },
  /**
   * 【守五項，只有失速進 PENDING】它的來源品質比另外兩台轟炸機好得多 ——
   * 空技廠那份文件給的是一條**從海平面到 8,000 m 的完整速度曲線**（11 個
   * 高度），升限與極速同源同重量，所以 `ceiling` 也守死。
   *
   * 爬升由專案負責人 2026-09-03 裁決進斷言（史實值是「到 3,000 m 的平均」
   * 反算的，見 `specs/g4m.ts`）。
   */
  {
    spec: G4M,
    hist: G4M_HISTORICAL,
    checks: ['vmaxCritical', 'vmaxSeaLevel', 'climb', 'ceiling', 'peak'],
  },
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

  /**
   * PENDING 是文件，但讓它進斷言，才不會有人把它刪掉之後沒人發現。
   *
   * 【由 `checks` 算出「誰沒守」，再要求 `PENDING` 逐項對得上】上一版是
   * 兩份手維護的清單（一個字串陣列、一個寫死的預期值），加一台新機種時
   * **兩邊都要記得改，漏一邊才會紅**。改成從 `CASES` 推導之後，漏填會直接
   * 指出是哪一台的哪一項（Codex 審查 2026-09-03 P0）。
   */
  it('每一個沒守住的項目都有逐條記錄，而且沒有多記', () => {
    const covered = CASES.flatMap(({ spec, checks }) =>
      ALL.filter((c) => !checks.includes(c)).map((c) => `${spec.id}:${c}`))
    const recorded = PENDING.map((q) => `${q.id}:${q.check}`)
    expect(recorded.slice().sort()).toEqual(covered.slice().sort())
    // 每一條都要寫「量到多少、為什麼還沒對上」，不是只列個名字
    for (const q of PENDING) expect(q.reason.length, `${q.id}:${q.check}`).toBeGreaterThan(15)
  })

  /**
   * 「109 比 P-51 爬得快多少」決定了每一場交戰，所以它自己是一條護欄，
   * 不只是上面兩條絕對值斷言的副產品。
   *
   * 【為什麼是雙邊 ±5%】兩台的絕對值各自守 ±5%，最壞情況下比值可以差
   * 到約 ±10% 而兩條絕對值斷言都還是綠的。這條把它收回 ±5%，也就是說
   * **兩台的誤差不准往相反方向跑**。實測 +0.49%，餘裕 4.5 點。
   *
   * 【它曾經是單邊的】有一段時間這條寫的是「模型比值必須**大於**史實
   * 比值，且超出不到 +20%」——因為當時 P-51D 的爬升差史實 14.45%，比值
   * 被推到 +15.5%，等式不可能成立。成因見本檔案的檔頭（`engine.gears` 混了
   * 出力狀態），修掉之後這條回到它原本該守的形狀。若哪天又要放寬成單邊，
   * 請先確認那是一個裁決，而不是又有一個成因沒查出來。
   */
  it('K-4 對 P-51D 的爬升優勢比值落在史實 ±5%', () => {
    const histRatio = BF109K4_HISTORICAL.climbRateSeaLevel / P51D_HISTORICAL.climbRateSeaLevel
    const modelRatio = maxClimbRate(BF109K4, 0).rate / maxClimbRate(P51D, 0).rate
    // 實測：模型 1.3463、史實 1.3397、+0.49%
    expectWithin(modelRatio, histRatio, 'K-4 ÷ P-51D 海平面爬升比')
  })
})
