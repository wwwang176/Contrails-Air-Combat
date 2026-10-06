# 田色 clipmap 展示區 —— 逐像素算式改成跟著鏡頭的貼圖

2026-09-17

## 1. 要做的事

內陸地形的田色由 `fields.ts` 的片段著色器**每個像素當場算**：區塊種子、田格
邊界、樹籬帶、條紋，洛伊納再疊廠區的距離場。Iris Xe 上盟 M2 開場整層地面
值 4.8 ms，其中 3.4 ms 是這支算式（`gfxexp` 探針：常數色 PBR 省 3.42 ms）。

做法：**把田色烘成兩張跟著鏡頭走的貼圖**（clipmap），地面每個像素改成查貼圖；
鏡頭周圍一小圈仍然走原本的算式，畫質與現在逐位元相同。

**這一輪只建展示區，不動遊戲。** `createTerrain`、`farmGround.ts`、`fields.ts`
一個字都不改；新模組獨立成檔，展示區把地面的材質換掉來看效果。遊戲要不要接、
接在哪個畫質檔位，看過展示區之後負責人決定。

## 2. 負責人裁定

1. 做法選「內圈算式、外圈貼圖」（討論裡的做法二），不做第三層更細的貼圖 ——
   再細也追不上算式，只有貼地 100 m 以下有感。
2. 先建展示區，先不動遊戲。
3. 兩層的尺寸照 POC 量到的定：近圖 2048 格 × 2 m 蓋 4 km、遠圖 4096 格 × 7.3 m
   蓋 30 km。POC 數字（`gfxclip`，盟 M2 開場同一段，兩趟）：

```
  基準                          20.5 ms/幀
  近 2048/2 m ＋ 遠 2048/14.6 m  省 4.34 ms   遠圖 1 km 高度看 2.5 km 外明顯偏軟
  近 2048/2 m ＋ 遠 4096/7.3 m   省 3.45 ms   遠圖銳利度接近算式          ← 選這組
  近 4096/1 m ＋ 遠 2048/14.6 m  省 3.21 ms   近圖 4096 取樣多花 1 ms，畫質看不出差
  近 4096/1 m ＋ 遠 4096/7.3 m   ——           兩張 4096² 帶 mipmap → D3D11 記憶體不足，context 掉
```

## 3. 模組 `src/render/fieldClipmap.ts`

### 3.1 一層是什麼

一層 = `N × N` 格的貼圖，一格 `m` 公尺，蓋住 `span = N·m` 的正方形窗。
**貼圖是環面的**：世界格 `c = floor(x / m)` 存在格 `c mod N`。窗是
`[ox, ox + N)`（x）與 `[oz, oz + N)`（z），`ox`、`oz` 是整數格。

取樣：`uv = fract(world / span)`。只要像素在窗內，環面上那一格就是對的內容，
**不需要原點 uniform**。`fract` 在 0↔1 交界會讓導數爆掉、mip 選到最小那一級而
畫出一條線 —— 所以用 `textureGrad`，導數由 `world / span` 算（處處連續）。

### 3.2 什麼時候挪窗、挪窗要烘哪些格

鏡頭所在的格 `cc = floor(cam / m)`。`|cc − (ox + N/2)| > N / 8` 就重新置中：
`ox' = cc − N / 2`。z 同理，兩軸各自獨立。

新窗減舊窗 = 至多兩塊矩形（x 方向新露出的那一條 × 整個新窗的 z，加上
z 方向新露出的那一條 × 新窗**扣掉前一條**的 x），角落不重烘。位移 ≥ N 就是
整張。每一塊矩形映到環面上，每一軸至多切成兩段 → 一塊最多四片。

烘一片：viewport／scissor 設到那一片的貼圖矩形，全螢幕四邊形的 uv 映成
世界座標，片段著色器跑 `fieldColorAt`（`fieldGlslWithSite`，不查候選表 ——
烘圖不是每幀的事）。**mipmap 只在一次挪窗的最後一片之後產一次**：three
是「畫進 RT 就產 mip」，中間幾片先把 `generateMipmaps` 關掉。

