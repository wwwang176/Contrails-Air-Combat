# 音訊動態 —— 施工計畫

2026-09-23　設計：`docs/superpowers/specs/2026-09-23-audio-dynamics-design.md`

四步，每一步各自驗得起來，順序不能換：限幅器先上，後面兩步才有一個不會破音
的底可以比較；包絡表是 HDR 的輸入，所以排在 HDR 前面。

## 一、真峰值限幅器

- `public/audio/limiter.js`：`AudioWorkletProcessor`。5 ms 預看的環狀緩衝、
  天花板 −1.5 dBFS 樣本峰值、釋放 120 ms、收到 `reset` 訊息清緩衝。
- `src/audio/limiter.ts`：純函數 `limiterGain(peak, ceiling)` 與環狀緩衝的
  索引計算抽出來，worklet 與單元測試共用同一份邏輯。
- `src/audio/engine.ts`：`fade → limiter → destination`；`addModule` 失敗、
  `processorerror` 兩條都旁路；`applyRunState` 恢復與 `stopAll` 送 `reset`。

驗：單元測試（增益曲線、緩衝、兩條失敗路徑）＋ 探針錄 30 s 算真峰值。

## 二、同檔去相關

- `src/audio/engine.ts`：記下每個檔上一次發聲的 context 時間；30 ms 內的第二份
  延遲 3–12 ms 再 `start`。**不動起始位置**（會裁掉起音）。

驗：單元測試（同檔連兩次要有延遲、隔久了不延遲）。

## 三、素材包絡表

- 產生腳本放**工作區外**（與既有的素材處理同一條路），輸出寫進
  `public/audio/manifest.json` 的 `envelopeDb`：每 0.25 s 一格、相對整段峰值的
  RMS，四捨五入到 0.1 dB。
- `src/audio/catalog.ts`／`engine.ts`：讀進來，`envelopeAt(file, age)` 查表，
  沒有這一欄的回 0。

驗：單元測試（查表、邊界、缺欄位回 0）＋ 清單護欄（每個檔案都有、長度與時長
相符）。

## 四、HDR 動態窗口

- `src/audio/dynamics.ts`：純函數 —— `stepLoudest`（起音／釋放）、`hdrDuckDb`
  （不衰減區、斜坡、最大衰減、絕對地板）、保底類別表。
- `src/audio/engine.ts`：一次性音效在發聲時與每一幀更新；循環音在 `assign`
  與每一幀更新；`stopAll` 把 `loudest` 歸零。

驗：單元測試（安靜場景不衰減、爆炸時讓位、地板、保底類別、換場歸零）
＋ 探針量衰減量的分位數。

## 收尾

- 整套測試、`tsc`、Playwright 進關卡確認沒有錯誤。
- 合併回 main 之前跑一次盟 M2 貼航母的破音驗收。
