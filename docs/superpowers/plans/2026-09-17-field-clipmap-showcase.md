# 田色 clipmap 展示區 —— 實作計畫

2026-09-17　spec：`docs/superpowers/specs/2026-09-17-field-clipmap-showcase-design.md`

## 步驟

1. **純函式 TDD**　`test/unit/field-clipmap.test.ts` 先寫、先紅：
   `windowOriginFor`、`needsRecentre`、`newCellRects`、`torusPieces`。
   暴力法對照（N = 8 與 N = 16，位移涵蓋 0、±1、±N/8、±N/2、±N、±(N+3)，
   兩軸獨立與同時）。
2. **模組**　`src/render/fieldClipmap.ts`：純函式 ＋ `createFieldClipmap`。
   GPU 那一半沒有單元測試（vitest 是 node 環境），靠 Playwright。
3. **展示區**　`tools/clipmap.html`、`src/tools/clipmap.ts`、`vite.config.ts`。
4. **Playwright**　`scratchpad` 的探針：開頁、切模式、飛過 1 km、截三個機位、
   量兩個模式的幀時間。
5. **Codex 審查** spec＋plan 一次（背景），diff 一次。

## 不動的檔案

`src/render/fields.ts`、`farmGround.ts`、`farHorizon.ts`、`terrain.ts`、
`main.ts`（裡面那段試玩用的暫時鉤子另外拆，不在這個計畫裡）。
