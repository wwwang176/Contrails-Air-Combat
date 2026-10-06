import { SINGLE_FILES } from '../audio/catalog'

const BACK_ACTS = new Set(['back', 'toSetup', 'toMission', 'toMenu'])
const CLOSE_ACTS = new Set([
  'resume', 'tutorialOk', 'restartNo', 'abandonNo', 'toMenuNo',
  'settingsCancel', 'reloadNo', 'planePickCancel',
])

/** Maps menu action identifiers to the corresponding UI sound. */
export function uiSound(act: string | undefined): string {
  if (act === undefined) return SINGLE_FILES.uiClick
  if (BACK_ACTS.has(act)) return SINGLE_FILES.uiBack
  if (CLOSE_ACTS.has(act)) return SINGLE_FILES.uiClose
  return SINGLE_FILES.uiClick
}
