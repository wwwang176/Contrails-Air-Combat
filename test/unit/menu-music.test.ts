import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MENU_MUSIC, MUSIC_FADE_SECONDS, createMusic } from '../../src/audio/music'

/** 記下排程的假 AudioParam：只記呼叫，值由測試讀寫 `value` */
function fakeParam() {
  const calls: [string, number, number?][] = []
  return {
    value: 0,
    calls,
    cancelScheduledValues(t: number) { calls.push(['cancel', t]); return this },
    setValueAtTime(v: number, t: number) { calls.push(['set', v, t]); this.value = v; return this },
    linearRampToValueAtTime(v: number, t: number) { calls.push(['ramp', v, t]); return this },
  }
}

/** `play()` 的結果由測試決定什麼時候兌現 */
function setup() {
  const gain = fakeParam()
  const gainNode = { gain, connect: vi.fn() }
  const source = { connect: vi.fn() }
  const ctx = {
    currentTime: 10,
    createGain: vi.fn(() => gainNode),
    createMediaElementSource: vi.fn(() => source),
  }
  const pending: { resolve: () => void; reject: (e: Error) => void }[] = []
  const element = {
    loop: false,
    play: vi.fn(() => new Promise<void>((resolve, reject) => { pending.push({ resolve, reject }) })),
    pause: vi.fn(),
  }
  const output = { name: 'musicBus' }
  const music = createMusic(ctx as never, output as never, element as never)
  /** 兌現最後一次 `play()` 並讓 then 跑完 */
  const played = async (): Promise<void> => { pending.at(-1)!.resolve(); await Promise.resolve(); await Promise.resolve() }
  return { ctx, gain, gainNode, source, element, output, music, pending, played }
}

const ramps = (gain: ReturnType<typeof fakeParam>) => gain.calls.filter((c) => c[0] === 'ramp')

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('選單背景音樂', () => {
  it('建立時接好：元素循環、元素 → 自己的增益 → 匯流排；增益從 0 起，不播', () => {
    const { ctx, gain, gainNode, source, element, output } = setup()
    expect(element.loop).toBe(true)
    expect(ctx.createMediaElementSource).toHaveBeenCalledWith(element)
    expect(source.connect).toHaveBeenCalledWith(gainNode)
    expect(gainNode.connect).toHaveBeenCalledWith(output)
    expect(gain.value).toBe(0)
    expect(element.play).not.toHaveBeenCalled()
  })

  /** 【等真的開始播才淡入】串流慢的時候，在呼叫的當下排的淡入會在無聲中走完 */
  it(`開始：播放成功之後才從目前的值線性淡入，${MUSIC_FADE_SECONDS} s`, async () => {
    const { ctx, gain, element, music, played } = setup()
    music.setRunning(true)
    music.start()
    expect(element.play).toHaveBeenCalledTimes(1)
    expect(ramps(gain)).toEqual([])
    ctx.currentTime = 12
    await played()
    expect(gain.calls.slice(-3)).toEqual([['cancel', 12], ['set', 0, 12], ['ramp', MENU_MUSIC.level, 12 + MUSIC_FADE_SECONDS]])
    expect(MUSIC_FADE_SECONDS).toBe(0.5)
  })

  it('播放還沒開始就停止：之後兌現也不淡入', async () => {
    const { gain, music, played } = setup()
    music.setRunning(true)
    music.start()
    music.stop()
    await played()
    expect(ramps(gain).every((c) => c[1] === 0)).toBe(true)
  })

  it(`停止：線性淡出到 0，${MUSIC_FADE_SECONDS} s 之後才暫停元素`, async () => {
    const { ctx, gain, element, music, played } = setup()
    music.setRunning(true)
    music.start()
    await played()
    gain.value = MENU_MUSIC.level
    ctx.currentTime = 20
    gain.calls.length = 0
    music.stop()
    expect(gain.calls).toEqual([['cancel', 20], ['set', MENU_MUSIC.level, 20], ['ramp', 0, 20 + MUSIC_FADE_SECONDS]])
    vi.advanceTimersByTime(MUSIC_FADE_SECONDS * 1000 - 1)
    expect(element.pause).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(element.pause).toHaveBeenCalledTimes(1)
  })

  /** 【淡出途中又回到選單】排定的暫停要取消，否則淡回來之後被暫停，整首無聲 */
  it('淡出途中再開始：取消暫停，從目前的值淡回來', async () => {
    const { ctx, gain, element, music, played } = setup()
    music.setRunning(true)
    music.start()
    await played()
    music.stop()
    ctx.currentTime = 10.2
    gain.value = 0.3
    music.start()
    await played()
    expect(gain.calls.slice(-3)).toEqual([['cancel', 10.2], ['set', 0.3, 10.2], ['ramp', MENU_MUSIC.level, 10.2 + MUSIC_FADE_SECONDS]])
    vi.advanceTimersByTime(2000)
    expect(element.pause).not.toHaveBeenCalled()
  })

  /**
   * 【音訊暫停時元素也要停】切分頁、關音量時引擎的 context 暫停，那只是不輸出 —— 元素照樣往前走，
   * 回來時位置已經跳掉。恢復時要播的話重新播放並淡入
   */
  it('音訊暫停時暫停元素；恢復時要播就重新播放並淡入，不播就不動', async () => {
    const { ctx, gain, element, music, played } = setup()
    music.start()
    expect(element.play).not.toHaveBeenCalled()
    music.setRunning(true)
    expect(element.play).toHaveBeenCalledTimes(1)
    await played()
    music.setRunning(false)
    expect(element.pause).toHaveBeenCalledTimes(1)
    expect(gain.value).toBe(0)
    ctx.currentTime = 30
    music.setRunning(true)
    expect(element.play).toHaveBeenCalledTimes(2)
    await played()
    expect(ramps(gain).at(-1)).toEqual(['ramp', MENU_MUSIC.level, 30 + MUSIC_FADE_SECONDS])
    music.stop()
    vi.advanceTimersByTime(2000)
    music.setRunning(false)
    music.setRunning(true)
    expect(element.play).toHaveBeenCalledTimes(2)
  })

  it('重複開始、重複停止、沒開始就停止都是冪等的', async () => {
    const { gain, element, music, played } = setup()
    music.setRunning(true)
    music.stop()
    expect(gain.calls).toEqual([])
    music.start()
    music.start()
    expect(element.play).toHaveBeenCalledTimes(1)
    await played()
    music.stop()
    const n = gain.calls.length
    music.stop()
    expect(gain.calls.length).toBe(n)
    vi.advanceTimersByTime(2000)
    expect(element.pause).toHaveBeenCalledTimes(1)
  })

  /** 瀏覽器拒絕播放不能變成沒人接的 promise 錯誤，也不淡入 */
  it('播放被拒絕時不拋錯、不淡入', async () => {
    const { gain, music, pending } = setup()
    music.setRunning(true)
    expect(() => music.start()).not.toThrow()
    pending[0]!.reject(new Error('NotAllowedError'))
    await Promise.resolve(); await Promise.resolve()
    expect(ramps(gain)).toEqual([])
  })
})
