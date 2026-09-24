/// <reference lib="webworker" />
import { createLeyte } from '../world/leyte'
import { bakeLeyteCanopy } from './flora'

/**
 * 雷伊泰的樹冠圖在這裡烘（`render/canopyBake.ts`）。高度場自己建一份 ——
 * `createLeyte` 是確定性的，與主執行緒那一份逐位元相同，不必把高度場傳過來。
 */
const scope = self as DedicatedWorkerGlobalScope

scope.onmessage = (): void => {
  const map = bakeLeyteCanopy(createLeyte().field)
  scope.postMessage(map, [map.data.buffer])
}
