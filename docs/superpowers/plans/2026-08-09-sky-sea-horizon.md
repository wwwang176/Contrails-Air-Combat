# 天空、海面與地平線的重新調色 —— 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把天空提亮、讓海面近到遠完全均勻、並把畫面上那條地平線挪回眼高,使海天接縫成為一條乾淨的界線。

**Architecture:** 四個獨立的改動 —— 天空的兩個色常數、海面材質退出全域霧、遠海放大到實質無限、霧色不再壓暗。全部是常數與旗標,沒有新的演算法。

**Tech Stack:** TypeScript（strict、`noUncheckedIndexedAccess`）、three.js、vitest、Playwright。

**依據 spec:** `docs/superpowers/specs/2026-08-09-sky-sea-horizon-design.md`

## Global Constraints

- **絕不 `git add -A`** —— `bash.exe.stackdump` 是被追蹤且已被修改的檔案。一律列明確路徑。
- **沒有 `@types/node`** —— 不可用 `node:path`、`__dirname`、`process`、`fs`。
- `noUncheckedIndexedAccess`、`noUnusedLocals`、`noUnusedParameters` 都開著。
- `src/render/vortex.ts`、`src/render/tube.ts` 不得 import `src/battle/`、`src/ai/`、`src/hud/`；`src/render/fog.ts` 不得 import `scene.ts`。
- 熱路徑不得配置。
- **絕不為了讓測試變綠而放寬門檻。** 本次**刻意刪除**的三條測試是專案負責人的裁定（spec §5),不是實作者的判斷 —— 除了那三條之外,任何紅都要先量、先報告、先問。
- 每一條新測試都要先看到它紅（或用 mutation 證明不是假綠）。
- 型別檢查指令是 `npx tsc --noEmit`。
- **絕不用 PowerShell 讀寫含中文的檔案。** 中文 commit message 寫到 `$CLAUDE_JOB_DIR/tmp/msg.txt` 再 `git commit -F`。

## 檔案結構

| 檔案 | 這次的職責 |
|---|---|
| `src/render/sky.ts` | 兩個色常數 |
| `src/render/ocean.ts` | 兩個材質加 `fog: false`;`FAR_SEA_SIZE` |
| `src/render/scene.ts` | `CAMERA_FAR` |
| `src/render/fog.ts` | 刪 `FOG_SKY_DARKEN`;`FOG_COLOR` 不再乘倍率 |
| `test/unit/fog.test.ts` | 刪三條、加四條 |
| `test/e2e/battlefield-visuals.e2e.ts` | 只改註解裡的舊數字與舊判準,斷言不動 |

---

### Task 1: 四個改動與測試

**Files:**
- Modify: `src/render/sky.ts:23-24`、`src/render/ocean.ts:52,89-94,138-142`、`src/render/scene.ts:31`、`src/render/fog.ts:1-41`
- Test: `test/unit/fog.test.ts`

**Interfaces:**
- Consumes: 無
- Produces: `SKY_HORIZON`/`SKY_ZENITH`（值變,型別不變)、`FAR_SEA_SIZE: number`、`CAMERA_FAR: number`、`FOG_COLOR: Color`（`FOG_SKY_DARKEN` **移除 export**)

- [ ] **Step 1: 刪掉三條被推翻的測試**

`test/unit/fog.test.ts`,在 `describe('地平線要看得出來')` 內刪除這三條（**整條連同註解**）：

```ts
  it('霧色比**地平線上的**天空色暗', () => { … })
  it('暗的幅度看得出來（不是差幾個位元）', () => { … })
  it('霧色仍然比近處的海亮（深度感靠這個差）', () => { … })
```

同時刪除 `describe('霧的濃度落在設計意圖上')` 裡的：

```ts
  it('遠海邊緣完全化進霧色（才不會看到硬邊）', () => {
    expect(fogFactor(FAR_SEA_SIZE / 2, FOG_DENSITY)).toBeGreaterThan(0.999)
  })
```

【為什麼是刪不是改】前三條守的是「靠霧色與天空色的差撐出地平線」,而地平線
現在由**海色**與天空色的差撐起來（spec §4.2）。第四條守的是「遠海的邊要被
霧藏起來」,而那條邊在 spec §4.3 之後已經在眼高上,不需要藏。四條的**理由**
都失效了,留著改斷言會變成描述已不存在之機制的註解。

`FAR_SEA_SIZE` 與 `FOG_DENSITY` 的 import 若因此變成未使用,不要急著刪 ——
Step 2 的新斷言會用到 `FAR_SEA_SIZE`。

