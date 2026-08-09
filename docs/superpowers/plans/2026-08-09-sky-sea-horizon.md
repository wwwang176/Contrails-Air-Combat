# 天空、海面與地平線的重新調色 —— 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把天空提亮、讓霧不再使海面近遠變色、並把畫面上那條地平線挪回幾何地平線附近，使海天接縫成為一條乾淨的界線。

**Architecture:** 四個獨立的改動 —— 天空的兩個色常數、海面材質退出全域霧、遠海放大、霧色不再壓暗。全部是常數與旗標，沒有新的演算法。

**Tech Stack:** TypeScript（strict、`noUncheckedIndexedAccess`）、three.js、vitest、Playwright。

**依據 spec:** `docs/superpowers/specs/2026-08-09-sky-sea-horizon-design.md`

**版本:** v2（吸收 Codex 對 v1 的十一條審查意見，見 spec §8 與文末）

## Global Constraints

- **絕不 `git add -A`** —— `bash.exe.stackdump` 是被追蹤且已被修改的檔案。一律列明確路徑。
- **沒有 `@types/node`** —— 不可用 `node:path`、`__dirname`、`process`、`fs`。
- `noUncheckedIndexedAccess`、`noUnusedLocals`、`noUnusedParameters` 都開著。
- `src/render/fog.ts` 不得 import `scene.ts`。
- 熱路徑不得配置。
- **絕不為了讓測試變綠而放寬門檻。** 本次**刻意刪除**的四條測試是專案負責人的裁定（spec §5），不是實作者的判斷 —— 除了那四條之外，任何紅都要先量、先報告、先問。
- 每一條新測試都要先看到它紅（或用 mutation 證明不是假綠）。
- 型別檢查指令是 `npx tsc --noEmit`。
- **絕不用 PowerShell 讀寫含中文的檔案。** 中文 commit message 寫到 `$CLAUDE_JOB_DIR/tmp/msg.txt` 再 `git commit -F`。

## 檔案結構

| 檔案 | 這次的職責 |
|---|---|
| `src/render/sky.ts` | 兩個色常數 + 檔頭那句「遠海半邊 250 km」 |
| `src/render/ocean.ts` | 兩個材質加 `fog: false`；`FAR_SEA_SIZE` |
| `src/render/scene.ts` | `CAMERA_FAR` + 第 47 行那句「海…全部吃霧」 |
| `src/render/fog.ts` | 刪 `FOG_SKY_DARKEN`；`FOG_COLOR` 不再乘；`FOG_DENSITY` 註解裡「250 km 遠海邊要吃滿霧」那一行 |
| `test/unit/fog.test.ts` | 刪四條、加七條 |
| `test/e2e/battlefield-visuals.e2e.ts` | 註解裡的舊數字、抓 warning、讀 `DEPTH_BITS`、換主要證據那張圖 |

---

### Task 1: 四個改動與測試

**Files:**
- Modify: `src/render/sky.ts`、`src/render/ocean.ts`、`src/render/scene.ts`、`src/render/fog.ts`
- Test: `test/unit/fog.test.ts`

**Interfaces:**
- Consumes: 無
- Produces: `SKY_HORIZON` / `SKY_ZENITH`（值變）、`FAR_SEA_SIZE: number`、`CAMERA_FAR: number`、`FOG_COLOR: Color`。**`FOG_SKY_DARKEN` 移除 export。**

- [ ] **Step 1: 刪掉四條被推翻的測試**

`test/unit/fog.test.ts`，在 `describe('地平線要看得出來')` 內刪除這三條
（**整條連同註解**）：

```ts
  it('霧色比**地平線上的**天空色暗', () => { … })
  it('暗的幅度看得出來（不是差幾個位元）', () => { … })
  it('霧色仍然比近處的海亮（深度感靠這個差）', () => { … })
```

以及 `describe('霧的濃度落在設計意圖上')` 裡的：

```ts
  it('遠海邊緣完全化進霧色（才不會看到硬邊）', () => {
    expect(fogFactor(FAR_SEA_SIZE / 2, FOG_DENSITY)).toBeGreaterThan(0.999)
  })
```

【為什麼是刪不是改】前兩條與第三條守的是「靠霧色與天空色／海色的差撐出
地平線」，而地平線現在由**海色**與天空色的 0.371 階差撐起來（spec §4.2）。
第四條守的是「遠海的邊要被霧藏起來」，而那條邊在 spec §4.3 之後已經接近
幾何地平線，不需要藏。四條的**理由**都失效了。

**但「霧色必須跟著天空走」這個需求沒有失效** —— 它由 Step 2 的
`FOG_COLOR 逐分量等於 skyColorAt(0)` 接手。

- [ ] **Step 2: 寫失敗的新測試**

檔案頂端的 import 改成（`Material` 是型別 import）：

```ts
import { Color, type Material } from 'three'
import { createFog, fogFactor, FOG_COLOR, FOG_DENSITY } from '../../src/render/fog'
import { createSky, skyColorAt, SKY_HORIZON, SKY_ZENITH } from '../../src/render/sky'
import { CAMERA_FAR } from '../../src/render/scene'
import { createOcean, FAR_SEA_SIZE, FAR_SEA_Y, SEA_COLOR } from '../../src/render/ocean'
import { DEFAULT_GOD_CAMERA } from '../../src/camera/godCamera'
```

