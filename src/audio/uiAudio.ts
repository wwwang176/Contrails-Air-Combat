import { CATEGORY } from './catalog'
import { dbToGain } from './curves'
import { MIX_HEADROOM_DB } from './volume'

/**
 * 選單按鈕使用獨立 context，不受戰場的暫停、慢動作或聲道配額影響。
 * 解碼後的 AudioBuffer 不綁 context，直接共用素材載入器的緩衝。
 */
export function createUiAudio(
  buffers: ReadonlyMap<string, AudioBuffer>, makeup: ReadonlyMap<string, number>,
) {
  let uiCtx: AudioContext | null = null
  let uiGain: GainNode | null = null
  let masterDb: number | null = 0

  function setVolume(db: number | null): void {
    masterDb = db
    if (uiGain !== null) uiGain.gain.value = db === null ? 0 : dbToGain(db + MIX_HEADROOM_DB)
  }

  function play(file: string, extraDb = 0): void {
    const buf = buffers.get(file)
    if (buf === undefined) return
    // 第一次有素材可播才建立 context，避免無聲時仍佔用音訊硬體。
    if (uiCtx === null) {
      uiCtx = new AudioContext()
      uiGain = uiCtx.createGain()
      uiGain.gain.value = masterDb === null ? 0 : dbToGain(masterDb + MIX_HEADROOM_DB)
      uiGain.connect(uiCtx.destination)
    }
    // 每次都恢復，分頁切回來時瀏覽器可能已將 context 暫停。
    void uiCtx.resume().catch(() => {})
    const src = uiCtx.createBufferSource()
    src.buffer = buf
    const g = uiCtx.createGain()
    g.gain.value = dbToGain(CATEGORY.ui.gainDb + (makeup.get(file) ?? 0) + extraDb)
    src.connect(g).connect(uiGain!)
    src.start()
  }

  return { play, setVolume }
}
