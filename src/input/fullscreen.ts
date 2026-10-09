/** 可以進全螢幕的元素。iPad Safari 只有加前綴的 `webkitRequestFullscreen` */
export interface FullscreenTarget {
  requestFullscreen?: () => Promise<void> | void
  webkitRequestFullscreen?: () => void
}

/** 讀「現在是不是全螢幕」的文件 */
export interface FullscreenDocument {
  fullscreenElement?: Element | null
  webkitFullscreenElement?: Element | null
}

/**
 * 進全螢幕；已經是全螢幕就不動。**要在使用者手勢裡呼叫**，否則瀏覽器拒絕。
 *
 * 不支援（iPhone Safari 只准影片全螢幕，兩個方法都沒有）、被拒絕、同步拋錯都當作沒事 ——
 * 呼叫端是出擊、繼續那一下，拋錯會讓後面的載入整個不跑。
 */
export function enterFullscreen(el: FullscreenTarget, doc: FullscreenDocument): void {
  if (doc.fullscreenElement || doc.webkitFullscreenElement) return
  try {
    if (el.requestFullscreen !== undefined) {
      void Promise.resolve(el.requestFullscreen()).catch(() => {})
      return
    }
    el.webkitRequestFullscreen?.()
  } catch {
    // 不支援或被拒絕：維持原本的視窗大小
  }
}
