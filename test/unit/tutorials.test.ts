import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BOMB_TUTORIAL, FIGHTER_BOMB_TUTORIAL, FIGHTER_TUTORIAL, TORPEDO_TUTORIAL, markTutorialSeen, readSeenTutorials,
  tutorialsFor, unseenTutorials, type Tutorial,
} from '../../src/ui/tutorials'

/** 【用 import.meta.glob 而不是 fs】`main.ts` 與 `menu.ts` 抓 DOM，載進 vitest 會直接爆；讀原始碼 */
const SOURCES = import.meta.glob(['../../index.html', '../../src/main.ts', '../../src/ui/menu.ts'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>
// 【換行統一成 LF】工作區在 Windows 上是 CRLF
const srcOf = (name: string): string =>
  Object.entries(SOURCES).find(([k]) => k.endsWith(name))![1].replace(/\r\n/g, '\n')

describe('哪一架飛機看哪幾張卡', () => {
  it('戰鬥機看空戰；轟炸機只看投彈或投雷', () => {
    expect(tutorialsFor('fighter', null)).toEqual([FIGHTER_TUTORIAL])
    expect(tutorialsFor('bomber', 'bomb')).toEqual([BOMB_TUTORIAL])
    expect(tutorialsFor('bomber', 'torpedo')).toEqual([TORPEDO_TUTORIAL])
    expect(tutorialsFor('bomber', null)).toEqual([])
  })

  /** 【掛彈的戰鬥機兩張都看】先學飛、再學投 —— 投的是戰鬥機那一張，沒有瞄準視角 */
  it('掛彈的戰鬥機先看空戰、再看戰鬥機的投彈', () => {
    expect(tutorialsFor('fighter', 'bomb')).toEqual([FIGHTER_TUTORIAL, FIGHTER_BOMB_TUTORIAL])
  })
})

describe('每張卡只自動出現一次', () => {
  /** node 沒有 localStorage，換一個記在 Map 裡的 */
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map()
    ;(globalThis as Record<string, unknown>)['localStorage'] = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    }
  })
  afterEach(() => { delete (globalThis as Record<string, unknown>)['localStorage'] })

  it('看過的卡記下來，下一場只剩沒看過的', () => {
    const all = tutorialsFor('fighter', 'bomb')
    expect(unseenTutorials(all, readSeenTutorials())).toEqual(all)
    markTutorialSeen(FIGHTER_TUTORIAL.id)
    expect(unseenTutorials(all, readSeenTutorials())).toEqual([FIGHTER_BOMB_TUTORIAL])
    markTutorialSeen(FIGHTER_BOMB_TUTORIAL.id)
    expect(unseenTutorials(all, readSeenTutorials())).toEqual([])
  })

  it('壞掉的存檔當成都沒看過，不拋', () => {
    store.set('tutorial.seen', '{not json')
    expect(readSeenTutorials().size).toBe(0)
    store.set('tutorial.seen', '{"a":1}')
    expect(readSeenTutorials().size).toBe(0)
  })

  /** 【存不了也能玩】無痕視窗的 localStorage 會直接拋 */
  it('localStorage 拋例外時照樣能跑', () => {
    ;(globalThis as Record<string, unknown>)['localStorage'] = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    expect(readSeenTutorials().size).toBe(0)
    expect(() => markTutorialSeen('fighter')).not.toThrow()
  })
})

describe('教學卡的內容', () => {
  const all: Tutorial[] = [FIGHTER_TUTORIAL, TORPEDO_TUTORIAL, BOMB_TUTORIAL, FIGHTER_BOMB_TUTORIAL]

  it('每張卡的 id 都不同 —— 撞了的話看過一張等於看過兩張', () => {
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length)
  })

  for (const t of all) {
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

  it('index.html 有暫停時重看的「教學」按鈕，一開始藏著', () => {
    const html = srcOf('index.html')
    const tag = html.match(/<button id="help"[^>]*>/)
    expect(tag).not.toBeNull()
    expect(tag![0]).toContain('data-act="help"')
    expect(tag![0]).toContain('hidden')
  })

  /** 【出擊時只挑沒看過的】看過的不能每一場再彈一次 */
  it('載入時只排沒看過的卡', () => {
    const main = srcOf('main.ts')
    const head = 'async function loadBattle(): Promise<void> {'
    const body = main.slice(main.indexOf(head), main.indexOf('\n}', main.indexOf(head)))
    expect(body).toContain('unseenTutorials(playerTutorials(), readSeenTutorials())')
  })

  /** 【按「了解」才算看過】只彈不記的話，每一場都會再彈 */
  it('每一張按「了解」就記成看過', () => {
    const menu = srcOf('menu.ts')
    const at = menu.indexOf('function nextTutorial(): void {')
    const body = menu.slice(at, menu.indexOf('\n  }\n', at))
    expect(body).toContain('markTutorialSeen(')
  })

  /** 【「教學」按鈕只在暫停時出現】飛行中指標鎖著，按鈕點不到 */
  it('暫停選單打開才顯示「教學」按鈕，關掉就藏', () => {
    const menu = srcOf('menu.ts')
    const at = menu.indexOf('setPaused(v) {')
    const body = menu.slice(at, menu.indexOf('\n    },', at))
    expect(body).toContain('help.hidden = !helpAvailable')
    expect(body).toContain('help.hidden = true')
  })

  /**
   * 【遲到的放開也不算】`exitPointerLock` 是非同步的：卡片一出現就按掉的話，
   * 放開發生在卡片關掉之後，只靠 `tutorialOpen` 擋不住 —— 暫停選單蓋上來，
   * 遊戲停在第一幀。教學放開之前先記一筆，那一次放開照記號略過。
   */
  it('教學自己放開的那一次指標不算玩家按了 Esc', () => {
    const main = srcOf('main.ts')
    const open = main.indexOf('menu.showTutorials(tutorialPending')
    const exit = main.indexOf('document.exitPointerLock()', open)
    expect(main.slice(open, exit)).toContain('ignoreNextUnlock = true')
    const at = main.indexOf('if (input.pointerLockLost || input.pauseRequested) {')
    const block = main.slice(at, main.indexOf('menu.setPaused(true)', at))
    expect(block).toContain('if (unlocked && ignoreNextUnlock)')
  })

  /** 【教學自己放開指標】放開那一下不能被當成玩家按了 Esc，否則暫停選單會疊在卡上 */
  it('教學卡開著時，放開指標不彈暫停選單', () => {
    const main = srcOf('main.ts')
    const at = main.indexOf('if (input.pointerLockLost || input.pauseRequested) {')
    const block = main.slice(at, main.indexOf('menu.setPaused(true)', at))
    expect(block).toContain('!tutorialOpen')
  })
})
