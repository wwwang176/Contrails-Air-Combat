import { SINGLE_FILES } from '../audio/catalog'

/** 退回上一頁，以及收起疊在上面的暫停、確認框、設定、教學卡：同一聲 */
const CLOSE_ACTS = new Set([
  'back', 'toSetup', 'toMission', 'toMenu',
  'resume', 'tutorialOk', 'restartNo', 'abandonNo', 'toMenuNo',
  'settingsCancel', 'reloadNo', 'planePickCancel',
])

/** 選單動作代號對應到該播的介面音效 */
export function uiSound(act: string | undefined): string {
  if (act === undefined) return SINGLE_FILES.uiClick
  if (CLOSE_ACTS.has(act)) return SINGLE_FILES.uiClose
  return SINGLE_FILES.uiClick
}