在 `describe('地平線要看得出來')` 內（原本那三條的位置）放入：

```ts
  /**
   * 【地平線現在由海色與天空色的差撐起來，不再由霧色】專案負責人的要求原文
   * 是「海面要比天空深」。海面不吃霧之後（見下一條），霧不再讓海面往天空色
   * 靠，所以這條關係變成兩個常數之間的事。
   *
   * 【比的是 base color，那是刻意的】畫面上的像素還要過一次 PBR 著色，測不到
   * 也不該測 —— 那會把燈光綁進這條斷言。base color 與天空色是唯一測得到、
   * 也唯一不會隨燈光漂掉的一組數（spec §4.2）。
   *
   * 【0.25 是怎麼來的】實測 B 案：天空 0.431、海 0.060，階差 0.371。改動前
   * 那一階只有 0.092（霧化後的遠海 0.169 對天空 0.261）—— 那正是「接縫太怪」
   * 的成因。取 0.25 留浮動空間，但遠高於改動前。
   */
  it('海色比地平線上的天空色暗，而且差得很開', () => {
    const sky = skyColorAt(0, new Color())
    const sea = new Color(SEA_COLOR)
    expect(lightness(sea)).toBeLessThan(lightness(sky))
    expect(lightness(sky) - lightness(sea)).toBeGreaterThan(0.25)
  })

  /**
   * 【這是「霧不再讓海面近遠變色」唯一的來源】海面的近遠色差**完全**來自霧。
   *
   * 【兩個材質要分開斷言】只測一個的話，漏掉另一個的那種錯誤 —— 也就是
   * `ocean.ts` 自己註解裡警告的「5 km 處出現一條色帶」—— 就沒有被守住。
   */
  it('細浪面不吃霧', () => {
    const ocean = createOcean()
    try {
      expect((ocean.mesh.material as Material).fog).toBe(false)
    } finally {
      ocean.dispose()
    }
  })

  it('遠海不吃霧', () => {
    const ocean = createOcean()
    try {
      expect((ocean.farMesh.material as Material).fog).toBe(false)
    } finally {
      ocean.dispose()
    }
  })

  /**
   * 【天空頂部比較深】專案負責人要求的第四件事。它改動前就成立，這條是防止
   * 日後有人把漸層調反或壓平 —— 那會讓天空變成一片死板的單色。
   * 實測 B 案落差 0.154（改動前 0.146）。
   */
  it('天頂比地平線上的天空暗', () => {
    const top = skyColorAt(1, new Color())
    const hz = skyColorAt(0, new Color())
    expect(lightness(hz) - lightness(top)).toBeGreaterThan(0.10)
  })

  /**
   * 【天空整體要比改動前亮】改動前地平線 0.261、天頂 0.115；B 案是 0.431 與
   * 0.277。
   *
   * 【兩頭都要釘】只釘地平線的話，有人可以把天頂調得**更黑**而仍然通過 ——
   * 那不是「整體淡一點」，是把落差拉大。所以天頂也要有下限。
   */
  it('天空整體比改動前亮（地平線與天頂都要）', () => {
    expect(lightness(skyColorAt(0, new Color()))).toBeGreaterThan(0.35)
    expect(lightness(skyColorAt(1, new Color()))).toBeGreaterThan(0.20)
  })

  /**
   * 【把著色器那一份接上來】上面四條測的都是 CPU 的 `skyColorAt`，而畫面是
   * 天空球的著色器畫的。`sky.ts` 寫著「兩份必須一致」，但那句話原本沒有任何
   * 測試 —— 有人改了 `uniforms` 而沒改 `skyColorAt`（或反過來），上面每一條
   * 都還是綠的，畫面卻變了。
   *
   * 這一條只能守住「uniform 餵的是同兩個常數」，守不住 `FRAG` 裡的混色公式
   * （那是字串，測不到）。守得住一半也比零好。
   */
  it('天空球的 uniform 用的是同兩個常數', () => {
    const sky = createSky()
    const mat = sky.material as { uniforms: Record<string, { value: Color }> }
    expect(mat.uniforms.horizon!.value.getHex()).toBe(SKY_HORIZON)
    expect(mat.uniforms.zenith!.value.getHex()).toBe(SKY_ZENITH)
  })

  /**
   * 【取代被刪掉的「霧色比天空暗」】那條斷言的**關係**被需求推翻了，但它
   * 背後的需求沒有 —— **霧色必須跟著天空走**。改動後的關係是「相等」。
   *
   * 【為什麼 `createFog` 那條守不住這件事】它比的是 `createFog().color` 與
   * exported `FOG_COLOR`。兩邊一起改照樣綠，`FOG_COLOR` 可以被寫成任意常數。
   * 這一條比的是 `FOG_COLOR` 與它宣稱的來源。
   */
  it('霧色就是地平線上的天空色', () => {
    const sky = skyColorAt(0, new Color())
    expect(FOG_COLOR.r).toBeCloseTo(sky.r, 9)
    expect(FOG_COLOR.g).toBeCloseTo(sky.g, 9)
    expect(FOG_COLOR.b).toBeCloseTo(sky.b, 9)
  })
```

