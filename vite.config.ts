import { defineConfig } from 'vitest/config'

/**
 * 工具頁（開發用的展示區），網址是 /tools/xxx.html。
 *
 * 用相對路徑字串而非 node:path + __dirname——專案沒有 @types/node，
 * 那兩者會讓 tsc --noEmit 直接失敗，而 build 腳本第一步就是 tsc。
 */
const TOOLS = {
  hangar: 'tools/hangar.html',
  ground: 'tools/ground.html',
  range: 'tools/range.html',
  propdisc: 'tools/propdisc.html',
  damageedge: 'tools/damageedge.html',
  daylight: 'tools/daylight.html',
  blast: 'tools/blast.html',
  smoke: 'tools/smoke.html',
  torpedo: 'tools/torpedo.html',
  recovery: 'tools/recovery.html',
  clipmap: 'tools/clipmap.html',
}

export default defineConfig(({ command, mode }) => ({
  /**
   * 網站掛在哪一層路徑底下。
   *
   * 【建置時是 `/Contrails-Air-Combat/`】GitHub Pages 的專案頁網址是
   * `https://<user>.github.io/<repo>/`，資源從那一層開始找。`vite build` 會把
   * HTML 與 import 進來的資源改寫到這裡；程式裡寫死的 `/models/…` 那種字串
   * 不會被改寫，所以發出請求的地方一律經過 `core/asset.ts` 的 `assetUrl`。
   *
   * 【開發與測試維持 `/`】`npm run dev` 與 vitest 都是 serve，不帶子路徑。
   * 部署到別的地方時用環境變數 `BASE_PATH` 覆寫（例如 `/`）。
   */
  base: command === 'build' ? process.env['BASE_PATH'] ?? '/Contrails-Air-Combat/' : '/',
  build: {
    // 【非設不可】`main.ts` 與五個工具頁都用 top-level await（模型與貼圖要
    // 在建場景之前載完）。vite 的預設 target 是 es2020 —— 那個版本沒有
    // top-level await，所以 `vite build` 會直接失敗，而 **dev server 照樣
    // 能開**：與下面那條「工具頁在正式建置中靜靜消失」是同一種失效。
    target: 'es2022',
    // 【工具頁那一趟不清目錄】它疊在遊戲那一趟的輸出上，清掉的話遊戲就沒了
    emptyOutDir: mode !== 'tools',
    rollupOptions: {
      // 【遊戲與工具頁分兩趟建】`npm run build` 先建遊戲、再以 `--mode tools`
      // 建工具頁到同一個 dist。同一趟建的話多個入口共用的模組會被切成共用
      // chunk，遊戲首頁要抓三十幾個 JS；遊戲單獨一趟就是一整包。
      //
      // 【工具頁一定要建】不列進來的話它們在正式建置中會靜靜消失（dev server
      // 照樣能開，所以很容易到上線前才發現）。
      input: mode === 'tools' ? TOOLS : { main: 'index.html' },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    benchmark: { include: ['bench/**/*.bench.ts'] },
  },
}))
