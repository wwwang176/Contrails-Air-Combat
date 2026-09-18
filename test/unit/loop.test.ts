import { describe, it, expect } from 'vitest'
import { FixedStepAccumulator, MAX_FRAME_SECONDS, clampFrameSeconds } from '../../src/core/loop'

function makeLoop(overrides: Partial<{ stepHz: number; maxSubsteps: number; maxFrameSeconds: number }> = {}) {
  return new FixedStepAccumulator({
    stepHz: 240,
    maxSubsteps: 8,
    maxFrameSeconds: 0.25,
    ...overrides,
  })
}

describe('FixedStepAccumulator', () => {
  it('60fps 的一幀跑 4 個 240Hz 子步', () => {
    const loop = makeLoop()
    let count = 0
    loop.advance(1 / 60, () => count++)
    expect(count).toBe(4)
  })

  it('每個子步收到固定的 dt', () => {
    const loop = makeLoop()
    const dts: number[] = []
    loop.advance(1 / 60, (dt) => dts.push(dt))
    for (const dt of dts) expect(dt).toBeCloseTo(1 / 240, 12)
  })

  it('餘數累積到下一幀', () => {
    const loop = makeLoop({ stepHz: 100 })
    let count = 0
    // 每幀 1/60 = 0.016667s，步長 0.01s → 第一幀 1 步（餘 0.006667）
    loop.advance(1 / 60, () => count++)
    expect(count).toBe(1)
    // 第二幀累積至 0.023333 → 2 步
    count = 0
    loop.advance(1 / 60, () => count++)
    expect(count).toBe(2)
  })

  it('回傳的 alpha 為剩餘 accumulator 的比例', () => {
    const loop = makeLoop({ stepHz: 100 })
    const alpha = loop.advance(0.015, () => {})
    // 0.015 跑 1 步後剩 0.005，alpha = 0.005 / 0.01 = 0.5
    expect(alpha).toBeCloseTo(0.5, 10)
  })

  it('子步數受 maxSubsteps 上限限制', () => {
    const loop = makeLoop({ maxSubsteps: 8 })
    let count = 0
    loop.advance(1.0, () => count++) // 1 秒 = 240 步，但上限 8
    expect(count).toBe(8)
  })

  it('觸及子步上限時丟棄剩餘 accumulator，不產生螺旋死亡', () => {
    const loop = makeLoop({ maxSubsteps: 8 })
    loop.advance(1.0, () => {}) // 觸及上限
    let count = 0
    loop.advance(1 / 60, () => count++) // 下一幀應恢復正常
    expect(count).toBe(4)
  })

  it('單幀經過時間被 maxFrameSeconds 夾制', () => {
    const loop = makeLoop({ maxSubsteps: 1000, maxFrameSeconds: 0.25 })
    let count = 0
    loop.advance(10, () => count++) // 分頁切回造成的巨大 dt
    expect(count).toBe(60) // 0.25s × 240Hz
  })

  it('lastSubstepCount 記錄實際子步數', () => {
    const loop = makeLoop()
    loop.advance(1 / 60, () => {})
    expect(loop.lastSubstepCount).toBe(4)
  })

  /**
   * 【畫面那一側跟世界一起慢】煙、火、鏡頭、海浪吃這個值。低於 30 fps 時
   * 物理丟時間，畫面也要丟同樣多，否則特效比世界快
   */
  it('worldSeconds：跟得上時等於這一幀，跟不上時只給子步上限那麼多', () => {
    const loop = makeLoop({ maxSubsteps: 8 })
    expect(loop.worldSeconds(1 / 60)).toBe(1 / 60)
    expect(loop.worldSeconds(1 / 144)).toBe(1 / 144)
    expect(loop.worldSeconds(1 / 20)).toBeCloseTo(8 / 240, 12)
    expect(loop.worldSeconds(10)).toBeCloseTo(8 / 240, 12)
  })

  /** 【長時間平均要與物理一致】差了就是特效與世界的速度又分家 */
  it('worldSeconds 的累計與物理實際跑過的時間一致', () => {
    for (const fps of [20, 30, 60, 144]) {
      const loop = makeLoop({ maxSubsteps: 8 })
      let physics = 0
      let world = 0
      for (let i = 0; i < 600; i++) {
        world += loop.worldSeconds(1 / fps)
        loop.advance(1 / fps, (dt) => { physics += dt })
      }
      expect(Math.abs(world - physics), `${fps} fps`).toBeLessThan(1 / 240 + 1e-9)
    }
  })

  it('setStepHz 變更步長並清空 accumulator', () => {
    const loop = makeLoop()
    loop.advance(0.003, () => {}) // 不足一步，留下餘數
    loop.setStepHz(120)
    expect(loop.stepSeconds).toBeCloseTo(1 / 120, 12)
    let count = 0
    loop.advance(1 / 120, () => count++)
    expect(count).toBe(1) // 若未清空 accumulator 會變成 2
  })
})

describe('clampFrameSeconds', () => {
  /**
   * 【分頁切回來那一幀】背景分頁的 requestAnimationFrame 整個暫停，回來的
   * 第一幀帶著整段離開的秒數。沒夾的話機庫的開火、拋彈、搖晃與鏡頭會一口氣
   * 走完那段時間。
   */
  it('分頁切回來那一幀被夾到上限', () => {
    expect(clampFrameSeconds(300)).toBe(MAX_FRAME_SECONDS)
  })

  it('正常的一幀原封不動', () => {
    expect(clampFrameSeconds(1 / 60)).toBe(1 / 60)
  })

  /**
   * 換機種那一幀要建整台幾何，實測 40…90 ms。夾到它的話機庫在換機種時會
   * 整頁慢動作一下。
   */
  it('換機種那種 90 ms 的長幀不夾', () => {
    expect(clampFrameSeconds(0.09)).toBe(0.09)
  })

  it('可以指定自己的上限', () => {
    expect(clampFrameSeconds(1, 0.5)).toBe(0.5)
  })
})
