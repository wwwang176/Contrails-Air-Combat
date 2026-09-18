import type { OrdnanceKind } from '../weapons/stores'
import type { Screen } from './screens'

/**
 * # 進場教學
 *
 * 出擊之後、第一幀畫完就暫停，彈出一張卡：一排幾格，每格一張遊戲截圖配一句
 * 話。按「了解」才開始飛。
 *
 * 【只講玩家非知道不可的】操作流程與畫面上怎麼判讀，白話、一格一句。數值與
 * 原理不寫 —— 玩家飛一次就知道了。
 *
 * 【依掛載，不依關卡】掛魚雷就是投雷的卡、掛炸彈就是投彈的卡 —— 任務與
 * 遭遇戰都一樣，換一台掛同樣東西的飛機不必再登記一次。
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
  readonly title: string
  readonly panels: readonly TutorialPanel[]
}

export const TORPEDO_TUTORIAL: Tutorial = {
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

/** 這一場該看哪一張卡。沒有掛載就沒有卡 */
export function tutorialFor(ordnance: OrdnanceKind | null): Tutorial | null {
  if (ordnance === 'torpedo') return TORPEDO_TUTORIAL
  if (ordnance === 'bomb') return BOMB_TUTORIAL
  return null
}

/**
 * 這一次出擊要不要彈教學。
 *
 * 【從選單進來才彈】遭遇戰的設定頁、任務的簡報按出擊是 `from` 為那一頁；
 * 結算板的「再打一場」是從 `battle` 自己出擊 —— 同一場剛看過，不再彈。
 * 暫停選單的「重新開始」根本不走出擊（`onRestart`），也不彈。
 */
export function tutorialOnFight(from: Screen): boolean {
  return from !== 'battle'
}
