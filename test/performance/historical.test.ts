import { describe, it, expect } from 'vitest'
import {
  maxLevelSpeed, maxClimbRate, stallSpeed, serviceCeiling,
} from '../../src/analysis/envelope'
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109G6, BF109G6_HISTORICAL } from '../../src/specs/bf109g6'
import { HE111, HE111_HISTORICAL } from '../../src/specs/he111'
import { B17G, B17G_HISTORICAL } from '../../src/specs/b17g'
import type { AircraftSpec, HistoricalReference } from '../../src/specs/types'

const TOLERANCE = 0.05
const KMH = 3.6

/**
 * 海平面爬升率為什麼不用 ±5%，而是下方的有號區間 [−15%, −12%]。
 *
 * 這是**經專案負責人裁決的刻意偏離**，不是調參沒調到位，也不是把測試放寬
 * 來遮蓋失敗。下一位讀到這裡的人請不要再去嘗試把它調回 ±5%——做不到，
 * 原因是物理性的：
 *
 * P-51D 的史實海平面爬升率 1,060 m/min 在本模型的螺旋槳模型下無法達成。
 * η(V) = etaMax·(1 − e^(−V/vRef)) 之下，命中 1,060 需要 vRef ≈ 26，
 * 此時 T = η(V)·P/V 在 V→0 的極限是 38.5 kN，而 3.4 m 槳盤在海平面吃下
 * 1,490 hp 的動量理論理想靜推力只有 30.2 kN——即該螺旋槳必須產生理想值的
 * **1.27 倍**推力（等於機重的 0.91 倍），違反致動盤的動量守恆。
 * 把所有允許旋鈕推到物理極限（cd0 = 0.014 下限、oswald = 1.0、
 * figureOfMerit = 1.0）也只能到 1,029 m/min，且會讓 7,600 m 極速超標 10%。
 * 詳細數據見 task-14-report.md §4。
 *
 * 因此 P-51D 停在 907 m/min（−14.5%）。Bf 109 的 1,150 m/min 本來是**做得到**的
 * （實測可達 1,113 m/min，僅 −3.2%），但若讓它留在那裡，109 的爬升優勢會是
 * +22.6%，而史實只有 +8.5%。這是一款空戰遊戲：絕對爬升率兩機同時低 14.5%
 * 玩家感覺不出來，但「109 比 P-51 爬得快多少」決定了每一場 P-51 對 109 的
 * 交戰。負責人因此裁決以同一比例把 109 減調至 984 m/min，換取正確的相對關係。
 *
 * 所以：絕對值用**有號區間**（下方 CLIMB_BAND，記錄「兩機都低約 14.5%」
 * 這個已知事實，含方向），相對值用緊容差（下方的比值測試）——後者才是
 * 真正被守護的性質。
 */

/**
 * 海平面爬升率的相對誤差允許區間 [−15%, −12%]。
 *
 * 刻意做成**單邊有號**而非 ±15%：實測誤差是 −14.449%（P-51D）與
 * −14.450%（Bf 109），偏低的方向是這次裁決的內容本身。若寫成雙邊 ±15%，
 * 一次把爬升率調到 **+14%**（高於史實）的迴歸也會通過——那顯然不是
 * 我們想允許的。上界 −12% 同時防止「有人偷偷把絕對值調回接近史實、
 * 但破壞了相對關係」的情況（相對關係另有下方的比值斷言把關）。
 */
const CLIMB_BAND = { min: -0.15, max: -0.12 }

