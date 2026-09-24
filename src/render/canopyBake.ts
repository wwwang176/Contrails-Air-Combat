import type { CanopyMap } from './leyteGround'

/**
 * 雷伊泰的精細樹冠圖：在背景執行緒烘（`canopy.worker.ts`），**整個遊戲只烘
 * 一次**，之後每一場直接拿同一份。
 *
 * 回 null = 這個環境沒有 Web Worker（單元測試），或背景執行緒起不來 —— 呼叫端
 * 留著粗的那一張，林子是平均的暗綠，不影響其他東西。
 */
let pending: Promise<CanopyMap | null> | null = null

export function requestLeyteCanopy(): Promise<CanopyMap | null> | null {
  if (typeof Worker === 'undefined') return null
  if (pending !== null) return pending
  pending = new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./canopy.worker.ts', import.meta.url), { type: 'module', name: 'leyte-canopy' })
    } catch {
      resolve(null)
      return
    }
    worker.onmessage = (event: MessageEvent<CanopyMap>): void => {
      resolve(event.data)
      worker.terminate()
    }
    worker.onerror = (): void => {
      resolve(null)
      worker.terminate()
    }
    worker.postMessage(null)
  })
  return pending
}
