/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest'

/**
 * 【為什麼這是一條讀原始碼的測試】`main.ts` 是進入點：它在模組層就建
 * `WebGLRenderer`、抓 DOM、註冊事件，載進 vitest 會直接爆。全專案沒有第二個
 * 檔案是這樣的，也因此 `main.ts` 是唯一一段沒有單元測試的產品碼。
 *
 * 而這裡要守的東西正好只存在於 `main.ts`：**它有兩個「換一場」的入口，而
 * 只有一個會清粒子池。**
 *
 *   `enterBattle()`    設定頁的「開始戰鬥」、結算的「再打一場」 → 七個 reset()
 *   `restartBattle()`  暫停選單的「重新開始」                   → 一個都沒有
 *
 * 症狀：按「重新開始」之後最多約 3 秒，上一場的煙（2.5 s × 1.25 抖動）、
 * 碎片（1.5–2 s）、水柱（~2.1 s）還飄在舊位置。殘骸不在其中 ——
 * `restartBattle` 有呼叫 `rebuildVisuals()`，它會把殘骸池持有的模型還回去。
 *
 * **那 3 秒不是重點。** 重點是「兩個入口、一份清單」這個結構本身：下一個人
 * 加第八個池的時候會加到其中一個，而這個缺陷就是這樣長出來的。所以修法是
 * 抽一個 `resetPools()` 讓兩邊都呼叫，而這條測試釘的就是那件事。
 *
 * 【用 import.meta.glob 而不是 fs】專案沒有 `@types/node`。Vite 的 raw
 * 匯入不需要它。
 */
const SOURCES = import.meta.glob('../../src/main.ts', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

const MAIN = Object.values(SOURCES)[0]!

/** 取出某個函數的函數體（到第一個頂層 `\n}` 為止）。 */
function bodyOf(name: string): string {
  const head = `function ${name}(): void {`
  const from = MAIN.indexOf(head)
  if (from < 0) throw new Error(`main.ts 裡找不到 ${name}() —— 這條測試的錨點過期了`)
  const to = MAIN.indexOf('\n}', from)
  if (to < 0) throw new Error(`${name}() 的結尾找不到`)
  return MAIN.slice(from + head.length, to)
}

describe('換一場的兩個入口都要清粒子池', () => {
  it('main.ts 有這兩個入口（錨點還在）', () => {
    expect(() => bodyOf('enterBattle')).not.toThrow()
    expect(() => bodyOf('restartBattle')).not.toThrow()
  })

  for (const entry of ['enterBattle', 'restartBattle']) {
    it(`${entry}() 呼叫 resetPools()`, () => {
      expect(bodyOf(entry)).toContain('resetPools()')
    })
  }

  /**
   * 【為什麼要禁止直接呼叫】只斷言「兩邊都有 resetPools()」的話，有人仍然
   * 可以在其中一邊多加一個 `newPool.reset()` 而另一邊沒有 —— 兩份清單又
   * 出現了。這一條把「池子的清單只有一份」變成一條硬規則。
   */
  for (const entry of ['enterBattle', 'restartBattle']) {
    it(`${entry}() 不直接呼叫任何 xxx.reset()`, () => {
      const direct = bodyOf(entry).match(/\b[a-z]\w*\.reset\(\)/g) ?? []
      expect(direct).toEqual([])
    })
  }

  /**
   * 【`resetPools` 不可以是空函數】上面三組都只看「有沒有呼叫」，把
   * `resetPools` 的函數體換成 `void POOLS` 之後它們**全部照樣綠** ——
   * 實測過，這一條就是補那個洞的。
   */
  it('resetPools() 真的呼叫了 reset()', () => {
    expect(bodyOf('resetPools')).toContain('.reset()')
  })

  /**
   * 【清單本身要有東西】`resetPools` 有呼叫 `reset()` 但 `POOLS` 是空的，
   * 上面每一條都綠。這一條讀 `POOLS` 的字面量，確認每一個池都在裡面。
   */
  it('POOLS 涵蓋每一個粒子池', () => {
    const m = MAIN.match(/const POOLS[^=]*=\s*\[([^\]]*)\]/)
    expect(m).not.toBeNull()
    // 【要先把註解剝掉】陣列裡是可以寫註解的，而註解與它下一行的名字之間
    // 沒有逗號 —— 不剝的話那一整段會被當成一個「池名」
    const listed = m![1]!
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    expect(listed.sort()).toEqual(
      [
        'debris', 'fireball', 'flakBursts', 'smoke', 'sparks', 'splashes',
        'spray', 'vortex', 'wakes',
        // 爆炸那一組
        'blastChunks', 'blastGlow', 'blastEmber', 'blastSmoke', 'blastDust',
        'blastMist', 'blastJets',
        // 【船火那一組】`shipFires` 不是粒子池，但它有跨場狀態而且
        // `reset()` 的簽章一樣。漏清的話上一場的火會用同一個船索引附到
        // 新一場的船上，燒滿 60 秒
        'shipFireSmoke', 'shipFires',
      ].sort(),
    )
  })

  /**
   * 【進了 `POOLS` 還要有人推它】清乾淨與會動是兩件事。少了 `step` 的池子
   * 會**收得到 `emit` 但一個粒子都不畫** —— 實例矩陣是在 `step` 裡寫的，
   * 從來不推就等於整池不存在，而且完全不報錯。
   *
   * 【`shipFires` 不在此列】它不是粒子池，走的是 `stepShipFires(...)`。
   */
  it('POOLS 裡的每一個粒子池每幀都被推', () => {
    const m = MAIN.match(/const POOLS[^=]*=\s*\[([^\]]*)\]/)
    const listed = m![1]!
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== 'shipFires')
    for (const pool of listed) {
      expect(MAIN, `${pool} 沒有人每幀推它`).toContain(`${pool}.step(`)
    }
  })
})