function expectClimbInBand(actual: number, expected: number, label: string) {
  const err = (actual - expected) / expected
  if (err < CLIMB_BAND.min || err > CLIMB_BAND.max) {
    throw new Error(
      `${label}：實測 ${(actual * 60).toFixed(2)} m/min，史實 ${(expected * 60).toFixed(2)} m/min，` +
      `相對誤差 ${(err * 100).toFixed(2)}% 落在允許區間 ` +
      `[${CLIMB_BAND.min * 100}%, ${CLIMB_BAND.max * 100}%] 之外。` +
      `本專案刻意讓兩機的絕對爬升率同時偏低約 14.5%，理由見本檔案上方說明。`,
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
 * 兩台轟炸機**還沒守住**的三項，連同 2026-08-20 的實測偏差。
 *
 * He 111 的 5,000 m 極速本來也在這張表上（−6.2%）。第二輪把 `powerCritical`
 * 由 2,120 調到 2,216 之後收到 **−3.6%**，已經升級成守死 —— 理由與代價
 * （升限 −0.9% → +3.5%）寫在 `specs/he111.ts` 的引擎註解裡。
 *
 * ```
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
const PENDING = ['He111 失速', 'B17G 失速', 'B17G 升限'] as const

const CASES: { spec: AircraftSpec; hist: HistoricalReference; checks: readonly Check[] }[] = [
  { spec: P51D, hist: P51D_HISTORICAL, checks: ALL },
  { spec: BF109G6, hist: BF109G6_HISTORICAL, checks: ALL },
  // 極速兩點與升限守死；失速與爬升見 PENDING
  { spec: HE111, hist: HE111_HISTORICAL,
    checks: ['vmaxCritical', 'vmaxSeaLevel', 'ceiling', 'peak'] },
  // 極速兩點守死；失速、升限與爬升見 PENDING
  { spec: B17G, hist: B17G_HISTORICAL, checks: ['vmaxCritical', 'vmaxSeaLevel', 'peak'] },
]

describe('L2 史實性能（極速／失速／升限 ±5%，爬升率 [−15%, −12%] 並另有比值斷言）', () => {
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

      // 允許區間 [−15%, −12%]，理由見檔案上方 CLIMB_BAND 的說明。
      it.runIf(has('climb'))('海平面爬升率落在 [−15%, −12%]（見上方說明：兩機絕對值皆刻意低約 14.5%）', () => {
        expectClimbInBand(
          maxClimbRate(spec, 0).rate, hist.climbRateSeaLevel, '海平面爬升率',
        )
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
    expect(PENDING).toHaveLength(3)
    const covered = CASES.flatMap(({ spec, checks }) =>
      ALL.filter((c) => !checks.includes(c)).map((c) => `${spec.id}:${c}`))
      // He111 少 climb/stall、B17G 少 climb/stall/ceiling
    expect(covered.sort()).toEqual([
      'b17g:ceiling', 'b17g:climb', 'b17g:stall',
      'he111:climb', 'he111:stall',
    ])
  })

  it('Bf 109 的海平面爬升率優勢與史實比例相符', () => {
    const histRatio = BF109G6_HISTORICAL.climbRateSeaLevel / P51D_HISTORICAL.climbRateSeaLevel
    const modelRatio = maxClimbRate(BF109G6, 0).rate / maxClimbRate(P51D, 0).rate
    // 絕對值兩機皆低約 14.5%（見上方 CLIMB_BAND 的說明），但相對關係
    // 必須守住——空戰平衡取決於此，玩家感受得到的是這個比值，不是絕對值。
    //
    // 這是本檔案裡唯一「緊」的爬升斷言，也是唯一真正被守護的性質。
    // toBeCloseTo(·, 2) 要求 |模型 − 史實| < 0.005。
    //   實測：模型 1.084901、史實 1.084906，Δ = −5.0×10⁻⁶ → 約 1,000 倍餘裕。
    //   反向：若 109 退回它自己能達成的 1,113.1 m/min，比值為 1.2275，
    //         Δ = +0.1426 → 超出門檻 28.5 倍，會立刻失敗。
    expect(Math.abs(modelRatio - histRatio)).toBeLessThan(0.005)
    expect(modelRatio).toBeCloseTo(histRatio, 2)
  })
})
