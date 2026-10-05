import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSeenShots, saveSeenShots } from '../../src/app/reel/shotHistory'

afterEach(() => vi.unstubAllGlobals())

describe('reel playback history', () => {
  it('keeps valid shot IDs in their recorded order and writes the same storage key', () => {
    const storage = { getItem: vi.fn(() => '["fleet",null,3,"raid"]'), setItem: vi.fn() }
    vi.stubGlobal('localStorage', storage)
    expect(readSeenShots()).toEqual(['fleet', 'raid'])
    expect(storage.getItem).toHaveBeenCalledWith('reel.seenShots')
    saveSeenShots(['raid', 'fleet'])
    expect(storage.setItem).toHaveBeenCalledWith('reel.seenShots', '["raid","fleet"]')
  })

  it('treats absent, malformed and non-array data as an empty history', () => {
    const getItem = vi.fn<() => string | null>()
    vi.stubGlobal('localStorage', { getItem })
    for (const data of [null, '{', '{}', 'null', '42', '"fleet"']) {
      getItem.mockReturnValue(data)
      expect(readSeenShots()).toEqual([])
    }
  })

  it('keeps playback usable when storage access is blocked', () => {
    const blocked = () => { throw new Error('storage blocked') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked })
    expect(readSeenShots()).toEqual([])
    expect(() => saveSeenShots(['fleet'])).not.toThrow()
    vi.stubGlobal('localStorage', undefined)
    expect(readSeenShots()).toEqual([])
    expect(() => saveSeenShots(['fleet'])).not.toThrow()
  })
})
