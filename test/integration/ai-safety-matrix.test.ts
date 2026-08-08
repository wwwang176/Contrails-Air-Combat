import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { AiController } from '../../src/ai/AiController'
import { recoveryAltitude, DEFAULT_SAFETY } from '../../src/ai/safety'
import { maxLoadFactorAero, stallSpeed } from '../../src/analysis/envelope'
import { PILOT_G_POSITIVE } from '../../src/control/limiters'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import type { AircraftSpec } from '../../src/specs/types'
import { DEG } from '../../src/core/math'

const DT = 1 / 240
const SIM_SECONDS = 20

interface Run {
  /** 全程的最低高度，m */
  minAltitude: number
  /** 安全層介入的總步數 */
  interventions: number
  finite: boolean
}

/**
 * 從指定的初始俯衝狀態跑 AI，回傳全程的最低高度。
 *
 * 【目標放在很遠的地方】這一條測的是**安全層**，不是纏鬥。把目標擺遠，
 * AI 的意圖會落在 approach，轉向不會干擾俯衝恢復的判定；但目標仍然存在，
 * 所以走的是完整的程式路徑而不是「沒有目標」那條捷徑。
 */
function fly(
  spec: AircraftSpec, altitude: number, tas: number, gammaDeg: number, bankDeg: number,
): Run {
  const self = new Aircraft(spec, altitude, tas)
  const g = gammaDeg * DEG
  const dir = new Vector3(0, Math.sin(g), -Math.cos(g))
  self.state.position.set(0, altitude, 0)
  self.state.velocity.copy(dir).multiplyScalar(tas)
  self.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
  // 疊上坡度：繞機首軸滾轉
  const roll = self.state.orientation.clone()
  self.state.orientation.multiply(
    roll.setFromAxisAngle(new Vector3(0, 0, -1), bankDeg * DEG),
  )
  self.prevPosition.copy(self.state.position)
  self.prevOrientation.copy(self.state.orientation)

  const target = new Aircraft(spec, 5000, 180)
  target.state.position.set(0, 5000, -6000)
  target.prevPosition.copy(target.state.position)

  const ai = new AiController()
  ai.target = target
  const cmd = createCommand()

  let minAltitude = altitude
  let interventions = 0
  for (let i = 0; i < SIM_SECONDS * 240; i++) {
    ai.update(self, DT, cmd)
    if (ai.safetyActive) interventions++
    self.update(cmd.aimWorld, cmd.throttle, DT, cmd.brake)
    target.update(new Vector3(0, 0, -1), 0.7, DT)
    minAltitude = Math.min(minAltitude, self.state.position.y)
    if (!Number.isFinite(self.state.position.y)) {
      return { minAltitude: -Infinity, interventions, finite: false }
    }
  }
  return { minAltitude, interventions, finite: true }
}

/**
 * 這個初始條件在 t=0 時，安全層是否**承諾**救得回來。
 *
 * 【為什麼「永不觸海」必須有這道範圍限制】安全層的契約是一句條件句：
 * 「若 `離海高度 > 所需脫離高度`，我把你拉起來」。從一個一開始就低於
 * 所需脫離高度的狀態出發，它沒有承諾過任何事——第一個物理步就已經
 * 太遲了，那不是防護失效，是題目無解。
 *
 * 實測（Task 12 的二分搜尋，記錄於 spec §9）：
 *
 * | 情境 | 閉式 need0 | 本函數的門檻 | 實測最低可恢復 |
 * |---|---|---|---|
 * | 120 m/s / −89° | 236 m | 473 m | 372 m |
 * | 200 m/s / −89° | 624 m | 1056 m | 485 m |
 * | 300 m/s / −89° | 1404 m | 2226 m | 668 m |
 * | 300 m/s / −45° / 坡度 135° | 419 m | 748 m | 301 m |
 *
 * 門檻**始終高於**實測需求（最緊的一組是 120 m/s / −70° / 坡度 135°：
 * 357 對 341），所以 `factor = 1.5` 是夠的：凡是本函數說有空間的，實際
 * 上都拉得起來。這正是下面的斷言要驗的事。
 *
 * 【為什麼閉式解會低估到需要 1.5 倍】實測單一次脫離：過載要 1.4 秒才建立
 * 起來，而且封頂在 5.6 g（迎角被限制在 11.1°），不是閉式解假設的瞬間
 * 6.5 g。實際轉彎率只有理想值的 65%。
 */