在檔案末尾（`describe('相機遠平面容得下遠海')` 之前）新增：

```ts
/**
 * 【畫面上那條地平線必須接近幾何地平線】這個世界的海是平的，所以幾何地平線
 * 永遠是與海面平行的那條視線（世界仰角 0°），與高度無關。但 `farMesh` 是
 * **有限**的四邊形，它的邊落在 `atan(離海高度 / 半邊)` —— **那才是畫面上
 * 實際看到的那條線**。
 *
 * 【那是上界】正方形朝**邊的中點**看時俯角最深，朝**角**看時距離是
 * `半邊 × √2`、俯角更淺。所以這條算的是最壞值。
 *
 * 改動前半邊 250 km，上帝視角上限（12,000 m）時那條邊在幾何地平線以下
 * 2.751°，1080p / 65° 下是 40.7 px，而且**隨高度往下跑**。以前被霧糊掉所以
 * 看不出來；海面不吃霧之後它會變成 L 0.060 對 L 0.431 的硬階。
 * 半邊 3,000 km 之後只剩 0.229°（3.4 px）。
 */
describe('地平線接近幾何地平線', () => {
  /** 透視投影下的像素數：`(H/2)·tanθ / tan(FOV_v/2)`。1080p / 65° */
  const pixels = (deg: number): number =>
    (1080 / 2) * Math.tan(deg * (Math.PI / 180)) / Math.tan(32.5 * (Math.PI / 180))

  /** 遠海邊的最壞俯角，度。高度是**離海面**的高度，所以要扣掉 `FAR_SEA_Y` */
  const edgeDeg = (cameraY: number): number =>
    Math.atan((cameraY - FAR_SEA_Y) / (FAR_SEA_SIZE / 2)) * (180 / Math.PI)

  /**
   * 【為什麼要這一條】負的或零的 `FAR_SEA_SIZE` 會讓 `edgeDeg` 變成負值或
   * `atan(∞)`，下面那條斷言可能因此假綠。先把輸入釘住。
   */
  it('遠海的尺寸是正的', () => {
    expect(FAR_SEA_SIZE).toBeGreaterThan(0)
  })

  it('上帝視角的高度上限處，遠海的邊落在幾何地平線以下不到 0.3°', () => {
    // 【用實際的設定值不寫死】上帝視角的上限日後若調高，這條要跟著紅
    const deg = edgeDeg(DEFAULT_GOD_CAMERA.maxAltitude)
    expect(deg).toBeGreaterThan(0)
    expect(deg).toBeLessThan(0.3)
    expect(pixels(deg)).toBeLessThan(4)
  })

  /** 【纏鬥的整個高度帶要低於兩個像素】那才是實際會一直看到的高度。 */
  it('6,000 m 處低於兩個像素', () => {
    expect(pixels(edgeDeg(6_000))).toBeLessThan(2)
  })
})
```

- [ ] **Step 3: 跑測試，確認紅的是該紅的那些**

```
npx vitest run test/unit/fog.test.ts
```

預期 **7 紅、4 綠**（新增的十一條）：

| 測試 | 預期 |
|---|---|
| 海色比地平線上的天空色暗，而且差得很開 | 🔴 實得 0.261 − 0.060 = 0.201，不到 0.25 |
| 細浪面不吃霧 | 🔴 `fog` 是 `true`（three 的預設） |
| 遠海不吃霧 | 🔴 同上 |
| 天空整體比改動前亮（地平線與天頂都要） | 🔴 地平線實得 0.261，不到 0.35 |
| 霧色就是地平線上的天空色 | 🔴 實得 `skyColorAt(0) × 0.65` |
| 上帝視角的高度上限處…不到 0.3° | 🔴 實得 2.751° |
| 6,000 m 處低於兩個像素 | 🔴 實得 20.4 px |
| 天頂比地平線上的天空暗 | 🟢 改動前就成立（0.146 > 0.10）→ 靠 Step 6 的 mutation |
| 天空球的 uniform 用的是同兩個常數 | 🟢 改動前就成立 → 靠 Step 6 的 mutation |
| 遠海的尺寸是正的 | 🟢 改動前就成立 → 靠 Step 6 的 mutation |
| （既有的其餘各條） | 🟢 |

**記下實際的紅法**，Task 2 的回填要用。

【`createOcean` / `createSky` 在 vitest 裡跑得起來嗎】兩者都只建幾何與材質，
不碰 WebGL context。`material.fog` 與 `uniforms` 都是純 JS 欄位；
`onBeforeCompile` 只在真的編譯著色器時才被呼叫。**若這一步意外噴 WebGL 相關
錯誤，停下來報告** —— 不要改成斷言常數繞過去，那就測不到材質真的有設。

- [ ] **Step 4: 改四個檔案**

