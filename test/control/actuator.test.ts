import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { DEFAULT_ACTUATOR_RATES, slewSurfaces } from '../../src/control/actuator'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import type { Controls } from '../../src/physics/types'

const DT = 1 / 240

const mk = (): Controls => ({ aileron: 0, elevator: 0, rudder: 0, throttle: 0, brake: 0 })

describe('舵面作動速率', () => {
  it('大幅指令被速率夾住，單步最多走 rate·dt', () => {
    const actual = mk()
    const command = { aileron: 1, elevator: -1, rudder: 1, throttle: 0.7, brake: 0 }
    const r = { aileron: 5, elevator: 6, rudder: 4 }
    slewSurfaces(actual, command, r, DT)
    expect(actual.aileron).toBeCloseTo(5 * DT, 12)
    expect(actual.elevator).toBeCloseTo(-6 * DT, 12)
    expect(actual.rudder).toBeCloseTo(4 * DT, 12)
    // 油門不受本機制節流（已由輸入層限速），必須原樣傳遞
    expect(actual.throttle).toBe(0.7)
  })

  it('小幅指令一步到位，不引入額外的滯後', () => {
    // 【為什麼這條重要】若把速率限制寫成一階遲滯（LERP），小訊號也會被
    // 拖慢，等於在 PID 內環裡加入全頻段相位落後，既有的增益整定與離散
    // 穩定性不等式（見 FlightDirector 的「不變量二」）就全部失效。
    // 速率限制是非線性：只在指令跳變大於 rate·dt 時作用，小訊號完全透明。
    const actual = mk()
    const small = DEFAULT_ACTUATOR_RATES.aileron * DT * 0.5
    slewSurfaces(actual, { aileron: small, elevator: 0, rudder: 0, throttle: 0, brake: 0 },
      DEFAULT_ACTUATOR_RATES, DT)
    expect(actual.aileron).toBe(small)
  })

  it('反向指令同樣受限（不會瞬間打到反舵）', () => {
    const actual = { aileron: 1, elevator: 0, rudder: 0, throttle: 0, brake: 0 }
    slewSurfaces(actual, { aileron: -1, elevator: 0, rudder: 0, throttle: 0, brake: 0 },
      DEFAULT_ACTUATOR_RATES, DT)
    expect(actual.aileron).toBeCloseTo(1 - DEFAULT_ACTUATOR_RATES.aileron * DT, 12)
  })

  it('真實輸入路徑下，副翼不再單步由 0 跳到滿舵', () => {
    // 修改前實測：滑鼠一甩，副翼在單一物理步（4.2 ms）內由 0 變 1.000，
    // 等效速率 240 /s。這是使用者試飛時察覺「機翼馬上就有反應」的來源。
    const ac = new Aircraft(P51D, 4000, 220)
    const aim = new Vector3(0, 0, -1)
    // 直接把瞄準點甩到右方 25°，模擬一次到底的滑鼠甩動
    aim.set(Math.sin(25 * (Math.PI / 180)), 0, -Math.cos(25 * (Math.PI / 180))).normalize()

    let prev = 0
    let maxRate = 0
    for (let i = 0; i < Math.round(2 / DT); i++) {
      ac.update(aim, 1.1, DT)
      maxRate = Math.max(maxRate, Math.abs(ac.surfaces.aileron - prev) / DT)
      prev = ac.surfaces.aileron
    }
    // 實際位置的變化率不得超過設定值（浮點餘裕）
    expect(maxRate).toBeLessThanOrEqual(DEFAULT_ACTUATOR_RATES.aileron * 1.001)
    // 而指令本身仍然是瞬時的——證明被夾住的是舵面，不是指揮儀
    expect(Math.abs(ac.controls.aileron)).toBeGreaterThan(0)
  })

  it('換裝機種會清掉舵面實際位置（與 PID 積分項同一類殘留）', () => {
    const ac = new Aircraft(P51D, 4000, 220)
    ac.surfaces.aileron = 0.5
    ac.surfaces.elevator = -0.3
    ac.surfaces.rudder = 0.2
    ac.setSpec(P51D)
    expect(ac.surfaces.aileron).toBe(0)
    expect(ac.surfaces.elevator).toBe(0)
    expect(ac.surfaces.rudder).toBe(0)
  })
})
