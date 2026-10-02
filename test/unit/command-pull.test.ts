import { describe, expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { PlayerController } from '../../src/control/PlayerController'
import { createInputState } from '../../src/input/InputState'
import { CommandDelay } from '../../src/ai/delay'
import { applySafety } from '../../src/ai/safety'
import { applyFeel, feelFor } from '../../src/specs/feel'
import { JU87 as HISTORICAL_JU87 } from '../../src/specs/ju87'
import { A6M5 } from '../../src/specs/a6m5'
import { G4M } from '../../src/specs/g4m'

/**
 * # `Command.pull`：強制「滾轉後拉」，不准推頭
 *
 * 只有 AI 寫的一格，與 `upright` 同一個模式，對稱的相反：`upright` 一律推頭（機翼不准翻過去），
 * `pull` 一律翻轉後拉（機翼翻到顛倒、用正過載把機鼻拉下去）。俯衝轟炸的過頂翻轉要它：指揮儀自己
 * 在這個速度與高度下會選推頭（負過載的俯仰率不到正過載的一半，但翻轉那一圈的時間更貴），推頭拉不過垂直。
 *
 * 會壞而且不報錯的地方：指揮儀沒讀它、延遲錯拍、玩家接手時殘留、安全層接管時殘留。
 */

const DT = 1 / 240
const JU87 = applyFeel(HISTORICAL_JU87, feelFor(HISTORICAL_JU87))

describe('Command.pull 的預設值與傳遞', () => {
  it('createCommand 預設是 false', () => {
    expect(createCommand().pull).toBe(false)
  })

  /** 【直通】與 `upright`、`bombing` 同一個理由：它描述的是 AI 自己此刻的狀態 */
  it('有反應延遲時 pull 仍然當步送達', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    input.pull = true
    d.push(input, 0.3, DT, out)
    expect(out.pull).toBe(true)
    input.pull = false
    d.push(input, 0.3, DT, out)
    expect(out.pull).toBe(false)
  })

  it('零延遲也直接複製', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    input.pull = true
    d.push(input, 0, DT, out)
    expect(out.pull).toBe(true)
  })

  /** 【接管要最快的改出】強制翻轉不能綁住安全層 */
  it('撞地接管時關掉 pull', () => {
    const a = new Aircraft(G4M)
    a.state.position.set(0, 40, 0)
    a.state.velocity.set(0, -60, -80)
    const out = createCommand()
    out.pull = true
    expect(applySafety(a, 0, out)).not.toBe('none')
    expect(out.pull).toBe(false)
  })

  it('失速接管時也關掉 pull', () => {
    const a = new Aircraft(G4M, 3000, 30)
    a.state.position.set(0, 3000, 0)
    a.state.velocity.set(0, 0, -30)
    const out = createCommand()
    out.pull = true
    expect(applySafety(a, 0, out)).toBe('stall')
    expect(out.pull).toBe(false)
  })

  /** 【接手僚機時 `Command` 沿用那一席的】玩家不該帶著 AI 的強制翻轉 */
  it('PlayerController 每步把 pull 清成 false', () => {
    const pc = new PlayerController(createInputState())
    const out = createCommand()
    out.pull = true
    pc.update(new Aircraft(A6M5), DT, out)
    expect(out.pull).toBe(false)
  })
})

describe('指揮儀讀 pull', () => {
  /** 平飛的 Ju 87，瞄準點在正下方偏前 60°；跑幾步讓指揮儀做出決定 */
  const decide = (pull: boolean): { pushMode: boolean; roll: number } => {
    const a = new Aircraft(JU87, 1500, 90)
    a.state.position.set(0, 1500, 0)
    a.state.orientation.setFromEuler(new Euler(0, 0, 0, 'YXZ'))
    a.state.velocity.set(0, 0, -90)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
    // 往下 60°、稍微偏右一點（正下方時方位角不定，偏一點讓兩邊不要抖）
    const aim = new Vector3(0.03, -Math.sin(Math.PI / 3), -Math.cos(Math.PI / 3)).normalize()
    for (let i = 0; i < 12; i++) a.update(aim, 0.2, DT, 0, false, false, pull)
    return { pushMode: a.dbg.pushMode, roll: a.dbg.rollCommand }
  }

  it('不加 pull：這個速度下指揮儀選推頭，滾轉指令小', () => {
    const r = decide(false)
    expect(r.pushMode).toBe(true)
    expect(Math.abs(r.roll)).toBeLessThan(1)
  })

  it('加 pull：不推頭，滾轉指令接近 180°（把瞄準點翻到機體上方再拉）', () => {
    const r = decide(true)
    expect(r.pushMode).toBe(false)
    expect(Math.abs(r.roll)).toBeGreaterThan(2.5)
  })

  /** 【pull 與 upright 同時給】upright 優先：機翼放平是投放的硬條件，不能被強制翻轉蓋掉 */
  it('pull 與 upright 同時給時 upright 優先', () => {
    const a = new Aircraft(JU87, 1500, 90)
    a.state.position.set(0, 1500, 0)
    a.state.velocity.set(0, 0, -90)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
    const aim = new Vector3(0.03, -Math.sin(Math.PI / 3), -Math.cos(Math.PI / 3)).normalize()
    for (let i = 0; i < 12; i++) a.update(aim, 0.2, DT, 0, true, false, true)
    expect(a.dbg.pushMode).toBe(true)
  })
})

describe('pull 不准負過載', () => {
  /**
   * 【機翼還沒翻過來的那一段】瞄準點在機腹那一側，俯仰外環的垂直誤差是負的，會要求推桿。
   * 翻轉要的是正過載把機鼻拉下去；推這一下白白吃掉高度，也讓乘員頂著座艙頂。
   * 機體上方向的比力 = (加速度 + 重力補償)·機體上方 / g
   */
  const G0 = 9.80665
  const minLoadFactor = (pull: boolean, upright = false): number => {
    const a = new Aircraft(JU87, 1500, 90)
    a.state.position.set(0, 1500, 0)
    a.state.orientation.setFromEuler(new Euler(0, 0, 0, 'YXZ'))
    a.state.velocity.set(0, 0, -90)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
    const aim = new Vector3(0.03, -Math.sin(Math.PI / 3), -Math.cos(Math.PI / 3)).normalize()
    const up = new Vector3()
    const dv = new Vector3()
    const vPrev = a.state.velocity.clone()
    let min = Infinity
    for (let i = 0; i < 240 * 2; i++) {
      a.update(aim, 0.2, DT, 0, upright, false, pull)
      dv.copy(a.state.velocity).sub(vPrev).divideScalar(DT)
      dv.y += G0
      up.set(0, 1, 0).applyQuaternion(a.state.orientation)
      // 前 0.2 s 的加速度還在從平飛的初值爬升，不計
      if (i > 48) min = Math.min(min, dv.dot(up) / G0)
      vPrev.copy(a.state.velocity)
    }
    return min
  }

  it('加 pull：整段翻轉過載不低於 0', () => {
    expect(minLoadFactor(true)).toBeGreaterThan(-0.05)
  })

  /** 對照組：不加 pull 時指揮儀選推頭，過載本來就是負的——量得到負值才代表上面那條量的是對的東西 */
  it('不加 pull：推頭，過載為負', () => {
    expect(minLoadFactor(false)).toBeLessThan(-0.2)
  })

  /** upright 優先：機翼放平要的就是推頭，pull 的下限不能把它擋成零 */
  it('pull 與 upright 同時給：仍然推頭，過載為負', () => {
    expect(minLoadFactor(true, true)).toBeLessThan(-0.2)
  })
})