- [ ] **Step 2: 寫失敗的新測試**

在 `describe('地平線要看得出來')` 內（原本那三條的位置）放入：

```ts
  /**
   * 【地平線現在由海色與天空色的差撐起來,不再由霧色】專案負責人的要求原文
   * 是「海面要比天空深」。海面不吃霧（見下一條）之後,海恆為 `SEA_COLOR`,
   * 所以這條關係變成兩個常數之間的事,不必再繞過霧。
   *
   * 【0.25 是怎麼來的】實測 B 案：天空 0.431、海 0.060,階差 0.371。
   * 改動前那一階只有 0.092（霧化後的遠海 0.169 對天空 0.261）—— 那正是
   * 「接縫太怪」的成因。取 0.25 留浮動空間,但遠高於改動前。
   */
  it('海色比地平線上的天空色暗,而且差得很開', () => {
    const sky = skyColorAt(0, new Color())
    const sea = new Color(SEA_COLOR)
    expect(lightness(sea)).toBeLessThan(lightness(sky))
    expect(lightness(sky) - lightness(sea)).toBeGreaterThan(0.25)
  })

  /**
   * 【這是「近到遠沒有顏色變化」唯一的來源】海面的近遠色差**完全**來自霧。
   * 只要有一個材質忘了關,那一片就會往天空色靠 —— 而畫面上只會看到「海的
   * 遠處變淡」,沒有任何錯誤、沒有任何別的測試會紅。
   */
  it('海面的兩個材質都不吃霧', () => {
    const ocean = createOcean()
    try {
      expect((ocean.mesh.material as Material).fog).toBe(false)
      expect((ocean.farMesh.material as Material).fog).toBe(false)
    } finally {
      ocean.dispose()
    }
  })

  /**
   * 【天空頂部比較深】專案負責人要求的第四件事。它改動前就成立,這條是
   * 防止日後有人把漸層調反或壓平 —— 那會讓天空變成一片死板的單色。
   * 實測 B 案落差 0.154（改動前 0.146）。
   */
  it('天頂比地平線上的天空暗', () => {
    const top = skyColorAt(1, new Color())
    const hz = skyColorAt(0, new Color())
    expect(lightness(hz) - lightness(top)).toBeGreaterThan(0.10)
  })

  /**
   * 【天空整體要比改動前亮】純粹釘住方向。改動前地平線上的天空是 0.261,
   * B 案是 0.431。取 0.35 當門檻。
   */
  it('地平線上的天空比改動前亮', () => {
    expect(lightness(skyColorAt(0, new Color()))).toBeGreaterThan(0.35)
  })
```

在檔案末尾（`describe('相機遠平面容得下遠海')` 之前）新增：

```ts
/**
 * 【畫面上那條地平線必須在眼高】這個世界的海是平的,所以幾何上的地平線永遠
 * 在俯角 0°。但 `farMesh` 是**有限**的四邊形,它的邊落在 `atan(h / 半邊)`
 * —— 那才是畫面上實際看到的那條線。
 *
 * 改動前半邊 250 km,12,000 m（上帝視角上限）時那條邊在眼高以下 2.748°,
 * 1080p / 65° 下是 45.6 px,而且**隨高度往下跑**。以前被霧糊掉所以看不出來;
 * 海面不吃霧之後它會變成 L 0.060 對 L 0.431 的硬階。
 *
 * 半邊 3,000 km 之後只剩 0.229°（3.8 px）。
 */
describe('地平線落在眼高', () => {
  /** 上帝視角的高度上限,m。與 `godCamera.ts` 的 `maxAltitude` 同值 */
  const MAX_EYE = 12_000

  it('最高視角下,遠海的邊落在眼高以下不到 0.3°', () => {
    const deg = Math.atan(MAX_EYE / (FAR_SEA_SIZE / 2)) * (180 / Math.PI)
    expect(deg).toBeLessThan(0.3)
  })
})
```

檔案頂端的 import 補上：

```ts
import { Color, type Material } from 'three'
import { createOcean, FAR_SEA_SIZE, SEA_COLOR } from '../../src/render/ocean'
```

（`skyColorAt`、`SKY_HORIZON`、`CAMERA_FAR`、`fogFactor`、`FOG_DENSITY`、
`FOG_COLOR`、`createFog` 的既有 import 不動;`FOG_COLOR` 仍被
`createFog` 那一組用到。）

