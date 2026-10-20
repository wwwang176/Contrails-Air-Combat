# Contrails Air: Combat

**中文** | [English](README.en.md)

《Contrails Air: Combat》是一款採用風格化 **low-poly 美術**的瀏覽器二戰空戰遊戲。率領編隊執行護航、攔截、轟炸與魚雷攻擊；善用速度與高度，才能在混戰中活著返航。

## 線上遊玩

https://wwwang176.github.io/Contrails-Air-Combat/

## 遊戲特色

- **三條戰役、十場任務**：從歐洲轟炸航線、東線夜襲與雪原俯衝轟炸，到太平洋艦隊防空與低空雷擊。
- **十種二戰軍機**：各有不同的速度、爬升、迴轉、火力與掛載特性。
- **講究能量的空戰**：俯衝換取速度，急轉與爬升則會消耗能量。
- **多樣任務目標**：護航、攔截、空中殲滅、水平轟炸、機場掃射、截斷補給車隊與魚雷攻擊。
- **編隊 AI**：友軍會維持隊形、掩護長機並選擇目標。
- **自由遭遇戰**：任意混編雙方機種，最多各 20 架，並選擇地形、高度、時間與玩家領隊。
- **動態戰場**：曳光彈、爆炸、煙霧、探照燈、水花、尾流與殘骸構成持續變化的戰場。
- **臨場音效**：引擎、槍砲與爆炸聽得出方向與遠近，遠處的聲音較悶、也較晚傳到。

## 遊戲畫面

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/leuna-b17-formation.jpg" alt="梅澤堡的油廠上空的 B-17 機群"><br><sub>梅澤堡的油廠：B-17 機群</sub></td>
    <td width="50%"><img src="docs/screenshots/rennell-torpedo-run.jpg" alt="倫內爾島黃昏的一式陸攻雷擊"><br><sub>倫內爾島：黃昏的一式陸攻雷擊</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/rzhev-stuka.jpg" alt="勒熱夫雪原上的斯圖卡與戰車"><br><sub>勒熱夫：雪原上的斯圖卡與戰車</sub></td>
    <td><img src="docs/screenshots/poltava-night-raid.jpg" alt="波爾塔瓦之夜探照燈下的 He 111"><br><sub>波爾塔瓦之夜：探照燈下的 He 111</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/berlin-escort.jpg" alt="柏林上空 P-51 咬住 Bf 109"><br><sub>柏林上空：P-51 咬住 Bf 109</sub></td>
    <td><img src="docs/screenshots/okinawa-carrier.jpg" alt="沖繩外海零戰俯衝航艦"><br><sub>沖繩外海：零戰俯衝航艦</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/okinawa-dogfight.jpg" alt="沖繩外海 F6F 追擊零戰"><br><sub>沖繩外海：F6F 追擊零戰</sub></td>
    <td><img src="docs/screenshots/leyte-beach-strafe.jpg" alt="雷伊泰前線疾風掃射灘頭"><br><sub>雷伊泰前線：疾風掃射灘頭</sub></td>
  </tr>
</table>

## 三條戰役

- **美軍**：歐洲護航與轟炸、沖繩艦隊防空。（柏林上空 · 梅澤堡的油廠 · 沖繩外海）
- **德軍**：攔截轟炸機流、雪原俯衝轟炸、夜襲與低空機場突擊。（梅澤堡上空 · 勒熱夫 · 波爾塔瓦之夜 · 底板行動）
- **日軍**：瓜達康納爾護航、雷伊泰截斷補給線與倫內爾島雷擊。（瓜達康納爾上空 · 雷伊泰前線 · 倫內爾島）

## 可投入作戰的軍機

| 陣營 | 戰鬥機 | 轟炸機 |
| --- | --- | --- |
| 美軍 | P-51D Mustang、F6F-5 Hellcat、F4F-4 Wildcat | B-17G Flying Fortress |
| 德軍 | Bf 109 K-4 | He 111 H-6、Ju 87 B-2 斯圖卡 |
| 日軍 | Ki-84 疾風、A6M5 零戰 | G4M 一式陸攻 |

機庫提供各機種的外觀、性能與背景資料；遭遇戰則能自由混編雙方軍機。

## 操作方式

| 操作 | 功能 |
| --- | --- |
| 滑鼠移動 | 移動瞄準點，飛機會朝向瞄準點飛行 |
| 滑鼠左鍵 | 鎖定滑鼠／開火；在轟炸視角中投彈或投雷 |
| 按住滑鼠右鍵拖曳 | 自由觀察四周，放開後回正 |
| `W` / `S` | 增加油門／降低油門與減速 |
| `V` | 切換第一人稱與第三人稱視角 |
| `B` | 切換轟炸／投雷視角（限可用機種）；掛彈的戰鬥機直接投彈 |
| `Tab` | 按住查看戰況與計分板 |
| `I` / `O` / `G` | AI 接管／編隊命令標記／自由觀戰鏡頭 |
| `Esc` | 釋放滑鼠並開啟暫停選單 |

自由觀戰鏡頭使用 `W` `A` `S` `D` 移動、`Q` `E` 升降，按住 `Shift` 可加速。

## 本機遊玩

```bash
npm install
npm run dev
```

需要 [Node.js](https://nodejs.org/)；啟動後開啟 `http://localhost:5173`。建議使用桌面瀏覽器與滑鼠。

---

Built with TypeScript, Three.js and Vite.
