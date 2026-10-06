import { ALLIES } from './allies'
import { GERMANY } from './germany'
import { JAPAN } from './japan'
import type { Campaign, MissionCard } from './types'

/** 任務目錄與既有匯出介面；設定轉換與地面編組各由專用模組負責。 */
export * from './types'
export { CONVOY, KILL } from './shared'
export { missionRules, missionConfigFrom } from './configuration'
export { convoyGround, columnGround } from './groundColumns'

/** 三條線的全部卡片。選單與測試共用。 */
export const MISSIONS: Record<Campaign, readonly MissionCard[]> = {
  allies: ALLIES,
  germany: GERMANY,
  japan: JAPAN,
}