- [ ] **Step 3: 跑測試,確認紅的是該紅的那些**

```
npx vitest run test/unit/fog.test.ts
```

預期 **4 紅**：

| 測試 | 預期的紅法 |
|---|---|
| 海色比地平線上的天空色暗,而且差得很開 | 🔴 實得 0.261 − 0.060 = 0.201,不到 0.25 |
| 海面的兩個材質都不吃霧 | 🔴 `material.fog` 是 `true`（three 的預設） |
| 天頂比地平線上的天空暗 | 🟢 改動前就成立（0.261 − 0.115 = 0.146 > 0.10）→ 靠 Step 6 的 mutation |
| 地平線上的天空比改動前亮 | 🔴 實得 0.261,不到 0.35 |
| 最高視角下,遠海的邊落在眼高以下不到 0.3° | 🔴 實得 2.748° |

**記下實際的紅法**,Task 2 的回填要用。

【`createOcean` 在 vitest 裡跑得起來嗎】它只建 `PlaneGeometry` 與
`MeshStandardMaterial`,不碰 WebGL context —— `material.fog` 是純 JS 欄位。
`onBeforeCompile` 只在真的編譯著色器時才被呼叫,單元測試不會走到。若這一步
意外噴 WebGL 相關錯誤,**停下來報告**,不要改成斷言常數繞過去（那就測不到
材質真的有設）。

- [ ] **Step 4: 改四個檔案**

**(a) `src/render/sky.ts`** —— 換兩個常數,並改寫它們的註解：

```ts
/**
 * 天空球的地平色與天頂色。
 *
 * 【這兩個不是畫面上看到的顏色】`t = dirY × 0.5 + 0.5`,所以畫面上的地平線
 * （`dirY = 0`）落在漸層的**正中間**,實際是 `#89accd`（L 0.431);`SKY_ZENITH`
 * 出現在正上方（`#4d84b8`,L 0.277);而 `SKY_HORIZON`（L 0.702）只出現在
 * `dirY = −1`,那裡被海擋著,畫面上永遠看不到。
 *
 * 【2026-08-09 提亮】專案負責人試飛後要求「天空整體顏色淡一點」。地平線上的
 * 天空由 L 0.261 提到 0.431,天頂由 0.115 提到 0.277 —— 天頂到地平線的落差
 * 由 0.146 變成 0.154,「頂部比較深」這個關係維持。
 *
 * 海天的明暗關係由 `test/unit/fog.test.ts` 釘住,而它比的是**海色**與
 * **地平線上的**天空色,不是這兩個常數。
 */
export const SKY_HORIZON = 0xc6dfec
export const SKY_ZENITH = 0x4d84b8
```

**(b) `src/render/ocean.ts`** —— 兩個材質各加一行,並放大遠海：

`material`（細浪面）與 `farMaterial` 的建構參數各加：

```ts
    // 【海面不吃霧,spec 2026-08-09 §4.2】海面的近遠色差**完全**來自霧,
    // 而霧色是由天空色推導的,所以遠海必然往天空靠 —— 接縫因此糊成一片。
    // 專案負責人要的是「近到遠幾乎沒有顏色變化」,做法是讓海退出全域霧。
    // 兩個材質必須一起關,漏一個就會在 5 km 處出現一條色帶。
    fog: false,
```

`FAR_SEA_SIZE` 換值並改寫註解：

```ts
/**
 * 遠海的邊長,m。**這是一片平的四邊形,不是網格。**
 *
 * 【為什麼是 3,000 km 的半邊】這個世界的海是平的,幾何上的地平線永遠在
 * 眼高（俯角 0°)。但這片四邊形是有限的,它的邊落在 `atan(h / 半邊)` ——
 * **那才是畫面上實際看到的那條地平線**。
 *
 * | 高度 | 半邊 250 km | 半邊 3,000 km |
 * |---|---|---|
 * | 1,000 m | 0.229°（3.8 px） | 0.019°（0.3 px） |
 * | 6,000 m | 1.375°（22.8 px） | 0.115°（1.9 px） |
 * | 12,000 m | 2.748°（45.6 px） | 0.229°（3.8 px） |
 *
 * 250 km 時那條線在上帝視角的極端高度下低了 45.6 px,而且隨高度移動。
 * 以前看不出來是因為霧把它糊掉了;海面不吃霧之後它會變成 L 0.060 對
 * L 0.431 的硬階（spec 2026-08-09 §3）。
 *
 * 【遠平面要跟著動】`CAMERA_FAR` 必須大於半對角線 4,243 km,見 `scene.ts`。
 *
 * 【為什麼不必分段】它是平的,分段沒有任何意義。
 */
