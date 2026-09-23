import type { OrdnanceKind } from '../weapons/stores'
import type { AircraftSpec } from '../specs/types'

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
 * 字型與配色走；換字不必重拍圖。
 */

export interface TutorialTag {
  readonly text: string
  /** 標籤中心在圖上的位置，以圖寬／圖高的百分比計（0–100） */
  readonly x: number
  readonly y: number
}

export interface TutorialPanel {
  /** 截圖，`public/` 底下的路徑。經 `assetUrl` 載 */
  readonly image: string
  readonly alt: string
  readonly tags: readonly TutorialTag[]
  readonly caption: string
}

export interface Tutorial {
  /** 記「看過了」用的鍵。**改了等於所有玩家重看一次** */
  readonly id: string
  readonly title: string
  readonly panels: readonly TutorialPanel[]
}

export const FIGHTER_TUTORIAL: Tutorial = {
  id: 'fighter',
  title: '空戰',
  panels: [
    {
      image: '/ui/tutorial/fighter-1.jpg', alt: '轉彎中，圓圈與十字分開、中間有一條連線',
      tags: [{ text: '圓圈', x: 39, y: 29 }, { text: '機頭', x: 83, y: 18 }],
      caption: '移動滑鼠控制圓圈，飛機會朝圓圈飛過去。',
    },
    {
      image: '/ui/tutorial/fighter-2.jpg', alt: '十字壓在敵機上開火',
      tags: [{ text: '機槍', x: 24, y: 42 }],
      caption: '十字是機槍打的方向，按住左鍵開火。',
    },
    {
      image: '/ui/tutorial/fighter-3.jpg', alt: '敵機的目標框、前方的預瞄小圈與連線',
      tags: [{ text: '敵機', x: 66, y: 58 }, { text: '預瞄點', x: 41, y: 20 }],
      caption: '敵機會一直移動，把十字對準前面的小圈再開火。',
    },
  ],
}

export const TORPEDO_TUTORIAL: Tutorial = {
  id: 'torpedo',
  title: '投雷',
  panels: [
    {
      image: '/ui/tutorial/torpedo-1.jpg', alt: '機腹的瞄準視角', tags: [],
      caption: '按 B 進入瞄準視角，再按一次離開。',
    },
    {
      image: '/ui/tutorial/torpedo-2.jpg', alt: '落水點的圓圈與往前延伸的航跡線',
      tags: [{ text: '落水點', x: 49, y: 89 }, { text: '路線', x: 70, y: 40 }],
      caption: '圈是魚雷會落下的地方，線是它接著跑的路線。綠圈表示可以投雷，紅圈表示高度或角度不對。',
    },
    {
      image: '/ui/tutorial/torpedo-3.jpg', alt: '畫面下方的坡度、俯仰、高度三格',
      tags: [{ text: '高度・角度', x: 50, y: 66 }],
      caption: '下面三格是高度和角度，變紅的那一格就是要調整的，全部變綠才能投。',
    },
  ],
}

export const BOMB_TUTORIAL: Tutorial = {
  id: 'bomb',
  title: '投彈',
  panels: [
    {
      image: '/ui/tutorial/bomb-1.jpg', alt: '機腹的瞄準視角', tags: [],
      caption: '按 B 進入瞄準視角，再按一次離開。',
    },
    {
      image: '/ui/tutorial/bomb-2.jpg', alt: '落點的圓圈壓在廠區邊上',
      tags: [{ text: '落點', x: 62, y: 20 }],
      caption: '圈是炸彈會落下的地方，把圈對準目標。綠圈表示可以投彈，紅圈表示飛太低或姿態不對。',
    },
    {
      image: '/ui/tutorial/bomb-3.jpg', alt: '畫面下方的彈艙格子',
      tags: [{ text: '彈艙', x: 50, y: 64 }],
      caption: '下面這排是彈艙，亮著的是還有的炸彈。',
    },
  ],
}

/**
 * 掛彈戰鬥機的投彈。**沒有瞄準視角** —— B 直接投，落點圈留在一般視角裡。
 * 圖沿用轟炸機那一張的落點圈與彈艙格子。
 */
export const FIGHTER_BOMB_TUTORIAL: Tutorial = {
  id: 'fighterBomb',
  title: '投彈',
  panels: [
    {
      image: '/ui/tutorial/bomb-2.jpg', alt: '落點的圓圈壓在目標上',
      tags: [{ text: '落點', x: 62, y: 20 }],
      caption: '圈是炸彈會落下的地方。俯衝把圈壓在目標上，按 B 投彈。',
    },
    {
      image: '/ui/tutorial/bomb-3.jpg', alt: '畫面下方的彈艙格子',
      tags: [{ text: '炸彈', x: 50, y: 64 }],
      caption: '下面這排是炸彈，投完會自己補回。',
    },
  ],
}

/**
 * 這架飛機的全部教學卡，依序。戰鬥機先看空戰；有掛載再看那一種的卡。
 * 轟炸機只看投彈或投雷 —— 它不靠前射機槍打仗。戰鬥機掛彈的操作與轟炸機
 * 不同（沒有瞄準視角），所以是另一張卡。
 */
export function tutorialsFor(
  role: AircraftSpec['role'], ordnance: OrdnanceKind | null,
): Tutorial[] {
  const out: Tutorial[] = []
  if (role === 'fighter') out.push(FIGHTER_TUTORIAL)
  if (ordnance === 'torpedo') out.push(TORPEDO_TUTORIAL)
  else if (ordnance === 'bomb') out.push(role === 'fighter' ? FIGHTER_BOMB_TUTORIAL : BOMB_TUTORIAL)
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
