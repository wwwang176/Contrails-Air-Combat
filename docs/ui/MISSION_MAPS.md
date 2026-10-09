# 任務圖製作與維護指南

更新：2026-10-10。適用於目前十個可玩任務的分層作戰簡報圖。

本檔是任務圖製作與維護的唯一說明文件，整合製作流程、擺位紀錄及素材來源；`public/ui/maps/` 不另放維護文件。

## 現行方式：地形底圖 + 可編輯圖層

目前遊戲直接產生 inline SVG，把地形、雲、航線、單位、目標框、空中編隊分開呈現。使用者已確認保留此方式，**不需要再烘成一張圖片**。`review-layouts.json` 雖然名字包含 review，現在就是正式畫面讀取的位置資料。

製作原則是「真實遊戲地形、正確相對位置、清楚的任務意圖」。示意圖不必逐架精準定位，但不能把跑道兩側、前後梯隊、攻擊方向或道路上的車隊順序畫反。

| 檔案 | 用途 |
| --- | --- |
| `src/battle/missions/` | 任務、兵力、增援、地面與艦隊配置的來源；修改任務時先查這裡 |
| `public/ui/maps/reference/<id>-opening.json` | 已保存的遊戲開場部署與俯拍範圍，屬於快照，可能落後於程式 |
| `public/ui/maps/reference/<id>-terrain.webp` | 遊戲內實際俯拍地形參考 |
| `public/ui/maps/reference/objectives.json` | 匯出的任務目標與地面／艦隊配置快照 |
| `public/ui/maps/reference/review-layouts.json` | **現行**裁切、單位位置、大小、朝向、航線、雲與目標框 |
| `src/ui/missionArtwork.ts` | 任務 ID 到地形底圖的對照；勒熱夫直接使用 reference 雪地 |
| `src/ui/missionLayers.ts` | 將位置資料渲染成 SVG，套用陣營顏色、剪影與雲遮罩 |
| `src/ui/missionDiagram.ts` | 依實際勝利條件選擇目標類型，組合地圖與圖例 |
| `public/ui/maps/tactical/*-terrain.webp` | 經風格化的純地形；柏林檔名為 `berlin-runtime-terrain.webp` |
| `public/ui/maps/model-silhouettes/` | 由遊戲 GLB 產生的透明側面剪影與來源 manifest |
| `public/ui/sil/` | 空中飛機使用的既有剪影 |
| `public/textures/cloud-puffs.png` | 遊戲既有 4 × 4 雲圖集 |

上表路徑以專案根目錄為準。舊 `campaign-layouts.json`、`model-layouts.json` 仍是歷史資料，不是現行調整入口；舊合成圖片已清除。

## 修改既有任務

1. 找到任務 ID 與任務設定，確認這次改的是位置、數量、機型、任務目標，還是地形。
2. 如果只調整呈現大小／間距，直接改 `review-layouts.json`，不必重新生成地形。任務配置已改動時，重新俯拍並核對部署；不要只相信舊快照。
3. 調整單位、文字、目標框和航線。裁切變動時，必須一起重新換算圖層位置。
4. 產生獨立預覽，再進實際選單檢查桌面與手機橫向。
5. 記錄特殊位移、代表性數量及來源。保留圖層，讓使用者確認後繼續修改。

### 取得遊戲內參考

在專案根目錄開啟開發伺服器：

```sh
npm run dev -- --host 127.0.0.1 --port 5199
```

另一個終端執行，例如底板行動：

```sh
node scripts/capture-briefing-reference.mjs germany-m3
```

輸出是 `.shots/briefing-reference/germany-m3/terrain.png` 與 `deployment.json`。腳本經由真正選單進入任務，在開場暫停，以正交相機俯拍，關閉雲、霧、HUD 等遮擋。偵錯 hook 只注入 Playwright 收到的頁面，不改正式遊戲程式。若遊戲內部變數或 hook 改名，需同步維護捕捉腳本。

人工檢查後才把 JSON 保存為 `reference/<id>-opening.json`，地形轉為 WebP 保存。`.shots/` 是忽略的檢查產物，不要把它當唯一來源。捕捉腳本可使用 `BRIEFING_URL`；目前剪影與分層預覽腳本固定使用 5199。

更新目標快照的指令如下；它會覆寫 `objectives.json`，應檢查差異：

```sh
npx vite-node scripts/export-briefing-objectives.ts
```

