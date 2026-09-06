import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import {
  applyFeel, GAME_FEEL, HISTORICAL, BOMBER_FEEL, BOMBER_EXCESS_POWER, feelFor,
} from '../../src/specs/feel'
import { maxLevelSpeed, maxClimbRate } from '../../src/analysis/envelope'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { HE111, HE111_HISTORICAL } from '../../src/specs/he111'
import { B17G, B17G_HISTORICAL } from '../../src/specs/b17g'
import type { AircraftSpec, HistoricalReference } from '../../src/specs/types'

const DT = 1 / 240
const FWD = new Vector3(0, 0, -1)

/**
 * 滿舵滾轉 `seconds` 秒累積走過的滾轉角，rad。
 *
 * 【為什麼逐格累積而不是量頭尾夾角】`angleTo` 的值域是 [0, π]，滾過 180°
 * 之後會折回來 —— 滾得**比較快**的那一架反而量到比較小的角度。逐格增量
 * 永遠是小角度，不會折。
 *
 * 【為什麼量角度而不是瞬時角速度】滾轉率要幾十毫秒才建立，取樣單一時刻會
 * 被暫態主導。積分後的角度同時涵蓋「滾得多快」與「多快滾起來」。
 */
function rollTravel(spec: AircraftSpec, seconds: number): number {
  const a = new Aircraft(spec, 4000, 200)
  // 先平飛一段讓配平穩定
  for (let s = 0; s < 240; s++) a.update(FWD, 0.7, DT)

  const prev = new Vector3()
  const now = new Vector3()
  const aim = new Vector3()
  prev.set(0, 1, 0).applyQuaternion(a.state.orientation)
  let travel = 0
  const steps = Math.round(seconds / DT)
  for (let s = 0; s < steps; s++) {
    // 瞄準點放在機首右側 —— 指揮儀是 bank-to-turn，這會要求滿舵右滾。
    // 相對當前姿態算，所以滾過去之後它還在右邊，指令持續有效。
    aim.set(1, 0, -1).normalize().applyQuaternion(a.state.orientation)
    a.update(aim, 0.7, DT)
    now.set(0, 1, 0).applyQuaternion(a.state.orientation)
    travel += prev.angleTo(now)
    prev.copy(now)
  }
  return travel
}

describe('手感係數層', () => {
  it('史實輪廓原封不動地回傳同一個物件', () => {
    // 【同一性而不是相等】史實測試必須跑在**沒有被包裝過**的 spec 上，
    // 否則「這些數字對應真飛機」這個前提就不成立了。
    expect(applyFeel(P51D, HISTORICAL)).toBe(P51D)
    expect(applyFeel(BF109K4, HISTORICAL)).toBe(BF109K4)
  })

  it('滾轉倍率只動 clDa，其餘欄位逐一相同', () => {
    const f = applyFeel(P51D, { roll: 1.2, oswald: 1, power: 1, lift: 1, cd0: 1, mass: 1 })
    expect(f.moments.clDa).toBeCloseTo(P51D.moments.clDa * 1.2, 12)
    expect(f.id).toBe(P51D.id)
    // 其餘力矩導數不動
    for (const k of ['cm0', 'cmAlpha', 'cmQ', 'cmDe', 'clBeta', 'clP', 'cnBeta',
      'cnR', 'cnDr'] as const) {
      expect(f.moments[k]).toBe(P51D.moments[k])
    }
    // 其餘子結構共用同一個物件（沒有被意外複製或改動）
    expect(f.wing).toBe(P51D.wing)
    expect(f.drag).toBe(P51D.drag)
    expect(f.engine).toBe(P51D.engine)
    expect(f.prop).toBe(P51D.prop)
    expect(f.limits).toBe(P51D.limits)
    expect(f.controlStiffening).toBe(P51D.controlStiffening)
  })

  it('不修改傳入的 spec', () => {
    const before = P51D.moments.clDa
    applyFeel(P51D, { roll: 1.5, oswald: 1, power: 1, lift: 1, cd0: 1, mass: 1 })
    expect(P51D.moments.clDa).toBe(before)
  })

  it('滾轉倍率真的滾得比較快', () => {
    const base = rollTravel(P51D, 1.5)
    const fast = rollTravel(applyFeel(P51D, GAME_FEEL), 1.5)
    expect(fast).toBeGreaterThan(base)
    // 穩態滾轉率 p = (clDa / −clP)·(2V/b) 對 clDa 是線性的，所以滾轉角
    // 大致等比。暫態與指揮儀的限幅讓它不會剛好 1.20
    expect(fast / base).toBeGreaterThan(1.1)
    expect(fast / base).toBeLessThan(1.3)
  })

  /**
   * 高速滾轉是 P-51 對 Bf 109 的招牌優勢（`relative.test.ts` 有史實斷言），
   * 手感係數不該把它抹平或放大。
   *
   * 【為什麼容差是 5% 而不是「相等」】穩態滾轉率對 `clDa` 是嚴格線性的，
   * 所以同一個倍率**在穩態下**完全不改變比值。但 1.5 秒的積分裡有暫態，
   * 而兩機的副翼高速變重程度差很多（`aileronK` 0.35 對 109 的高得多），
   * 滾得比較快的一方先進入飽和 —— 實測比值由 1.772 變成 1.829（+3.2%）。
   *
   * 這個 3.2% **不是實作可以消掉的**，換任何縮放位置都會有；寫成「相等」
   * 只會逼下一個人去放寬它。直接把意圖寫成「相對變化 5% 以內」。
   */
  it('兩台一起套用時，機種之間的相對強弱維持在 5% 以內', () => {
    const ratioBase = rollTravel(P51D, 1.5) / rollTravel(BF109K4, 1.5)
    const ratioFeel = rollTravel(applyFeel(P51D, GAME_FEEL), 1.5)
      / rollTravel(applyFeel(BF109K4, GAME_FEEL), 1.5)
    expect(Math.abs(ratioFeel / ratioBase - 1)).toBeLessThan(0.05)
  })
})

