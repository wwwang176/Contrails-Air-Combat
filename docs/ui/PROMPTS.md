# UI 用圖的出處（全部由 grok CLI 的 image_gen 生成，2026-09-04）

**五張全部是黑白檔案照。** 陣營頁那三張原本是戰時海報的構圖（國旗當背景、前景開火的飛機），
2026-09-04 試玩後負責人改口：「任務模式、遭遇戰兩張圖的風格很棒，有點實拍的膠片感；
任務內的陣營圖也可以做到這樣嗎?」—— 於是三張都用檔案照的提示詞重生，海報版不留。

**構圖沒有變**：國旗（或國籍圖騰）當背景、前景是正在開火的飛機。變的只有渲染 ——
從「網版印刷海報 ＋ 半調網點」換成「暗房照片蒙太奇 ＋ 粗顆粒黑白底片」。

【2026-09-04 我在這裡走錯過一次】第一次改的時候把構圖也一起換成單純的空拍檔案照
（飛機在雲上、沒有國旗），負責人：「我滿喜歡原本的構圖，我只是想改成膠片感而已」。
**要換的是質感，不是構圖。**

檔案照的共同風格前綴：黑白／褪色、粗粒子、刮痕、相紙邊；禁止文字、浮水印、現代物件。
德國機一律加：`plain tail fin, no tail markings`（skirmish.jpg 第一版尾翼有小標記，已用 image_edit 抹掉）。

| 檔案 | 用途 | 比例 | 提示詞 |
|---|---|---|---|
| mission.jpg | 主選單 · 任務模式 | 3:4 | Vintage 1944 aerial photograph of a formation of B-17 Flying Fortress bombers leaving long white contrails high over Germany, shot from a nearby escort fighter. Black and white, heavy film grain, slightly faded, high contrast, scratches and dust like an archival print. |
| skirmish.jpg | 主選單 · 遭遇戰 | 3:4 | A single frame from 1944 WWII fighter gun camera footage: a Messerschmitt Bf 109 seen through the gunsight reticle, banking hard, tracer streaks passing it. Extremely grainy 16mm film, blurred motion, high contrast black and white, dark vignette, film sprocket holes and frame counter numbers along one edge. |
| allies.jpg | 陣營頁 · 盟軍（星條旗當底） | 3:4 | 1944 wartime propaganda photograph, a darkroom photo montage printed on grainy black and white film: a P-51D Mustang fighter diving steeply toward the viewer, all six machine guns firing with bright muzzle flashes and tracer lines, the Stars and Stripes flag filling the entire background as a huge cloth flag photographed behind the aircraft, dramatic low angle, heroic energy. Entirely black and white monochrome, absolutely no colour anywhere, no selective colour effect, heavy film grain, slightly faded, high contrast, scratches and dust like an archival print, dark vignette. No text, no lettering, no watermark. |
| germany.jpg | 陣營頁 · 德軍（鐵十字當圖騰，**不用國旗**：1944 年的德國國旗是卍字旗） | 3:4 | 1944 wartime propaganda photograph, a darkroom photo montage printed on grainy black and white film: a Messerschmitt Bf 109 fighter charging head-on toward the viewer, cannon and machine guns firing with muzzle flashes and tracer streaks, behind it a huge Balkenkreuz (straight-armed cross with white outline) filling the entire background as a painted marking, dramatic angle, heroic energy. Absolutely no swastika, no eagle emblem, no flags, plain tail fin with no tail markings. Entirely black and white monochrome, absolutely no colour anywhere, no selective colour effect, heavy film grain, slightly faded, high contrast, scratches and dust like an archival print, dark vignette. No text, no lettering, no watermark. |
| japan.jpg | 陣營頁 · 日本（日章圓當底，**不是旭日旗**） | 3:4 | 1944 wartime propaganda photograph, a darkroom photo montage printed on grainy black and white film: a Mitsubishi A6M5 Zero fighter climbing steeply and banking toward the viewer, wing cannons firing with muzzle flashes and tracer streaks, behind it one enormous Hinomaru sun disc filling the background as a dark grey circle on a plain pale field, bold composition, heroic energy. Plain round disc only, not the rising-sun ray flag. Entirely black and white monochrome, absolutely no colour anywhere, no selective colour effect, heavy film grain, slightly faded, high contrast, scratches and dust like an archival print, dark vignette. No text, no lettering, no watermark. |

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

## 【踩過的坑】日本那張第一版是「局部彩色」

日本那張第一版的提示詞只寫「plain red Hinomaru」，生出來的是黑白照片上留著**鮮紅色**的
日章圓 —— 那是現代的選擇性上色，不是 1944 年的照片。三張的提示詞現在都帶
`absolutely no colour anywhere, no selective colour effect`。

顯示層那道 `grayscale(.9) sepia(.28)` 會把紅色壓成灰，所以**在畫面上看不出這個錯**；
是拉原檔出來看才發現的。