**開場快照不一定包含全部開場兵力。** 勒熱夫曾因截圖早於兩批 time-zero 戰鬥機到場而漏掉六架 Yak-1B。應對照 `battle.waves` 與任務設定補足開場編隊；不要因此把未來秘密增援、觸發時間或尚未啟動的單位提前揭露。

### 座標與裁切

畫布固定為 `1200 × 800`。影像右方是世界 `-Z`，上方是世界 `-X`，**不代表地理北方**。使用 deployment 中的 bounds 將世界位置 `(worldX, worldZ)` 換算：

```text
sourceX = (south - worldZ) / (south - north) * 1200
sourceY = (worldX - west) / (east - west) * 800

crop = [cropX, cropY, cropWidth, cropHeight]
chartX = (sourceX - cropX) / cropWidth * 1200
chartY = (sourceY - cropY) / cropHeight * 800
```

`crop` 預設 `[0, 0, 1200, 800]`。renderer **只裁切地形**，不會自動搬動單位；JSON 中單位的位置已是最後畫布座標。建議裁切維持 3:2，避免地形變形。

風格化地形可能有地標偏移，投影只能當起點。這次底板行動與波爾塔瓦分別使用過來源座標水平 -37、-29 像素的人工對齊修正；這是當前素材的校準紀錄，**不是新任務可通用的常數**。已調好的 JSON 不要再次套用偏移。

### 位置資料欄位

| 欄位 | 現行行為 |
| --- | --- |
| `groups[].instances[]` | 地面單位、停放飛機、船艦；`model`、中心 `x/y`、`width`、`flip`、`opacity`。高度依 manifest 比例計算 |
| `groups[].label` | 可為 null；文字位置獨立調整 |
| `air[]` | 空中編隊；`model` 對應 `ui/sil/<model>.png`，`label` 手動維護數量，中心 `x/y`、`flip` 控制擺位與方向 |
| `team` | `blue` 是玩家方，`red` 是敵方，與國籍無關 |
| `routes[].path` | `[startX, startY, controlX, controlY, endX, endY]`，二次 Bézier 曲線與箭頭 |
| `targets[]` | 中心 `x/y`、`width/height`、`team`、可選 `label`；預設四角框，`shape: "circle"` 使用圓圈 |
| `clouds[]` | `[x, y, size, ...]`；目前只讀前三個數值，舊資料第四值不影響渲染 |
| `shade` | 地形暗色覆層不透明度，預設 0.3；數字越高越暗 |
| `snow` | 調整友方色彩並替敵我單位剪影加黑色描邊；不會把地形自動變成雪地 |

空中剪影目前固定為 124 × 48，文字在其上方 35 像素；若需逐編隊調整尺寸，要同步擴充 `missionLayers.ts`，單加 JSON 的 width 不會生效。既有空中飛機剪影通常機頭向左，仍應以預覽確認 `flip`。

`source`、`units`、`representative`、`style` 等留在 JSON 的欄位是來源／設計紀錄，目前 renderer 不用它們推算數量或做一致性驗證。不要以為改了任務兵力後圖片標籤會自動更新。

## 新增任務圖

1. 完成可玩的任務設定，取得穩定任務 ID。
2. 捕捉該任務自己的地形與開場部署，核對目標、陣營、時間零增援。
3. 選擇直接使用遊戲俯拍，或只將地形轉成深色簡報風格。先做一張驗證，不要一次生成整批。
4. 將底圖加入 `missionArtwork.ts`，並在 `review-layouts.json` 新增同 ID 的完整 entry，包含 `groups`、`air`、`routes`、`targets`、`clouds`（無內容用空陣列）。只登錄底圖而沒加 layout，畫面會缺少單位。
5. 有新地面／艦艇模型時，先產生透明側面剪影與 manifest；空中機型確認 `public/ui/sil/` 已有檔案。
6. 新增任務若引入新的勝利規則，檢查 `diagramTarget()` 與對應翻譯。既有目標分類不要只依「打擊」等選單類別推測。
7. 執行預覽與測試，再實際進選單比較部署。

### 地形生成範本

使用內建 imagegen **編輯該任務的遊戲俯拍**，已核准圖只作風格參考。生成只負責地形，不負責單位、文字、雲或航線。提示詞範本：

> 將這張遊戲內正交俯拍轉成深色二戰作戰簡報地形。保留原有道路、跑道、停機坪、田地、河流、海岸與設施的相對位置、方向和比例，僅限原圖存在的地物。保留 3:2 範圍；低對比炭灰橄欖棕色、細緻地形紋理，讓上層單位容易辨識。不要新增地理特徵。不要文字、飛機、車輛、艦艇、符號、航線、箭頭、雲、圖例或外框。

