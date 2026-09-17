import type { BattleConfig } from './setup'

/** 這一場要掛哪幾組點光源 */
export interface BattleLights {
  /** 照明彈的燈（`render/flares.ts`） */
  readonly flares: boolean
}

/**
 * 一場戰鬥要掛哪幾組點光源。**開戰時決定、整場不變。**
 *
 * 【為什麼要依關卡】點光源就算強度 0 也照算，每個受光材質的每個片元多一份
 * 光照；燈數一變又要全部重編著色器。所以用不到的那一組就不掛，而掛不掛在
 * 開場決定 —— 重編的卡頓留在載入那一刻，不會落在戰鬥中。
 *
 * 【爆炸的閃光不在這裡】擊墜與高砲每一關都有，那三盞燈恆掛（`main.ts`）。
 */
export function battleLights(cfg: BattleConfig): BattleLights {
  let flares = false
  for (const b of cfg.beats ?? []) if (b.kind === 'flare') flares = true
  return { flares }
}
