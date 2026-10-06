import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSeenShots, saveSeenShots } from '../../src/app/reel/shotHistory'

afterEach(() => vi.unstubAllGlobals())

describe('短片的播放紀錄', () => {
  it('留下有效的鏡次 ID、照記錄的順序，寫回同一個儲存鍵', () => {
    const storage = { getItem: vi.fn(() => '["fleet",null,3,"raid"]'), setItem: vi.fn() }
    vi.stubGlobal('localStorage', storage)
    expect(readSeenShots()).toEqual(['fleet', 'raid'])
    expect(storage.getItem).toHaveBeenCalledWith('reel.seenShots')
    saveSeenShots(['raid', 'fleet'])
    expect(storage.setItem).toHaveBeenCalledWith('reel.seenShots', '["raid","fleet"]')
  })

  it('沒有資料、格式壞掉或不是陣列，都當成空的紀錄', () => {
    const getItem = vi.fn<() => string | null>()
    vi.stubGlobal('localStorage', { getItem })
    for (const data of [null, '{', '{}', 'null', '42', '"fleet"']) {
      getItem.mockReturnValue(data)
      expect(readSeenShots()).toEqual([])
    }
  })

  it('儲存被擋掉時照樣能播', () => {
    const blocked = () => { throw new Error('storage blocked') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked })
    expect(readSeenShots()).toEqual([])
    expect(() => saveSeenShots(['fleet'])).not.toThrow()
    vi.stubGlobal('localStorage', undefined)
    expect(readSeenShots()).toEqual([])
    expect(() => saveSeenShots(['fleet'])).not.toThrow()
  })
})
