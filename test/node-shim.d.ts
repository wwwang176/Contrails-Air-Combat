/**
 * node 內建模組的**最小**型別宣告。
 *
 * 【為什麼不裝 `@types/node`】專案刻意不裝（見 `vite.config.ts` 的註解）：
 * 裝了之後 `src/` 底下也會看得到 `Buffer`、`require`、`process`，而那些東西
 * 出現在跑瀏覽器的程式碼裡時**應該要紅**。
 *
 * 【為什麼需要這一支】`test/fixtures/glb.ts` 要自己讀 `public/*.glb` 餵給
 * node 環境的 vitest。它是被 `.test.ts` import 的，所以非得通過
 * `npx tsc --noEmit` 不可 —— 探針可以像 `b17-ref.measure.ts` 那樣就地
 * `declare const process`，被測試 import 的模組不行。
 *
 * 【範圍刻意開到最小】只有 `readFileSync`，而且只有「路徑進、位元組出」
 * 這一個多載。要用到第二個 API 的時候再加，一次一個 —— 這樣「src 不該碰
 * node」這條界線還是靠型別在守，只是開了一道具名的門。
 */
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array
  /** 只給 `test/tools/p51-export.ts` 寫 GLB 用；同樣是「路徑進、位元組出」的最小多載。 */
  export function writeFileSync(path: string, data: Uint8Array): void
}
