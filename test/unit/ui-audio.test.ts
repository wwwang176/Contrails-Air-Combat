import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUiAudio } from '../../src/audio/uiAudio'
import { CATEGORY } from '../../src/audio/catalog'
import { dbToGain } from '../../src/audio/curves'
import { MIX_HEADROOM_DB } from '../../src/audio/volume'

function fixture() {
  const contexts: FakeContext[] = []
  function gain() {
    return { gain: { value: 1 }, connect: vi.fn((target: unknown) => target) }
  }
  function source() {
    return { buffer: null as AudioBuffer | null, playbackRate: { value: 1 },
      connect: vi.fn((target: unknown) => target), start: vi.fn() }
  }
  class FakeContext {
    readonly destination = {}
    readonly gains: ReturnType<typeof gain>[] = []
    readonly sources: ReturnType<typeof source>[] = []
    readonly resume = vi.fn(async () => {})
    constructor() { contexts.push(this) }
    createGain() { const node = gain(); this.gains.push(node); return node }
    createBufferSource() { const node = source(); this.sources.push(node); return node }
  }
  vi.stubGlobal('AudioContext', FakeContext)
  const buffer = { duration: 1 } as AudioBuffer
  const buffers = new Map([['click', buffer]])
  const makeup = new Map([['click', -2]])
  return { contexts, buffer, buffers, makeup, audio: createUiAudio(buffers, makeup) }
}

afterEach(() => vi.unstubAllGlobals())

describe('選單音效', () => {
  it('沒有素材時不建立 context，素材稍後載入便可播放', () => {
    const { contexts, buffers, buffer, audio } = fixture()
    audio.setVolume(-9)
    audio.play('back')
    expect(contexts).toHaveLength(0)
    buffers.set('back', buffer)
    audio.play('back')
    expect(contexts).toHaveLength(1)
    const ctx = contexts[0]!
    expect(ctx.sources[0]!.buffer).toBe(buffer)
    expect(ctx.sources[0]!.start).toHaveBeenCalledOnce()
    expect(ctx.gains[0]!.gain.value).toBe(dbToGain(-9 + MIX_HEADROOM_DB))
    expect(ctx.gains[1]!.gain.value).toBe(dbToGain(CATEGORY.ui.gainDb))
  })

  it('共用 context 與主增益，每次點擊新建來源並恢復播放，不改播放速度', () => {
    const { contexts, buffer, audio } = fixture()
    audio.play('click', 3)
    audio.play('click')
    expect(contexts).toHaveLength(1)
    const ctx = contexts[0]!
    expect(ctx.resume).toHaveBeenCalledTimes(2)
    expect(ctx.sources).toHaveLength(2)
    expect(ctx.gains).toHaveLength(3)
    expect(ctx.gains[0]!.connect).toHaveBeenCalledWith(ctx.destination)
    for (let i = 0; i < 2; i++) {
      const src = ctx.sources[i]!
      expect(src.buffer).toBe(buffer)
      expect(src.playbackRate.value).toBe(1)
      expect(src.connect).toHaveBeenCalledWith(ctx.gains[i + 1])
      expect(ctx.gains[i + 1]!.connect).toHaveBeenCalledWith(ctx.gains[0])
      expect(src.start).toHaveBeenCalledOnce()
    }
    expect(ctx.gains[0]!.gain.value).toBe(dbToGain(MIX_HEADROOM_DB))
    expect(ctx.gains[1]!.gain.value).toBe(dbToGain(CATEGORY.ui.gainDb - 2 + 3))
    expect(ctx.gains[2]!.gain.value).toBe(dbToGain(CATEGORY.ui.gainDb - 2))
  })

  it('建立前後的靜音與音量設定都套用主增益，不改單次音效的增益', () => {
    const { contexts, audio } = fixture()
    audio.setVolume(null)
    audio.play('click')
    const ctx = contexts[0]!
    expect(ctx.gains[0]!.gain.value).toBe(0)
    const perSound = ctx.gains[1]!.gain.value
    audio.setVolume(-12)
    expect(ctx.gains[0]!.gain.value).toBe(dbToGain(-12 + MIX_HEADROOM_DB))
    expect(ctx.gains[1]!.gain.value).toBe(perSound)
    audio.setVolume(null)
    expect(ctx.gains[0]!.gain.value).toBe(0)
    expect(contexts).toHaveLength(1)
  })

  it('resume 被瀏覽器拒絕時不拋出未處理錯誤，下一次點擊仍會重試', async () => {
    const { contexts, audio } = fixture()
    audio.play('click')
    const ctx = contexts[0]!
    ctx.resume.mockRejectedValueOnce(new Error('手勢限制'))
    audio.play('click')
    await Promise.resolve()
    audio.play('click')
    expect(ctx.resume).toHaveBeenCalledTimes(3)
    expect(ctx.sources).toHaveLength(3)
  })
})
