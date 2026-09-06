import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 彈艙的接線護欄 —— **讀 `main.ts` 的原始碼**。
 *
 * 守的是「`stepBombBay` 不在任何視角分支裡」。關進去的話回補與連投節拍會在
 * 那個視角之外凍住，而 `bomb-bay.test.ts` 抓不到 —— 那一支測的是「餵它 dt
 * 會怎樣」，這裡的缺陷是**沒有人餵它**。
 *
 * 【判斷方式是順序，不是括號配對】`main.ts` 有樣板字串與大量中文註解，數
 * 大括號會誤判，而會誤報的護欄比沒有護欄更糟。相機的兩個分支各有一行只出現
 * 在自己那一支的呼叫；彈艙排在兩者之前就代表它不在任何一支裡面。
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
  // 【比對到左括號為止】參數名不是這支護欄的內容 —— 釘住 `bombBay` 的話，
  // 改成 `playerBay()` 就讓整支護欄靜靜地失效（32f4c79 起紅到現在）
  const bay = only('stepBombBay(')
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

/**
 * # 標記的接線護欄 —— 同樣讀 `main.ts` 的原始碼
 *
 * 守的是「`fillMarkers` 真的被叫到」。`hud-marker-feed.test.ts` 是**直接**
 * 呼叫那支函數，所以把 `main.ts` 裡那一行刪掉不會讓任何測試紅 ——
 * 而 `HudFrame` 開出來 `markerCount` 是 0、widget 只讀前 `markerCount` 格，
 * 症狀就是**整組標記一個都不畫，而且沒有任何錯誤訊息**（Codex 審查
 * 2026-09-07）。與上面那一支是同一個手法、同一個理由。
 */
describe('標記的接線：`fillMarkers` 必須真的被呼叫', () => {
  const fill = only('fillMarkers(')

  it('不在任何視角分支裡 —— 三種視角都要畫標記', () => {
    let i = fill
    while (i > 0 && !SRC[i]!.trimStart().startsWith('if (')) i--
    const guard = SRC[i]!.trim()
    expect(guard).not.toContain('viewMode')
    expect(guard).not.toContain('godView')
  })

  /** 【兩個池都要餵】少一個就是「魚雷沒有標記」，而且不會有錯誤訊息 */
  it('炸彈與魚雷兩個池都接上去', () => {
    const near = SRC.slice(Math.max(0, fill - 6), fill).join('\n')
    expect(near).toContain('world.bombs')
    expect(near).toContain('world.torpedoes')
  })
})
