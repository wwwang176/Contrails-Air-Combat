import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { batteryDps, mountDirection } from '../../src/weapons/types'
import { stepCadence } from '../../src/weapons/cadence'
import { M2_BROWNING, P51D_BATTERY } from '../../src/weapons/p51d'
import { BF109G6_BATTERY, MG131, MG151_20 } from '../../src/weapons/bf109g6'

/**
 * L2 史實值：資料表本身就是被測物，與 M1 的 specs.test.ts 同一個模式。
 * 這些數字若被「調參」動過，這裡就該紅。
 */
describe('L2 武器史實值', () => {
  it('M2 Browning .50 cal：887 m/s、800 rpm、機翼 6 挺', () => {
    expect(M2_BROWNING.muzzleVelocity).toBe(887)
    expect(M2_BROWNING.roundsPerMinute).toBe(800)
    expect(P51D_BATTERY.mounts).toHaveLength(6)
    expect(P51D_BATTERY.mounts.every((m) => m.weapon === M2_BROWNING)).toBe(true)
  })

  it('MG 151/20：705 m/s、700 rpm、單挺穿槳轂', () => {
    expect(MG151_20.muzzleVelocity).toBe(705)
    expect(MG151_20.roundsPerMinute).toBe(700)
    const axial = BF109G6_BATTERY.mounts.filter((m) => m.weapon === MG151_20)
    expect(axial).toHaveLength(1)
    // 穿槳轂＝在中軸線上
    expect(axial[0]!.position.x).toBe(0)
  })

  it('MG 131：750 m/s、900 rpm、機首左右各一', () => {
    expect(MG131.muzzleVelocity).toBe(750)
    expect(MG131.roundsPerMinute).toBe(900)
    const cowl = BF109G6_BATTERY.mounts.filter((m) => m.weapon === MG131)
    expect(cowl).toHaveLength(2)
    expect(cowl[0]!.position.x).toBeCloseTo(-cowl[1]!.position.x, 9)
  })

  it('P-51 的六挺翼槍左右對稱，而且真的在機翼上', () => {
    const xs = P51D_BATTERY.mounts.map((m) => m.position.x).sort((a, b) => a - b)
    for (let i = 0; i < 3; i++) expect(xs[i]).toBeCloseTo(-xs[5 - i]!, 9)
    // 離中軸線超過機身半寬（0.45），否則就不是翼槍了
    expect(Math.min(...xs.map(Math.abs))).toBeGreaterThan(0.5)
  })
})

/**
 * L3 平衡：守的是**相對關係**，不是絕對值（spec §6.3 明示數值可調）。
 */
describe('L3 火力平衡的相對關係', () => {
  it('MG 151/20 的單發傷害顯著高於 .50 BMG', () => {
    expect(MG151_20.damage).toBeGreaterThan(M2_BROWNING.damage * 3)
  })

  it('Bf 109 的總 DPS 高於 P-51', () => {
    expect(batteryDps(BF109G6_BATTERY)).toBeGreaterThan(batteryDps(P51D_BATTERY))
  })

  it('DPS 對得上 spec §6.3 的表（P-51 480、109 627）', () => {
    expect(batteryDps(P51D_BATTERY)).toBeCloseTo(480, 0)
    expect(batteryDps(BF109G6_BATTERY)).toBeCloseTo(626.67, 1)
  })
})

