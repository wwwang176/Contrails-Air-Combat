/**
 * Vite 在建置時字面替換的 `import.meta.env`。**只宣告用到的欄位** —— 專案沒有
 * 引入 `vite/client` 的整份型別。
 *
 * 【一定要寫成 `import.meta.env.BASE_URL`】Vite 是照字面替換的；轉型、解構或
 * 可選鏈的寫法在建置後會拿到 undefined，而 dev server 照樣正常。
 */
interface ImportMetaEnv {
  readonly BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
