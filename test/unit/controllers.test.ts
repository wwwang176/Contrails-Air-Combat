import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { PlayerController } from '../../src/control/PlayerController'
import { MANOEUVRES, ScriptedController } from '../../src/control/ScriptedController'
import { createInputState } from '../../src/input/InputState'
import { P51D } from '../../src/specs/p51d'
import { RAD } from '../../src/core/math'

const DT = 1 / 240

/** 機首方向的水平航向，rad。0 = −Z，順時針為正。 */
function heading(a: Aircraft): number {
  const f = new Vector3(0, 0, -1).applyQuaternion(a.state.orientation)
  return Math.atan2(-f.x, -f.z)
}

/** 把飛機加上控制器跑 seconds 秒。 */
function fly(a: Aircraft, c: ScriptedController, seconds: number): void {
  const cmd = createCommand()
  for (let i = 0; i < seconds * 240; i++) {
    c.update(a, DT, cmd)
    a.update(cmd.aimWorld, cmd.throttle, DT)
  }
}

describe('PlayerController', () => {
  it('把 InputState 原封不動搬進 Command', () => {
    const input = createInputState()
    input.aimWorld.set(0.6, 0, -0.8)
    input.throttle = 0.93
    input.firing = true

    const c = new PlayerController(input)
    const cmd = createCommand()
    c.update(new Aircraft(P51D), DT, cmd)

    expect(cmd.aimWorld.toArray()).toEqual([0.6, 0, -0.8])
    expect(cmd.throttle).toBe(0.93)
    expect(cmd.firing).toBe(true)
  })

  it('複製而不是共用參考 —— 控制器不得反過來改到輸入狀態', () => {
    const input = createInputState()
    const c = new PlayerController(input)
    const cmd = createCommand()
    c.update(new Aircraft(P51D), DT, cmd)
    cmd.aimWorld.set(1, 0, 0)
    expect(input.aimWorld.toArray()).toEqual([0, 0, -1])
  })

  /** 【剛按下才投】持續按著的話，每一次回補完成都會自動再倒一整艙 */
  it('投彈視角下剛按下的那一步寫 bombing，按著不放不再寫', () => {
    const input = createInputState()
    input.viewMode = 'bomb'
    const c = new PlayerController(input)
    const cmd = createCommand()
    const a = new Aircraft(P51D)
    const seq: boolean[] = []
    for (const down of [false, true, true, true, false, true]) {
      input.firing = down
      c.update(a, DT, cmd)
      seq.push(cmd.bombing)
      expect(cmd.firing).toBe(false)
    }
    expect(seq).toEqual([false, true, false, false, false, true])
  })

  it('不在投彈視角時左鍵是機槍，不投彈', () => {
    const input = createInputState()
    input.viewMode = 'third'
    input.firing = true
    const c = new PlayerController(input)
    const cmd = createCommand()
    c.update(new Aircraft(P51D), DT, cmd)
    expect(cmd.bombing).toBe(false)
    expect(cmd.firing).toBe(true)
  })
})

describe('ScriptedController', () => {
  it('四種機動齊全（spec §11）', () => {
    expect([...MANOEUVRES].sort()).toEqual(['climb', 'straight', 'turn', 'weave'])
  })

  it('靶機不開火（spec §11：它的存在是為了驗證 M2，不是為了對戰）', () => {
    const a = new Aircraft(P51D)
    const c = new ScriptedController()
    const cmd = createCommand()
    cmd.firing = true
    c.update(a, DT, cmd)
    expect(cmd.firing).toBe(false)
  })

  it('瞄準向量恆為單位長度', () => {
    const a = new Aircraft(P51D)
    const c = new ScriptedController()
    const cmd = createCommand()
    for (const m of MANOEUVRES) {
      c.setManoeuvre(m, a)
      for (let i = 0; i < 100; i++) {
        c.update(a, DT, cmd)
        expect(cmd.aimWorld.length()).toBeCloseTo(1, 9)
      }
    }
  })

  it('等速直線：20 秒後航向漂移小於 3°，高度變化小於 200 m', () => {
    const a = new Aircraft(P51D, 4000, 160)
    const c = new ScriptedController()
    c.setManoeuvre('straight', a)
    const h0 = heading(a)
    fly(a, c, 20)
    expect(Math.abs(heading(a) - h0) * RAD).toBeLessThan(3)
    expect(Math.abs(a.state.position.y - 4000)).toBeLessThan(200)
  })

  it('定盤旋：航向持續變化，20 秒轉出的角度接近標稱轉率', () => {
    const a = new Aircraft(P51D, 4000, 160)
    const c = new ScriptedController()
    c.setManoeuvre('turn', a)
    fly(a, c, 5)          // 先讓它進入穩態
    const h0 = heading(a)
    fly(a, c, 10)
    // 展開角度差（可能跨過 ±π）
    let d = heading(a) - h0
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    expect(Math.abs(d) * RAD).toBeGreaterThan(60)     // 至少 6°/s
    expect(Math.abs(d) * RAD).toBeLessThan(160)       // 但不是失控翻滾
  })

  it('蛇行：航向來回擺盪，不是單向轉走', () => {
    const a = new Aircraft(P51D, 4000, 160)
    const c = new ScriptedController()
    c.setManoeuvre('weave', a)
    const samples: number[] = []
    const cmd = createCommand()
    for (let i = 0; i < 240 * 16; i++) {
      c.update(a, DT, cmd)
      a.update(cmd.aimWorld, cmd.throttle, DT)
      if (i % 240 === 0) samples.push(heading(a))
    }
    // 至少換向一次：差分的符號必須同時出現正與負
    const diffs = samples.slice(1).map((h, i) => h - samples[i]!)
    expect(diffs.some((d) => d > 0.01)).toBe(true)
    expect(diffs.some((d) => d < -0.01)).toBe(true)
  })

  it('爬升：高度上升', () => {
    const a = new Aircraft(P51D, 4000, 200)
    const c = new ScriptedController()
    c.setManoeuvre('climb', a)
    fly(a, c, 10)
    expect(a.state.position.y).toBeGreaterThan(4200)
  })

  it('setManoeuvre 重新錨定基準航向 —— 切換機動不會硬扯機首回原方向', () => {
    const a = new Aircraft(P51D, 4000, 160)
    const c = new ScriptedController()
    c.setManoeuvre('turn', a)
    fly(a, c, 8)
    const h = heading(a)
    c.setManoeuvre('straight', a)
    const cmd = createCommand()
    c.update(a, DT, cmd)
    const aim = Math.atan2(-cmd.aimWorld.x, -cmd.aimWorld.z)
    expect(Math.abs(aim - h) * RAD).toBeLessThan(1)
  })
})
