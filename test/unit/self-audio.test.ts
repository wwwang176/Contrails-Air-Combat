import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AudioListener } from 'three'
import { createSelfAudio } from '../../src/audio/selfAudio'
import { CATEGORY } from '../../src/audio/catalog'
import { dbToGain } from '../../src/audio/curves'

const { channels, FakeAudio } = vi.hoisted(() => {
  class FakeAudio {
    isPlaying = false
    gain = { gain: { setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() } }
    setLoop = vi.fn()
    setFilter = vi.fn()
    setBuffer = vi.fn()
    setPlaybackRate = vi.fn()
    play = vi.fn(() => { this.isPlaying = true })
    stop = vi.fn(() => { this.isPlaying = false })
    constructor() { channels.push(this) }
  }
  const channels: FakeAudio[] = []
  return { channels, FakeAudio }
})
vi.mock('three', () => ({ Audio: FakeAudio }))
beforeEach(() => { channels.length = 0 })

function fixture() {
  const ctx = { currentTime: 0 }
  const listener = { context: ctx } as AudioListener
  const buffers = new Map(['a', 'b', 'c'].map(name => [name, { name } as unknown as AudioBuffer]))
  const makeup = new Map([['a', 3]])
  const playback = { muted: false, timeScale: 1 }
  const filter = { frequency: { setTargetAtTime: vi.fn() } }
  const lowpass = vi.fn(() => filter as unknown as BiquadFilterNode)
  const audio = createSelfAudio(listener, buffers, makeup, playback, lowpass)
  return { audio, ctx, buffers, makeup, playback, filter, lowpass }
}

