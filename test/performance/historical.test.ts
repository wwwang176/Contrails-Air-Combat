import { describe, it, expect } from 'vitest'
import {
  maxLevelSpeed, maxClimbRate, stallSpeed, serviceCeiling,
} from '../../src/analysis/envelope'
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109G6, BF109G6_HISTORICAL } from '../../src/specs/bf109g6'
import type { AircraftSpec, HistoricalReference } from '../../src/specs/types'

const TOLERANCE = 0.05
const KMH = 3.6

/**
 * 海平面爬升率的容差為什麼是 ±15% 而不是 ±5%。
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
 * 所以：絕對值用寬容差（±15%，記錄「兩機都低約 14.5%」這個已知事實），
 * 相對值用緊容差（下方的比值測試）——後者才是真正被守護的性質。
 */
const CLIMB_TOLERANCE = 0.15

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

const CASES: { spec: AircraftSpec; hist: HistoricalReference }[] = [
  { spec: P51D, hist: P51D_HISTORICAL },
  { spec: BF109G6, hist: BF109G6_HISTORICAL },
]

describe('L2 史實性能（極速／失速／升限 ±5%，爬升率 ±15% 並另有比值斷言）', () => {
  for (const { spec, hist } of CASES) {
    describe(spec.name, () => {
      it(`臨界高度 ${hist.vmaxAtCritical.altitude} m 極速`, () => {
        const v = maxLevelSpeed(spec, hist.vmaxAtCritical.altitude)
        expectWithin(v * KMH, hist.vmaxAtCritical.speed * KMH, '臨界高度極速 (km/h)')
      })

      it('海平面極速', () => {
        expectWithin(maxLevelSpeed(spec, 0) * KMH, hist.vmaxSeaLevel * KMH, '海平面極速 (km/h)')
      })

      // 容差 ±15%，理由見檔案上方 CLIMB_TOLERANCE 的說明。
      it('海平面爬升率（±15%，見上方說明：兩機絕對值皆刻意低約 14.5%）', () => {
        expectWithin(
          maxClimbRate(spec, 0).rate, hist.climbRateSeaLevel,
          '海平面爬升率 (m/s)', CLIMB_TOLERANCE,
        )
      })

      it('海平面失速速度', () => {
        expectWithin(stallSpeed(spec, 0, 1) * KMH, hist.stallSpeed * KMH, '失速速度 (km/h)')
      })

      it('實用升限', () => {
        expectWithin(serviceCeiling(spec), hist.serviceCeiling, '實用升限 (m)')
      })

      it('極速在臨界高度附近達到峰值', () => {
        const critical = hist.vmaxAtCritical.altitude
        const peak = maxLevelSpeed(spec, critical)
        expect(maxLevelSpeed(spec, critical - 3000)).toBeLessThan(peak)
        expect(maxLevelSpeed(spec, critical + 3000)).toBeLessThan(peak)
      })
    })
  }

  it('Bf 109 的海平面爬升率優勢與史實比例相符', () => {
    const histRatio = BF109G6_HISTORICAL.climbRateSeaLevel / P51D_HISTORICAL.climbRateSeaLevel
    const modelRatio = maxClimbRate(BF109G6, 0).rate / maxClimbRate(P51D, 0).rate
    // 絕對值兩機皆低約 14.5%（見上方 CLIMB_TOLERANCE 的說明），但相對關係
    // 必須守住——空戰平衡取決於此，玩家感受得到的是這個比值，不是絕對值。
    //
    // 這是本檔案裡唯一「緊」的爬升斷言，也是唯一真正被守護的性質。
    // toBeCloseTo(·, 2) 要求 |模型 − 史實| < 0.005；實測差為 0.00001，
    // 有 500 倍餘裕。反過來，若 109 退回它自己能達成的 1,113 m/min，
    // 比值會是 1.2275，與史實差 0.1426——超出門檻 28 倍，會立刻失敗。
    expect(modelRatio).toBeCloseTo(histRatio, 2)
  })
})
