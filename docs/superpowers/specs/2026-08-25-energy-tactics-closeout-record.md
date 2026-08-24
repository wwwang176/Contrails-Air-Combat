# feat/energy-tactics 結案紀錄（2026-08-25）

> **這份文件的用途**：本分支橫跨多份 spec／plan，途中多個機制被實測否決或
> 被更晚的設計取代。**以這份為準** —— 讀到某份 spec 或 task 清單說某件事
> 「待做」時，先來這裡對照它是不是已經被結掉了。專案負責人 2026-08-25
> 試玩驗收（「OK 可以咬住了」）後定案、併回 main。

## 一、最終上線的機制（與定值出處）

| 機制 | 所在 | 定值依據 |
| --- | --- | --- |
| 空層鎖（band lock，基準貼敵） | `steer.ts` stepBand／bandHold | 八旋鈕註解 + `band-drill.probe.ts` 九開局 |
| 能量帳折現 `kineticWeight 0.1` | `doctrine.ts` | `speed-decay.probe.ts`（帳面動能每秒蒸發 10~46 m） |
| 動態高度鎖（兩條線分家） | `AiController.ts` | 敵人 −300（容低位 yo-yo）、轟炸機 −100（天職） |
| 反應延遲穩態補償器 `trimTau: 1` | `delay.ts`／`profile.ts` | orbit／weave 四組對照表（profile.ts 註解） |
| 速度先於轉向 `extendVigor 0.85→1.05` | `steer.ts` extendHeadingBias | belowOrbit 死亡螺旋 + 斜坡兩端掃描（欄位註解） |
| 迴轉閂鎖去高度污染（中點高度） | `assess.ts` airframeTurnAdvantage | `turn-latch-alt.probe.ts`（600 m = 正好踩觸發門檻） |
| `extendTurnCap 20°`、`engageKnobs` 尾追門 | `steer.ts` | rearHigh 重掃、90° 橫越後置病 |

主要 commit：`8ceb425`（補償器）→ `69c44e6`（行為重構）→ `8d3085c`（量測儀）
→ `e06f164`（「敵人在下方」四連修）→ `5817072`（四連修量尺）。

## 二、被否決或被取代的機制 —— **不要重做**

- **`rollFirstPull`（倒飛先滾轉再拉）**：整層移除。量測否決 —— 關掉反而
  更好（−239 vs −277），教訓在 `steer.ts` 拉桿段註解。
- **extendPitchAngle 的「相對速度赤字」版**（能量 spec §4 的方向修正，
  task #311/#312）：被 `altitudeAdvantage` 版取代（爬升的唯一戰術理由是
  敵人在上方 + 速度先於高度閘門）。#312 的「量測與基準裁定」隨之失效。
- **迴轉平面紀律（turn-plane discipline）**：整層移除（追不上 Task 1），
  spec `2026-08-23-turn-plane-discipline-design.md` 全文僅存史料價值。
  #331 的掃描回填隨之失效。
- **追不上閂鎖（track break，trackEnter 等四旋鈕）**：機制入庫但
  `trackEnter: 0` **關閉** —— 判準被量測否決（敵人在機體仰角 +86° 時它
  說「追得上」），註解記於 `DEFAULT_STEER`。整批移除與否留待負責人日後
  裁定；在那之前**不是待辦**。
- **戰術層 `quota: 0` 預設關閉**（能量 spec §14）：消融證明兩條紅護欄與
  它無關；翻開與否是負責人的平衡決策，**不是遺漏**。
- **`aimError`**：仍無人消費，刻意不做（`profile.ts` 註解）。
- **bleed-zone 重掃提案**：撤回 —— 量測顯示超速僅 8~15 m/s 擦邊，
  與 2026-08-07 在案裁決相符。

## 三、刻意留下的殘留（已向負責人聲明，不算缺陷）

- 倒飛開局最低點 −454（`extendTurnCap` 20° 的已知代價，帶 vigor 後已較
  −679 改善）。
- belowOrbit 的回場要 65 s —— 高高度平飛幾乎沒有多餘功率，物理上限。
- band 重鎖棘輪（無原空層記憶）—— 貼敵基準上線後影響大幅縮小。
- 護送主判準定案值 **−145**（兩線分家後）：與在案接受的 −137/−280 同
  量級；−100 時代的 +154 有一部分是「過度打斷追擊」貢獻的，不是基準。

## 四、全套回歸基準（2026-08-25）

13 failed / 2934 passed，為 HEAD 既有基準（17 條）的真子集 —— 分支反而
修好 4 條（集火×2、側舷@1000、對頭@1000）。perf-gate 三條在全套並行下
必炸、單獨跑全過（資源競爭，非迴歸）。