describe('玩家的循環音', () => {
  it('建四條重複使用的循環，只有風聲加濾波；缺檔時保持無聲', () => {
    const f = fixture()
    expect(channels).toHaveLength(4)
    expect(channels.every(c => c.setLoop.mock.calls[0]?.[0] === true)).toBe(true)
    expect(f.lowpass).toHaveBeenCalledOnce()
    expect(channels[1]!.setFilter).toHaveBeenCalledWith(f.filter)
    for (const c of [channels[0]!, channels[2]!, channels[3]!]) expect(c.setFilter).not.toHaveBeenCalled()
    f.audio.selfLoop('engine', 'missing', 1, 0)
    f.audio.selfLoop('wind', null, 1, 0)
    expect(channels.every(c => c.play.mock.calls.length === 0)).toBe(true)
    for (let i = 0; i < 300; i++) {
      f.ctx.currentTime += 1 / 60
      f.audio.selfLoop('wind', 'a', 1, 0)
    }
    expect(channels).toHaveLength(4)
    expect(channels[1]!.play).toHaveBeenCalledOnce()
    expect(channels[1]!.setBuffer).toHaveBeenCalledOnce()
    expect(f.lowpass).toHaveBeenCalledOnce()
  })

  it('各用自己的類別，套當下的補償增益、時間倍率與風聲截止頻率，不重新起播', () => {
    const f = fixture()
    const slots = ['engine', 'wind', 'warn', 'siren'] as const
    const categories = ['engineSelf', 'wind', 'warn', 'sirenSelf'] as const
    for (let i = 0; i < slots.length; i++) {
      f.audio.selfLoop(slots[i]!, 'a', 1.4, -2, 4500)
      expect(channels[i]!.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(
        dbToGain(CATEGORY[categories[i]!].gainDb + 3 - 2), 0, 0.05)
      expect(channels[i]!.setPlaybackRate).toHaveBeenLastCalledWith(1.4)
    }
    expect(f.filter.frequency.setTargetAtTime).toHaveBeenLastCalledWith(4500, 0, 0.05)
    f.ctx.currentTime = 1
    f.playback.timeScale = 0.2
    f.makeup.set('a', 5)
    f.audio.selfLoop('wind', 'a', 2, -1)
    expect(channels[1]!.setPlaybackRate).toHaveBeenLastCalledWith(0.4)
    expect(channels[1]!.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(
      dbToGain(CATEGORY.wind.gainDb + 5 - 1), 1, 0.05)
    expect(f.filter.frequency.setTargetAtTime).toHaveBeenLastCalledWith(22000, 1, 0.05)
    expect(channels.every(c => c.play.mock.calls.length === 1)).toBe(true)
  })

  it('換檔前先淡出舊檔，兩個檔永遠不同時播', () => {
    const f = fixture()
    const c = channels[0]!
    f.audio.selfLoop('engine', 'a', 1, 0)
    f.ctx.currentTime = 1
    f.audio.selfLoop('engine', 'b', 1, 0)
    expect(c.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, 0.1 / 3)
    f.ctx.currentTime = 1.099
    f.audio.selfLoop('engine', 'b', 1, 0)
    expect(c.stop).not.toHaveBeenCalled()
    expect(c.setBuffer).toHaveBeenCalledOnce()
    f.ctx.currentTime = 1.1
    f.audio.selfLoop('engine', 'b', 1, 0)
    expect(c.stop).toHaveBeenCalledOnce()
    expect(c.setBuffer).toHaveBeenLastCalledWith(f.buffers.get('b'))
    expect(c.stop.mock.invocationCallOrder[0]).toBeLessThan(c.setBuffer.mock.invocationCallOrder[1]!)
    expect(c.setBuffer.mock.invocationCallOrder[1]).toBeLessThan(c.play.mock.invocationCallOrder[1]!)
    expect(c.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(dbToGain(CATEGORY.engineSelf.gainDb), 1.1, 0.05)
  })

  it('等待切換中又要回正在播的檔，就取消切換', () => {
    const f = fixture()
    f.audio.selfLoop('engine', 'a', 1, 0)
    f.ctx.currentTime = 1
    f.audio.selfLoop('engine', 'b', 1, 0)
    f.ctx.currentTime = 1.05
    f.audio.selfLoop('engine', 'a', 1, 0)
    f.ctx.currentTime = 2
    f.audio.selfLoop('engine', 'a', 1, 0)
    expect(channels[0]!.stop).not.toHaveBeenCalled()
    expect(channels[0]!.play).toHaveBeenCalledOnce()
    expect(channels[0]!.setBuffer).toHaveBeenCalledOnce()
  })

  it('等待中的檔被換掉時，淡出不延長，也不播過期的那一個', () => {
    const f = fixture()
    f.audio.selfLoop('engine', 'a', 1, 0)
    f.ctx.currentTime = 1
    f.audio.selfLoop('engine', 'b', 1, 0)
    f.ctx.currentTime = 1.05
    f.audio.selfLoop('engine', 'c', 1, 0)
    f.ctx.currentTime = 1.1
    f.audio.selfLoop('engine', 'c', 1, 0)
    expect(channels[0]!.setBuffer.mock.calls).toEqual([[f.buffers.get('a')], [f.buffers.get('c')]])
  })

  it.each(['null', 'missing', 'muted'] as const)('%s 時淡出到無聲，之後還能再起播', kind => {
    const f = fixture()
    f.audio.selfLoop('engine', 'a', 1, 0)
    f.ctx.currentTime = 1
    f.playback.muted = kind === 'muted'
    const target = kind === 'null' ? null : kind === 'missing' ? 'missing' : 'a'
    f.audio.selfLoop('engine', target, 1, 0)
    expect(channels[0]!.isPlaying).toBe(true)
    f.ctx.currentTime = 1.1
    f.audio.selfLoop('engine', target, 1, 0)
    expect(channels[0]!.isPlaying).toBe(false)
    expect(channels[0]!.stop).toHaveBeenCalledOnce()
    f.playback.muted = false
    f.audio.selfLoop('engine', 'a', 1, 0)
    expect(channels[0]!.isPlaying).toBe(true)
    expect(channels[0]!.play).toHaveBeenCalledTimes(2)
  })

  it('四個聲道立刻全停，下一場之前清掉切換中的狀態', () => {
    const f = fixture()
    for (const slot of ['engine', 'wind', 'warn', 'siren'] as const) {
      f.audio.selfLoop(slot, 'a', 1, 0)
      f.audio.selfLoop(slot, 'b', 1, 0)
    }
    f.audio.stopAll()
    f.audio.stopAll()
    expect(channels.every(c => !c.isPlaying && c.stop.mock.calls.length === 1)).toBe(true)
    f.ctx.currentTime = 2
    for (const slot of ['engine', 'wind', 'warn', 'siren'] as const) f.audio.selfLoop(slot, 'c', 1, 0)
    expect(channels).toHaveLength(4)
    for (const c of channels) expect(c.setBuffer.mock.calls).toEqual([[f.buffers.get('a')], [f.buffers.get('c')]])
  })
})
