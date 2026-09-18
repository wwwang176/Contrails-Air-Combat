/**
 * 測試開跑前先產出 `public/models/`（`scripts/compress-models.mjs`，增量）。
 *
 * 【測試讀的是發佈出去的那一份】讀 GLB 的測試走 `public/models/`，也就是線上
 * 實際載入的檔案 —— 壓過的那幾支因此連解碼路徑一起被測到。那個目錄不進版控，
 * 剛 clone 下來時是空的，少了這一步那些測試全部讀不到檔。
 *
 * 寫成 .mjs：tsc 不檢查它，也就不必為了一個 import 補 node 的型別。
 */
export default async function () {
  await import('../../scripts/compress-models.mjs')
}
