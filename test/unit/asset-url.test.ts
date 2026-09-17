import { describe, it, expect } from 'vitest'
import { assetUrl } from '../../src/core/asset'

/**
 * `assetUrl`：`public/` 資源接上網站的基底路徑。
 *
 * vitest 是 serve，基底恆為 `/`，所以這裡只驗「接法」；建置時換成
 * `/Contrails-Air-Combat/` 要看 `vite build` 的產物。
 */
describe('assetUrl', () => {
  it('根目錄開頭的路徑接在基底後面，不會多一個斜線', () => {
    expect(import.meta.env.BASE_URL).toBe('/')
    expect(assetUrl('/models/p51d.glb')).toBe('/models/p51d.glb')
    expect(assetUrl('/ui/sil/a6m5.png')).toBe('/ui/sil/a6m5.png')
  })

  it('不是根目錄開頭的原樣回傳', () => {
    expect(assetUrl('https://example.com/x.glb')).toBe('https://example.com/x.glb')
    expect(assetUrl('blob:abc')).toBe('blob:abc')
    expect(assetUrl('models/p51d.glb')).toBe('models/p51d.glb')
  })
})