export const FAR_SEA_SIZE = 6_000_000
```

**(c) `src/render/scene.ts`** —— `CAMERA_FAR`：

```ts
/**
 * 遠平面,m。
 *
 * 【它只有一個約束】必須大於遠海的**半對角線**（`FAR_SEA_SIZE / 2 × √2`
 * = 4,243 km),否則遠海的四個角會被裁掉,而被裁掉的邊緣就是一條硬邊。
 * 2026-08-09 遠海由半邊 250 km 放大到 3,000 km（見 `ocean.ts` 的
 * `FAR_SEA_SIZE`),這裡跟著由 800 km 拉到 5,000 km。
 *
 * 【深度精度的代價幾乎是零】解析度是 `Δz ≈ z²·(f−n)/(n·f·2²⁴)`,而 `f ≫ n`
 * 時 `(f−n)/(n·f) → 1/n`。**近平面沒有動**,所以近場精度不變 —— 100 m 處
 * 仍然是 0.6 mm。這次只把那個因子從 0.99999875 變成 0.9999998。
 *
 * 【但「沒有變差」不等於「夠用」】決定 `Δz` 的是近平面與距離：12,000 m 處
 * 是 8.58 m。遠海與細浪面只相距 3 m,所以高空俯視時兩者的深度分不出前後
 * —— 那是既有的限制,處置見 `ocean.ts` 的 `farMesh.renderOrder`。
 */
export const CAMERA_FAR = 5_000_000
```

**(d) `src/render/fog.ts`** —— 刪掉 `FOG_SKY_DARKEN`,`FOG_COLOR` 不再乘：

```ts
/**
 * 霧色。**由地平線上的天空色直接取得。**
 *
 * 【2026-08-09：不再壓暗】改動前是 `skyColorAt(0) × FOG_SKY_DARKEN`(0.65),
 * 而那個倍率存在的唯一理由是「遠海化進霧色之後不能與天空同色,否則地平線
 * 消失」。海面不吃霧之後（`ocean.ts` 的 `fog: false`),遠海根本不化進霧色,
 * 那個理由就沒了 —— 地平線改由**海色**與天空色的 0.371 階差撐起來。
 *
 * 霧剩下的工作只有一件：物件的空氣透視。而物件絕大多數是在**天空**的背景上
 * 看到的,所以霧色就該是地平線上的天空色 —— 遠處的飛機自然融進天空。
 *
 * 【為什麼是推導不是寫死】天空色怎麼調,霧色都自動跟上。這是這個專案一貫的
 * 「推導比鏡射安全」—— 初版寫死 `0x7ea8c4` 就是這樣出錯的。
 */
export const FOG_COLOR: Color = skyColorAt(0, new Color())
```

並刪掉整段 `FOG_SKY_DARKEN`（含它那張倍率表）。

- [ ] **Step 5: 跑測試與型別**

```
npx vitest run test/unit/fog.test.ts
npx tsc --noEmit
```

預期全綠。`tsc` 會抓到任何還在 import `FOG_SKY_DARKEN` 的地方 —— 若有,那些
是 Step 4(d) 沒清乾淨。

- [ ] **Step 6: Mutation —— 證明「天頂比地平線暗」那條不是假綠**

它在改動前就是綠的,所以要靠 mutation。做完立刻還原：

| # | mutation（改 `src/render/sky.ts`） | 必須轉紅的測試 |
|---|---|---|
| 1 | `SKY_ZENITH = 0x4d84b8` → `= 0xc6dfec`（與 horizon 同值,漸層壓平） | `天頂比地平線上的天空暗` |
| 2 | 把 `SKY_HORIZON` 與 `SKY_ZENITH` 的值互換 | `天頂比地平線上的天空暗`（漸層反向） |

另外兩個守新行為的 mutation：

| # | mutation | 必須轉紅的測試 |
|---|---|---|
| 3 | `ocean.ts` 的細浪面 `fog: false` → `fog: true` | `海面的兩個材質都不吃霧` |
| 4 | `ocean.ts` 的 `farMaterial` `fog: false` → `fog: true` | 同上 |

**四個都必須轉紅。** 3 與 4 分開做 —— 只測一個的話,漏掉另一個材質的那種
錯誤（正是註解裡警告的「5 km 處出現一條色帶」）就沒有被守住。

還原後再跑一次確認全綠,並用 `git diff` 確認乾淨。

- [ ] **Step 7: 全套回歸**

```
npx vitest run
npx tsc --noEmit
```

`perf-gate` 與 `rematch` 照專案慣例**單獨跑**：

```
npx vitest run test/unit/perf-gate.test.ts
npx vitest run test/integration/rematch.test.ts
```

【已知的兩條既有紅】`ai-command-channel > 命令佔時比例落在掃描定出的區間`
與 `ai-command-tactics > 側翼讓開火時的方位角往後側方移動` 在本次改動之前
就是紅的（記錄於 `2026-08-09-recovery-altitude-degeneracy-design.md` §13.7)。
**其餘任何一條紅都要停下來查**,尤其是 `render` 或 `world` 底下的。

- [ ] **Step 8: Commit**

```bash
cat > "$CLAUDE_JOB_DIR/tmp/msg.txt" <<'EOF'
feat: 天空提亮、海面完全均勻、地平線挪回眼高