**(a) `src/render/sky.ts`**

檔頭第 9 行那句「**為什麼遠海比它還大卻沒問題**」提到「遠海半邊 250 km」，
把數字改成 3,000 km（那段的論證不變 —— 天空球 `depthWrite: false` 且
`renderOrder = −1000`，任何東西都蓋得過它）。

兩個色常數換掉，註解改寫：

```ts
/**
 * 天空球的地平色與天頂色。
 *
 * 【這兩個不是畫面上看到的顏色】`t = dirY × 0.5 + 0.5`，所以畫面上的地平線
 * （`dirY = 0`）落在漸層的**正中間**，實際是 `#89accd`（L 0.431）；
 * `SKY_ZENITH` 出現在正上方（`#4d84b8`，L 0.277）；而 `SKY_HORIZON`
 * （L 0.702）只出現在 `dirY = −1`，那裡被海擋著，畫面上永遠看不到。
 *
 * 【2026-08-09 提亮】專案負責人試飛後要求「天空整體顏色淡一點」。地平線上的
 * 天空由 L 0.261 提到 0.431，天頂由 0.115 提到 0.277 —— 天頂到地平線的落差
 * 由 0.146 變成 0.154，「頂部比較深」這個關係維持。
 *
 * 海天的明暗關係由 `test/unit/fog.test.ts` 釘住，而它比的是**海色**與
 * **地平線上的**天空色，不是這兩個常數。
 */
export const SKY_HORIZON = 0xc6dfec
export const SKY_ZENITH = 0x4d84b8
```

**(b) `src/render/ocean.ts`**

`material`（細浪面）與 `farMaterial` 的建構參數各加一行：

```ts
    // 【海面不吃霧，spec 2026-08-09 §4.2】海面的近遠色差**完全**來自霧，而
    // 霧色是由天空色推導的，所以遠海必然往天空靠 —— 接縫因此糊成一片：實測
    // 那一階只有 0.092，而海面自己近到遠就變了 0.109。專案負責人要的是
    // 「近到遠幾乎沒有顏色變化」。
    // **兩個材質必須一起關**，漏一個就會在 5 km 處出現一條色帶。
    fog: false,
```

`FAR_SEA_SIZE` 換值並改寫註解：

```ts
/**
 * 遠海的邊長，m。**這是一片平的四邊形，不是網格。**
 *
 * 【為什麼是 3,000 km 的半邊】這個世界的海是平的，幾何地平線永遠是與海面
 * 平行的那條視線（世界仰角 0°），與高度無關。但這片四邊形是有限的，它的邊
 * 落在 `atan(離海高度 / 半邊)` —— **那才是畫面上實際看到的那條地平線**。
 * （那是上界：朝正方形的**角**看時距離是 `半邊 × √2`，俯角更淺。）
 *
 * 像素數用 `(H/2)·tanθ / tan(FOV_v/2)`，1080p / 65°：
 *
 * | 相機高度 | 半邊 250 km | 半邊 3,000 km |
 * |---|---|---|
 * | 1,000 m | 0.230°（3.4 px） | 0.019°（0.28 px） |
 * | 6,000 m | 1.376°（20.4 px） | 0.115°（1.7 px） |
 * | 12,000 m | 2.751°（40.7 px） | 0.229°（3.4 px） |
 *
 * 250 km 時那條線在上帝視角的極端高度下低了 40.7 px，而且隨高度移動。以前
 * 看不出來是因為霧把它糊掉了；海面不吃霧之後它會變成 L 0.060 對 L 0.431 的
 * 硬階（spec 2026-08-09 §3）。
 *
 * 【這是近似，不是精確】有限平面永遠做不到精確落在幾何地平線。要精確就得換
 * 成相機相對的程序化海面或 clip-space 的解法 —— 那是另一個量級的改動。現況
 * 與目標之間差了一個數量級，先把數量級拿掉。
 *
 * 【遠平面要跟著動】`CAMERA_FAR` 必須大於半對角線 4,243 km，見 `scene.ts`。
 *
 * 【為什麼不必分段】它是平的，分段沒有任何意義。
 */
export const FAR_SEA_SIZE = 6_000_000
```

**(c) `src/render/scene.ts`**

`CAMERA_FAR` 換值並改寫註解：

```ts
/**
 * 遠平面，m。
 *
 * 【它只有一個約束】必須大於遠海的**半對角線**（`FAR_SEA_SIZE / 2 × √2`
 * = 4,243 km），否則遠海的四個角會被裁掉，而被裁掉的邊緣就是一條硬邊。
 * 2026-08-09 遠海由半邊 250 km 放大到 3,000 km（見 `ocean.ts` 的
 * `FAR_SEA_SIZE`），這裡跟著由 800 km 拉到 5,000 km。
 *
 * 【深度精度的代價幾乎是零】解析度是 `Δz ≈ z²·(f−n)/(n·f·2^bits)`，而
 * `f ≫ n` 時 `(f−n)/(n·f) → 1/n`。**近平面沒有動**，所以近場精度不變。
 * 這次只把那個因子從 0.99999875 變成 0.9999998。
 *
 * 【但那個計算假設 24-bit 深度緩衝，而 WebGL 只保證 16 bit】24-bit 下
 * 100 m 處是 0.6 mm、12,000 m 處是 8.58 m；16-bit 下是 0.15 m 與 2.2 km。
 * **這是遠平面拉到 800 km 時就存在的事，不是這次引入的** —— `f ≫ n` 之後
 * 精度幾乎只由近平面決定。實際位元數由 `battlefield-visuals.e2e.ts` 讀
 * `gl.getParameter(gl.DEPTH_BITS)` 記錄。
 *
 * 【遠海與細浪面只相距 3 m】高空俯視時兩者的深度分不出前後 —— 既有的限制，
 * 處置見 `ocean.ts` 的 `farMesh.renderOrder`。`renderOrder` 只固定平手的
 * 倒向，不會增加深度精度。
 */
