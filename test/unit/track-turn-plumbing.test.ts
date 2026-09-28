import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { PlayerController } from '../../src/control/PlayerController'
import { createInputState } from '../../src/input/InputState'
import { CommandDelay } from '../../src/ai/delay'
import { applySafety } from '../../src/ai/safety'
import { DEG } from '../../src/core/math'
import { P51D } from '../../src/specs/p51d'

/**
 * # `Command.trackTurn` 的傳遞
 *
 * 只有 AI 寫的一格，與 `upright` 同一個模式。三個會壞而且不報錯的地方：
 * 延遲錯拍、玩家接手時殘留、安全層接管時殘留。
 */

const DT = 1 / 240

describe('CommandDelay', () => {
  /**
   * 【跟瞄準方向一起延遲】直通的話，從集合切到追擊時開關先套在舊的集合方向上；
   * 延遲的追擊方向到的時候開關早就開了，「首次啟用不微分」的保護也用掉了。
   */
  it('trackTurn 與瞄準方向同一格輸出', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    const steps = Math.round(0.1 / DT)
    input.aimWorld.set(1, 0, 0)
    input.trackTurn = false
    for (let i = 0; i < 50; i++) d.push(input, 0.1, DT, out)
    input.aimWorld.set(0, 0, -1)
    input.trackTurn = true
    for (let i = 0; i < steps; i++) {
      d.push(input, 0.1, DT, out)
      expect(out.aimWorld.x).toBe(1)
      expect(out.trackTurn).toBe(false)
    }
    d.push(input, 0.1, DT, out)
    expect(out.aimWorld.z).toBe(-1)
    expect(out.trackTurn).toBe(true)
  })

  it('零延遲直接複製', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    input.trackTurn = true
    d.push(input, 0, DT, out)
    expect(out.trackTurn).toBe(true)
  })
})

describe('PlayerController', () => {
  /**
   * 【玩家也跟瞄】滑鼠準星是世界固定的，不是由自己的速度導出的 —— 瞄準方向
   * 在轉就是玩家在跟一個轉彎。接手僚機時 `Command` 沿用那一席的，每步寫。
   */
  it('每步把 trackTurn 寫成 true', () => {
    const p = new PlayerController(createInputState())
    const out = createCommand()
    out.trackTurn = false
    p.update(new Aircraft(P51D), DT, out)
    expect(out.trackTurn).toBe(true)
  })
})

/**
 * 接線護欄 —— **讀 `main.ts` 的原始碼**（同 `bomb-bay-wiring.test.ts` 的做法）。
 *
 * 交還操縱與接手新機時瞄準方向被一步重設到機首。不清跟瞄歷史的話，不到 5°
 * 的重設會被微分成假的角速度（`FlightDirector.resetTrack`）。
 */
describe('main.ts：重設瞄準方向時清掉跟瞄歷史', () => {
  const SRC = new TextDecoder().decode(readFileSync('src/main.ts')).replace(/\r\n/g, '\n')

  it('交還操縱', () => {
    expect(SRC).toMatch(
      /player\.controller = playerController\n(\s*\/\/[^\n]*\n)*\s*input\.aimWorld\.set\(0, 0, -1\)\.applyQuaternion\(player\.aircraft\.state\.orientation\)\n(\s*\/\/[^\n]*\n)*\s*player\.aircraft\.director\.resetTrack\(\)/,
    )
  })

  it('接手新機', () => {
    expect(SRC).toMatch(
      /input\.aimWorld\.set\(0, 0, -1\)\.applyQuaternion\(player\.aircraft\.state\.orientation\)\n(\s*\/\/[^\n]*\n)*\s*player\.aircraft\.director\.resetTrack\(\)\n(\s*\/\/[^\n]*\n)*\s*rig\.snapTo\(input\.aimWorld\)/,
    )
  })
})

describe('applySafety', () => {
  function flying(altitude: number, tas: number, gammaDeg: number): Aircraft {
    const a = new Aircraft(P51D, altitude, tas)
    const g = gammaDeg * DEG
    const dir = new Vector3(0, Math.sin(g), -Math.cos(g))
    a.state.position.set(0, altitude, 0)
    a.state.velocity.copy(dir).multiplyScalar(tas)
    a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
    a.update(dir, 0.7, DT)
    return a
  }

  function cmd() {
    const c = createCommand()
    c.aimWorld.set(0, -0.5, -1).normalize()
    c.throttle = 0.7
    c.trackTurn = true
    return c
  }

  it('撞地接管時清成 false', () => {
    const c = cmd()
    expect(applySafety(flying(200, 180, -60), 0, c)).toBe('ground')
    expect(c.trackTurn).toBe(false)
  })

  it('失速接管時清成 false', () => {
    const c = cmd()
    expect(applySafety(flying(4000, 40, 0), 0, c)).toBe('stall')
    expect(c.trackTurn).toBe(false)
  })

  it('超速守線時清成 false', () => {
    const c = cmd()
    expect(applySafety(flying(4000, 250, -30), 0, c)).toBe('overspeed')
    expect(c.trackTurn).toBe(false)
  })

  it('沒有接管時保留', () => {
    const c = cmd()
    c.aimWorld.set(0, 0, -1)
    expect(applySafety(flying(4000, 150, 0), 0, c)).toBe('none')
    expect(c.trackTurn).toBe(true)
  })
})