專案負責人試飛後的要求：天空淡一點、海面比天空深、海面近到遠幾乎沒有顏色
變化、天空頂部比較深。

量出來的根因：接縫那一階只有 0.092，而海面自己近到遠就變了 0.109 ——
那條線比它兩側的漸層還弱。海面的變化完全來自霧，而霧色由天空色推導。

四個改動：
  天空 B 案（地平線 L 0.261 -> 0.431、天頂 0.115 -> 0.277，落差維持 0.15）
  海面兩個材質 fog: false（近到遠變化量 0.000）
  遠海半邊 250 km -> 3,000 km，CAMERA_FAR 800 km -> 5,000 km
  FOG_SKY_DARKEN 刪除，FOG_COLOR = skyColorAt(0)

第三項是算的時候挖出來的：畫面上那條地平線其實是遠海平面的邊，落在眼高
以下 atan(h / 半邊)，12,000 m 時是 2.748 度（45.6 px）且隨高度移動。以前被
霧糊掉，海面不吃霧之後會變成硬階。放大後只剩 0.229 度（3.8 px）。

推翻 2026-08-08 那份 spec 的一條裁定（「霧色仍然比近處的海亮，深度感靠
這個差」），那是專案負責人的決定，見 spec 5 節。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTdeLVNHduRspN8aPBMYYf
EOF
git add src/render/sky.ts src/render/ocean.ts src/render/scene.ts src/render/fog.ts test/unit/fog.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

### Task 2: Playwright 驗收與註解回填

**Files:**
- Modify: `test/e2e/battlefield-visuals.e2e.ts`（**只改註解與 console 訊息,斷言一個字都不動**）
- Modify: `docs/superpowers/specs/2026-08-09-sky-sea-horizon-design.md`（新增 §8 實測結果）

**Interfaces:**
- Consumes: Task 1 的 `FAR_SEA_SIZE`、`CAMERA_FAR`、`FOG_COLOR`
- Produces: 無

- [ ] **Step 1: 改 e2e 裡描述舊數字的註解**

`test/e2e/battlefield-visuals.e2e.ts` 有三處寫著已經不成立的東西：

**(a) 檔頭第 18 行**：`相機遠平面 800 km、遠海那片 500 km 的四邊形` →
`相機遠平面 5,000 km、遠海那片 6,000 km 的四邊形`。

**(b) 第 81–82 行的 console 訊息**：
```ts
    console.log(`[人工看] ${SHOTS}vis-3-high.png —— 海要接到地平線，`
      + '地平線要是一條看得出來的線（海比天暗），畫面下半不得出現天空色的破洞')
```
改成：
```ts
    console.log(`[人工看] ${SHOTS}vis-3-high.png —— 海要接到地平線，`
      + '地平線要是一條乾淨的硬線（海 L 0.060 對天空 L 0.431），'
      + '而且要落在眼高上，不得低於畫面中線一段；畫面下半不得出現天空色的破洞')
```

**(c) 第 103–106 行那段「權威判準」**：
```ts
    //   一、`test/unit/fog.test.ts` 把顏色關係釘死（霧色必須比
    //       `skyColorAt(0)` 暗，而且暗的幅度 > 0.05）。
```
改成：
```ts
    //   一、`test/unit/fog.test.ts` 把顏色關係釘死（**海色**必須比
    //       `skyColorAt(0)` 暗，而且差距 > 0.25；2026-08-09 之前比的是
    //       霧色，那時海面還吃霧）。
```

