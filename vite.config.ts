import { defineConfig } from 'vitest/config'

export default defineConfig({
  build: {
    // 【非設不可】`main.ts` 與五個工具頁都用 top-level await（模型與貼圖要
    // 在建場景之前載完）。vite 的預設 target 是 es2020 —— 那個版本沒有
    // top-level await，所以 `vite build` 會直接失敗，而 **dev server 照樣
    // 能開**：與上面那條「機庫在正式建置中靜靜消失」是同一種失效。
    target: 'es2022',
    rollupOptions: {
      // 多頁面：不列進來的話 build 只會產出 index.html，機庫在正式建置中
      // 會靜靜消失（dev server 照樣能開，所以很容易到上線前才發現）。
      // 開發用的展示區都放在 tools/，網址是 /tools/xxx.html。
      // 用相對路徑字串而非 node:path + __dirname——專案沒有 @types/node，
      // 那兩者會讓 tsc --noEmit 直接失敗，而 build 腳本第一步就是 tsc。
      input: {
        main: 'index.html',
        hangar: 'tools/hangar.html',
        ground: 'tools/ground.html',
        range: 'tools/range.html',
        propdisc: 'tools/propdisc.html',
        damageedge: 'tools/damageedge.html',
        daylight: 'tools/daylight.html',
        blast: 'tools/blast.html',
        torpedo: 'tools/torpedo.html',
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    benchmark: { include: ['bench/**/*.bench.ts'] },
  },
})