依任務補上限制，例如勒熱夫保留白色雪地，純海面不要憑空生成島嶼。每次檢查跑道、道路等關鍵地標是否漂移；過度漂移就重新處理底圖，不能用錯誤的單位擺位掩飾。保存實際提示詞、來源與結果位置，既有紀錄在 `reference/campaign-prompts.json`。

### 從遊戲模型產生剪影

```sh
node scripts/render-briefing-models.mjs
```

腳本讀取 `public/models/<id>.glb`，使用遊戲的 GLTF loader（含 Meshopt）、白色無光材質與正交側視，輸出透明 PNG。相機沿 -X 看，畫面右方是 -Z。`manifest.json` 記錄來源 SHA-256、mesh 數、寬高，renderer 以 alpha mask 染色。

目前模型清單寫在腳本 `ids`；沒有單一模型命令列參數。加入新型號後執行會重新輸出整份清單與 manifest，需檢查差異。不要憑空補模型不存在的零件，例如 P-51 原模型沒有起落架，就不自行畫上去。

## 已驗證的視覺做法與容易失敗的方式

- **敵我顏色固定**：敵人全部紅色，玩家方藍灰；不要因為是主要目標就把敵方改成米白。
- **單位直接放在相對位置**：空中編隊使用飛機剪影，地面與船艦用模型側面剪影。不要回到「精準飛機點 + 拉線到符號」或方框打叉。
- **實際模型比生成模型可靠**：imagegen 畫車輛、防空炮、船艦容易變 Q 版、輪廓錯誤或數量漂移。地形風格化與單位呈現分工處理。
- **主要目標放大並框起來**：底板行動的 P-51、波爾塔瓦的 B-17、雷伊泰卡車、沖繩友方航母均適用；防空火力仍要辨識，但不搶主要目標。
- **固定設施屬於地形**：梅澤堡油廠直接框地形上的廠區，不當成可移動裝備剪影。
- **航線必須有意義**：只表達主攻方向、實際行進或護航終點。雷伊泰防守的 F6F、固定炮位、防禦巡邏不需要向外延伸的攻擊線；也不要宣稱線條是 AI 的精準軌跡。
- **雲使用既有圖集**：低透明度分層疊加，renderer 會避開單位和目標。不要生成一片模糊白團。地面群組的獨立文字位置仍需人工檢查，現有遮罩並未逐一量測所有文字邊界。
- **先看實際 UI 尺寸**：1200 × 800 單圖很好看不代表手機看得懂。字不要放大到搶畫面，單位太小則調剪影／裁切，不靠新增解釋文字補救。
- **玩家不需要製作說明**：不要加「編隊與航線示意、兵力以任務說明為準」或素材／技術備註到遊戲中。完整任務說明保留在右側 UI。

### 特殊任務的維護基準

| 任務 | 要保留的判斷 |
| --- | --- |
| 勒熱夫 `germany-m4` | 白色雪地加 30% 暗覆層，敵我單位剪影加黑色描邊；敵炮在防線左／西側，友方炮與坦克在右／東側；保留兩端與後方坦克，友方飛機由右下方接近；別漏六架 Yak-1B |
| 波爾塔瓦 `germany-m2` | B-17 放停機坪附近；目前以右上 3 架、左下 4 架代表，放大並分組框選；`representative: true` 不改真實兵力數量 |
| 底板行動 `germany-m3` | 12 架 P-51 在跑道上方、4 架在左側，放大分組框選；防空單位分布周圍，攻擊來自下方 |
| 雷伊泰 `japan-m2` | 車隊保持內陸往海岸的順序，中心落在道路上；車輛放大約 50%，道路裁切更緊，九輛卡車各框選；坦克、防空炮不套卡車目標框；F6F 無出擊線 |
| 沖繩 `allies-m3` | 被保護的航母使用友方藍色目標框，護航艦分布周圍 |
| 倫內爾 `japan-m3` | 多艘巡洋艦及周邊驅逐艦使用實際模型剪影，保持艦隊相對布局 |

這些是目前已核准配置的基準，不是硬性永遠不變的兵力；任務邏輯變更時應重新對照。

## 預覽與驗證

Vite 在 5199 運行時：

```sh
node scripts/preview-layered-briefings.mjs
npx vitest run test/unit/mission-diagram.test.ts
npx tsc --noEmit
```

