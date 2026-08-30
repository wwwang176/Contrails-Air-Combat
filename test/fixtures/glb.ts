/**
 * 把 GLB 機種載進 **node** 測試環境。
 *
 * 【為什麼需要這一支】`buildAircraft` 對 GLB 機種要求樣板已經預載，而
 * `preloadAircraftModels()` 走的是 `fetch('/models/…')` —— 那是瀏覽器的路。
 * vitest 跑在 node，沒有 dev server，`fetch` 一個絕對路徑會直接爆。
 *
 * `glb.ts` 早就留了 `parseGlbTemplate` + `registerGlbTemplate` 這道門給
 * node（見那個檔案的註解），這裡只是把「自己讀檔」那一半補上。
 *
 * 【為什麼可以 import node:fs】專案沒有裝 `@types/node`，但 vitest 與
 * playwright 的型別宣告已經把 node 的環境型別帶進同一個 program，所以
 * `tsc --noEmit` 掃得過。`src/` 底下不要學這一招 —— 那些程式碼跑在瀏覽器。
 */
import { readFileSync } from 'node:fs'
import { GLB_MODELS } from '../../src/render/geometry/buildAircraft'
import { parseGlbTemplate, registerGlbTemplate } from '../../src/render/geometry/glb'

/** manifest 的 url 是**瀏覽器**路徑（`/models/…`），檔案在 `public/` 底下。 */
const PUBLIC = 'public'

let loaded = false

/**
 * 載入所有 GLB 機種的樣板。可以重複呼叫，第二次之後是 no-op ——
 * 每個測試檔各自 `beforeAll` 一次，不必互相知道對方做過了。
 */
export async function loadGlbTemplatesForNode(): Promise<void> {
  if (loaded) return
  for (const [id, def] of Object.entries(GLB_MODELS)) {
    const buf = readFileSync(`${PUBLIC}${def.url}`)
    // Buffer 的 ArrayBuffer 可能比它自己長（node 會共用底層記憶體池），
    // 所以要切出這一段，不能直接丟 `buf.buffer`
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    registerGlbTemplate(id, await parseGlbTemplate(bytes, def))
  }
  loaded = true
}
