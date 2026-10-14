import { describe, expect, it, vi } from 'vitest'
import { createMissionCompletion, MISSION_COMPLETION_KEY } from '../../src/app/missionCompletion'

function memoryStorage(initial: string | null = null) {
  let value = initial
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next }),
  }
}

describe('任務通關紀錄', () => {
  it('只記任務勝利；重玩失敗不移除既有紀錄，重開仍讀得到', () => {
    const storage = memoryStorage()
    const progress = createMissionCompletion(() => storage)
    expect(progress.record('germany-m4', 'fighting')).toBe(false)
    expect(progress.record('germany-m4', 'defeat')).toBe(false)
    expect(progress.record(null, 'victory')).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(progress.record('germany-m4', 'victory')).toBe(true)
    expect(progress.record('germany-m4', 'victory')).toBe(false)
    expect(progress.record('germany-m4', 'defeat')).toBe(false)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(storage.setItem).toHaveBeenCalledWith(MISSION_COMPLETION_KEY, '["germany-m4"]')
    expect(createMissionCompletion(() => storage).has('germany-m4')).toBe(true)
    expect(progress.has('germany-m2')).toBe(false)
  })

  it.each(['bad json', '{}', 'null', '123'])('舊資料無法讀取時不阻擋新的通關：%s', raw => {
    const storage = memoryStorage(raw)
    const progress = createMissionCompletion(() => storage)
    expect(progress.has('allies-m1')).toBe(false)
    expect(progress.record('allies-m1', 'victory')).toBe(true)
    expect(createMissionCompletion(() => storage).has('allies-m1')).toBe(true)
  })

  it('只接受清單中的字串，重複 id 不會重複記錄', () => {
    const storage = memoryStorage('["japan-m1",null,3,{},"","japan-m1"]')
    const progress = createMissionCompletion(() => storage)
    expect(progress.has('japan-m1')).toBe(true)
    progress.record('japan-m2', 'victory')
    expect(JSON.parse(storage.getItem()!)).toEqual(['japan-m1', 'japan-m2'])
  })

  it('停用儲存或寫入失敗時仍保留本分頁的完成狀態', () => {
    const blocked = createMissionCompletion(() => { throw new Error('denied') })
    expect(blocked.record('allies-m1', 'victory')).toBe(true)
    expect(blocked.has('allies-m1')).toBe(true)
    expect(blocked.record('allies-m1', 'victory')).toBe(false)
    const storage = memoryStorage()
    storage.setItem.mockImplementation(() => { throw new Error('quota') })
    const full = createMissionCompletion(() => storage)
    expect(full.record('allies-m2', 'victory')).toBe(true)
    expect(full.has('allies-m2')).toBe(true)
    expect(full.record('allies-m2', 'victory')).toBe(false)
  })

  it('保存新通關前合併其他分頁已寫入的紀錄', () => {
    const storage = memoryStorage()
    const a = createMissionCompletion(() => storage)
    const b = createMissionCompletion(() => storage)
    a.record('allies-m1', 'victory')
    b.record('germany-m4', 'victory')
    const reopened = createMissionCompletion(() => storage)
    expect(reopened.has('allies-m1')).toBe(true)
    expect(reopened.has('germany-m4')).toBe(true)
  })
})