預覽會讀取所有可玩任務，輸出 `.shots/briefing-reference/<id>/layer-review-full.png` 與 `layer-review-overview.png`；不寫入正式圖片。腳本末尾的「ten」訊息是固定字串，新增任務後實際輸出數量以 MISSIONS 為準。

測試會檢查底圖存在、目標分類、雙語、分層結構、雲素材及特定回歸問題；**不會完整驗證單位數量、相對位置、所有剪影檔案或防守單位航線**。舊 builder 的檢查不能算作現行 renderer 已有的保護。

人工至少檢查桌面 1280 × 720、手機橫向 844 × 390 與 667 × 375：地標／單位前後左右、剪影陣營與朝向、標籤不重疊、雲不遮擋、框選正確、圖像完整、右側說明可捲動、出擊可見。桌面標題橫跨地圖與右欄，手機兵力保留剪影與軍徽。

只有文件或單純位置變更，選擇相應檢查即可；修改 renderer／目標邏輯時應跑上述測試。UI 預覽可使用 `test/e2e/menu-pages.fixture.ts` 快速檢查，但不能取代遊戲內地形／部署捕捉。

## 素材來源紀錄

### 柏林俯拍與風格化底圖

`public/ui/maps/reference/allies-m1-terrain.webp` 是遊戲農田的正交俯拍，從原始 PNG 以 WebP 品質 95 轉存。`allies-m1-opening.json` 記錄同一開場畫面（模擬時間 1/60 秒）的飛機位置、速度、目標、相機範圍與方向。

內建 imagegen 將俯拍轉成 `public/ui/maps/tactical/berlin-runtime-terrain.webp`，尺寸 1536 × 1024、WebP 品質 90。原始生成檔為 `exec-7cbc954c-c3db-45ee-b9b0-b5f3d31d8953.png`。它保留田地、道路與森林整體布局，但不是逐像素測繪；飛機與航線由獨立圖層提供。

當時提示詞的中文說明（翻譯，不是原始逐字提示詞）：

> 將實際遊戲正交俯拍轉為克制的深色二戰軍用地圖底圖。保留每群田地、道路網與森林的位置、比例、方向及邊界，不可創造地物。原圖沒有河流、湖泊、海岸、大城市、油廠或機場，不要新增。維持 3:2 裁切與地標對齊，僅改成炭灰橄欖棕紙面（約 #37382e）上的細緻暖灰田界與點狀森林，以低對比襯托上層單位。消除樹木 LOD 雜訊與陰影接縫，但不改布局。不要文字、標籤、符號、箭頭、單位、網格、標頭、頁尾、羅盤、比例尺、框線或圖例。這是原圖風格轉換，不是想像新的柏林地形。

柏林的護航虛線僅表達終點方位，不是 AI 的精準軌跡。純海面任務可沿用同一水面來源，再疊加各自獨立的部署；勒熱夫則直接使用實際白色雪地參考。

### 舊素材與來源追蹤

舊模型烘圖（`*-models.webp`）、合成 SVG（`*-runtime.svg`）、深色試作圖（`*-local-dark.webp`）、`berlin-local.webp` 與原始任務插畫已刪除。現行純地形、模型剪影及遊戲俯拍參考仍保留。

`public/ui/maps/tactical/dark-prompts.json`、`prompts.json` 只保留早期生成紀錄，當中的舊圖片路徑不代表檔案仍存在；現行地形紀錄見 `public/ui/maps/reference/campaign-prompts.json`。

舊預覽指令 `node scripts/preview-campaign-briefings.mjs` 已轉接現行分層預覽，輸出位置與 `preview-layered-briefings.mjs` 相同。

早期區域地圖使用 Natural Earth 公有領域海岸線與河流，見[授權說明](https://www.naturalearthdata.com/about/terms-of-use/)及[來源資料](https://github.com/nvkelso/natural-earth-vector/tree/master/geojson)。使用的資料檔為 `ne_50m_land.geojson`、`ne_50m_rivers_lake_centerlines.geojson`；`src/ui/missionMapData.ts` 屬於該舊區域地圖流程。

## 舊流程的界線

`build-briefing-maps.py` 的區域地圖、`build-briefing-reference.mjs`／`build-campaign-briefings.mjs` 的合成 SVG，以及 `bake-model-briefings.mjs` 的烘圖都是歷史製作工具。日常維護**不要執行這些腳本取代目前畫面**，也不要修改舊 layout 後期待 UI 更新。

以此文件與 `reference/review-layouts.json` 為準。若未來確實要烘圖，應另行評估並保留可編輯來源；目前沒有烘圖需求。