function withinContract(
  spec: AircraftSpec, altitude: number, tas: number, gammaDeg: number,
): boolean {
  const nMax = Math.min(maxLoadFactorAero(spec, altitude, tas), PILOT_G_POSITIVE)
  const needed = recoveryAltitude(tas, gammaDeg * DEG, nMax) * DEFAULT_SAFETY.factor
    + DEFAULT_SAFETY.clearance
  return altitude > needed
}

const SPECS: readonly [string, AircraftSpec][] = [['P-51D', P51D], ['Bf 109', BF109G6]]
const ALTITUDES = [300, 600, 1200, 2500] as const
const SPEEDS = [120, 200, 300] as const
const DIVES = [-20, -45, -70, -89] as const
const BANKS = [0, 60, 135] as const

/**
 * 契約內案例的數量下限。
 *
 * 【為什麼需要這一條】上面的斷言以安全層自己的判準劃定範圍，那本身有個
 * 漏洞：一個把所有情況都宣告為「來不及了」的退化防護層可以空洞地通過
 * 全部測試。把契約內的案例數釘住，門檻一旦被灌水就會在這裡紅。
 *
 * 實測 288 組中有 198 組落在契約內（69%）。取 190 留一點浮動空間。
 */
const MIN_IN_CONTRACT = 190

describe('L4-A 安全矩陣 —— 契約內永不觸海', () => {
  for (const [name, spec] of SPECS) {
    for (const alt of ALTITUDES) {
      for (const tas of SPEEDS) {
        for (const dive of DIVES) {
          for (const bank of BANKS) {
            const inContract = withinContract(spec, alt, tas, dive)
            const label = `${name} / ${alt} m / ${tas} m/s / ${dive}° / 坡度 ${bank}°`
            it(`${label}${inContract ? '' : '（契約外：出發時已經來不及）'}`, () => {
              const r = fly(spec, alt, tas, dive, bank)
              // 【契約外也要驗有限】極端姿態下數值爆掉是另一類 bug，
              // 與救不救得回來無關，兩邊都必須排除。
              expect(r.finite).toBe(true)
              if (!inContract) return
              // 【門檻是 0 而不是「安全裕度」】測的是「有沒有撞海」這件事實，
              // 不是「有沒有守住我們自己訂的裕度」——後者只是在測常數。
              expect(r.minAltitude).toBeGreaterThan(0)
            })
          }
        }
      }
    }
  }

  it(`契約內案例不少於 ${MIN_IN_CONTRACT} 組 —— 防止門檻被灌水成空洞測試`, () => {
    let n = 0
    for (const [, spec] of SPECS) {
      for (const alt of ALTITUDES) {
        for (const tas of SPEEDS) {
          for (const dive of DIVES) {
            for (const _bank of BANKS) {
              if (withinContract(spec, alt, tas, dive)) n++
            }
          }
        }
      }
    }
    expect(n).toBeGreaterThanOrEqual(MIN_IN_CONTRACT)
  })
})

/**
 * 低速改出 —— 2026-08-09 的兩段式改出**新開的那一支**的 physics-in-loop 護欄。
 *
 * 【為什麼上面那 288 組蓋不到】它們的速度是 120／200／300 m/s，每一格的
 * `nMax` 都在 `n*` 的 **3.3 倍**以上，全部走「與修改前逐位元相同」的單段支。
 * 換句話說：上面那張矩陣證明了「舊行為沒被動到」，卻**一格都沒踩進新行為**。
 *
 * 而新分支在 `1 < nMax < n*` 那一段給出的值**比舊公式小**（實測
 * TAS 200 / −45° / `nMax = 1.1`：2607 → 2070 m，少 20.6%）。那是理想兩段模型
 * 的最佳值沒錯，但「理想模型算得出來」不等於「這台飛機真的在那個高度內拉得
 * 回來」—— 那要真的跑物理才知道。這一組就是在跑物理。
 *
 * 【速度怎麼選】直接指定目標 `nMax`，再由 `tas = Vs(1g) × √nMax` 反推 ——
 * 因為 `nMax = (tas / Vs)²`。0.5 與 0.9 落在「拉不動」那一側，1.1 與 1.3 落在
 * 「拉得動但加速更划算」那一段（`n*` 在 −20°／−45°／−70° 分別是
 * 1.119／1.304／1.463）。
 */
