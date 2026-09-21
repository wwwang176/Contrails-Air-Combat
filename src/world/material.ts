/**
 * 子彈打在飛機以外的東西上，打到的是什麼材質。**只給音效用。**
 *
 * 【為什麼是列舉而不是直接寫聲音】`world/` 不該知道有哪些音效檔。這裡只回答
 * 「打到什麼」，對應到哪一個聲音由 `audio/catalog.ts` 決定。
 *
 * 【認不得的怎麼辦】新加的東西忘了給材質時，音效層有一份預設 —— 不會沒聲音，
 * 也不會報錯。這比強迫每一個新目標都先想好聲音實際。
 */
export const MATERIAL = {
  /** 艦體：厚鋼板 */
  ship: 0,
  /** 地面目標：建築、車輛、砲位 */
  ground: 1,
} as const

export type ImpactMaterial = typeof MATERIAL[keyof typeof MATERIAL]
