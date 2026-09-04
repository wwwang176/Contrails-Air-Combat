import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 彈艙的接線護欄 —— **讀 `main.ts` 的原始碼**。
 *
 * 【為什麼需要一支讀原始碼的測試】彈艙被關進條件式**兩次**：
 *
 * ```
 *   第一次   綁在「投彈模式」          投完之後要盯著地面 20 秒才補得完
 *   第二次   綁在「非上帝視角」        按 G 之後回補與連投節拍一起凍住
 * ```
 *
 * 兩次的成因相同：`stepBombBay` 住在 `main.ts` 每幀迴圈裡，而它周圍全都是
 * 視角分支，很容易被順手縮進去一層。狀態機本身的測試（`bomb-bay.test.ts`）
 * 抓不到這件事 —— 那一支測的是「餵它 dt 會怎樣」，而缺陷是**沒有人餵它**。
 *
 * 【為什麼不用括號配對去判斷巢狀】`main.ts` 裡有樣板字串與大量中文註解，
 * 自己數大括號會踩到誤判，而一支會誤報的護欄比沒有護欄更糟。改成用**順序**：
 * 相機的兩個分支各有一行只出現在自己那一支的呼叫，彈艙排在兩者之前就代表
 * 它不在任何一支裡面。
 */
const SRC = new TextDecoder().decode(readFileSync('src/main.ts')).split('\n')

/** 唯一一行含 `needle` 的行號。找不到或找到多行都讓測試失敗 —— 那代表這支護欄該重寫 */
function only(needle: string): number {
  const hits: number[] = []
  for (let i = 0; i < SRC.length; i++) if (SRC[i]!.includes(needle)) hits.push(i)
  expect(hits, `main.ts 裡「${needle}」應該只出現一次，實際 ${hits.length} 次`).toHaveLength(1)
  return hits[0]!
}

describe('彈艙的接線：不得被關進任何視角分支', () => {
  const bay = only('stepBombBay(bombBay')
  const godBranch = only('stepGodCamera(godCam')
  const flyBranch = only('rig.update(')

  it('排在上帝視角分支之前 —— 按 G 不得凍住回補與連投節拍', () => {
    expect(bay).toBeLessThan(godBranch)
  })

  it('排在座艙／機外分支之前 —— 那一支是相機，與彈艙無關', () => {
    expect(bay).toBeLessThan(flyBranch)
  })

  it('投彈點與彈艙同一格，否則連投中途換視角會從凍住的位置投出去', () => {
    const eye = only('BOMB_EYE.copy(bp)')
    expect(eye).toBeLessThan(bay)
    expect(bay - eye).toBeLessThan(6)
  })

  it('包住它的條件只看「掛不掛得了彈」，不看視角', () => {
    // 往上找最近的一行 `if (`
    let i = bay
    while (i > 0 && !SRC[i]!.trimStart().startsWith('if (')) i--
    const guard = SRC[i]!.trim()
    expect(guard).toContain('bp !== null')
    expect(guard).not.toContain('viewMode')
    expect(guard).not.toContain('godView')
  })
})
