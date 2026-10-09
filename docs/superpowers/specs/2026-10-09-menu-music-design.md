# 選單背景音樂

## 目標

選單畫面有一首循環的背景音樂。

- 開場頁（`landing`）不播；按「開始遊戲」（`start`）之後才開始，0.5 s 淡入
- 開始載入戰鬥（`fight` 進到 `battle`）時 0.5 s 淡出，戰鬥中不播
- 從戰鬥回到任何選單畫面（`toMenu`、`toSetup`、`toMission`）時 0.5 s 淡入，接著上次停下的位置播
- 機庫也是選單畫面，照常播
- 吃玩家的音量設定與靜音；分頁切走時跟著整個音訊一起停

## 素材

- `public/music/menu.mp3`：立體聲 128 kbps，整首正規化到 −16 LUFS（整合響度），峰值壓在 −1 dBFS 以下；
  壓峰值少掉的 1.8 dB 由程式補回（`MENU_MUSIC.makeupDb`）
- 原曲 0:40–2:20 比前後大約 4 dB（A 加權，3 s 窗），處理時這一段降 4 dB、前後各 3 s 漸變；
  處理後三段是 −24.9／−25.0／−25.3 dB(A)
- **不進 `public/audio/manifest.json`**：清單裡的檔案在背景整個下載並解碼（一首 3 分鐘的立體聲約 40 MB 浮點），
  而且算進戰鬥載入的進度條。音樂用串流播放
- 檔名泛用，不帶原曲名；不帶封面與標籤

## 播放

- `src/audio/music.ts`：`createMusic(ctx, output, element)` 回傳 `{ start(), stop(), setRunning(run) }`
  - `HTMLAudioElement`（`loop = true`）經 `ctx.createMediaElementSource` → 自己的 `GainNode` → `output`
  - `start()`：要播。音訊在跑時 `element.play()`，**等它成功才排淡入**（串流還沒開始就排的話，
    淡入在無聲中走完，第一個樣本就是全音量）；等待期間收到 `stop()` 就不淡入。拒絕就算了
  - `stop()`：不播。增益從目前值線性到 0，0.5 s；0.5 s 後 `element.pause()`。淡出途中再 `start()`
    就取消暫停、從目前的值淡回來
  - `setRunning(run)`：引擎的 context 暫停（切分頁、關音量、暫停）時 `element.pause()`，恢復時要播就
    重新 `play()` 並淡入 —— context 暫停只是不輸出，元素照樣往前走，回來時位置已經跳掉
  - 重複呼叫同一個是冪等的
- 輸出端（`output.ts`）多一個音樂匯流排：**接在共用淡入之後**、限幅器之前。共用淡入是進戰鬥（1 s）與
  恢復（0.8 s）用的，經過它的話第一次按「開始遊戲」時兩條淡入相乘，不是 0.5 s。限幅器接上、失效、
  旁路時，匯流排跟著共用淡入一起改接
  - 匯流排的增益跟著主音量（`setVolume` 同時設 `listener` 與它，含混音餘量）
- 引擎（`createAudioEngine`）建一個音樂，接在匯流排上；`applyRunState` 每次呼叫 `music.setRunning`
  - 引擎介面多 `music: { start(): void; stop(): void }`
- 音量：`MENU_MUSIC.gainDb` −9 dB（試聽裁定）；加上檔案壓峰值少掉的 `makeupDb` 1.8 dB
- 網址用 `assetUrl('/music/menu.mp3')`

## 接線（`main.ts` 的 `onEvent`）

- `event === 'start'`：`audio.music.start()`（按鈕的點擊已經先 `audio.unlock()`）
- `event === 'fight' && screen === 'battle'`：`audio.music.stop()`，排在 `loadBattle()` 之前
- `from === 'battle' && screen !== 'battle'`（`leaveBattle()` 那一支）：`audio.music.start()`
- 開發用的 `__drill` 直接進戰鬥：`audio.music.stop()`

## 測試

- `music.ts`：用假的 `AudioParam`／元素驗淡入淡出的排程、暫停的時機、淡出途中再開始會取消暫停、冪等
- 接線：`onEvent` 三處、`__drill` 一處的呼叫存在；`stop` 排在 `loadBattle()` 之前
- 不測音量的聽感（試聽裁定）