export const CAMERA_FAR = 5_000_000
```

第 47–50 行那段霧的註解裡「飛機、海、參照物、殘骸、曳光彈、粒子全部吃霧」
要改：

```ts
  // 【霧掛在 scene 上，逐材質生效】three 的 `material.fog` 預設為 true，
  // 所以飛機、參照物、殘骸、曳光彈、粒子都吃霧。天空球是 `ShaderMaterial`
  // （`fog` 預設 false）不吃 —— 正確，天空本來就是無限遠。
  // **海面自 2026-08-09 起明確關掉**（`ocean.ts` 的 `fog: false`），
  // 否則遠海會往天空色靠、地平線糊掉。HUD 是另一張 2D canvas，與這裡無關。
```

**(d) `src/render/fog.ts`**

刪掉整段 `FOG_SKY_DARKEN`（含它那張倍率表），`FOG_COLOR` 改成：

```ts
/**
 * 霧色。**就是地平線上的天空色。**
 *
 * 【2026-08-09：不再壓暗】改動前是 `skyColorAt(0) × FOG_SKY_DARKEN`（0.65），
 * 而那個倍率存在的唯一理由是「遠海化進霧色之後不能與天空同色，否則地平線
 * 消失」。海面不吃霧之後（`ocean.ts` 的 `fog: false`），遠海根本不化進霧色，
 * 那個理由就沒了 —— 地平線改由**海色**與天空色的 0.371 階差撐起來。
 *
 * 霧剩下的工作只有一件：物件的空氣透視。座艙視角下物件絕大多數是在天空的
 * 背景上看到的，所以霧色就該是地平線上的天空色。
 *
 * 【已知代價：上帝視角俯視時背景是海，而海不吃霧】那時遠處的飛機、殘骸、
 * 煙霧會往**亮的**霧色化，而背景是 L 0.060 的深海。單一的 `FogExp2` 顏色
 * 無法同時匹配亮天空與深海。30 km 處的幅度是 16%（`FOG_DENSITY` 未動）。
 *
 * 【為什麼是推導不是寫死】天空色怎麼調，霧色都自動跟上。初版寫死
 * `0x7ea8c4` 就是這樣出錯的。這條關係由 `test/unit/fog.test.ts` 逐分量釘住
 * —— 注意 `createFog` 那條守不住它（兩邊一起改照樣綠）。
 */
export const FOG_COLOR: Color = skyColorAt(0, new Color())
```

`FOG_DENSITY` 的註解裡「250 km（遠海邊緣） ~100% —— 邊緣要完全化掉，否則
就是另一條硬邊」那一行要改成：

```
 *   250 km               ~100%  —— 【2026-08-09 起這一條只是紀錄】海面已經
 *                                   不吃霧，遠海的邊也已接近幾何地平線，
 *                                   不再需要靠霧藏起來
