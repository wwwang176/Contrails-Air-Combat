import type { MessageKey } from '../i18n'
import { AIRCRAFT_MODEL_COUNT, preloadAircraftModels } from '../render/geometry/buildAircraft'
import { groundModelUrls, preloadGroundModels } from '../render/geometry/ground'
import { preloadShipModels } from '../render/ships'
import { BALLOON_MODEL_COUNT, preloadBalloonModel } from '../render/balloons'
import { fileFraction, type LoadingScreen } from '../ui/loading'

/**
 * 啟動時備妥同步建模需要的樣板。載入畫面在 HTML 裡已蓋著，全部完成才收。
 * 任務專用的廠區與機場佈景在進關卡時載入，不阻擋選單啟動。
 */
export async function preloadStartupAssets(loading: Pick<LoadingScreen, 'set' | 'step' | 'hold' | 'finish'>): Promise<void> {
  const shipIds = ['essex', 'wichita', 'fletcher', 'lst'] as const
  const fileTotal = AIRCRAFT_MODEL_COUNT + shipIds.length + groundModelUrls().length + BALLOON_MODEL_COUNT
  let filesDone = 0
  let fileLabel: MessageKey = 'loading.preparing'
  const fileLoaded = (): void => {
    filesDone++
    loading.set(fileLabel, fileFraction(filesDone, fileTotal))
  }
  const loadGroup = (label: MessageKey): Promise<void> => {
    fileLabel = label
    return loading.step(label, fileFraction(filesDone, fileTotal))
  }
  await loading.hold()
  await loadGroup('loading.aircraft')
  await preloadAircraftModels(fileLoaded)
  // 同步建船需要四種樣板；任一種漏載會讓使用該艦級的關卡無法進場。
  await loadGroup('loading.ships')
  await preloadShipModels(shipIds, fileLoaded)
  await loadGroup('loading.ground')
  await preloadGroundModels(undefined, fileLoaded)
  await preloadBalloonModel(fileLoaded)
  await loading.finish('loading.done')
}
