import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAudioAssets } from '../../src/audio/assets'
import { FIRST_FILES } from '../../src/audio/catalog'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// 測試只驗證解碼結果的儲存與物件身分，不使用 Web Audio 播放。
const decoded = { duration: 1 } as AudioBuffer
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('音效素材載入', () => {
  it('優先載入按鈕音，同時最多六個下載／解碼工作，進度包含每一支素材', async () => {
    const ids = ['normal0', FIRST_FILES[0]!, 'normal1', FIRST_FILES[1]!, 'normal2', 'normal3', 'normal4', 'normal5']
    const manifest = Object.fromEntries(ids.map((id, i) => [id, { loop: false, makeupDb: i, envelopeDb: [0, -i] }]))
    const gates = ids.map(() => deferred<AudioBuffer>())
    const started: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('manifest.json')) return Response.json(manifest)
      const id = url.split('/').at(-1)!.slice(0, -4)
      started.push(id)
      return new Response(new Uint8Array([ids.indexOf(id)]))
    }))
    let active = 0, peak = 0
    const assets = createAudioAssets({ decodeAudioData: vi.fn(async (data: ArrayBuffer) => {
      active++
      peak = Math.max(peak, active)
      try { return await gates[new Uint8Array(data)[0]!]!.promise } finally { active-- }
    }) })
    const progress = vi.fn()
    const loading = assets.load(progress)
    await vi.waitFor(() => expect(active).toBe(6))
    expect(started).toEqual([...FIRST_FILES, 'normal0', 'normal1', 'normal2', 'normal3'])
    expect(progress.mock.calls).toEqual([[0, 8]])
    expect(assets.makeup.get('normal5')).toBe(7)
    expect(assets.envelopes.get('normal5')).toEqual([0, -7])
    gates[ids.indexOf(FIRST_FILES[0]!)]!.resolve(decoded)
    await vi.waitFor(() => expect(started).toHaveLength(7))
    expect(started[6]).toBe('normal4')
    expect(assets.buffers.get(FIRST_FILES[0]!)).toBe(decoded)
    expect(progress).toHaveBeenLastCalledWith(1, 8)
    for (const gate of gates) gate.resolve(decoded)
    await loading
    expect(peak).toBe(6)
    expect(started).toEqual([...FIRST_FILES, 'normal0', 'normal1', 'normal2', 'normal3', 'normal4', 'normal5'])
    expect(progress.mock.calls).toEqual(Array.from({ length: 9 }, (_, i) => [i, 8]))
    expect(assets.buffers.size).toBe(8)
  })

  it('共用載入工作，清單到手前不回報；中途與完成後加入都取得目前進度', async () => {
    const manifest = deferred<Response>()
    const decode = deferred<AudioBuffer>()
    const request = vi.fn(async (url: string) => url.endsWith('manifest.json') ? manifest.promise : new Response(new Uint8Array([0])))
    vi.stubGlobal('fetch', request)
    const assets = createAudioAssets({ decodeAudioData: vi.fn(() => decode.promise) })
    const background = assets.load()
    const first = vi.fn(), second = vi.fn(), late = vi.fn()
    const a = assets.load(first)
    expect(first).not.toHaveBeenCalled()
    manifest.resolve(Response.json({ sound: { loop: false, makeupDb: -2 } }))
    await vi.waitFor(() => expect(first).toHaveBeenCalledWith(0, 1))
    const b = assets.load(second)
    expect(second).toHaveBeenCalledWith(0, 1)
    decode.resolve(decoded)
    await Promise.all([background, a, b])
    expect(first.mock.calls).toEqual([[0, 1]])
    expect(second.mock.calls).toEqual([[0, 1], [1, 1]])
    const buffers = assets.buffers
    await assets.load(late)
    expect(late.mock.calls).toEqual([[1, 1]])
    expect(request).toHaveBeenCalledTimes(2)
    expect(assets.buffers).toBe(buffers)
    expect(assets.buffers.get('sound')).toBe(decoded)
    expect(assets.envelopes.has('sound')).toBe(false)
  })

  it('下載或解碼失敗仍推進進度，其餘素材與清單的增益、包絡保留', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('manifest.json')) return Response.json({
        missing: { loop: false, makeupDb: 1 }, broken: { loop: false, makeupDb: 2 }, good: { loop: false, makeupDb: 3 },
      })
      if (url.endsWith('/missing.mp3')) throw new Error('下載失敗')
      return new Response(new Uint8Array([url.endsWith('/broken.mp3') ? 0 : 1]))
    }))
    const assets = createAudioAssets({ decodeAudioData: vi.fn(async (data: ArrayBuffer) => {
      if (new Uint8Array(data)[0] === 0) throw new Error('解碼失敗')
      return decoded
    }) })
    const progress = vi.fn()
    await assets.load(progress)
    expect(progress.mock.calls).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]])
    expect([...assets.buffers.keys()]).toEqual(['good'])
    expect([...assets.makeup.values()]).toEqual([1, 2, 3])
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('清單失敗只記錄一次警告，重複呼叫不重新下載或阻擋啟動', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const request = vi.fn().mockRejectedValue(new Error('清單不存在'))
    vi.stubGlobal('fetch', request)
    const assets = createAudioAssets({ decodeAudioData: vi.fn() })
    const progress = vi.fn()
    await assets.load(progress)
    await assets.load(progress)
    expect(request).toHaveBeenCalledTimes(1)
    expect(progress).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(assets.buffers.size).toBe(0)
  })

  it('空清單完成後不啟動下載或解碼工作', async () => {
    const request = vi.fn(async () => Response.json({}))
    vi.stubGlobal('fetch', request)
    const decodeAudioData = vi.fn()
    const assets = createAudioAssets({ decodeAudioData })
    const progress = vi.fn()
    await assets.load(progress)
    expect(progress.mock.calls).toEqual([[0, 0]])
    expect(request).toHaveBeenCalledTimes(1)
    expect(decodeAudioData).not.toHaveBeenCalled()
  })
})
