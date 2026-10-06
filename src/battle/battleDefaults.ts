import type { BattleConfig } from './battleConfig'
import { ACE } from '../ai/profile'
import { P51D } from '../specs/p51d'
import { BF109K4 } from '../specs/bf109k4'
import { HEAD_ON } from './entry'
import { lineAbreast } from './order'
import { NEUTRAL_TUNING } from './mission'

export const DEFAULT_BATTLE: BattleConfig = {
  // 【對頭 20v20 是預設】直接吃 `DEFAULT_BATTLE` 的整合測試與探針都建立在它上面
  units: lineAbreast(HEAD_ON, P51D, 20, BF109K4, 20),
  altitude: 4000,
  tas: 200,
  entryRange: 10000,
  schwarmSpacing: 800,
  lateralOffset: 1500,
  altitudeSpread: 300,
  // 【測試的基準是天花板】遊戲的難度由 `battleConfigFrom` 覆寫，見
  // `aiProfile` 的註解。
  aiProfile: ACE,
  // 【遭遇戰＝沒有時限的殲滅】它是一條規則，不是兩行寫死的判斷
  rules: { kind: 'annihilate' },
  tuning: NEUTRAL_TUNING,
}
