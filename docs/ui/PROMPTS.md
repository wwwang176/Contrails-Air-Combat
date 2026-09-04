# mockup 用圖的出處（全部由 grok CLI 的 image_gen 生成，2026-09-04）

主選單兩張是黑白檔案照；陣營頁三張是**戰時海報的構圖**（專案負責人 2026-09-04：「背景是國旗、前景是正在開火的飛機、熱血的風格」），但**顯示時走跟照片同一層黑白處理**（負責人：「顏色太鮮豔，原本的黑白很棒」）—— 原檔留彩色，黑白是 CSS 濾鏡，之後要改回來不用重生。

檔案照的共同風格前綴：黑白／褪色、粗粒子、刮痕、相紙邊；禁止文字、浮水印、現代物件。
德國機一律加：`plain tail fin, no tail markings`（skirmish.jpg 第一版尾翼有小標記，已用 image_edit 抹掉）。

| 檔案 | 用途 | 比例 | 提示詞 |
|---|---|---|---|
| mission.jpg | 主選單 · 任務模式 | 3:4 | Vintage 1944 aerial photograph of a formation of B-17 Flying Fortress bombers leaving long white contrails high over Germany, shot from a nearby escort fighter. Black and white, heavy film grain, slightly faded, high contrast, scratches and dust like an archival print. |
| skirmish.jpg | 主選單 · 遭遇戰 | 3:4 | A single frame from 1944 WWII fighter gun camera footage: a Messerschmitt Bf 109 seen through the gunsight reticle, banking hard, tracer streaks passing it. Extremely grainy 16mm film, blurred motion, high contrast black and white, dark vignette, film sprocket holes and frame counter numbers along one edge. |
| allies.jpg | 陣營頁 · 盟軍海報（直式彩色，不上黑白） | 3:4 | 1944 American war bond propaganda poster, screen-printed style with limited palette and halftone texture: a P-51D Mustang fighter diving steeply toward the viewer, all six machine guns firing with bright muzzle flashes and tracer lines, the Stars and Stripes filling the entire background in bold red, white and blue stripes and a field of stars, dramatic low angle, heroic energy. No text, no lettering. |
| germany.jpg | 陣營頁 · 德軍海報（鐵十字當圖騰，**不用國旗**：1944 年的德國國旗是卍字旗） | 3:4 | 1944 German Luftwaffe recruitment poster, screen-printed style with limited palette and halftone texture: a Messerschmitt Bf 109 fighter charging head-on toward the viewer, cannon and machine guns firing with muzzle flashes and tracer streaks, behind it a huge black Balkenkreuz (straight-armed cross with white outline) as the graphic backdrop on a diagonally split field of deep red and black, dramatic angle, heroic energy. Absolutely no swastika, no eagle emblem, no flags, plain tail fin with no tail markings, no text. |
| japan.jpg | 陣營頁 · 日本海報（日章旗當底，**不是旭日旗**） | 3:4 | 1944 Japanese naval aviation propaganda poster, screen-printed style with limited palette and halftone texture: a Mitsubishi A6M5 Zero fighter climbing steeply and banking toward the viewer, wing cannons firing with muzzle flashes and tracer streaks, behind it one enormous red Hinomaru sun disc on a plain white field filling the background, bold graphic composition, heroic energy. Plain red disc only, not the rising-sun ray flag, no text. |

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