/**
 * 轟炸機的手感輪廓。守的是**設計的兩個支點**，不是六個數字：
 * 「只動多出來的功率」與「極速不動」。倍率本身要重新裁定時，這四條裡只有
 * 最後一條的區間需要跟著改。
 */
describe('轟炸機另一組手感輪廓', () => {
  it('feelFor 依 role 分流，不靠機種 id 硬編清單', () => {
    expect(feelFor(P51D)).toBe(GAME_FEEL)
    expect(feelFor(BF109K4)).toBe(GAME_FEEL)
    expect(feelFor(HE111)).toBe(BOMBER_FEEL)
    expect(feelFor(B17G)).toBe(BOMBER_FEEL)
  })

  it('只有 power 與 cd0 不同，其餘四項與 GAME_FEEL 逐字相同', () => {
    expect(BOMBER_FEEL.roll).toBe(GAME_FEEL.roll)
    expect(BOMBER_FEEL.oswald).toBe(GAME_FEEL.oswald)
    expect(BOMBER_FEEL.lift).toBe(GAME_FEEL.lift)
    expect(BOMBER_FEEL.mass).toBe(GAME_FEEL.mass)
    expect(BOMBER_FEEL.power).toBeCloseTo(GAME_FEEL.power * BOMBER_EXCESS_POWER, 10)
    expect(BOMBER_FEEL.cd0).toBeCloseTo(GAME_FEEL.cd0 * BOMBER_EXCESS_POWER, 10)
  })

  /**
   * 這一條是整組設計的支點。`V_max³ ∝ power / cd0`，同乘一個因子時比值不變，
   * 所以極速不該動。若日後有人只調其中一項，這裡會先紅。
   */
  it('power 與 cd0 同乘 ⇒ 海平面極速不動（1% 之內）', () => {
    for (const spec of [HE111, B17G]) {
      const a = maxLevelSpeed(applyFeel(spec, GAME_FEEL), 0)
      const b = maxLevelSpeed(applyFeel(spec, BOMBER_FEEL), 0)
      expect(Math.abs(b - a) / a).toBeLessThan(0.01)
    }
  })

  /**
   * 裁定的內容本身：轟炸機的出貨爬升率對史實的倍數，要落在戰鬥機那個
   * 1.89× 附近。不另訂輪廓時是 2.71×／2.94×，會直接超出上界。
   */
  it('出貨爬升倍數落在 [1.7, 2.1]（戰鬥機是 1.89×）', () => {
    const cases: [AircraftSpec, HistoricalReference][] = [
      [HE111, HE111_HISTORICAL], [B17G, B17G_HISTORICAL]]
    for (const [spec, hist] of cases) {
      const r = maxClimbRate(applyFeel(spec, BOMBER_FEEL), 0).rate / hist.climbRateSeaLevel
      expect(r).toBeGreaterThanOrEqual(1.7)
      expect(r).toBeLessThanOrEqual(2.1)
    }
  })
})
