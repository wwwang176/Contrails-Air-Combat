/**
 * 把 `public/` 底下的資源路徑接到網站的基底路徑上。
 *
 * 【為什麼需要】資料表裡寫的是 `/models/p51d.glb` 這種從網站根目錄開始的路徑。
 * 部署到 GitHub Pages 時網站在 `/Contrails-Air-Combat/` 底下，根目錄那一層是
 * 別人的 —— 直接拿去請求會 404，而本機的 dev server 照樣正常（見
 * `vite.config.ts` 的 `base`）。
 *
 * **發出請求的那一行才包它**，資料表裡的字串維持原樣：那些字串同時是測試讀
 * `public/` 檔案時的鍵。
 *
 * 不是 `/` 開頭的（完整網址、`blob:`、相對路徑）原樣回傳。
 */
export function assetUrl(path: string): string {
  if (!path.startsWith('/')) return path
  return import.meta.env.BASE_URL + path.slice(1)
}
