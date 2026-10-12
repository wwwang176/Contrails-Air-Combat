# 開場導覽：怎麼排一關的鏡位

機制見 `2026-10-12-mission-intro-design.md`。這一份是**排鏡位的做法**：已經排好的日 M2、盟 M3、
德 M4 怎麼來的，與排其他關時要照的條件。

## 現況

| 關 | 鏡位 |
|---|---|
| 盟 M1 | B-17 左前上方近拍 → 左側斜前方長焦拍同層六架 B-17 → Bf 109 左前上方近拍 |
| 盟 M2 | 廠區冷卻塔、儲氣槽與煙囪低角度橫移 → 南側外圈重高砲近拍 → B-17 右後上方跟拍（待負責人驗收） |
| 日 M2 | 車隊第一輛卡車前方路邊貼地、迎面開近 → 從內陸高處沿灘頭橫移，掃過九輛目標卡車 |
| 盟 M3 | 貼海面沿航母右舷橫移 → 零戰編隊側面 1.1 km 長焦（10°），編隊滑過畫面 |
| 德 M4 | 反坦克砲正前方偏 15° 貼地平拍、它開火 → 跳切到 IV 號 15° 俯視、砲彈陸續落在旁邊 → Ju 87 後上方跟拍 |

還沒有的：德 M1、德 M2、德 M3、日 M1、日 M3。

## 負責人認可的方向

- **任務目標要看得清楚長怎麼樣**：近、低角度。遠景裡的白漆單位、小卡車在畫面上只剩任務目標框，等於沒拍
- **地面目標貼地或低角度拍**；平行地面的遠景「太平」，被否決過
- **要有因果**：開火 → 跳切 → 落彈。一發砲彈跨過剪接點最有效（德 M4）
- **要有動態**：迎面開近（`backTo`）、長焦下的編隊滑過畫面、慢慢橫移；靜止的畫面被嫌過
- **長焦壓縮**讓一隊飛機看起來很多（盟 M3）
- 每段 2～3.5 秒，硬切，全長 7～9 秒（不含 1.5 秒滑回）

## 欄位（`IntroShot`，`src/battle/missions/types.ts`）

- `follow`：跟拍 `subject`（地面單位 `{ ground }`、要害艦 `{ ship: 'vital' }`、飛機 `{ air, role }`）。
  `back` 負 = 在前方；`backTo` 讓距離在這一段裡線性變化；`up` 量在「對象與鏡頭底下的地面」較高者之上
- `pan`：鏡頭由 `from` 移到 `to`、看的點由 `lookFrom` 移到 `lookTo`。丘陵地加 `aboveGround: true`，
  四個點的 `y` 就變成離地高度
- `fov`：這一段的視角（度）。收窄 = 長焦
- `fires`：這一段裡排的砲擊（`IntroFire`）。只有畫面，不扣血。單位用座標指（離那一點最近、還在場上的）；
  `miss` 是落點相對目標的世界座標偏移。砲彈 450 m/s：開火時刻 + 距離 / 450 就是落地時刻，排在切過去之後

## 做法

1. **先量座標**。開發伺服器開著，Playwright 進那一關，等 `window.__probe().t > 0.2`，讀：
   `__probe()`（玩家位置）、`__ground()`（地面單位：id、team、alive、dormant、scripted、x、z）、
   `__ships()`、`__seats()`（每一架飛機）。範例腳本見下
2. 寫鏡位，在卡片上寫一段註解：每一段拍什麼、座標、為什麼這樣排（照德 M4 那一段的格式）
3. 截圖：照 `__probe().t` 在幾個時刻截，一段至少兩張（看得出動態）。**截圖會晚幾百毫秒**，短特效
   （砲口閃光）不一定截得到，看落彈的塵土即可
4. 給負責人看截圖再調。數值都標「起始值」

```js
// 進關、在導覽的幾個時刻截圖（照 `__probe().t`）
await page.click('[data-act="start"]'); await page.waitForTimeout(1500)
await page.click('[data-act="mission"]'); await page.click('[data-campaign="germany"]')
await page.click('[data-mission="germany-m4"]'); await page.click('#brief-go')
const marks = [0.8, 2.5, 4.2, 6.0]; let k = 0
for (let i = 0; i < 3000 && k < marks.length; i++) {
  await page.waitForTimeout(15)
  const p = await page.evaluate(() => { try { return window.__probe?.() } catch { return null } })
  if (p && p.t >= marks[k]) await page.screenshot({ path: `intro-${k++}.png` })
}
```

## 踩過的坑

- **雪地白漆**：冬季塗裝的砲與戰車在雪地上，離 50 m 以外就看不出來（德 M4）。拉遠的俯視全是彈坑
- **開場就是殘骸的單位**：劇本打掉的單位（`__ground()` 的 `scripted: true`、`alive: false`）開場就在燒，
  近拍只看得到火的網格。先查再選
- **藏著的縱隊**：`dormant: true` 的單位開場不在場上（德 M4 的蘇軍戰車縱隊等突破才出發），拍不到
- **橫移太快會糊**：離地 50 m 內的對象，3.5 秒橫移超過 50 m 就一秒掃過畫面
- **編隊本身有高低層**：盟 M3 的零戰上下差 200 m，長焦再窄也疊不在一起；視角窄到 7° 時上下兩層會被切掉
- **貼地拍火**：燒著的煙火太近會看到低多邊形的火焰網格，保持 100 m 以上
- **陸地上的貼地鏡頭**：`follow` 的 `up` 已經量在地面之上；`pan` 要加 `aboveGround`，否則會鑽進丘陵

## 紀律

- 照 repo 根目錄的 `CLAUDE.md`：註解寫事實（繁體中文）、改檔直接編輯、不加 session 網址
- 在 `feat/mission-intro` 上 **只 commit、不 push、不合併**
- 改完跑 `npx tsc --noEmit`（基準 0 行）與 `npx vitest run test/unit/mission-intro.test.ts
  test/unit/mission-intro-director.test.ts test/unit/campaigns.test.ts`