- [ ] **Step 2: 跑 Playwright 驗收**

Dev server 要開著（本 session 已經開在 5173;若沒有,先 `npm run dev`）。

```
npx vite-node test/e2e/battlefield-visuals.e2e.ts
```

**唯一的自動斷言是「全程沒有 console 錯誤」。** 這一次它守的是新的巨大幾何
（6,000 km 的四邊形）與 5,000 km 遠平面會不會讓 three 噴警告或 NaN ——
那正是本次最可能壞掉的方式。

截圖產在 `.shots/`。**`vis-3-high.png` 是這次的主要證據**：那是上帝視角爬高
之後的俯視,要看的是地平線有沒有變成一條乾淨的線、位置在不在眼高、下半部
有沒有天空色的破洞。

【若出現 console 錯誤,停下來報告】特別注意 `RENDER WARNING` 或深度相關的
訊息 —— 5,000 km 的遠平面是本次唯一可能踩到 WebGL 限制的地方。

- [ ] **Step 3: 把截圖交給專案負責人**

用 `SendUserFile` 把 `.shots/vis-1-cockpit.png`、`.shots/vis-2-god.png`、
`.shots/vis-3-high.png`、`.shots/vis-5-back.png` 送出,並說明每一張要看什麼。

**顏色好不好看只有專案負責人能判定** —— 前一版的錯（霧色比天空亮）就是他
一眼看出來的,不是任何測試抓到的。

- [ ] **Step 4: 回填 spec**

在 `docs/superpowers/specs/2026-08-09-sky-sea-horizon-design.md` 末尾新增：

```markdown
## 8. 實測結果（2026-08-09 回填）

### 8.1 改動前後的明度

| 位置 | 改動前 | 改動後 |
|---|---|---|
| 天頂 | `#1f4f80` L 0.115 | `#4d84b8` L 0.277 |
| 天空 45° | `#54779a` L 0.205 | `#779fc5` L 0.373 |
| 地平線上的天空 | `#6788a7` L 0.261 | `#89accd` L 0.431 |
| 海 @2 km | `#1d3f5c` L 0.060 | `#1d3f5c` L 0.060 |
| 海 @250 km | `#537089` L 0.169 | `#1d3f5c` L 0.060 |
| **接縫的階差** | **0.092** | **0.371** |
| **海面近到遠的變化** | **0.109** | **0.000** |

### 8.2 地平線的位置

| 高度 | 改動前 | 改動後 |
|---|---|---|
| 1,000 m | 0.229°（3.8 px） | 0.019°（0.3 px） |
| 6,000 m | 1.375°（22.8 px） | 0.115°（1.9 px） |
| 12,000 m | 2.748°（45.6 px） | 0.229°（3.8 px） |

### 8.3 迴歸

（填入：全套 vitest 的通過／失敗數、`tsc` 結果、`perf-gate` 與 `rematch`
單獨跑的結果、四個 mutation 各自打紅了哪一條。）

### 8.4 Playwright

（填入：console 錯誤數、截圖清單、專案負責人的判定。）
```

**把括號裡的字換成實際量到的數字。**

- [ ] **Step 5: Commit**

```bash
cat > "$CLAUDE_JOB_DIR/tmp/msg.txt" <<'EOF'
docs: 回填天空海面調色的實測結果與 Playwright 驗收

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTdeLVNHduRspN8aPBMYYf
EOF
git add test/e2e/battlefield-visuals.e2e.ts docs/superpowers/specs/2026-08-09-sky-sea-horizon-design.md
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

## 不做的事

- **不動 `SKY_GRADIENT_POWER`、`FOG_DENSITY`、`SEA_COLOR`、燈光、波形、`FAR_SEA_Y`、`renderOrder`。** 理由見 spec §7。
- **不做「天空球下半部塗成海色」。** 那個做法地平線會精確落在 `dirY = 0`,
  但天空球不吃光、遠海吃光,要接得上就得在 CPU 重算 three 的 PBR —— 一個會
  隨燈光漂掉又沒人守得住的耦合。放大平面沒有顏色匹配問題（spec §4.3）。
- **不動 e2e 的任何斷言。** 只改註解與 console 訊息裡已經不成立的數字。
- **不處理那兩條既有紅**（`ai-command-channel` 的佔時比例、`ai-command-tactics`
  的側翼方位角）。它們與本次無關,記錄在
  `2026-08-09-recovery-altitude-degeneracy-design.md` §13.7。