```

並把下一句「三個數字都被 `test/unit/fog.test.ts` 釘住」改成「前兩個數字被
`test/unit/fog.test.ts` 釘住」。

- [ ] **Step 5: 跑測試與型別**

```
npx vitest run test/unit/fog.test.ts
npx tsc --noEmit
```

預期全綠。`tsc` 會抓到任何還在 import `FOG_SKY_DARKEN` 的地方。

- [ ] **Step 6: Mutation**

三條在改動前就綠的測試要靠 mutation 證明；另外兩個守新行為。每個做完立刻
還原（`git checkout -- <檔>`），逐個跑 `npx vitest run test/unit/fog.test.ts`：

| # | mutation | 必須轉紅的測試 |
|---|---|---|
| 1 | `sky.ts`：`SKY_ZENITH` 改成與 `SKY_HORIZON` 同值（漸層壓平） | `天頂比地平線上的天空暗` |
| 2 | `sky.ts`：`SKY_HORIZON` 與 `SKY_ZENITH` 的值互換（漸層反向） | `天頂比地平線上的天空暗` |
| 3 | `sky.ts`：`createSky` 的 `zenith` uniform 改成 `new Color(SKY_HORIZON)` | `天空球的 uniform 用的是同兩個常數` |
| 4 | `ocean.ts`：**細浪面**的 `fog: false` → `fog: true` | `細浪面不吃霧`（且 `遠海不吃霧` 仍綠） |
| 5 | `ocean.ts`：**遠海**的 `fog: false` → `fog: true` | `遠海不吃霧`（且 `細浪面不吃霧` 仍綠） |
| 6 | `ocean.ts`：`FAR_SEA_SIZE` 改成 `-6_000_000` | `遠海的尺寸是正的` |
| 7 | `fog.ts`：`FOG_COLOR` 尾巴加回 `.multiplyScalar(0.65)` | `霧色就是地平線上的天空色` |

**七個都必須轉紅，而且 4 與 5 必須各自只打紅自己那一條** —— 那是「兩個材質
分開斷言」的意義所在。

**全部還原後再跑一次確認全綠**，並用 `git diff` 確認乾淨。

- [ ] **Step 7: 全套回歸**

```
npx vitest run
npx tsc --noEmit
npx vitest run test/unit/perf-gate.test.ts
npx vitest run test/integration/rematch.test.ts
```

後兩支照專案慣例**單獨跑**。

【已知的兩條既有紅】`ai-command-channel > 命令佔時比例落在掃描定出的區間`
與 `ai-command-tactics > 側翼讓開火時的方位角往後側方移動`，在本次改動之前
就是紅的（記錄於 `2026-08-09-recovery-altitude-degeneracy-design.md` §13.7）。
**其餘任何一條紅都要停下來查**，尤其是 `render` 或 `world` 底下的。

- [ ] **Step 8: Commit**

```bash
cat > "$CLAUDE_JOB_DIR/tmp/msg.txt" <<'EOF'
feat: 天空提亮、海面退出全域霧、地平線挪回幾何地平線附近

專案負責人試飛後的要求：天空淡一點、海面比天空深、海面近到遠幾乎沒有顏色
變化、天空頂部比較深。

量出來的根因：接縫那一階只有 0.092，而海面自己近到遠就變了 0.109 ——
那條線比它兩側的漸層還弱。海面的變化完全來自霧，而霧色由天空色推導。

四個改動：
  天空 B 案（地平線 L 0.261 -> 0.431、天頂 0.115 -> 0.277，落差維持 0.15）
  海面兩個材質 fog: false
  遠海半邊 250 km -> 3,000 km，CAMERA_FAR 800 km -> 5,000 km
  FOG_SKY_DARKEN 刪除，FOG_COLOR = skyColorAt(0)

第三項是算的時候挖出來的：畫面上那條地平線其實是遠海平面的邊，落在幾何
地平線以下 atan(離海高度 / 半邊)，12,000 m 時是 2.751 度（40.7 px）且隨
高度移動。以前被霧糊掉，海面不吃霧之後會變成硬階。放大後剩 0.229 度
（3.4 px），6,000 m 以下低於 1.7 px。

推翻 2026-08-08 那份 spec 的一條裁定（「霧色仍然比近處的海亮，深度感靠
這個差」），那是專案負責人的決定，見 spec 5 節。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTdeLVNHduRspN8aPBMYYf
EOF
git add src/render/sky.ts src/render/ocean.ts src/render/scene.ts src/render/fog.ts test/unit/fog.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

### Task 2: Playwright 驗收

**Files:**
- Modify: `test/e2e/battlefield-visuals.e2e.ts`

**Interfaces:**
- Consumes: Task 1 的 `FAR_SEA_SIZE`、`CAMERA_FAR`、`FOG_COLOR`
- Produces: 截圖與 `DEPTH_BITS` 的量測值

- [ ] **Step 1: 改 e2e —— 三件事**

**(a) 抓 warning，不只 error。** 現在只收 `m.type() === 'error'`，而計畫聲稱
它會抓 WebGL warning —— 那是假的。改成：

```ts
    const errors: string[] = []
    const warnings: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
      else if (m.type() === 'warning') warnings.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(String(e)))
```

並在第 26 條之前加上：

```ts
    // 26a. THREE / WebGL 的 warning 也算失敗。**這是這次新增的巨大幾何
    // （半邊 3,000 km）與 5,000 km 遠平面最可能現形的方式** —— 它們不一定
    // 會噴 error，但幾乎一定會先噴 warning。其他 warning 只記錄不失敗。
    const gfx = warnings.filter((w) => /THREE|WebGL|GL_/i.test(w))
    console.log(`[26a] 圖形相關 warning ${gfx.length} 則（總 warning ${warnings.length} 則）`)
    for (const w of gfx) console.log('  ' + w)
    if (gfx.length > 0) throw new Error('有圖形相關的 warning')
```

**(b) 讀深度緩衝的位元數。** 在第 22 條之後加：

```ts
    // 22a. 深度緩衝的實際位元數。**只記錄不斷言** —— `scene.ts` 的精度計算
    // 假設 24 bit，而 WebGL 規格只保證 16 bit。這不是本次引入的（遠平面
    // 拉到 800 km 時就存在），但沒有人量過。
    const depthBits = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('canvas:not(#hud)')
      const gl = c?.getContext('webgl2') ?? c?.getContext('webgl') ?? null
      return gl === null ? -1 : (gl.getParameter(gl.DEPTH_BITS) as number)
    })
    console.log(`[22a] DEPTH_BITS = ${depthBits}（scene.ts 的精度計算假設 24）`)
```

