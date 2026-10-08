# 各砲種的開火聲（SPEC）

## 1. 目的

現在艦砲、高射砲、地面戰的砲聲共用一個砲擊庫（三個檔），每發隨機挑一個，再用播放速度與低通
裝出各口徑。同一門砲連開幾發，聽起來像三種不同的武器輪流打。

改成**每種砲固定一個聲音**，每發只在音高與音量上有小變化。聲音由負責人在試聽頁選定
（2026-10-09）。

## 2. 砲種與聲音

| 聲音種類（`GunSound` 的鍵） | 誰在用 | 檔案 | 砲種音量 | 等化 |
|---|---|---|---|---|
| `naval5in` | 艦艇 127 mm（`flak` 層） | `gun-5in` | 0 dB | — |
| `heavyFlak` | 陸上 Flak 18、90 mm M1A1 | `gun-heavy-flak` | 0 dB | — |
| `tankGun` | T-34、雪曼、IV 號、虎式（地面戰） | `gun-tank` | −3 dB | — |
| `atGun` | ZiS-3（地面戰） | `gun-at` | −3 dB | — |
| `mortar` | 迫擊砲班（地面戰） | `gun-mortar` | −6 dB | — |
| `naval40` | 艦艇 40 mm（`autocannon` 層） | `gun-40mm` | −6 dB | — |
| `naval20` | 艦艇 20 mm（`mg` 層） | `gun-20mm` | −10 dB | — |
| `lightFlak20` | 陸上 Flak 38 四聯 20 mm | `gun-20mm` | −6 dB | — |
| `quad50` | M16 半履帶車四聯 .50 | `gun-50cal` | −8 dB | 低音 +6 dB（烘進檔案） |
| `roof50` | 卡車車頂 .50 | `gun-50cal` | −10 dB | 同上 |
| `infantry` | 步兵班（地面戰） | `gun-rifle` | −12 dB | 高音 +6 dB（烘進檔案） |

- 砲種音量是試聽頁定案表的值。**再加上 A 加權校正**：每個檔照素材慣例標準化到 −16 LUFS 之後，
  人耳聽感（A 加權、最響 0.4 s）仍各不相同；校正量讓遊戲裡的相對大小與試聽頁一致。校正量量好就寫死。
  基準是舊砲擊庫三個檔照遊戲播出來的平均 −24.1 dB(A)。.50 與步兵另加等化在試聽頁多出來的響度
  （低音 +0.2、高音 +1.1 dB(A)；檔案是等化之後才標準化的，那一截被標準化吃掉了）。寫進程式的值：

  | 種類 | naval5in | heavyFlak | tankGun | atGun | mortar | naval40 | naval20 | lightFlak20 | quad50 | roof50 | infantry |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | dB | +2.8 | +3.3 | −6.0 | −5.9 | −7.4 | −6.4 | −10.4 | −6.4 | −8.7 | −10.7 | −14.7 |
- 每發：播放速度 1 ± 4%、音量 ± 1 dB，均勻亂數
- 不再用播放速度與低通裝口徑（每種都有自己的檔）
- 每一種各自限頻率（`gap`），沿用現有的值：艦砲／重高砲 0.12 s、戰車砲／反坦克砲 0.15 s、
  迫擊砲 0.3 s、40 mm／陸上 20 mm／四聯 .50 0.1 s、艦上 20 mm／車頂 .50 0.07 s、步兵 0.08 s

## 3. 作法

### 3.1 檔案

- 九個新檔照素材慣例處理：單聲道 96 kbps MP3、最響的 0.4 s 標準化到 −16 LUFS、峰值限 −1 dBFS
  （差多少寫進 `manifest.json` 的 `makeupDb`）、開頭靜音剪掉、尾巴剪到 −40 dB 以下或最長 4 s 並淡出、
  `envelopeDb` 每 0.25 s 一格
- `gun-40mm` 就是現在的 `cannon-1`（改名，內容不變）。`cannon-2`、`cannon-3` 移除
- 檔名泛用，不帶素材來源

### 3.2 程式

- `catalog.ts`：`GUN_BY_TIER` 改成上表，每一種帶自己的池名（`pool`）；`POOLS` 拿掉 `cannon`、加上九個池
- 船：`gun.zone.tier` 經固定表對到 `naval5in`／`naval40`／`naval20`
- 陸上砲位：`ShipAAZone` 加選填的 `sound`，`createGroundBattery` 多一個參數；`placeGround` 依單位填
  （重高砲 `heavyFlak`、Flak 38 `lightFlak20`、M16 `quad50`、車頂機槍 `roof50`）
- `cannonAudio.ts`：鍵 = `zone.sound ?? 船的對照`；播 `g.pool`；每發音量加 ±1 dB 亂數（亂數注入，測試可決定）
- **音高亂數只有一個來源**：引擎每次播放本來就乘 `randomRate`（±8%）。改成看類別：`CategorySpec`
  加選填的 `pitchJitter`（省略 = 0.08），`cannon` 填 0.04。`cannonAudio` 不再另外乘音高 —— 兩邊都乘的話
  實際範圍是 0.88～1.12
- 地面戰的四種（`groundGunTier`）不變

### 3.3 要換掉的既有測試

舊設計的斷言（同一庫用播放速度與低通裝口徑）與新設計直接衝突，改寫成新的：

- `audio-catalog.test.ts`「地面戰的砲聲」：口徑間的播放速度排序、反坦克砲比戰車砲高、迫擊砲低通
  → 改成每一種對到自己的池、池有檔、限頻率的既有約束（步兵 `gap` 短於連發間隔）保留
- `audio-wiring.test.ts`：`playPool('cannon', 'cannon', …)` 與 `g.rate, g.cutoffHz` 的原始碼片段
  → 改成播 `g.pool`、類別 `cannon`
- `cannon-audio.test.ts`：呼叫參數改成新的池與音量

## 4. 護欄

1. 每一種聲音都有檔、檔在 `manifest.json`、包絡表齊全（既有的清單護欄涵蓋）
2. 船的三層、陸上四種砲位、地面戰四種各自對到上表的鍵
3. `cannon` 類別的音高亂數 ±4%（`randomRate` 吃類別的 `pitchJitter`，亂數 0 與 1 落在 0.96 與 1.04）；
   其他類別維持 ±8%
4. 每發音量在 ±1 dB 內；亂數 0 與 1 落在兩個邊上
5. `cannon` 池不存在；沒有任何程式播 `cannon`
