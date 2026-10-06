import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioContext as ThreeAudioContext, AudioListener, PerspectiveCamera } from 'three'
import { createAudioEngine } from '../../src/audio/engine'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('音訊輸出與相機的分工', () => {
  it('相機更新不觸發 listener 的位置排程，聲道仍共用主輸出', () => {
    const param = () => ({ value: 0, setTargetAtTime: vi.fn() })
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
    const ctx = {
      currentTime: 0, destination: {}, suspend: vi.fn(() => Promise.resolve()),
      createGain: vi.fn(() => ({ ...node(), gain: param() })),
      createBiquadFilter: vi.fn(() => ({ ...node(), Q: param(), frequency: param() })),
      createChannelSplitter: vi.fn(node), createChannelMerger: vi.fn(node),
    }
    vi.spyOn(ThreeAudioContext, 'getContext').mockReturnValue(ctx as unknown as AudioContext)
    vi.stubGlobal('__audioMix', undefined)
    const getInput = vi.spyOn(AudioListener.prototype, 'getInput')
    const update = vi.spyOn(AudioListener.prototype, 'updateMatrixWorld')
    const camera = new PerspectiveCamera()
    const originalChildren = [...camera.children]
    const engine = createAudioEngine(camera)
    const listeners = new Set(getInput.mock.contexts)
    expect(listeners.size).toBe(1)
    const listener = getInput.mock.contexts[0]!
    if (!(listener instanceof AudioListener)) throw new Error('聲道沒有使用 AudioListener')
    expect(listener.parent).toBeNull()
    expect(camera.children).toEqual(originalChildren)
    for (let i = 0; i < 120; i++) {
      camera.position.set(i, i / 2, -i)
      camera.rotation.y = i / 60
      camera.updateMatrixWorld(true)
      engine.beginFrame()
      engine.endFrame()
    }
    expect(update).not.toHaveBeenCalled()
    expect(listener.gain.connect).toHaveBeenCalled()
    engine.setVolume(-6)
    expect(listener.gain.gain.setTargetAtTime).toHaveBeenCalled()
  })
})
