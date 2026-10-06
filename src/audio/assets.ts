import { assetUrl } from '../core/asset'
import { FIRST_FILES } from './catalog'

/** 只依賴解碼能力，載入器不操作播放聲道或音訊時鐘。 */
export function createAudioAssets(ctx: Pick<BaseAudioContext, 'decodeAudioData'>) {
  const buffers = new Map<string, AudioBuffer>()
  const makeup = new Map<string, number>()
  /** 每個檔的素材包絡，每 ENVELOPE_STEP 秒一格、相對自己最響的那一格。 */
  const envelopes = new Map<string, readonly number[]>()
  let loading: Promise<void> | null = null
  let filesDone = 0
  let fileTotal = 0
  let onProgress: ((done: number, total: number) => void) | null = null

  async function loadAll(): Promise<void> {
    const res = await fetch(assetUrl('/audio/manifest.json'))
    const manifest = await res.json() as
      Record<string, { loop: boolean; makeupDb: number; envelopeDb?: number[] }>
    // 穩定排序讓選單按鈕音先載入，其餘素材維持清單順序。
    const first = new Set<string>(FIRST_FILES)
    const ids = Object.keys(manifest)
      .sort((a, b) => Number(first.has(b)) - Number(first.has(a)))
    for (const id of ids) {
      makeup.set(id, manifest[id]!.makeupDb)
      const e = manifest[id]!.envelopeDb
      if (e !== undefined) envelopes.set(id, e)
    }
    fileTotal = ids.length
    onProgress?.(filesDone, fileTotal)
    let next = 0
    // 最多六個並行，避免佔滿連線而延遲模型下載。
    async function worker(): Promise<void> {
      while (next < ids.length) {
        const id = ids[next++]!
        try {
          const r = await fetch(assetUrl(`/audio/${id}.mp3`))
          buffers.set(id, await ctx.decodeAudioData(await r.arrayBuffer()))
        } catch (e) {
          console.warn(`音效載入失敗：${id}`, e)
        }
        // 失敗也推進進度，避免少一支檔案時載入畫面永遠無法結束。
        filesDone++
        onProgress?.(filesDone, fileTotal)
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
  }

  async function load(cb?: (done: number, total: number) => void): Promise<void> {
    // 中途加入先回報已知進度，素材已載完時仍可結束載入畫面。
    if (cb !== undefined) {
      onProgress = cb
      if (fileTotal > 0) cb(filesDone, fileTotal)
    }
    loading ??= loadAll().catch((e) => { console.warn('音效清單載入失敗', e) })
    try {
      await loading
    } finally {
      if (onProgress === cb) onProgress = null
    }
  }

  return { buffers, makeup, envelopes, load }
}