一次挪窗的工作量：近圖 2048 × 256 × 2 條 ≈ 1 M 像素，遠圖 4096 × 512 × 2 ≈ 4 M
像素（每 3.75 km 一次）。開場或瞬移是整張，那一幀會頓一下 —— 遊戲裡是開局，
可以接受；展示區的機位按鈕也是瞬移。

### 3.3 地面的材質

`MeshStandardMaterial({ flatShading: true, roughness: 0.95 })`，與 `farmGround.ts`
同一組參數；`onBeforeCompile` 把 `color_fragment` 換成：

```
  d  = 像素到鏡頭的水平距離
  內圈：d < inner            → fieldColorAt(world)（原本的算式）
  近圖：在近窗內             → textureGrad(near)
  遠圖：在遠窗內             → textureGrad(far)
  遠窗外（遠景環 15 km 外）  → fieldColorAt(world)
```

內圈與近圖之間、近圖邊緣與遠圖之間各有一圈漸變（內圈 `band` 公尺、近圖邊緣
窗寬的 5%），硬切的話交接線會跟著鏡頭走。`inner = 0` 就是純貼圖；
`bypass` 旗標讓整支走算式 —— 展示區 A/B 用它，兩邊是同一個 program。

【內圈的算式比遊戲慢一點】遊戲的地面查區塊候選表（`uRegionCand`），這裡
不查，跑完整的 3×3。內圈只有 500 m，像素少；遊戲接的時候再把候選表傳進來。

### 3.4 介面

```ts
createFieldClipmap(renderer, {
  season, site?, near: { size, metersPerTexel }, far: { size, metersPerTexel },
  innerRadius?, innerBand?, edgeBlend?,
}) → {
  material,                 // 掛到地面與遠景環
  update(camX, camZ),       // 每幀；該挪窗就烘
  setInnerRadius(m), setBypass(on),
  stats: { recentres, pieces, texels },
  dispose(),
}
```

純函式獨立匯出、單元測試守著：`windowOriginFor`、`needsRecentre`、
`newCellRects`、`torusPieces`。

## 4. 展示區 `tools/clipmap.html` ＋ `src/tools/clipmap.ts`

走遊戲的路徑：`createScene` ＋ `createTerrain('leuna')` ＋
`applyTimeOfDay(…, 'novemberNoon')` ＋ `preloadPlantScenery`。建完把地面
（`children[2]` 的 25 塊）與遠景環（`children[0]`）的材質換成 clipmap 的。

鏡頭：`camera/godCamera.ts` 的 `stepGodCamera`，WASD 平移、Q/E 升降、Shift
加速、左鍵拖曳轉頭。三個機位按鈕：貼地 250 m、1 km、投彈 4 km。

面板：模式三選一（算式／純貼圖／內圈算式＋貼圖）、內圈半徑滑桿（0～2000 m）、
讀數（FPS 一秒平均、幀時間、挪窗次數、烘過的像素數、鏡頭位置）。

量測出口：`__cam(x, y, z, yawDeg, pitchDeg)`、`__mode(name)`、`__stats()`。

`vite.config.ts` 的 `input` 加一行 —— 不加的話 build 產不出這一頁。

## 5. 不做的事

- 不接進遊戲、不碰畫質檔位。
- 不做第三層貼圖。
- 不做分幀烘整張（開場那一下頓可以接受）。
- 遠景環 15 km 外仍走算式（那是地平線上一條，像素很少）。

## 6. 驗收

1. 單元測試：四支純函式（見 §3.4）。挪窗矩形用暴力法對照：對小的 N 把每一格
   列出來，矩形的聯集必須恰好等於「新窗減舊窗」而且互不重疊；環面切片的聯集
   必須等於原矩形取模，而且每一片都落在 `[0, N)`。
2. `npx tsc --noEmit` 錯誤數不增加（動工前 0）。
3. Playwright：展示區開得起來、三個模式切得動、`__stats()` 在飛過 1 km 後
   `recentres > 0`、context 沒掉；三個機位各截「算式 vs 內圈算式＋貼圖」。
4. 幀時間：純貼圖模式相對算式模式的差，與 POC 的 3.45 ms 同一個量級。
