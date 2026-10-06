# UI 用圖的出處（全部由 grok CLI 的 `image_gen` 生成，2026-09-04）

**五張原檔都是彩色的，黑白是 CSS 做的。** 負責人：「我想讓這些圖都有顏色，只是用 CSS
做成黑白，然後 HOVER 的時候帶出顏色回來」——
`index.html` 的 `.photo img` 是 `grayscale(1) sepia(.26)`，
`.tallcard:hover .photo img` 放到 `grayscale(.70) sepia(.06)`（還 30%）。
`sepia` 一定要跟著降，不降的話還回來的那點顏色會被褐調吃掉，看起來只是變亮。

## 提示詞要短

負責人：「GROK 給越多越不準確，給風格跟構圖就好」。實測完全吻合 ——
把提示詞從一百多字（含七八條禁令）砍成一句話之後，機體立刻從塑膠模型變成實拍質感，
B-17 的凝結尾也自己接對了。

一張圖的提示詞就三段：**年代與底片 ＋ 什麼飛機什麼姿態 ＋ 背景是什麼**，
最後補一句 `Faded colour film, grain, scratches, high contrast.` 與 `No text.`

`No text.` 是唯一必留的禁令 —— 少了它會冒出「BUY WAR BONDS」「大日本帝国 零戰」
之類的標語。德國那張再加 `no swastika`。

| 檔案 | 用途 | 比例 | 提示詞 |
|---|---|---|---|
| mission.jpg | 主選單 · 任務模式 | 3:4 | 1944 Kodachrome aerial war photograph. A formation of B-17 bombers seen from behind, long white contrails streaming back from their engines, deep blue sky. Faded colour film, grain, scratches. |
| skirmish.jpg | 主選單 · 遭遇戰 | 3:4 | A single frame from 1944 WWII fighter gun camera footage shot on colour 16mm film: a Messerschmitt Bf 109 seen through the gunsight reticle, banking hard, orange tracer streaks passing it, grey-green camouflage and pale blue sky. Extremely grainy colour film, blurred motion, high contrast, dark vignette, film sprocket holes and frame counter numbers along one edge. Plain tail fin, no tail markings, no swastika. No text, no watermark. |
| allies.jpg | 陣營頁 · 盟軍（星條旗當底） | 3:4 | 1944 Kodachrome propaganda photograph. A P-51D Mustang in a steep dive toward the camera, a huge American flag filling the background. Faded colour film, grain, scratches, high contrast. No text. |
| germany.jpg | 陣營頁 · 德軍（鐵十字當圖騰，**不用國旗**：1944 年的德國國旗是卍字旗） | 3:4 | 1944 Kodachrome propaganda photograph. A Bf 109 charging head-on toward the camera, a huge black Balkenkreuz cross filling the background. Faded colour film, grain, scratches, high contrast. No text, no swastika. |
| japan.jpg | 陣營頁 · 日本（日章圓當底，**不是旭日旗**） | 3:4 | 1944 Kodachrome propaganda photograph. An A6M Zero climbing steeply toward the camera, a huge red Hinomaru sun disc filling the background. Faded colour film, grain, scratches, high contrast. No text. |
| hangar.jpg | 主選單 · 機庫（**唯一在地上的一張**：另外兩張都在空中、都在打，機庫這一頁是「看」） | 3:4 | 1944 Kodachrome photograph inside a wartime aircraft hangar. A P-51D Mustang parked in the middle, engine cowling open, ground crew working beside it, shafts of daylight from the half-open hangar doors behind. Faded colour film, grain, scratches, high contrast. No text. |

跑法：`grok -p "<中文指令，內含上面的英文提示詞，指定存檔路徑>" --permission-mode bypassPermissions --no-subagents --max-turns 6`
一張約 40 秒，864×1152。轉檔：Pillow `quality=85, optimize, progressive, subsampling=1`，
五張合計 678 KB。

## 鏡像用 `image_edit`

盟軍那張生出來時國旗的星區在右邊（正掛時應該在左上）。整張水平翻轉會把飛機也翻掉，
所以走 `image_edit`，指令只講背景：

> mirror the American flag in the background horizontally so that the blue star field
> (canton) is in the upper LEFT corner of the flag instead of the right, red and white
> stripes mirrored with it. Keep the aircraft exactly as it is, do not move or change
> the plane. Keep the same faded Kodachrome film look, grain and scratches.

結果只有旗子鏡像，飛機的姿態與塗裝一格沒動；顆粒會比原圖乾淨一點點。

機庫那張修了兩輪，每一輪的指令都只講要改的東西、再補一句「其餘一律不動」：

> 1. add the missing three-bladed propeller onto the nose hub of the P-51D, blades in
>    the parked position. Keep everything else exactly as it is …
> 2. remove all lettering and text from the propeller blades so the blades are plain
>    black with yellow tips, and replace the long pointed spinner with the short blunt
>    rounded spinner of a P-51D Mustang. Keep everything else exactly as it is …

**`image_edit` 每改一次都會順手動到別的東西。** 第一輪補上槳的同時把整流罩畫成
又長又尖的錐、整張曝光壓暗一階；第二輪修回來，但槳轂被塗成白色。地勤、工具、
大門與光束三輪都沒被動過 —— 會被動到的是**被指令提到的那個區域周圍**。
所以想改三件事就分三輪、每輪改完看一次，不要一次寫完。

## 【踩過的坑】

**一、開火畫不出來，所以不畫。** 只要提示詞裡有 `guns firing`，模型就會在機翼**上表面**
畫出一排突出的假槍管，火光接在管子末端往後噴 —— P-51 與零戰的槍是藏在翼內的。
換成 `muzzle flashes at the leading edges of its wings` 也一樣。試了三輪之後裁決：
**陣營圖不畫開火**，靠俯衝／正面衝來／爬升的姿態撐張力。

**二、曳光彈的方向會反。** 有一版日本圖機頭朝左上、槍口在翼上，曳光卻整排往右下飛出去 ——
子彈飛向飛機的後方。負責人一眼看出來的。

**三、凝結尾不接在發動機上。** B-17 那張的白線曾經斜著穿過整個畫面，有幾條還從機頭前面
長出來。修法是把起點寫進提示詞：`streaming back from their engines`。

**四、「局部彩色」不是彩色。** 有一版是黑白照片上留著鮮紅的日章圓，那是現代的選擇性上色。
顯示層的 `grayscale` 會把紅壓成灰，**在畫面上看不出這個錯**，是拉原檔出來看才發現的。

**五、質感與構圖是兩件事。** 負責人說要「實拍的膠片感」時，我把構圖也一起換掉了
（單純的空拍照、沒有國旗），被退回：「我滿喜歡原本的構圖，我只是想改成膠片感而已」。
要換哪一層，先分清楚。

## 風格底線

- 共同：褪色、顆粒、刮痕、相紙邊；**禁止文字、浮水印、現代物件**。
- 德國機一律 `plain tail fin, no tail markings`，而且**絕不出現卍字**（用鐵十字）。
- 日本用日章圓，不是旭日旗。