**(c) 換掉描述舊值與舊判準的註解。** 四處：

| 行 | 現在寫的 | 改成 |
|---|---|---|
| 檔頭 18 | `相機遠平面 800 km、遠海那片 500 km 的四邊形` | `相機遠平面 5,000 km、遠海那片 6,000 km 的四邊形` |
| 69 | `遠海、霧、800 km 遠平面全部在這條路徑上` | `遠海、霧、5,000 km 遠平面全部在這條路徑上` |
| 84 | `把鏡頭抬起來看海天交界（霧色與天空色的那一階）` | `把鏡頭抬起來看海天交界（海色與天空色的那一階）` |
| 103–106 | `霧色必須比 skyColorAt(0) 暗，而且暗的幅度 > 0.05` | `**海色**必須比 skyColorAt(0) 暗，而且差距 > 0.25；2026-08-09 之前比的是霧色，那時海面還吃霧` |

**(d) 換掉「主要證據」那句。** 第 108–109 行現在寫著
`vis-3-high.png（俯視）才是這一份海面改動的主要證據`。

**那是錯的**：進上帝視角時相機是 −45° 俯角，65° 垂直 FOV 全部落在幾何地平線
以下 —— **那張圖裡不會有地平線**。改成：

```ts
    // `vis-1-cockpit.png`（座艙、機身大致平飛）才是地平線的證據 —— 那是唯一
    // 保證地平線在畫面內的一張。`vis-3-high.png` 是上帝視角俯視（−45° 進場
    // 俯角），它證明的是另一件事：畫面下半不得出現方形的邊或天空色的破洞。
```

並把第 81–82 行的 console 訊息拆成兩句：

```ts
    console.log(`[人工看] ${SHOTS}vis-1-cockpit.png —— 地平線要是一條乾淨的`
      + '硬線（海 L 0.060 對天空 L 0.431），海面近到遠不得有明顯的顏色變化')
    console.log(`[人工看] ${SHOTS}vis-3-high.png —— 俯視。畫面下半不得出現`
      + '方形的邊或天空色的破洞；遠處的飛機／煙霧在深海背景上不得亮得突兀')
```

最後那半句對應 spec §4.4 的已知代價，**是這次必看的一項**。

- [ ] **Step 2: 跑 Playwright 驗收**

Dev server 要開著（本 session 已開在 5173；若沒有，先 `npm run dev`）。

```
npx vite-node test/e2e/battlefield-visuals.e2e.ts
```

自動斷言有兩條：**沒有 console 錯誤**、**沒有圖形相關的 warning**。
`DEPTH_BITS` 只記錄。

【若出現 error 或圖形 warning，停下來報告】5,000 km 的遠平面與 6,000 km 的
四邊形是本次唯一可能踩到 WebGL 限制的地方。

- [ ] **Step 3: 把截圖交給專案負責人，並停在這裡等回覆**

用 `SendUserFile` 送出 `.shots/vis-1-cockpit.png`、`.shots/vis-3-high.png`、
`.shots/vis-5-back.png`，逐張說明要看什麼（見 Step 1(d) 的兩句 console 訊息，
外加 `vis-5-back.png` 的螺旋槳圓盤）。

**這是一道阻擋式的人工關卡。** 顏色好不好看只有專案負責人能判定 —— 前一版
的錯（霧色比天空亮）就是他一眼看出來的，不是任何測試抓到的。**在拿到他的
回覆之前不要進 Task 3。**

- [ ] **Step 4: Commit**

```bash
cat > "$CLAUDE_JOB_DIR/tmp/msg.txt" <<'EOF'
test: e2e 抓圖形 warning、讀 DEPTH_BITS、換掉描述舊值的註解

原本只收 console 的 error 而檔頭卻聲稱會抓 WebGL warning —— 補上，並限定
THREE / WebGL / GL_ 才失敗。新增 DEPTH_BITS 的量測（只記錄）：scene.ts 的
精度計算假設 24 bit，而 WebGL 只保證 16 bit，沒有人量過。

同時更正一句錯的判準：vis-3-high.png 是上帝視角 -45 度俯角拍的，65 度 FOV
全部落在幾何地平線以下，那張圖裡不會有地平線，不能當地平線的主要證據。
改用座艙那張。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTdeLVNHduRspN8aPBMYYf
EOF
git add test/e2e/battlefield-visuals.e2e.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

### Task 3: 回填

**前置條件：Task 2 Step 3 已經拿到專案負責人對截圖的回覆。**

**Files:**
- Modify: `docs/superpowers/specs/2026-08-09-sky-sea-horizon-design.md`（新增 §9）

- [ ] **Step 1: 回填 spec**

在末尾新增，把括號裡的字換成實際量到的數字：

```markdown
## 9. 實測結果（2026-08-09 回填）

### 9.1 改動前後的明度

