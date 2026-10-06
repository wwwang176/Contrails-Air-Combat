import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAudioOutput } from '../../src/audio/output'

afterEach(() => vi.unstubAllGlobals())

function fixture() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const loaded = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  const fade = { ...node(), gain: {
    value: 0, cancelScheduledValues: vi.fn(), setValueCurveAtTime: vi.fn(),
  } }
  const input = node()
  const limiter = { ...node(), port: { onmessage: null as null | ((e: MessageEvent) => void), postMessage: vi.fn() },
    onprocessorerror: null as null | (() => void) }
  const construct = vi.fn(function () { return limiter })
  vi.stubGlobal('AudioWorkletNode', construct)
  const ctx = { currentTime: 4, destination: {}, createGain: vi.fn(() => fade),
    audioWorklet: { addModule: vi.fn(() => loaded) } }
  const create = () => createAudioOutput(ctx as unknown as BaseAudioContext, input as unknown as GainNode)
  return { ctx, input, fade, limiter, construct, create, resolve, reject }
}

describe('世界音訊的輸出端', () => {
  it('載入中聲音照樣接通，載完才把限幅器接在淡入之後', async () => {
    const f = fixture()
    const output = f.create()
    expect(f.input.disconnect).toHaveBeenCalledOnce()
    expect(f.input.connect).toHaveBeenCalledWith(f.fade)
    expect(f.fade.connect).toHaveBeenLastCalledWith(f.ctx.destination)
    expect(output.limiterEnabled).toBe(false)
    output.resetLimiter()
    expect(f.limiter.port.postMessage).not.toHaveBeenCalled()
    f.resolve()
    await Promise.resolve()
    expect(f.construct).toHaveBeenCalledWith(f.ctx, 'limiter')
    expect(output.limiterEnabled).toBe(true)
    expect(f.fade.connect).toHaveBeenLastCalledWith(f.limiter)
    expect(f.limiter.connect).toHaveBeenLastCalledWith(f.ctx.destination)
    output.resetLimiter()
    expect(f.limiter.port.postMessage).toHaveBeenCalledWith('reset')
    const meter = { peakDb: 0, reductionDb: 0 }
    f.limiter.port.onmessage!({ data: { gain: 0.5, peak: 0.8 } } as MessageEvent)
    output.readMeter(meter)
    expect(meter.peakDb).toBeCloseTo(20 * Math.log10(0.4))
    expect(meter.reductionDb).toBeCloseTo(20 * Math.log10(0.5))
    output.bypassLimiter()
    expect(output.limiterEnabled).toBe(false)
    expect(f.limiter.disconnect).toHaveBeenCalledOnce()
    expect(f.fade.connect).toHaveBeenLastCalledWith(f.ctx.destination)
    output.readMeter(meter)
    expect(meter.reductionDb).toBe(0)
    output.bypassLimiter()
    expect(f.limiter.disconnect).toHaveBeenCalledOnce()
  })

  it('處理器出錯後改回直接輸出', async () => {
    const f = fixture()
    const output = f.create()
    f.resolve()
    await Promise.resolve()
    f.limiter.onprocessorerror!()
    expect(output.limiterEnabled).toBe(false)
    expect(f.limiter.disconnect).toHaveBeenCalledOnce()
    expect(f.fade.connect).toHaveBeenLastCalledWith(f.ctx.destination)
    output.resetLimiter()
    expect(f.limiter.port.postMessage).not.toHaveBeenCalled()
  })

  it('worklet 載入失敗或不支援時維持直接輸出', async () => {
    const f = fixture()
    const output = f.create()
    f.reject(new Error('unavailable'))
    await Promise.resolve()
    await Promise.resolve()
    expect(output.limiterEnabled).toBe(false)
    expect(f.construct).not.toHaveBeenCalled()
    expect(f.fade.disconnect).not.toHaveBeenCalled()
    expect(f.fade.connect).toHaveBeenLastCalledWith(f.ctx.destination)
    const ctx = { ...f.ctx, audioWorklet: undefined }
    expect(() => createAudioOutput(ctx as unknown as BaseAudioContext, f.input as unknown as GainNode)).not.toThrow()
  })

  it('淡入排程用同一條曲線覆蓋前一次；排程丟例外時直接放到全音量', () => {
    const f = fixture()
    const { fadeIn } = f.create()
    fadeIn(0.8)
    const curve = f.fade.gain.setValueCurveAtTime.mock.calls[0]![0] as Float32Array
    expect(curve).toHaveLength(32)
    expect(curve[0]).toBe(0)
    expect(curve[31]).toBe(1)
    f.ctx.currentTime = 5
    fadeIn(2)
    expect(f.fade.gain.cancelScheduledValues).toHaveBeenLastCalledWith(5)
    expect(f.fade.gain.setValueCurveAtTime).toHaveBeenLastCalledWith(curve, 5, 2)
    f.fade.gain.setValueCurveAtTime.mockImplementationOnce(() => { throw new Error('bad schedule') })
    fadeIn(0)
    expect(f.fade.gain.value).toBe(1)
  })
})
