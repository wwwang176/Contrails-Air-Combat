# UI 用圖的出處（全部由 grok CLI 的 image_gen 生成，2026-09-04）

**五張原檔全部是彩色的，黑白是 CSS 做的。** 負責人 2026-09-04：「我想讓這些圖都有
顏色，只是用 CSS 做成黑白，然後 HOVER 的時候帶出 10~20% 顏色回來」——
`index.html` 的 `.photo img` 是 `grayscale(1)`，`.tallcard:hover .photo img` 放到
`grayscale(.85)`（還 15%），`sepia` 同時從 .26 降到 .10，不降的話那點顏色會被褐調吃掉。

**構圖**：國旗（或國籍圖騰）填滿背景、前景是正在開火的飛機、低角度、主體壓滿框。
**質感**：Kodachrome 彩色底片、高反差、深黑與過曝的高光、細顆粒、褪色紙邊。

三次繞路，都記在這裡免得再走一遍：

1. 一開始是「網版印刷海報 ＋ 半調網點 ＋ 限定色盤」，顯示時用 CSS 壓黑白。
2. 負責人說要「實拍的膠片感」，我把**構圖也一起換掉**了（單純的空拍照、沒有國旗）
   —— 「我滿喜歡原本的構圖，我只是想改成膠片感而已」。**要換的是質感，不是構圖。**
3. 改成暗房蒙太奇 ＋ 粗顆粒黑白，「感覺還是沒有原圖好看」—— 問題在灰：旗子和飛機
   都落在中間調，海報原本的力道（大面積純黑對純白、主體壓滿框）被磨平了。
   `high contrast` ＋ `filling most of the frame` ＋ `deep blacks and blown highlights`
   才把份量還回去。試過沒選的兩個方向：照相凹版報紙（紙感好但主體太小）、
   戲劇打光蒙太奇（暗部糊掉）。
4. 最後回到彩色原檔（這一版）—— 黑白交給 CSS，滑過去才還顏色。

共同前綴：褪色、顆粒、刮痕、相紙邊；禁止文字、浮水印、現代物件。
德國機一律加：`plain tail fin, no tail markings`，而且**絕不出現卍字**（用鐵十字）。
日本用日章圓，不是旭日旗。

| 檔案 | 用途 | 比例 | 提示詞 |
|---|---|---|---|
| mission.jpg | 主選單 · 任務模式 | 3:4 | Vintage 1944 aerial photograph shot on Kodachrome colour film: a formation of B-17 Flying Fortress bombers leaving long white contrails high over Germany against a deep blue sky, shot from a nearby escort fighter. Rich saturated period colour, slightly faded, high contrast, fine film grain, scratches and dust like an archival print. No text, no lettering, no watermark. |
| skirmish.jpg | 主選單 · 遭遇戰 | 3:4 | A single frame from 1944 WWII fighter gun camera footage shot on colour 16mm film: a Messerschmitt Bf 109 seen through the gunsight reticle, banking hard, orange tracer streaks passing it, grey-green camouflage and pale blue sky. Extremely grainy colour film, blurred motion, high contrast, dark vignette, film sprocket holes and frame counter numbers along one edge. Plain tail fin, no tail markings, no swastika. No text, no watermark. |
| allies.jpg | 陣營頁 · 盟軍（星條旗當底） | 3:4 | 1944 wartime propaganda photograph shot on Kodachrome colour film, high contrast: a P-51D Mustang fighter filling most of the frame, diving steeply toward the viewer at a dramatic low angle, all six machine guns firing with brilliant white muzzle flashes and long tracer lines, a huge Stars and Stripes flag in bold red white and blue rippling across the entire background behind it, deep blacks and blown highlights, rich saturated period colour, fine film grain, faded edges, dust and fine scratches like an archival print, dark vignette. No text, no lettering, no watermark. |
| germany.jpg | 陣營頁 · 德軍（鐵十字當圖騰，**不用國旗**：1944 年的德國國旗是卍字旗） | 3:4 | 1944 wartime propaganda photograph shot on Kodachrome colour film, high contrast: a Messerschmitt Bf 109 fighter filling most of the frame, charging head-on toward the viewer at a dramatic low angle, cannon and machine guns firing with brilliant white muzzle flashes and long tracer streaks, behind it a huge black Balkenkreuz (straight-armed cross with white outline) filling the entire background as a painted marking on a deep red and charcoal field. Absolutely no swastika, no eagle emblem, no flags, plain tail fin with no tail markings. Deep blacks and blown highlights, rich saturated period colour, fine film grain, faded edges, dust and fine scratches like an archival print, dark vignette. No text, no lettering, no watermark. |
| japan.jpg | 陣營頁 · 日本（日章圓當底，**不是旭日旗**） | 3:4 | 1944 wartime propaganda photograph shot on Kodachrome colour film, high contrast: a Mitsubishi A6M5 Zero fighter filling most of the frame, climbing steeply and banking toward the viewer at a dramatic low angle, wing cannons firing with brilliant white muzzle flashes and long tracer streaks, behind it one enormous red Hinomaru sun disc on a plain white field filling the background, not the rising-sun ray flag. Deep blacks and blown highlights, rich saturated period colour, fine film grain, faded edges, dust and fine scratches like an archival print, dark vignette. No text, no lettering, no watermark. |

跑法：`grok -p "<中文指令，內含上面的英文提示詞，指定存檔路徑>" --permission-mode bypassPermissions --no-subagents --max-turns 6`
一張約 40 秒，864×1152 或 1152×864。正式版要出 2× 並改成 landscape 3:2。

## 存成 JPEG（2026-09-04）

`public/ui/` 收的是 JPEG，不是 PNG。原始 PNG 共 6.3 MB，粒子與halftone讓無損壓縮
幾乎沒有作用；Pillow `quality=85, optimize, progressive, subsampling=1` 之後是 0.77 MB，
與原檔的 PSNR 是 36.2–46.3 dB（最差的是 allies —— 海報的平塗色塊最吃量化）。

```
python -c "from PIL import Image;import glob;[Image.open(p).convert('RGB').save(p[:-4]+'.jpg','JPEG',quality=85,optimize=True,progressive=True,subsampling=1) for p in glob.glob('public/ui/*.png')]"
```

【為什麼不留 PNG 當母片】提示詞就在上面，重生一張 40 秒。要改 2× 或 landscape
的時候本來就得重生，留一份 6 MB 的中間產物在 repo 裡沒有人會去用它。

## 【踩過的坑】彩色是刻意的，但「局部彩色」不是

中間有一版日本圖是黑白照片上留著**鮮紅色**的日章圓 —— 那是現代的選擇性上色。
現在五張都是**整張彩色**，黑白交給 CSS；要的是「彩色原檔」，不是「黑白＋一點紅」。
如果哪天又要純黑白的原檔，提示詞要帶
`entirely black and white monochrome, absolutely no colour anywhere, no selective colour effect`。

