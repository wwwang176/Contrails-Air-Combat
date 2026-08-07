import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { applySafety, flightPathRate, recoveryAltitude, DEFAULT_SAFETY } from '../../src/ai/safety'
import { DEFAULT_STEER } from '../../src/ai/steer'
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

describe('flightPathRate', () => {
  /**
   * 把飛機擺成「以 tas 沿 γ 飛、坡度 φ、過載 n」，然後只讀 `flightPathRate`。
   *
   * 【為什麼不跑 `update`】要驗的是「給定姿態與過載，γ̇ 是多少」這條代數，
   * 跑一步物理會讓過載變成飛機自己算出來的值，就驗不到指定的 n。
   */
  function posed(tas: number, gammaDeg: number, bankDeg: number, n: number): Aircraft {
    const a = new Aircraft(P51D, 4000, tas)
    const g = gammaDeg * DEG
    const dir = new Vector3(0, Math.sin(g), -Math.cos(g))
    a.state.velocity.copy(dir).multiplyScalar(tas)
    a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
    // 繞速度向量滾 φ
    a.state.orientation.multiply(
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), bankDeg * DEG),
    )
    a.diag.loadFactor = n
    return a
  }

  it('平飛 1 G 時航跡角不變', () => {
    expect(flightPathRate(posed(200, 0, 0, 1))).toBeCloseTo(0, 6)
  })

  it('平飛 0 G 是自由落體：γ̇ = −g/V', () => {
    expect(flightPathRate(posed(200, 0, 0, 0))).toBeCloseTo(-9.80665 / 200, 6)
  })

  it('平飛拉 4 G 時航跡角以 g(n−1)/V 上揚', () => {
    expect(flightPathRate(posed(200, 0, 0, 4))).toBeCloseTo(9.80665 * 3 / 200, 6)
  })

  it('90° 坡度時升力完全不進垂直平面，只剩重力', () => {
    // n·cos φ = 0，所以 γ̇ = −g·cos γ / V
    expect(flightPathRate(posed(200, 0, 90, 4))).toBeCloseTo(-9.80665 / 200, 5)
  })

  it('倒飛拉桿會把航跡往下扯', () => {
    // 180° 坡度：升力朝下，n·cos φ = −4
    expect(flightPathRate(posed(200, 0, 180, 4))).toBeCloseTo(9.80665 * -5 / 200, 5)
  })

  it('俯衝時重力項按 cos γ 縮小', () => {
    // γ = −60°，1 G 正拉：γ̇ = g(1 − cos60)/V
    expect(flightPathRate(posed(200, -60, 0, 1))).toBeCloseTo(9.80665 * 0.5 / 200, 5)
  })

  it('速度越快同樣的過載扭轉航跡越慢', () => {
    const slow = flightPathRate(posed(120, 0, 0, 4))
    const fast = flightPathRate(posed(300, 0, 0, 4))
    expect(slow).toBeGreaterThan(fast)
    expect(slow / fast).toBeCloseTo(300 / 120, 5)
  })

  it('速度為零時回 0 而不是 NaN', () => {
    const a = posed(200, 0, 0, 1)
    a.state.velocity.set(0, 0, 0)
    expect(flightPathRate(a)).toBe(0)
  })

  it('垂直俯衝時垂直平面退化，回 0 而不是 NaN', () => {
    // γ = −90°：速度沿 −ŷ，「垂直平面內垂直於速度且朝上」沒有唯一解
    expect(Number.isFinite(flightPathRate(posed(200, -90, 0, 4)))).toBe(true)
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
    expect(applySafety(a, 0, cmd)).toBe('none')
    expect(cmd.aimWorld.equals(aim)).toBe(true)
    expect(cmd.throttle).toBe(1.1)
    expect(cmd.firing).toBe(true)
  })

  it('巡航高度陡俯衝 → 不介入（高度夠，拉得起來）', () => {
    const a = diving(4000, 250, -60)
    clean()
    expect(applySafety(a, 0, cmd)).toBe('none')
  })

  it('低空陡俯衝 → 介入', () => {
    const a = diving(200, 250, -60)
    clean()
    expect(applySafety(a, 0, cmd)).toBe('ground')
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
    expect(applySafety(a, 0, cmd)).toBe('ground')
    clean()
    // 同樣的飛機，但「海面」在 −3000 → 其實還很高
    expect(applySafety(a, -3000, cmd)).toBe('none')
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

/**
 * 失速硬介入 —— 瞄準點層（`steer.ts` 的 `speedRecover`）失職時的最後一道。
 *
 * 【為什麼上下兩層都要】瞄準點層是技巧：它把命令改成壓機頭，但指揮儀能不能
 * 兌現要看舵面權限。這一層是硬限制，門檻更低（1.1 對 1.4），只在技巧失效
 * 之後才動 —— 它每觸發一次，就代表上面那一層失職一次（spec §4.4）。
 */
describe('失速硬介入', () => {
  it('高空低速時介入，並壓機頭', () => {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    // 極低速平飛：speedMargin 遠低於門檻
    a.state.velocity.set(0, 0, -30)
    a.prevPosition.copy(a.state.position)
    const out = createCommand()
    out.aimWorld.set(0, 1, 0)
    out.firing = true
    expect(applySafety(a, 0, out)).toBe('stall')
    expect(out.aimWorld.y).toBeLessThan(0)
    expect(out.firing).toBe(false)
  })

  /**
   * 【撞地優先於失速】兩個安全關切在低空低速時相反：失速要壓頭、撞地要
   * 拉起。撞地優先，因為失速還有機會改出，撞地沒有（spec §4.5）。
   */
  it('同時有撞地風險與失速時，走撞地分支（拉起）', () => {
    const a = new Aircraft(P51D, 150, 200)
    a.state.position.set(0, 150, 0)
    a.state.velocity.set(0, -10, -30)
    a.prevPosition.copy(a.state.position)
    const out = createCommand()
    expect(applySafety(a, 0, out)).toBe('ground')
    expect(out.aimWorld.y).toBeGreaterThan(0)
  })

  it('速度充足且高度充足時不介入', () => {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    a.state.velocity.set(0, 0, -200)
    a.prevPosition.copy(a.state.position)
    const out = createCommand()
    expect(applySafety(a, 0, out)).toBe('none')
  })

  /** 【低速不能收油門】換速度要推力，而且低速時沒有減速的道理。 */
  it('失速介入時滿油門、不減速', () => {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    a.state.velocity.set(0, 0, -30)
    a.prevPosition.copy(a.state.position)
    const out = createCommand()
    applySafety(a, 0, out)
    expect(out.brake).toBe(0)
    expect(out.throttle).toBeGreaterThan(1)
  })

  /** 脫離向量與撞地分支同樣要滾轉友善：保持航向，只改仰角。 */
  it('失速介入時保持當前航向', () => {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    a.state.velocity.set(30, 0, -30)
    a.prevPosition.copy(a.state.position)
    const out = createCommand()
    applySafety(a, 0, out)
    const velHoriz = new Vector3(a.state.velocity.x, 0, a.state.velocity.z).normalize()
    const aimHoriz = new Vector3(out.aimWorld.x, 0, out.aimWorld.z).normalize()
    expect(aimHoriz.angleTo(velHoriz)).toBeCloseTo(0, 6)
  })

  /**
   * 【門檻必須低於瞄準點層】瞄準點層是技巧、這一層是硬限制，硬限制只在
   * 技巧失效時才動。兩者相等會讓兩層同時觸發，硬限制就永遠蓋掉技巧層。
   */
  it('門檻低於瞄準點層的 speedRecoverMargin', () => {
    expect(DEFAULT_SAFETY.stallMargin).toBeLessThan(DEFAULT_STEER.speedRecoverMargin)
  })
})
