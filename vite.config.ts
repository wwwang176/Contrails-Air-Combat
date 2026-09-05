import { defineConfig } from 'vitest/config'

export default defineConfig({
  build: {
    rollupOptions: {
      // 多頁面：不列進來的話 build 只會產出 index.html，機庫在正式建置中
      // 會靜靜消失（dev server 照樣能開，所以很容易到上線前才發現）。
      // 用相對路徑字串而非 node:path + __dirname——專案沒有 @types/node，
      // 那兩者會讓 tsc --noEmit 直接失敗，而 build 腳本第一步就是 tsc。
      input: {
        main: 'index.html',
        hangar: 'hangar.html',
        range: 'range.html',
        propdisc: 'propdisc.html',
        damageedge: 'damageedge.html',
        daylight: 'daylight.html',
        blast: 'blast.html',
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
