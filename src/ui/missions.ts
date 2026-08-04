import type { FactionChoice } from '../battle/skirmish'

/** 任務類型。對應 `docs/prompt.md` 規劃的五種 */
export type MissionType = '殲滅' | '攔截' | '打擊' | '護航' | '撤離'

export interface MissionCard {
  title: string
  type: MissionType
  /** 1~5 星 */
  difficulty: number
  /** 卡片上的一行說明 */
  summary: string
}

/**
 * 兩個陣營的任務。
 *
 * 【M10 全部不可點】這裡只有資料與文案，沒有任何行為。任務真的要做是
 * M11 之後的事 —— 那時每一張卡會多一個「怎麼打」的欄位（M10 spec §15）。
 */
export const MISSIONS: Record<FactionChoice, readonly MissionCard[]> = {
  allies: [
    { title: '諾曼第上空掃蕩', type: '殲滅', difficulty: 2, summary: '清空灘頭上空的攔截機。' },
    { title: '攔截 He 111 轟炸群', type: '攔截', difficulty: 3, summary: '在轟炸機投彈前擊落它們。' },
    { title: '打擊魯爾鐵路', type: '打擊', difficulty: 3, summary: '切斷補給線上的列車與調車場。' },
    { title: '護送 B-17 至集合點', type: '護航', difficulty: 4, summary: '把每一架轟炸機帶到集合點。' },
    { title: '且戰且走', type: '撤離', difficulty: 5, summary: '頂著數量劣勢活著退出戰區。' },
  ],
  axis: [
    { title: '帝國防空巡邏', type: '殲滅', difficulty: 2, summary: '驅離侵入本土空域的護航機。' },
    { title: '攔截 B-17 轟炸群', type: '攔截', difficulty: 3, summary: '突破護航網，打掉重轟炸機。' },
    { title: '打擊登陸艦隊', type: '打擊', difficulty: 4, summary: '在灘頭上空掩護，攻擊登陸艦艇。' },
    { title: '護送運輸機', type: '護航', difficulty: 3, summary: '掩護運輸機穿越敵方巡邏區。' },
    { title: '撤出包圍', type: '撤離', difficulty: 5, summary: '在補給斷絕的機場起飛並脫離。' },
  ],
}
