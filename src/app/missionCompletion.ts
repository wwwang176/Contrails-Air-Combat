import type { Outcome } from '../battle/mission'

export const MISSION_COMPLETION_KEY = 'campaign.completed.v1'
type ProgressStorage = Pick<Storage, 'getItem' | 'setItem'>

/** 只記通關的任務 id；存取失敗時仍保留本次分頁的進度，不阻擋結算。 */
export function createMissionCompletion(storage: () => ProgressStorage = () => localStorage) {
  const completed = new Set<string>()

  function read(): void {
    try {
      const value: unknown = JSON.parse(storage().getItem(MISSION_COMPLETION_KEY) ?? '[]')
      if (Array.isArray(value)) {
        for (const id of value) if (typeof id === 'string' && id.length > 0) completed.add(id)
      }
    } catch { /* 無痕限制、資料毀損或停用儲存時，沿用記憶體內的紀錄。 */ }
  }
  read()

  return {
    has(id: string): boolean { return completed.has(id) },
    /** 回傳是否首次過關；null 代表遭遇戰，不能留下任務通關紀錄。 */
    record(id: string | null, outcome: Outcome): boolean {
      if (id === null || id.length === 0 || outcome !== 'victory') return false
      // 寫入前合併其他分頁已保存的紀錄，重玩也不會移除既有通關。
      read()
      if (completed.has(id)) return false
      completed.add(id)
      try { storage().setItem(MISSION_COMPLETION_KEY, JSON.stringify([...completed])) }
      catch { /* 儲存失敗仍可在本分頁顯示完成章。 */ }
      return true
    },
  }
}

export const missionCompletion = createMissionCompletion()
