import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BOMB_TUTORIAL, TORPEDO_TUTORIAL, tutorialFor, tutorialOnFight, type Tutorial,
} from '../../src/ui/tutorials'

/** 【用 import.meta.glob 而不是 fs】`main.ts` 與 `menu.ts` 抓 DOM，載進 vitest 會直接爆；讀原始碼 */
const SOURCES = import.meta.glob(['../../index.html', '../../src/main.ts'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>
// 【換行統一成 LF】工作區在 Windows 上是 CRLF
const srcOf = (name: string): string =>
  Object.entries(SOURCES).find(([k]) => k.endsWith(name))![1].replace(/\r\n/g, '\n')

describe('哪一場彈哪一張教學', () => {
  it('掛魚雷看投雷、掛炸彈看投彈、沒掛載不彈', () => {
    expect(tutorialFor('torpedo')).toBe(TORPEDO_TUTORIAL)
    expect(tutorialFor('bomb')).toBe(BOMB_TUTORIAL)
    expect(tutorialFor(null)).toBeNull()
  })

  /** 【從選單進來才彈】結算的「再打一場」是從戰鬥畫面自己出擊，同一場剛看過 */
  it('從設定頁或任務簡報出擊會彈，再打一場不彈', () => {
    expect(tutorialOnFight('skirmish')).toBe(true)
    expect(tutorialOnFight('mission')).toBe(true)
    expect(tutorialOnFight('battle')).toBe(false)
  })
})

describe('教學卡的內容', () => {
  for (const t of [TORPEDO_TUTORIAL, BOMB_TUTORIAL] as Tutorial[]) {
    it(`${t.title}：每一格都有一句話，標籤都落在圖內`, () => {
      expect(t.panels.length).toBeGreaterThan(0)
      for (const p of t.panels) {
        expect(p.caption.length).toBeGreaterThan(0)
        for (const g of p.tags) {
          expect(g.x).toBeGreaterThanOrEqual(0)
          expect(g.x).toBeLessThanOrEqual(100)
          expect(g.y).toBeGreaterThanOrEqual(0)
          expect(g.y).toBeLessThanOrEqual(100)
        }
      }
    })

    it(`${t.title}：每一格的截圖檔都在 public 裡`, () => {
      for (const p of t.panels) {
        expect(readFileSync(`public${p.image}`).byteLength, p.image).toBeGreaterThan(0)
      }
    })
  }
})

describe('教學卡的接線', () => {
  it('index.html 有教學卡，一開始藏著，有「了解」', () => {
    const html = srcOf('index.html')
    const from = html.indexOf('<section id="tutorial"')
    expect(from).toBeGreaterThanOrEqual(0)
    const section = html.slice(from, html.indexOf('</section>', from))
    expect(section).toContain('hidden')
    expect(section).toContain('data-act="tutorialOk"')
  })

  /**
   * 【出擊把「從哪裡來」帶進載入】重新開始走 `onRestart`、不經過這裡；
   * 再打一場的 `from` 是 battle。兩條都不能彈。
   */
  it('出擊依來源決定要不要教學；重新開始不經過載入', () => {
    const main = srcOf('main.ts')
    const from = main.indexOf("if (event === 'fight' && screen === 'battle')")
    const branch = main.slice(from, main.indexOf('\n    }\n', from))
    expect(branch).toContain('loadBattle(tutorialOnFight(from))')
    const restart = main.slice(main.indexOf('  onRestart() {'), main.indexOf('\n  },', main.indexOf('  onRestart() {')))
    expect(restart).not.toContain('loadBattle(')
    expect(restart).not.toContain('tutorial')
  })

  /** 【教學自己放開指標】放開那一下不能被當成玩家按了 Esc，否則暫停選單會疊在卡上 */
  it('教學卡開著時，放開指標不彈暫停選單', () => {
    const main = srcOf('main.ts')
    const at = main.indexOf('if (input.pointerLockLost) {')
    const block = main.slice(at, main.indexOf('menu.setPaused(true)', at))
    expect(block).toContain('!tutorialOpen')
  })
})