describe('L4-A 安全矩陣 —— 低速改出（兩段式的新分支）', () => {
  const LOW_ALTITUDES = [600, 1200, 2500] as const
  /** 目標過載上限。由它反推速度 */
  const LOW_LOADS = [0.5, 0.9, 1.1, 1.3] as const
  const LOW_DIVES = [-20, -45, -70] as const

  /** 這個俯衝角的最佳拉起過載 `n*`，與速度、高度、機種都無關。 */
  function nStarOf(gammaDeg: number): number {
    const c = 1 - Math.cos(Math.abs(gammaDeg * DEG))
    const root = Math.cbrt(2 * c)
    return Math.sqrt(1 + root * root)
  }

  function speedFor(spec: AircraftSpec, alt: number, load: number): number {
    return stallSpeed(spec, alt, 1) * Math.sqrt(load)
  }

  for (const [name, spec] of SPECS) {
    for (const alt of LOW_ALTITUDES) {
      for (const load of LOW_LOADS) {
        for (const dive of LOW_DIVES) {
          const tas = speedFor(spec, alt, load)
          const inContract = withinContract(spec, alt, tas, dive)
          const label = `${name} / ${alt} m / nMax≈${load} / ${dive}°`
          it(`${label}${inContract ? '' : '（契約外）'}`, () => {
            const r = fly(spec, alt, tas, dive, 0)
            expect(r.finite).toBe(true)
            if (!inContract) return
            expect(r.minAltitude).toBeGreaterThan(0)
          })
        }
      }
    }
  }

  /**
   * 【防止這一組空洞化】兩個方向都要守：
   *
   * 一、若哪天門檻被放寬到讓這些格子全變成「契約外」，上面的斷言會整組被
   *     `return` 跳過，看起來還是綠的。
   * 二、若日後有人調整上面的高度／過載／俯衝角清單，或改了機種的失速速度，
   *     這些格子可能悄悄漂出 `nMax < n*` 的範圍，於是這一組就不再是新分支的
   *     護欄了，卻仍然全綠。
   *
   * 【它擋不住什麼】`nStarOf` 是本檔自己算的，所以**實作層**把分界改回
   * `nMax > 1` 這種 mutation 不會在這裡轉紅 —— 那一條由
   * `test/unit/ai-safety.test.ts` 的「回傳的是兩段模型在所有可行拉起速度上的
   * 最小值」守（已用 mutation 驗過）。這一條守的是**題目**有沒有漂掉，
   * 不是實作有沒有壞掉。
   */
  it('這一組真的踩在新分支上，而且真的在契約內', () => {
    let inContract = 0
    let newBranch = 0
    let total = 0
    for (const [, spec] of SPECS) {
      for (const alt of LOW_ALTITUDES) {
        for (const load of LOW_LOADS) {
          for (const dive of LOW_DIVES) {
            total++
            const tas = speedFor(spec, alt, load)
            if (withinContract(spec, alt, tas, dive)) inContract++
            const nMax = Math.min(maxLoadFactorAero(spec, alt, tas), PILOT_G_POSITIVE)
            if (nMax < nStarOf(dive)) newBranch++
          }
        }
      }
    }
    // 實測 72 組全部契約內、66 組走新分支（只有 nMax≈1.3 / −20° 那 6 格
    // 因為 n* = 1.119 < 1.3 而走單段支）。留一點浮動空間
    expect(total).toBe(72)
    expect(inContract).toBeGreaterThanOrEqual(66)
    expect(newBranch).toBeGreaterThanOrEqual(60)
  })
})

describe('L4-A 安全矩陣 —— 不誤觸發', () => {
  /**
   * 【為什麼這個方向同等重要】一個永遠開著的安全層會讓 AI 飛得很怪，
   * 而且沒人會發現原因——它看起來只是「這台 AI 好像不太敢俯衝」。
   */
  for (const [name, spec] of SPECS) {
    for (const tas of SPEEDS) {
      it(`${name} / 4000 m / ${tas} m/s 平飛 → 安全層一次都不介入`, () => {
        const r = fly(spec, 4000, tas, 0, 0)
        expect(r.interventions).toBe(0)
      })

      it(`${name} / 4000 m / ${tas} m/s 陡俯衝 → 高度夠，不介入`, () => {
        const r = fly(spec, 4000, tas, -60, 0)
        expect(r.interventions).toBe(0)
      })
    }
  }
})
