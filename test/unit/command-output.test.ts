import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { createCommand } from '../../src/control/Controller'
import { THROTTLE_RATE } from '../../src/input/throttle'
import { ACE } from '../../src/ai/profile'
import { createBandState } from '../../src/ai/bandState'
import { createSurfaceAttackState } from '../../src/ai/surfaceAttack'
import {
  createCommandOutputState, emitAiCommand, type CommandOutputContext,
} from '../../src/ai/commandOutput'
import { applySafety } from '../../src/ai/safety'
import { updateRecoveryAssist, updateRecoveryTrialAssist } from '../../src/ai/recoveryWorkerClient'

vi.mock('../../src/ai/safety', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/ai/safety')>(),
  applySafety: vi.fn(),
}))
vi.mock('../../src/ai/recoveryWorkerClient', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/ai/recoveryWorkerClient')>(),
  updateRecoveryAssist: vi.fn(),
  updateRecoveryTrialAssist: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(applySafety).mockReset().mockReturnValue('none')
  vi.mocked(updateRecoveryAssist).mockReset().mockReturnValue(0)
  vi.mocked(updateRecoveryTrialAssist).mockReset().mockReturnValue('pending')
})

function setup() {
  const self = new Aircraft(P51D)
  const state = createCommandOutputState()
  const ctx: CommandOutputContext = {
    seaHeight: 0, terrain: null, profile: ACE, selfIndex: 0, band: createBandState(),
    safetyAction: 'none', safetyActive: false,
  }
  const raw = createCommand()
  const out = createCommand()
  const surface = createSurfaceAttackState()
  const step = (dt = 1 / 240) => emitAiCommand(state, ctx, self, dt, out, raw, surface)
  return { self, state, ctx, raw, out, surface, step }
}

describe('AI 共用命令輸出', () => {
  it('安全層接收延遲後的命令與當下飛機，修正不再經過延遲', () => {
    const { self, state, ctx, out, step } = setup()
    const order: string[] = []
    vi.spyOn(state.delay, 'push').mockImplementation((_raw, _delay, _dt, command) => {
      order.push('delay')
      command.aimWorld.set(0, -0.8, -0.6)
    })
    self.state.position.y = 25
    vi.mocked(applySafety).mockImplementation((aircraft, _floor, command) => {
      order.push('safety')
      expect(aircraft).toBe(self)
      expect(aircraft.state.position.y).toBe(25)
      expect(command.aimWorld.y).toBe(-0.8)
      command.aimWorld.set(0, 0.6, -0.8)
      return 'ground'
    })
    step()
    expect(order).toEqual(['delay', 'safety'])
    expect(out.aimWorld.y).toBe(0.6)
    expect(ctx.safetyAction).toBe('ground')
    expect(ctx.safetyActive).toBe(true)
  })

  it('掃射捕獲期間，Worker 判定不安全時補高、等待時維持水平並禁射', () => {
    const { self, state, ctx, raw, out, surface, step } = setup()
    state.groundCapture.active = true
    state.groundCapture.armed = true
    surface.groundStrafeActive = true
    self.state.velocity.set(100, 5, 0)
    raw.aimWorld.set(0, -0.8, -0.6)
    raw.firing = true
    raw.bombing = true
    vi.mocked(updateRecoveryTrialAssist).mockReturnValue('unsafe')
    step()
    expect(out.aimWorld.y).toBeGreaterThan(0)
    expect(out.firing).toBe(false)
    expect(out.bombing).toBe(false)
    expect(ctx.safetyAction).toBe('ground')
    vi.mocked(updateRecoveryTrialAssist).mockReturnValue('pending')
    step()
    expect(out.aimWorld.y).toBe(0)
    expect(state.groundCapture.active).toBe(true)
  })

  it('超速觸發油門限速，解除後仍平順追上命令值', () => {
    const { state, raw, out, step } = setup()
    state.lastThrottle = 0.9
    raw.throttle = 0.1
    vi.mocked(applySafety).mockReturnValue('overspeed')
    step(0.1)
    expect(out.throttle).toBeCloseTo(0.9 - THROTTLE_RATE * 0.1)
    expect(state.throttleRamp).toBe(true)
    vi.mocked(applySafety).mockReturnValue('none')
    step(0.1)
    expect(out.throttle).toBeCloseTo(0.9 - THROTTLE_RATE * 0.2)
    raw.throttle = out.throttle
    step(0.1)
    expect(state.throttleRamp).toBe(false)
  })
})