describe('mountDirection（匯聚幾何）', () => {
  const out = new Vector3()

  it('射向只在橫向匯聚，縱向與瞄準線平行', () => {
    // 【偏離 spec §5.3 字面的理由】沒有重力，縱向也匯聚的話超過 300 m
    // 之後彈道會爬到瞄準線上方——實測 750 m 尾追整串從目標上方飛過，0 命中。
    for (let i = 0; i < P51D_BATTERY.mounts.length; i++) {
      mountDirection(P51D_BATTERY, i, out)
      expect(out.y).toBe(0)
      expect(out.length()).toBeCloseTo(1, 12)
    }
  })

  /**
   * 某一挺在「機體座標 z = −range 的平面」上偏離中軸線多少。
   *
   * 【注意 s 的算法】匯聚點是機體座標的 (0, 0, −convergence)，而槍口本身
   * 已經在 z ≈ −0.9 了。所以要走到 z = −range 的平面，前進量是
   * `(range + p.z) / |out.z|`，不是 `range / |out.z|`——後者會多走一個
   * 槍口的縱向位置，六挺在匯聚點上就對不齊（實測殘差 4 mm）。
   */
  const offsetAt = (battery: typeof P51D_BATTERY, i: number, range: number): number => {
    const p = battery.mounts[i]!.position
    mountDirection(battery, i, out)
    const s = (range + p.z) / -out.z
    return p.x + out.x * s
  }
  const spreadAt = (battery: typeof P51D_BATTERY, range: number): number => {
    let worst = 0
    for (let i = 0; i < battery.mounts.length; i++) {
      worst = Math.max(worst, Math.abs(offsetAt(battery, i, range)))
    }
    return worst
  }

  it('走到匯聚平面時，六挺的橫向位置全部收斂到 0', () => {
    for (let i = 0; i < P51D_BATTERY.mounts.length; i++) {
      expect(offsetAt(P51D_BATTERY, i, P51D_BATTERY.convergence)).toBeCloseTo(0, 9)
    }
  })

  it('彈著散佈在 300 m 最密，太近與太遠都變差', () => {
    expect(spreadAt(P51D_BATTERY, 300)).toBeLessThan(0.01)
    expect(spreadAt(P51D_BATTERY, 100)).toBeGreaterThan(1.0)
    expect(spreadAt(P51D_BATTERY, 500)).toBeGreaterThan(1.0)
    expect(spreadAt(P51D_BATTERY, 750)).toBeGreaterThan(spreadAt(P51D_BATTERY, 500))
  })

  it('109 的軸心武裝在遠距離的散佈遠小於 P-51 的翼槍', () => {
    // 史實優勢從資料自然落出來：軸心武裝任何距離都不必修正匯聚。
    // 用**相對關係**而不是絕對門檻——絕對值隨槍位微調而變，相對關係才是
    // 這一條要守的東西（實測 750 m：109 為 0.30 m、P-51 為 3.10 m）。
    expect(spreadAt(BF109G6_BATTERY, 750))
      .toBeLessThan(spreadAt(P51D_BATTERY, 750) / 5)
    expect(spreadAt(BF109G6_BATTERY, 750)).toBeLessThan(0.5)
  })
})

describe('stepCadence', () => {
  const DT = 1 / 240

  it('扣下扳機的第一步立刻擊發（不吃掉第一發）', () => {
    const cd = new Float32Array(1)
    expect(stepCadence(cd, 0, 800, true, DT)).toBe(1)
  })

  it('持續扣扳機一秒，發數等於 rpm/60（含 t=0 那一發）', () => {
    const cd = new Float32Array(1)
    let shots = 0
    for (let i = 0; i < 240; i++) shots += stepCadence(cd, 0, 800, true, DT)
    expect(shots).toBe(14)   // t = 0, 0.075, …, 0.975 共 14 發
  })

  it('三秒的平均射速收斂到標稱值', () => {
    const cd = new Float32Array(1)
    let shots = 0
    for (let i = 0; i < 720; i++) shots += stepCadence(cd, 0, 700, true, DT)
    expect(shots / 3).toBeCloseTo(700 / 60, 0)
  })

  it('放開扳機不擊發，且不累積「欠帳」', () => {
    // 若放開時繼續累加，重新扣下的瞬間會一次噴出整段時間的彈量。
    const cd = new Float32Array(1)
    stepCadence(cd, 0, 800, true, DT)
    let shots = 0
    for (let i = 0; i < 240; i++) shots += stepCadence(cd, 0, 800, false, DT)
    expect(shots).toBe(0)
    expect(stepCadence(cd, 0, 800, true, DT)).toBe(1)
  })

  it('連點扳機無法超過標稱射速', () => {
    // 這是「放開歸零」與「放開繼續倒數」的分野：歸零的話點放可以無限快。
    const cd = new Float32Array(1)
    let shots = stepCadence(cd, 0, 800, true, DT)
    // 一秒內以 20 Hz 連點（每 12 步一次）
    for (let i = 1; i < 240; i++) shots += stepCadence(cd, 0, 800, i % 12 === 0, DT)
    expect(shots).toBeLessThanOrEqual(14)
  })

  it('低更新率下一步可擊發多發（不會遺失彈量）', () => {
    // 0.25 s / 0.075 s：t = 0、0.075、0.15、0.225 共 4 發。
    // 【刻意避開 dt 剛好是射擊間隔整數倍的情形】0.3 s 表面上是 4 個間隔，
    // 但 0.075 在二進位浮點下是無限循環，0.075×4 = 0.30000000000000004，
    // 落在 t > 0 那一側——答案會是 4 或 5 全看捨入。那種邊界不該寫進測試。
    const cd = new Float32Array(1)
    expect(stepCadence(cd, 0, 800, true, 0.25)).toBe(4)
  })

  it('各掛架的時鐘互不干擾', () => {
    const cd = new Float32Array(2)
    stepCadence(cd, 0, 800, true, DT)
    expect(cd[1]).toBe(0)
    expect(stepCadence(cd, 1, 800, true, DT)).toBe(1)
  })
})
