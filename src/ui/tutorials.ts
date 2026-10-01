import type { OrdnanceKind } from '../weapons/stores'
import type { AircraftSpec } from '../specs/types'
import type { MessageKey, MessageParams } from '../i18n'

/**
 * # 教學卡
 *
 * 一張卡是一排幾格，每格一張遊戲截圖配一句話。
 *
 * 【每張只自動出現一次】出擊之後、第一幀畫完，這架飛機還沒看過的卡依序彈出，
 * 按「了解」記下來，之後不再自動彈。戰鬥中按 Esc，右上角的「教學」按鈕可以把這架
 * 飛機的卡全部重看一次。
 *
 * 【只講玩家非知道不可的】操作流程與畫面上怎麼判讀，白話、一格一句。數值與
 * 原理不寫 —— 玩家飛一次就知道了。
 *
 * 【依機種與掛載，不依關卡】戰鬥機看空戰的卡；掛魚雷、掛炸彈各一張卡。任務與
 * 遭遇戰都一樣，換一台同類的飛機不必再登記一次。
 *
 * 【標籤是 HTML，不畫在圖上】疊在截圖上、以圖的百分比定位，字跟著介面的
 * 字型、配色與語言走；截圖上不能有字，否則換語言時圖上那幾個字還是原來的。
 *
 * 文字欄位都是文字表的鍵（`src/i18n`），畫的時候才查。
 */

export interface TutorialTag {
  readonly textKey: MessageKey
  /** 句子的參數（HUD 讀數的數值） */
  readonly params?: MessageParams
  /** 接在句子後面、不必翻的符號（讀數出界的箭頭） */
  readonly suffix?: string
  /**
   * 仿 HUD 讀數的樣式：等寬字、`ok` 綠、`bad` 紅。省略 = 一般的說明標籤。
   * 截圖上不能有字，HUD 的讀數在圖上的位置改由這種標籤補回來
   */
  readonly hud?: 'ok' | 'bad'
  /** 標籤中心在圖上的位置，以圖寬／圖高的百分比計（0–100） */
  readonly x: number
  readonly y: number
}

export interface TutorialPanel {
  /** 截圖，`public/` 底下的路徑。經 `assetUrl` 載 */
  readonly image: string
  readonly altKey: MessageKey
  readonly tags: readonly TutorialTag[]
  readonly captionKey: MessageKey
  /** 觸控裝置上的說法。**省略 = 與 `captionKey` 相同**（那一句沒提到滑鼠或按鍵） */
  readonly touchCaptionKey?: MessageKey
}

/** 這一格在這台裝置上要印哪一句 */
export function captionOf(p: TutorialPanel, touch: boolean): MessageKey {
  return touch ? p.touchCaptionKey ?? p.captionKey : p.captionKey
}

export interface Tutorial {
  /** 記「看過了」用的鍵。**改了等於所有玩家重看一次** */
  readonly id: string
  readonly titleKey: MessageKey
  readonly panels: readonly TutorialPanel[]
}

export const FIGHTER_TUTORIAL: Tutorial = {
  id: 'fighter',
  titleKey: 'tutorial.fighter.title',
  panels: [
    {
      image: '/ui/tutorial/fighter-1.jpg', altKey: 'tutorial.fighter.1.alt',
      tags: [{ textKey: 'tutorial.tag.circle', x: 39, y: 29 }, { textKey: 'tutorial.tag.nose', x: 83, y: 18 }],
      captionKey: 'tutorial.fighter.1.caption',
      touchCaptionKey: 'tutorial.fighter.1.touch',
    },
    {
      image: '/ui/tutorial/fighter-2.jpg', altKey: 'tutorial.fighter.2.alt',
      tags: [{ textKey: 'tutorial.tag.guns', x: 24, y: 42 }],
      captionKey: 'tutorial.fighter.2.caption',
      touchCaptionKey: 'tutorial.fighter.2.touch',
    },
    {
      image: '/ui/tutorial/fighter-3.jpg', altKey: 'tutorial.fighter.3.alt',
      tags: [{ textKey: 'tutorial.tag.enemy', x: 66, y: 58 }, { textKey: 'tutorial.tag.lead', x: 41, y: 20 }],
      captionKey: 'tutorial.fighter.3.caption',
    },
  ],
}

