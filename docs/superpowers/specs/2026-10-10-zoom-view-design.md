# 按住 V 望遠（取代機首視角）

## 目標

- 拿掉機首視角（`viewMode: 'first'`）。視角只剩機外（`third`）與投彈瞄具（`bomb`，B 鍵，不變）
- **按住 V 望遠**：放開就回來。鏡頭留在機外，視野收窄（放大 `ZOOM_MAGNIFICATION` 倍），鏡頭稍微往上抬，
  自己的飛機留在畫面下方，正前方看得到遠處
- 手機的「視角」按鈕改成按住才望遠，字樣「望遠」；按鍵提示「V 望遠」

## 行為

- `InputState.zoom: boolean`：V 按下為 true、放開為 false；切出視窗、失去指標鎖（`clearHolds`）、陣亡、
  上帝視角、投彈瞄具時不望遠
- 鏡頭（`CameraRig`）：
  - 望遠量 `zoomK` 0–1，向目標平順靠近（時間常數 `ZOOM_TIME`，約 0.2 s 到位）
  - 放大倍率 = 1 + (`ZOOM_MAGNIFICATION` − 1) × `zoomK`
  - 垂直 FOV = 2·atan(tan(原本的 FOV / 2) ÷ 倍率)；原本的 FOV 照舊隨速度 65～73°
  - 鏡頭往世界上方多抬 `ZOOM_LIFT` × `zoomK` 公尺
  - 對外提供目前的倍率（`magnification`）
- 望遠時要跟著倍率調整的：
  - 滑鼠與觸控的瞄準靈敏度 ÷ 倍率（`InputState.aimScale`，主迴圈每幀寫入）
  - 飛機換低精度模型的距離 × 倍率（`aircraftVisuals.update` 吃倍率）
- 初始值：`ZOOM_MAGNIFICATION` 2.5、`ZOOM_LIFT` 0.3 m、`ZOOM_TIME` 0.07 s，由試玩裁定

## 拿掉的

- `CameraRigOptions.firstPersonOffset` 與 `main.ts` 改寫它的兩處；`pressView`
- 螺旋槳殘影的座艙視角除以 3（`COCKPIT_SPIN_DIVISOR`）：沒有座艙視角了

## 測試

- 按鍵：V 按下 zoom 為 true、放開為 false；`clearHolds` 清掉；V 不再改 `viewMode`
- 觸控：視角鈕按下望遠、放開結束
- 鏡頭：望遠到位後 FOV 是原本的 1/倍率（照 tan 換算）、鏡頭比不望遠時高；放開後回到原本的 FOV；
  投彈視角不吃望遠
- 靈敏度與 LOD 的接線
