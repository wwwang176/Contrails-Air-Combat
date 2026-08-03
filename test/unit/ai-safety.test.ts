import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { applySafety, recoveryAltitude } from '../../src/ai/safety'
import { P51D } from '../../src/specs/p51d'
import { DEG } from '../../src/core/math'

/** 讓飛機以 tas 沿 dir 飛，位於 altitude。 */
function diving(altitude: number, tas: number, gammaDeg: number): Aircraft {
  const a = new Aircraft(P51D, altitude, tas)
  const g = gammaDeg * DEG
  const dir = new Vector3(0, Math.sin(g), -Math.cos(g))
  a.state.position.set(0, altitude, 0)
  a.state.velocity.copy(dir).multiplyScalar(tas)
  a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
  a.update(dir, 0.7, 1 / 240)
  return a
}

describe('recoveryAltitude', () => {
  it('水平飛行不需要任何高度', () => {
    expect(recoveryAltitude(200, 0, 6)).toBeCloseTo(0, 9)
  })

  it('俯衝角越大需要越多高度', () => {
    const shallow = recoveryAltitude(200, -20 * DEG, 6)
    const steep = recoveryAltitude(200, -60 * DEG, 6)
    expect(steep).toBeGreaterThan(shallow)
  })

  /**
   * 【這是安全層的核心物理，也是它為什麼要收油門】拉起半徑正比於 V²，
   * 所以速度加倍、所需高度變成四倍。高速俯衝時「拉起來」不夠，還得
   * **減速**才拉得起來——這直接決定了硬接管時的油門政策。
   */
  it('所需高度正比於速度平方', () => {
    const slow = recoveryAltitude(150, -45 * DEG, 6)
    const fast = recoveryAltitude(300, -45 * DEG, 6)
    expect(fast / slow).toBeCloseTo(4, 1)
  })

  it('過載上限越大需要越少高度', () => {
    const weak = recoveryAltitude(200, -45 * DEG, 2)
    const strong = recoveryAltitude(200, -45 * DEG, 6)
    expect(strong).toBeLessThan(weak)
  })

  it('拉不動（nMax ≤ 1）時回傳 Infinity', () => {
    // 【為什麼是 Infinity 而不是一個很大的數】它會流進「離海高度夠不夠」
    // 的比較。用大數的話，在極高空仍然可能通過比較而不介入；Infinity
    // 保證任何有限高度都會觸發。
    expect(recoveryAltitude(200, -45 * DEG, 1)).toBe(Infinity)
    expect(recoveryAltitude(200, -45 * DEG, 0.5)).toBe(Infinity)
  })

  it('爬升時（gamma > 0）不需要高度', () => {
    expect(recoveryAltitude(200, 30 * DEG, 6)).toBeCloseTo(0, 9)
  })
})

describe('applySafety', () => {
  const cmd = createCommand()

  const clean = () => {
    cmd.aimWorld.set(0, -0.7, -0.7).normalize()
    cmd.throttle = 1.1
    cmd.brake = 0
    cmd.firing = true
  }

  /**
   * 【「不誤觸發」與「不漏」同等重要】一個永遠開著的安全層會讓 AI 飛得
   * 很怪，而且沒人會發現原因——它看起來只是「這台 AI 好像不太敢俯衝」。
   */
  it('巡航高度平飛 → 不介入，指令原封不動', () => {
    const a = diving(4000, 180, 0)
    clean()
    const aim = cmd.aimWorld.clone()
    expect(applySafety(a, 0, cmd)).toBe(false)
    expect(cmd.aimWorld.equals(aim)).toBe(true)
    expect(cmd.throttle).toBe(1.1)
    expect(cmd.firing).toBe(true)
  })

  it('巡航高度陡俯衝 → 不介入（高度夠，拉得起來）', () => {
    const a = diving(4000, 250, -60)
    clean()
    expect(applySafety(a, 0, cmd)).toBe(false)
  })

  it('低空陡俯衝 → 介入', () => {
    const a = diving(200, 250, -60)
    clean()
    expect(applySafety(a, 0, cmd)).toBe(true)
  })

  it('介入時瞄準點指向地平線上方', () => {
    const a = diving(200, 250, -60)
    clean()
    applySafety(a, 0, cmd)
    expect(cmd.aimWorld.y).toBeGreaterThan(0)
  })

  it('介入時停火 —— 快撞海了不該還在開火', () => {
    const a = diving(200, 250, -60)
    clean()
    applySafety(a, 0, cmd)
    expect(cmd.firing).toBe(false)
  })

  /**
   * 【脫離向量必須滾轉友善】指揮儀是 bank-to-turn：大坡度時命令「世界
   * 正上方」會要求飛機先滾平再拉，而滾平的過程中高度還在掉。脫離向量
   * 保持當前航向、只把仰角抬起來，指揮儀就能同時滾平與拉起。
   */
  it('脫離向量保持當前航向（水平分量與速度同向）', () => {
    const a = diving(200, 250, -50)
    clean()
    applySafety(a, 0, cmd)
    const velHoriz = new Vector3(a.state.velocity.x, 0, a.state.velocity.z).normalize()
    const aimHoriz = new Vector3(cmd.aimWorld.x, 0, cmd.aimWorld.z).normalize()
    expect(aimHoriz.angleTo(velHoriz)).toBeCloseTo(0, 4)
  })

  it('高速時減速（拉起半徑 ∝ V²，減速才拉得起來）', () => {
    const a = diving(200, 300, -60)
    clean()
    applySafety(a, 0, cmd)
    expect(cmd.brake).toBeGreaterThan(0)
  })

  it('低速時滿油門（防失速），不減速', () => {
    const a = diving(150, 90, -30)
    clean()
    applySafety(a, 0, cmd)
    expect(cmd.brake).toBe(0)
    expect(cmd.throttle).toBeGreaterThan(1)
  })

  it('海面高度不是 0 時一併考慮', () => {
    // 未來加入地形時，seaHeight 會換成該點的地表高度
    const a = diving(200, 250, -60)
    clean()
    expect(applySafety(a, 0, cmd)).toBe(true)
    clean()
    // 同樣的飛機，但「海面」在 −3000 → 其實還很高
    expect(applySafety(a, -3000, cmd)).toBe(false)
  })

  it('連續呼叫不配置：一萬次結果一致', () => {
    const a = diving(200, 250, -60)
    clean()
    applySafety(a, 0, cmd)
    const first = cmd.aimWorld.clone()
    for (let i = 0; i < 10000; i++) {
      clean()
      applySafety(a, 0, cmd)
    }
    expect(cmd.aimWorld.equals(first)).toBe(true)
  })
})