export const TORPEDO_TUTORIAL: Tutorial = {
  id: 'torpedo',
  titleKey: 'tutorial.torpedo.title',
  panels: [
    {
      image: '/ui/tutorial/torpedo-1.jpg', altKey: 'tutorial.sight.alt', tags: [],
      captionKey: 'tutorial.sight.caption',
      touchCaptionKey: 'tutorial.sight.touch',
    },
    {
      image: '/ui/tutorial/torpedo-2.jpg', altKey: 'tutorial.torpedo.2.alt',
      tags: [{ textKey: 'tutorial.tag.splash', x: 49, y: 89 }, { textKey: 'tutorial.tag.track', x: 70, y: 40 }],
      captionKey: 'tutorial.torpedo.2.caption',
    },
    {
      image: '/ui/tutorial/torpedo-3.jpg', altKey: 'tutorial.torpedo.3.alt',
      tags: [
        { textKey: 'tutorial.tag.gate', x: 50, y: 66 },
        { textKey: 'hud.gate.bank', params: { v: 1 }, hud: 'ok', x: 16, y: 81 },
        { textKey: 'hud.gate.pitch', params: { v: -25 }, hud: 'ok', x: 50, y: 81 },
        { textKey: 'hud.gate.agl', params: { v: 345 }, suffix: ' ▼', hud: 'bad', x: 84, y: 81 },
      ],
      captionKey: 'tutorial.torpedo.3.caption',
    },
  ],
}

export const BOMB_TUTORIAL: Tutorial = {
  id: 'bomb',
  titleKey: 'tutorial.bomb.title',
  panels: [
    {
      image: '/ui/tutorial/bomb-1.jpg', altKey: 'tutorial.sight.alt', tags: [],
      captionKey: 'tutorial.sight.caption',
      touchCaptionKey: 'tutorial.sight.touch',
    },
    {
      image: '/ui/tutorial/bomb-2.jpg', altKey: 'tutorial.bomb.2.alt',
      tags: [{ textKey: 'tutorial.tag.impact', x: 62, y: 20 }],
      captionKey: 'tutorial.bomb.2.caption',
    },
    {
      image: '/ui/tutorial/bomb-3.jpg', altKey: 'tutorial.bay.alt',
      tags: [{ textKey: 'tutorial.tag.bay', x: 50, y: 64 }],
      captionKey: 'tutorial.bomb.3.caption',
    },
  ],
}

/**
 * 直接投彈（掛彈戰鬥機、Ju 87）。**沒有瞄準視角** —— B 直接投，落點圈留在
 * 一般視角裡。圖沿用轟炸機那一張的落點圈與彈艙格子。
 *
 * 【id 不隨名稱改】它是存進 `localStorage` 的鍵，改了的話看過的人會再看一次。
 */
export const DIRECT_BOMB_TUTORIAL: Tutorial = {
  id: 'fighterBomb',
  titleKey: 'tutorial.bomb.title',
  panels: [
    {
      image: '/ui/tutorial/bomb-2.jpg', altKey: 'tutorial.fighterBomb.1.alt',
      tags: [{ textKey: 'tutorial.tag.impact', x: 62, y: 20 }],
      captionKey: 'tutorial.fighterBomb.1.caption',
      touchCaptionKey: 'tutorial.fighterBomb.1.touch',
    },
    {
      image: '/ui/tutorial/bomb-3.jpg', altKey: 'tutorial.bay.alt',
      tags: [{ textKey: 'tutorial.tag.bombs', x: 50, y: 64 }],
      captionKey: 'tutorial.fighterBomb.2.caption',
    },
  ],
}

/**
 * 這架飛機的全部教學卡，依序。戰鬥機先看空戰；有掛載再看那一種的卡。
 * 轟炸機只看投彈或投雷 —— 它不靠前射機槍打仗。直接投彈的機種（沒有
 * 瞄準視角）操作與有瞄具的轟炸機不同，所以是另一張卡；選哪張看操作方式，
 * 不看機種的 `role`（Ju 87 是轟炸機但直接投彈）。
 */
export function tutorialsFor(
  role: AircraftSpec['role'], ordnance: OrdnanceKind | null, directDrop: boolean,
): Tutorial[] {
  const out: Tutorial[] = []
  if (role === 'fighter') out.push(FIGHTER_TUTORIAL)
  if (ordnance === 'torpedo') out.push(TORPEDO_TUTORIAL)
  else if (ordnance === 'bomb') out.push(directDrop ? DIRECT_BOMB_TUTORIAL : BOMB_TUTORIAL)
  return out
}

const SEEN_KEY = 'tutorial.seen'

/**
 * 看過的卡。**讀寫都包 try** —— 無痕視窗與封鎖站台資料的設定會讓
 * `localStorage` 直接拋，那時每一場都重彈一次，遊戲照樣能玩。
 * 壞掉的存檔（不是字串陣列）當成都沒看過。
 */
export function readSeenTutorials(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function markTutorialSeen(id: string): void {
  try {
    const seen = readSeenTutorials()
    seen.add(id)
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]))
  } catch { /* 存不了就算了，見上面 */ }
}

/** 這一場要自動彈的卡：這架飛機的卡裡還沒看過的，依序 */
export function unseenTutorials(all: readonly Tutorial[], seen: ReadonlySet<string>): Tutorial[] {
  return all.filter((t) => !seen.has(t.id))
}