| 位置 | 改動前 | 改動後 |
|---|---|---|
| 天頂 | `#1f4f80` L 0.115 | `#4d84b8` L 0.277 |
| 天空 45° | `#54779a` L 0.205 | `#779fc5` L 0.373 |
| 地平線上的天空 | `#6788a7` L 0.261 | `#89accd` L 0.431 |
| 海（base color） | `#1d3f5c` L 0.060 | 不變 |
| 遠海 @250 km（霧化後） | `#537089` L 0.169 | 不吃霧 |
| **接縫的階差** | **0.092** | **0.371** |
| **霧造成的海面近遠色差** | **0.109** | **0.000** |

### 9.2 地平線的位置（最壞值，1080p / 65°）

| 相機高度 | 改動前 | 改動後 |
|---|---|---|
| 1,000 m | 0.230°（3.4 px） | 0.019°（0.28 px） |
| 6,000 m | 1.376°（20.4 px） | 0.115°（1.7 px） |
| 12,000 m | 2.751°（40.7 px） | 0.229°（3.4 px） |

### 9.3 迴歸

（填入：全套 vitest 的通過／失敗數、`tsc` 結果、`perf-gate` 與 `rematch`
單獨跑的結果。）

### 9.4 Mutation

（填入七個 mutation 各自打紅了哪一條，特別註明 4 與 5 有沒有各自只打紅
自己那一條。）

### 9.5 Playwright

（填入：console 錯誤數、圖形 warning 數、`DEPTH_BITS` 的實際值、截圖清單。）

### 9.6 專案負責人的判定

（填入他對截圖的實際回覆。**這一格不得由實作者代填。**）
```

- [ ] **Step 2: Commit**

```bash
cat > "$CLAUDE_JOB_DIR/tmp/msg.txt" <<'EOF'
docs: 回填天空海面調色的實測結果與人工驗收

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTdeLVNHduRspN8aPBMYYf
EOF
git add docs/superpowers/specs/2026-08-09-sky-sea-horizon-design.md
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

## 不做的事

見 spec §7。另外：

- **不動 e2e 的任何斷言邏輯以外的東西。** Task 2 加的兩項（warning、
  `DEPTH_BITS`）是新的量測，既有的第 22 / 26 條不動。
- **不處理那兩條既有紅**（`ai-command-channel` 的佔時比例、
  `ai-command-tactics` 的側翼方位角）。

## 審查紀錄（Codex，v1 → v2）

三條指出的是**實質錯誤**，已改：

| # | 內容 | 處置 |
|---|---|---|
| E5 | 「海面恆為 `SEA_COLOR`、變化量 0.000」不成立 —— 那是 base color，實際像素還過一次 PBR；細浪面有 `flatShading`、遠海沒有 | spec §4.2 改寫成「**霧**造成的近遠色差為零」，5 km 接縫明確排除；測試名稱與註解跟著改 |
| E8 | 把 `vis-3-high.png` 當成地平線的主要證據 —— 那是 −45° 俯角拍的，65° FOV 全部在地平線以下，拍不到 | Task 2 Step 1(d) 改用座艙那張，並把兩張各自要看什麼寫清楚 |
| E4 | 「物件絕大多數在天空背景上」在上帝視角俯視時不成立 | spec §4.4 加上已知代價與 16% 的幅度；列為 e2e 必看項目 |

其餘採納：

| # | 內容 | 處置 |
|---|---|---|
| E1 | `atan(h / 半邊)` 是**上界**不是單一角度；高度要扣 `FAR_SEA_Y`；「眼高」是世界仰角不是畫面中線 | spec §3 與測試的 `edgeDeg` 都改了 |
| E2 | 像素數要用 `(H/2)·tanθ/tan(FOV/2)`，3.4 px 不是 3.8 px | 全部重算；並明確寫出「戰鬥高度 < 2 px、極端高度 < 4 px」的判準 |
| E6 + E10 | `createFog` 那條守不住 `FOG_COLOR` 的定義；刪掉舊斷言後「霧色跟著天空走」沒人守 | 新增逐分量比對 `skyColorAt(0)` 的斷言 + mutation 7 |
| E7 | 天空提亮只釘地平線不夠；顏色只測 CPU 那一份；地平線測試寫死高度、可能因負尺寸假綠 | 加天頂下限、加 uniform 斷言、改用 `DEFAULT_GOD_CAMERA.maxAltitude` 與 `FAR_SEA_Y`、加正尺寸斷言 |
| E9 | mutation 沒問題，但要記錄實際結果 | Task 3 §9.4 |
| E11 | `fog.ts` / `scene.ts` / `sky.ts` / e2e 裡描述舊值的註解；§8.4 不能自填 | 全部納入 Step 4 與 Task 2 Step 1；負責人判定改成阻擋式關卡（Task 2 Step 3、Task 3 前置條件） |

E3（WebGL 只保證 16-bit 深度，而所有精度計算假設 24-bit）：**採納為量測項目
而非阻擋項** —— 那是遠平面拉到 800 km 時就存在的，不是本次引入。e2e 加一行
讀 `DEPTH_BITS` 記錄，並在 `scene.ts` 的註解裡寫明這個假設。
