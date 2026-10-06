# 上帝視角分隊標示 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上帝視角下替敵我雙方每個分隊的長機畫一個方框，框下顯示該分隊的存活／編制，形如 `(2/4)`。

**Architecture:** 沿用既有的接觸點池 —— `main.ts` 每幀已經在掃每一架並算好螢幕座標、框半徑、敵我，只要多填三個欄位（是不是長機、分隊存活、分隊員額）。新增一個只在上帝視角排進繪製名單的 widget `godMarkers`，把「誰要畫」「畫什麼字」「什麼顏色」三條規則抽成純函數，因為 canvas 在 node 環境驗不到。

**Tech Stack:** TypeScript（strict + `noUncheckedIndexedAccess`）、three.js、vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-08-09-god-view-flight-markers-design.md`

## Global Constraints

- 回應與註解一律**繁體中文**。
- **絕不 `git add -A`** —— `bash.exe.stackdump` 是被追蹤且已修改的檔案。永遠列出明確路徑。
- 含中文的 commit message 走 `$CLAUDE_JOB_DIR/tmp/msg.txt` + `git commit -F`；結尾附上
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` 與
  `Claude-Session: https://claude.ai/code/session_01MTdeLVNHduRspN8aPBMYYf` 兩行。
- **沒有 `@types/node`**：不得使用 `node:path`、`__dirname`、`process`、`fs`。
- `noUncheckedIndexedAccess` 開啟：所有索引存取都要 `!` 或先判空。
- `noUnusedLocals` / `noUnusedParameters` 開啟。
- **`src/hud/` 不得 import `src/battle/` 或 `src/world/`** —— `HudFrame` 是純 DTO，由 `main.ts` 填。
- 熱路徑不得配置（HUD 每幀都跑，widget 內不得 `new`、不得建立陣列或閉包）。
- **絕不為了讓測試變綠而放寬門檻。**
- 每一條新測試都要**先驗證它是紅的**再寫實作。
- 型別檢查是 `npx tsc --noEmit`（沒有 `npm run typecheck`）。
- **不寫飛機外形的測試**；不寫「畫出來好不好看」的測試。
- 絕不用 PowerShell 讀寫含中文的檔案（用 Read 工具，或 Python 搭 `io.open(..., encoding='utf-8')`）。

## 檔案結構

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src/hud/types.ts` | HUD 的純資料與跨 widget 共用的純函數 | 修改：`HudContact` 加三欄位、新增 `contactBoxRadius` |
| `src/hud/widgets/contacts.ts` | 座艙的目標框、預瞄環、邊緣指示 | 修改：框半徑的夾制改呼叫 `contactBoxRadius` |
| `src/hud/widgets/godMarkers.ts` | **新** —— 上帝視角的分隊標示 | 建立 |
| `src/hud/Hud.ts` | 繪製名單與分派 | 修改：`HudWidget` 加一個、`GOD` 名單加一個、`switch` 加一個 case |
| `src/main.ts` | 把世界狀態填進 `HudFrame` | 修改：填三個新欄位、`range` 改以鏡頭為基準 |
| `test/unit/hud.test.ts` | HUD 純函數的單元測試 | 修改：既有 `hudWidgets(true)` 那條要改，並新增 14 條 |
| `test/e2e/god-view.e2e.ts` | 上帝視角的人工驗收 | 修改：中央判準換成只數綠色 |

---

### Task 1：`HudContact` 的三個欄位與共用的框半徑

**Files:**
- Modify: `src/hud/types.ts`
- Modify: `src/hud/widgets/contacts.ts:3-5`（`BOX_MIN`／`BOX_MAX` 宣告）與 `:61`（夾制）
- Test: `test/unit/hud.test.ts`

**Interfaces:**
- Consumes: 無（這是第一個 task）
- Produces:
  - `HudContact.flightLeader: boolean`、`HudContact.flightAlive: number`、`HudContact.flightSize: number`
  - `contactBoxRadius(radius: number, unit: number, scale: number): number`（由 `src/hud/types.ts` 匯出）

- [ ] **Step 1: 寫會紅的測試**

在 `test/unit/hud.test.ts` 的 import 區把 `contactBoxRadius` 加進既有的 `../../src/hud/types` 那一行：

```ts
import {
  createHudContact, createHudFrame, indicatedAirspeed,
  contactColor, nextHitFlash, HIT_FLASH_SECONDS, HUD_COLORS, HUD_MAX_CONTACTS,
  contactBoxRadius,
} from '../../src/hud/types'
```

在檔案尾端加：

```ts
describe('contactBoxRadius', () => {
  /**
   * 【為什麼這個夾制值得一條測試】它原本寫在 `contacts.ts` 的繪製函數裡，
   * 而繪製函數在 node 環境驗不到 —— 於是那段註解記下的錯（先夾再乘 scale，
   * 動態尺寸被二次縮放）沒有任何東西守著。搬到 `types.ts` 給兩個 widget
   * 共用的同時，順帶讓它第一次有測試。
   */
  it('小於下界時夾到下界', () => {
    expect(contactBoxRadius(0.0001, 400, 1)).toBe(9)
  })

  it('大於上界時夾到上界', () => {
    expect(contactBoxRadius(10, 400, 1)).toBe(46)
  })

  it('中間段就是 radius × unit', () => {
    expect(contactBoxRadius(0.05, 400, 1)).toBeCloseTo(20, 10)
  })

  /**
   * 【順序不能反】上下界要**先乘 scale 再夾**。反過來的話固定的上下界只縮放
   * 一次、動態尺寸卻縮放兩次，兩者在不同視窗高度下對不起來。
   */
  it('上下界跟著 scale 走：scale = 2 時下界是 18 不是 9', () => {
    expect(contactBoxRadius(0.0001, 400, 2)).toBe(18)
    expect(contactBoxRadius(10, 400, 2)).toBe(92)
  })

  it('scale 不會把中間段乘第二次', () => {
    // radius × unit = 20，落在 [18, 92] 之內，所以原封不動
    expect(contactBoxRadius(0.05, 400, 2)).toBeCloseTo(20, 10)
  })
})

describe('HudContact 的分隊欄位', () => {
  /**
   * 【為什麼要守初始值】接觸點是**固定長度的池**，格子會被重複使用。
   * 新欄位若沒有初始值，型別上是 undefined、執行期會畫出 `(undefined/undefined)`。
   */
  it('createHudContact 把三個分隊欄位設成不畫標示的狀態', () => {
    const c = createHudContact()
    expect(c.flightLeader).toBe(false)
    expect(c.flightAlive).toBe(0)
    expect(c.flightSize).toBe(0)
  })
})
```

- [ ] **Step 2: 跑測試確認是紅的**

Run: `npx vitest run test/unit/hud.test.ts`
Expected: FAIL —— `contactBoxRadius` 不存在（import 失敗，整個檔案紅）。

- [ ] **Step 3: 在 `types.ts` 加欄位與函數**

在 `HudContact` 介面的 `leadBehind: boolean` 之後、`}` 之前加：

```ts
  /**
   * 這一架是不是自己分隊的長機（`members[0]`）。上帝視角的分隊標示只認它。
   *
   * 【玩家那一架恆為 true】玩家釘死在 `members[0]`（`FlightIndex.pinned`），
   * 所以他永遠是長機 —— 這是既有設計的直接後果，不是新特例。
   */
  flightLeader: boolean
  /** 它那個分隊還活著幾架。`flightLeader` 為 false 時無意義 */
  flightAlive: number
  /** 它那個分隊的編制員額。`flightAlive` 的分母 */
  flightSize: number
```

把 `createHudContact` 改成：

```ts
export function createHudContact(): HudContact {
  return {
    active: false, x: 0, y: 0, behind: false, radius: 0, hostile: true, flightMate: false,
    deltaY: 0, worldX: 0, worldZ: 0, range: 0,
    leadX: 0, leadY: 0, leadValid: false, leadBehind: false,
    flightLeader: false, flightAlive: 0, flightSize: 0,
  }
}
```

在 `contactColor` 之後加：

```ts
/** 目標框在螢幕上的最小／最大半徑，px（**未乘 scale**）。 */
const BOX_MIN = 9
const BOX_MAX = 46

/**
 * 一個接觸點的框半徑，CSS px。
 *
 * 【為什麼住在 types.ts 而不是某個 widget 裡】座艙的目標框（`contacts.ts`）
 * 與上帝視角的分隊標示（`godMarkers.ts`）都要用同一把尺。留在其中一邊就會
 * 變成另一邊自己寫一份 —— 與 `contactColor` 搬來這裡是同一條理由，而那條
 * 註解記的正是 M6 改色時踩到的：目標框改了，小地圖沒改。
 *
 * 【夾制的上下界要先乘 scale 再夾】`radius * unit` 已經是 CSS px，若把夾完
 * 的結果再乘一次 scale，動態尺寸會被二次縮放，而固定的上下界卻只縮放一次
 * —— 兩者在不同視窗高度下對不起來。
 */
export function contactBoxRadius(radius: number, unit: number, scale: number): number {
  return Math.max(BOX_MIN * scale, Math.min(BOX_MAX * scale, radius * unit))
}
```

- [ ] **Step 4: 讓 `contacts.ts` 改用它**

刪掉 `src/hud/widgets/contacts.ts` 開頭這三行：

```ts
/** 目標框在螢幕上的最小／最大半徑，px（未乘 L.scale）。 */
const BOX_MIN = 9
const BOX_MAX = 46
```

把第一行 import 改成：

```ts
import {
  contactBoxRadius, contactColor, HUD_COLORS, hudFont,
  type HudFrame, type HudLayout,
} from '../types'
```

把框半徑那一段（原第 58~61 行的註解與運算式）換成：

```ts
      const r = contactBoxRadius(c.radius, L.unit, L.scale)
```

（那段「夾制的上下界要先乘 L.scale 再夾」的註解已經跟著搬到 `types.ts` 的
`contactBoxRadius`，這裡不要留一份副本。）

- [ ] **Step 5: 跑測試與型別檢查**

Run: `npx vitest run test/unit/hud.test.ts && npx tsc --noEmit`
Expected: 兩者都通過。

- [ ] **Step 6: 突變驗證這幾條測試是承重的**

**兩個突變，各自對應不同的一半。** 每個都跑 `npx vitest run test/unit/hud.test.ts`，確認**指定的那幾條**轉紅（不是「跑跑看」），然後改回來。

| 突變 | 應該紅的 | 應該仍綠的 |
|---|---|---|
| `Math.max(BOX_MIN, Math.min(BOX_MAX, radius * unit)) * scale`（先夾再乘） | 只有「scale 不會把中間段乘第二次」（20 → 40） | 兩條夾制測試 —— **它們照樣過**：先夾出 9／46 再乘 2 剛好也是 18／92 |
| `Math.max(BOX_MIN, Math.min(BOX_MAX, radius * unit))`（完全不乘 scale） | 「scale = 2 時下界是 18」（9 ≠ 18）與上界那條（46 ≠ 92） | 中間段那條（20 = 20） |

【為什麼要兩個】第一個突變**單靠夾制測試抓不到**，這一點在初版計畫裡寫錯了
（Codex 2026-08-09 審查時算出來的）。兩條測試各守一半，缺一不可 —— 這正是
它們兩條都要存在的理由。

- [ ] **Step 7: Commit**

```bash
git add src/hud/types.ts src/hud/widgets/contacts.ts test/unit/hud.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

訊息主旨：`refactor: 框半徑的夾制搬進 types.ts，HudContact 長出分隊欄位`

---

### Task 2：`godMarkers` widget 與它的三條規則

**Files:**
- Create: `src/hud/widgets/godMarkers.ts`
- Modify: `src/hud/Hud.ts`
- Test: `test/unit/hud.test.ts`

**Interfaces:**
- Consumes: `HudContact.flightLeader` / `.flightAlive` / `.flightSize`、`contactBoxRadius(radius, unit, scale)`（Task 1）
- Produces:
  - `godMarkerVisible(c: HudContact, aspect: number): boolean`
  - `flightStrengthLabel(alive: number, size: number): string`
  - `godMarkerColor(hostile: boolean): string`
  - `drawGodMarkers(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void`
  - `hudWidgets(true)` 回傳 `['godMarkers', 'minimap', 'roster', 'hints']`

- [ ] **Step 1: 寫會紅的測試**

在 `test/unit/hud.test.ts` 的 import 區加一行：

```ts
import {
  godMarkerVisible, flightStrengthLabel, godMarkerColor,
} from '../../src/hud/widgets/godMarkers'
```

**修改既有的那一條**（原本寫死三個 widget，現在是四個）：

```ts
  it('上帝視角畫分隊標示、小地圖、名冊、提示', () => {
    expect(hudWidgets(true)).toEqual(['godMarkers', 'minimap', 'roster', 'hints'])
  })
```

**在它下面再加一條**（座艙那一側同樣要守住）：

```ts
  /**
   * 【座艙裡不畫分隊標示】那裡已經有完整的目標框與預瞄環，再疊一層分隊框
   * 是雜訊。這一條與「準星在上帝視角不出現」是對稱的兩半 —— 只守一邊的話，
   * 哪天有人把 `godMarkers` 加進 `FULL` 也不會有東西紅。
   */
  it('座艙不畫分隊標示', () => {
    expect(hudWidgets(false)).not.toContain('godMarkers')
  })
```

在檔案尾端加：

```ts
describe('godMarkerVisible —— 上帝視角要畫誰', () => {
  /** 在畫面正中央、已啟用的長機。各條測試由它出發只改一個欄位 */
  const leader = (): ReturnType<typeof createHudContact> => {
    const c = createHudContact()
    c.active = true
    c.flightLeader = true
    c.x = 0
    c.y = 0
    c.behind = false
    return c
  }

  it('長機且在畫面內就畫', () => {
    expect(godMarkerVisible(leader(), 16 / 9)).toBe(true)
  })

  /** 【這是這一份的核心要求】「只需標記小隊的長機」 */
  it('不是長機就不畫，即使它在畫面正中央', () => {
    const c = leader()
    c.flightLeader = false
    expect(godMarkerVisible(c, 16 / 9)).toBe(false)
  })

  /**
   * 【背後的接觸點必須擋掉】NDC 在相機背後會翻號，正前方 30° 與正後方 150°
   * 的目標會投影到同一側。不擋的話，你背後的分隊會被畫在你面前
   * —— 與 `edgeIndicatorPosition` 要吃 `behind` 是同一個成因。
   */
  it('在鏡頭背後就不畫', () => {
    const c = leader()
    c.behind = true
    expect(godMarkerVisible(c, 16 / 9)).toBe(false)
  })

  it('水平超出畫面就不畫（邊界是 aspect 不是 1）', () => {
    const aspect = 16 / 9
    const inside = leader()
    inside.x = aspect - 0.01
    expect(godMarkerVisible(inside, aspect)).toBe(true)

    const outside = leader()
    outside.x = aspect + 0.01
    expect(godMarkerVisible(outside, aspect)).toBe(false)
  })

  it('垂直超出畫面就不畫（邊界是 1）', () => {
    const inside = leader()
    inside.y = 0.99
    expect(godMarkerVisible(inside, 16 / 9)).toBe(true)

    const outside = leader()
    outside.y = 1.01
    expect(godMarkerVisible(outside, 16 / 9)).toBe(false)
  })

  /** 池子是固定長度的，沒在用的格子裡是上一場留下來的值 */
  it('沒啟用的格子不畫', () => {
    const c = leader()
    c.active = false
    expect(godMarkerVisible(c, 16 / 9)).toBe(false)
  })
})

describe('flightStrengthLabel', () => {
  it('存活與編制寫成 (2/4)', () => {
    expect(flightStrengthLabel(2, 4)).toBe('(2/4)')
  })

  /**
   * 【與 `roster.ts` 的 `flightLabel` 相反，這裡剩一架照樣顯示】那一個在
   * `alive < 2` 時回傳 null，理由是「剩一架時沒有『隊』這回事」。上帝視角是
   * 旁觀全場：`(1/4)` 正是「那一隊快被打光了」，是最值得看的資訊之一。
   */
  it('剩一架照樣顯示 (1/4)', () => {
    expect(flightStrengthLabel(1, 4)).toBe('(1/4)')
  })

  /** 架數不是 SCHWARM_SIZE 的倍數時，最後一個分隊比較小 —— 不需要特例 */
  it('編制員額 1 的分隊是 (1/1)', () => {
    expect(flightStrengthLabel(1, 1)).toBe('(1/1)')
  })
})

describe('godMarkerColor', () => {
  /**
   * 【兩色不是三色】座艙的 `contactColor` 有第三個顏色給玩家自己的 Schwarm
   * （警示黃 `HUD_COLORS.warn`），用來標「誰會在你被咬時回頭掩護你」。
   * 上帝視角是旁觀全場，那個區別沒有意義 —— 專案負責人 2026-08-09 的裁決。
   * 下面兩條精確相等就把「不得是警示黃」一起釘住了；**不要再補一條
   * `not.toBe(HUD_COLORS.warn)`**，那在相等斷言已經成立之後是恆真的，
   * 什麼都不守（Codex 2026-08-09 審查指出）。
   */
  it('敵方是危險色、我方是友軍色，沒有第三個', () => {
    expect(godMarkerColor(true)).toBe(HUD_COLORS.danger)
    expect(godMarkerColor(false)).toBe(HUD_COLORS.friendly)
  })
})

/**
 * 【為什麼要一個假的 canvas context】上面那些純函數全部通過，`drawGodMarkers`
 * 卻可能根本沒被呼叫、或把 `flightAlive` 與 `flightSize` 寫反、或把 y 軸翻錯 ——
 * 沒有任何一條會紅（Codex 2026-08-09 審查指出）。canvas 在 node 環境沒有實作，
 * 但這個 widget 只碰五個成員，手寫一個記錄呼叫的替身就夠。
 *
 * **這不是「測試繪製好不好看」**（那條紀律不變，好不好看只有專案負責人判定
 * 得了）。它測的是「畫了幾個、畫在哪、字是什麼」—— 三件有明確正確答案的事。
 */
describe('drawGodMarkers', () => {
  const LAYOUT: HudLayout = {
    width: 1280, height: 720, cx: 640, cy: 360, unit: 360, scale: 1,
  }

  function fakeCtx(): {
    ctx: CanvasRenderingContext2D
    rects: { x: number, y: number, w: number, h: number }[]
    texts: { text: string, x: number, y: number }[]
  } {
    const rects: { x: number, y: number, w: number, h: number }[] = []
    const texts: { text: string, x: number, y: number }[] = []
    const ctx = {
      font: '', textAlign: '', textBaseline: '',
      strokeStyle: '', fillStyle: '', lineWidth: 0,
      strokeRect(x: number, y: number, w: number, h: number): void {
        rects.push({ x, y, w, h })
      },
      fillText(text: string, x: number, y: number): void {
        texts.push({ text, x, y })
      },
    } as unknown as CanvasRenderingContext2D
    return { ctx, rects, texts }
  }

  /** 長機在 (0, 0.5)、半徑 0.05（× unit 360 = 18，落在夾制的中間段） */
  function twoContacts(): ReturnType<typeof createHudFrame> {
    const f = createHudFrame()
    const leader = f.contacts[0]!
    leader.active = true
    leader.flightLeader = true
    leader.hostile = true
    leader.x = 0
    leader.y = 0.5
    leader.radius = 0.05
    leader.flightAlive = 2
    leader.flightSize = 4

    const wingman = f.contacts[1]!
    wingman.active = true
    wingman.flightLeader = false
    wingman.hostile = true
    wingman.x = 0.2
    wingman.y = 0.1
    wingman.radius = 0.05
    wingman.flightAlive = 2
    wingman.flightSize = 4

    f.contactCount = 2
    return f
  }

  it('兩架同隊只畫一個框 —— 僚機沒有', () => {
    const { ctx, rects, texts } = fakeCtx()
    drawGodMarkers(ctx, LAYOUT, twoContacts())
    expect(rects).toHaveLength(1)
    expect(texts).toHaveLength(1)
  })

  /** 【y 要翻】螢幕座標往下為正，接觸點的 y 往上為正 */
  it('框以長機為中心，而且 y 軸有翻', () => {
    const { ctx, rects } = fakeCtx()
    drawGodMarkers(ctx, LAYOUT, twoContacts())
    // cx + 0 × 360 = 640；cy − 0.5 × 360 = 180；r = 0.05 × 360 = 18
    expect(rects[0]).toEqual({ x: 640 - 18, y: 180 - 18, w: 36, h: 36 })
  })

  /** 【分子分母不能對調】寫反的話畫出來是 (4/2)，而純函數測試抓不到 */
  it('框下的字是 (存活/編制)，貼在框底下', () => {
    const { ctx, texts } = fakeCtx()
    drawGodMarkers(ctx, LAYOUT, twoContacts())
    expect(texts[0]!.text).toBe('(2/4)')
    expect(texts[0]!.x).toBe(640)
    expect(texts[0]!.y).toBe(180 + 18 + 3)
  })
})

/**
 * 【接觸點池必須裝得下整場】`drawGodMarkers` 是從池子裡**過濾**長機的，
 * 而池子在 `main.ts` 是先到先得（`n >= HUD_MAX_CONTACTS` 就不再收）。
 * 池子若比參戰架數小，被擠掉的可能正好是某個分隊的長機 —— 那一隊就
 * **靜靜地沒有標示**，沒有錯誤、沒有警告（Codex 2026-08-09 審查指出）。
 *
 * 【為什麼這條護欄只能住在測試裡】`src/hud/` 不得 import `src/battle/`
 * （`HudFrame` 是純 DTO）。測試沒有這個限制，兩邊都 import 得到 ——
 * 與 `src/render/vortex.ts:131` 註解記的「為什麼不 import MAX_COMBATANTS」
 * 是同一個處置。
 */
describe('接觸點池的容量', () => {
  it('裝得下整場最大架數', () => {
    expect(HUD_MAX_CONTACTS).toBeGreaterThanOrEqual(MAX_COMBATANTS)
  })
})
```

這一段還要在 import 區補三個：

```ts
import { drawGodMarkers } from '../../src/hud/widgets/godMarkers'
import type { HudLayout } from '../../src/hud/types'
import { MAX_COMBATANTS } from '../../src/battle/skirmish'
```

（`createHudFrame` 與 `HUD_MAX_CONTACTS` 既有的 import 已經有了。）

- [ ] **Step 2: 跑測試確認是紅的**

Run: `npx vitest run test/unit/hud.test.ts`
Expected: FAIL —— `src/hud/widgets/godMarkers` 不存在。

- [ ] **Step 3: 建立 `src/hud/widgets/godMarkers.ts`**

```ts
import {
  contactBoxRadius, contactColor, hudFont,
  type HudContact, type HudFrame, type HudLayout,
} from '../types'

/**
 * 這個接觸點要不要畫分隊標示。
 *
 * 【為什麼抽成純函數】canvas 在 node 環境驗不到，而「只畫長機」正是這一份
 * 的核心要求 —— 它壞掉的話畫面上會多出十幾個框，而沒有任何自動化的東西
 * 會發現。與 `hudWidgets`、`edgeIndicatorPosition` 是同一個做法。
 *
 * 【畫面外不畫】專案負責人 2026-08-09 的裁決：上帝視角本來就有小地圖畫
 * 全場，邊緣再排十個箭頭只是雜訊。所以這裡沒有 `edgeIndicatorPosition`
 * 的對應物。
 */
export function godMarkerVisible(c: HudContact, aspect: number): boolean {
  return c.active && c.flightLeader && !c.behind
    && Math.abs(c.x) <= aspect && Math.abs(c.y) <= 1
}

/**
 * 分隊存活／編制的字串，形如 `(2/4)`。
 *
 * 【名字不叫 `flightLabel`】`roster.ts` 已經有一個同名函數，語意不同：
 * 它回傳 `隊 2/4`，而且剩一架時回傳 `null`（「那時候沒有『隊』這回事」）。
 * 上帝視角相反 —— `(1/4)` 是「那一隊快被打光了」，正是最值得看的資訊。
 */
export function flightStrengthLabel(alive: number, size: number): string {
  return `(${alive}/${size})`
}

/**
 * 分隊標示的顏色。**兩色**：敵紅、我方藍。
 *
 * 【為什麼借用 `contactColor` 而不自己寫一行三元式】那會是第三份同義的顏色
 * 邏輯，遲早與另外兩份漂開 —— `contactColor` 的註解記的就是這件事。
 *
 * 【`flightMate = false` 是刻意的裁決，不是忘了填】座艙的第三個顏色（警示黃）
 * 標的是玩家自己的 Schwarm，意思是「誰會在你被咬時回頭掩護你」。上帝視角是
 * 旁觀全場，那個區別沒有意義 —— 專案負責人 2026-08-09 的裁決。
 */
export function godMarkerColor(hostile: boolean): string {
  return contactColor(hostile, false)
}

/**
 * 上帝視角的分隊標示：長機外面一個方框，框下是 `(存活/編制)`。
 *
 * 框的線寬、字級、間距全部沿用座艙目標框（`contacts.ts`），因為兩者是同一套
 * 視覺語言 —— 只是框底下那個讀數的意思由「距離」換成「這一隊還剩幾架」。
 *
 * 【配置：每個標示一個字串，每幀】`flightStrengthLabel` 與 `hudFont` 都回傳
 * 新字串。**這不是零配置**，但與 `drawContacts` 的距離讀數是同一個取捨，而且
 * 量級更小（最多十個分隊 vs 最多四十架）。`hudFont` 已經提到迴圈外，一幀一次。
 */
export function drawGodMarkers(
  ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame,
): void {
  const aspect = L.width / L.height
  ctx.font = hudFont(10 * L.scale)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  for (let i = 0; i < f.contactCount; i++) {
    const c = f.contacts[i]!
    if (!godMarkerVisible(c, aspect)) continue

    const x = L.cx + c.x * L.unit
    const y = L.cy - c.y * L.unit
    const r = contactBoxRadius(c.radius, L.unit, L.scale)
    const color = godMarkerColor(c.hostile)

    ctx.strokeStyle = color
    ctx.lineWidth = 1.5 * L.scale
    ctx.strokeRect(x - r, y - r, r * 2, r * 2)

    // 【間距也要乘 scale】不乘的話高 DPI 下字會貼到框上
    ctx.fillStyle = color
    ctx.fillText(flightStrengthLabel(c.flightAlive, c.flightSize), x, y + r + 3 * L.scale)
  }
}
```

- [ ] **Step 4: 接進 `Hud.ts`**

加 import（依既有的字母順序，排在 `drawGEffect` 之後、`drawHealth` 之前）：

```ts
import { drawGodMarkers } from './widgets/godMarkers'
```

`HudWidget` union 加一個：

```ts
export type HudWidget =
  | 'gEffect' | 'damageEdge' | 'contacts' | 'reticle' | 'tape'
  | 'dials' | 'minimap' | 'health' | 'energy' | 'roster' | 'hints'
  | 'godMarkers'
```

把 `GOD` 的宣告與它的註解換成：

```ts
/**
 * 上帝視角畫這四個。
 *
 * 座艙儀表（姿態儀、速度高度帶、準星、過載黑視、受擊邊框、儀表、血條、能量、
 * 接觸點）全部不畫 —— 鏡頭都不在飛機上了，留著只是雜訊，而**準星更是直接
 * 誤導**：它會讓人以為那個方向會有子彈出去。
 *
 * 【`godMarkers` 不是座艙儀表】它標的是分隊，而分隊只有在看得見全場的時候
 * 才讀得出來。反過來座艙裡也不排它：那裡已經有完整的目標框與預瞄環，再疊
 * 一層分隊框是雜訊。
 *
 * 【排在最前面】世界疊加層在面板底下 —— 與 `FULL` 裡 `contacts` 排在
 * `dials`／`minimap` 之前是同一條理由。
 */
const GOD: readonly HudWidget[] = ['godMarkers', 'minimap', 'roster', 'hints']
```

`render` 的 `switch` 加一個 case（排在 `gEffect` 之後）：

```ts
        case 'godMarkers': drawGodMarkers(ctx, L, f); break
```

- [ ] **Step 5: 跑測試與型別檢查**

Run: `npx vitest run test/unit/hud.test.ts && npx tsc --noEmit`
Expected: 兩者都通過。

- [ ] **Step 6: 突變驗證**

三個突變，每一個都跑 `npx vitest run test/unit/hud.test.ts`，確認**指定的那幾條**轉紅，然後改回來：

| 突變 | 應該紅的 |
|---|---|
| `godMarkerVisible` 拿掉 `c.flightLeader &&` | 「不是長機就不畫」 |
| `godMarkerColor` 改成 `contactColor(hostile, true)` | 「沒有第三個顏色」與「我方是友軍色」 |
| `GOD` 名單把 `godMarkers` 移到最後 | 「上帝視角畫分隊標示、小地圖、名冊、提示」 |

- [ ] **Step 7: Commit**

```bash
git add src/hud/widgets/godMarkers.ts src/hud/Hud.ts test/unit/hud.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

訊息主旨：`feat: 上帝視角的分隊標示 widget`

---

### Task 3：編制查詢的純函數 + `main.ts` 接線 + 修掉算錯的 `range`

**Files:**
- Modify: `src/battle/flights.ts`（新增兩個純函數）
- Modify: `src/main.ts:786`（`refY`）、`:804`（`range`）、`:810-812`（欄位填寫）
- Test: `test/unit/battle-flights.test.ts`

**Interfaces:**
- Consumes: `HudContact.flightLeader` / `.flightAlive` / `.flightSize`（Task 1）、`drawGodMarkers` 已接進 `Hud.render`（Task 2）
- Produces:
  - `flightOfIndex(fi: FlightIndex, index: number): Flight | null`（由 `src/battle/flights.ts` 匯出）
  - `isFlightLeader(fi: FlightIndex, index: number): boolean`（同上）

**【為什麼要多這兩個純函數】** `main.ts` 進不了 vitest（它在模組載入時就摸
`document`），所以寫在那裡的東西一行都測不到。而這一段裡**有兩條會靜靜出錯
的規則**：把 `positionOf` 寫成 `flightOf`、或反過來。兩者都是 `Int32Array`，
型別上完全合法，畫面上的症狀是「標示跑到僚機身上」或「每一架都有標示」——
離成因很遠。抽成純函數就守得住（Codex 2026-08-09 審查指出這一段完全裸奔）。

`flightAlive` / `flightSize` 對調則由 Task 2 的 `drawGodMarkers` 測試守住
`(2/4)` 的方向；`range` 換基準沒有自動判準，靠 Task 4 的人工驗收。**這兩件
事在此明說，不假裝有覆蓋。**

- [ ] **Step 1: 先寫會紅的測試**

`test/unit/battle-flights.test.ts` 的 import 補兩個名字：

```ts
import {
  SCHWARM_SIZE, STATION_REFERENCE, createFlights, compactFlights, stationReferenceOf,
  flightOfIndex, isFlightLeader,
  type FlightMember, type FlightIndex,
} from '../../src/battle/flights'
```

檔案尾端加：

```ts
describe('flightOfIndex 與 isFlightLeader —— HUD 分隊標示要用的兩條查詢', () => {
  /**
   * 【為什麼這兩條值得純函數】它們的呼叫端是 `main.ts`，而那裡進不了 vitest。
   * 兩個索引表都是 `Int32Array`，把 `positionOf` 寫成 `flightOf` 型別上完全
   * 合法 —— 症狀是「標示跑到僚機身上」，離成因很遠。
   */
  it('每個分隊的 members[0] 是長機，其餘不是', () => {
    const fi = createFlights(roster(8))
    for (const f of fi.flights) {
      expect(isFlightLeader(fi, f.members[0]!)).toBe(true)
      for (let p = 1; p < f.count; p++) {
        expect(isFlightLeader(fi, f.members[p]!)).toBe(false)
      }
    }
  })

  it('長機陣亡後由繼任者接手，舊長機不再是長機', () => {
    const all = roster(8)
    const fi = createFlights(all)
    const first = fi.flights[0]!
    const dead = first.members[0]!
    const heir = first.members[1]!

    all[dead]!.alive = false
    compactFlights(fi, all)

    expect(isFlightLeader(fi, heir)).toBe(true)
    expect(isFlightLeader(fi, dead)).toBe(false)
  })

  it('已退場的那一架沒有分隊，也不是長機', () => {
    const all = roster(8)
    const fi = createFlights(all)
    const dead = fi.flights[0]!.members[1]!
    all[dead]!.alive = false
    compactFlights(fi, all)

    expect(flightOfIndex(fi, dead)).toBe(null)
    expect(isFlightLeader(fi, dead)).toBe(false)
  })

  /** 【回傳的是同一個物件不是複本】呼叫端每幀跑幾十次，不能配置 */
  it('flightOfIndex 回傳的就是 flights 裡那一個物件', () => {
    const fi = createFlights(roster(8))
    expect(flightOfIndex(fi, fi.flights[1]!.members[0]!)).toBe(fi.flights[1])
  })

  /** 存活數與編制員額是兩個不同的數，陣亡之後才分得出來 */
  it('count 是存活數、roster.length 是編制員額', () => {
    const all = roster(8)
    const fi = createFlights(all)
    const idx = fi.flights[0]!.members[0]!
    expect(flightOfIndex(fi, idx)!.count).toBe(4)
    expect(flightOfIndex(fi, idx)!.roster.length).toBe(4)

    all[fi.flights[0]!.members[3]!]!.alive = false
    compactFlights(fi, all)
    expect(flightOfIndex(fi, idx)!.count).toBe(3)
    expect(flightOfIndex(fi, idx)!.roster.length).toBe(4)
  })
})
```

- [ ] **Step 2: 跑測試確認是紅的**

Run: `npx vitest run test/unit/battle-flights.test.ts`
Expected: FAIL —— `flightOfIndex` 與 `isFlightLeader` 不存在。

- [ ] **Step 3: 在 `src/battle/flights.ts` 尾端實作**

```ts
/**
 * 第 `index` 架所屬的分隊；已退場（或不在編制內）回傳 null。
 *
 * 【為什麼回傳物件而不是三個數】呼叫端（`main.ts` 的 HUD 迴圈）每幀跑幾十次，
 * 回傳一個新物件就是每幀幾十次配置。這裡回的是 `flights` 陣列裡那一個實體。
 */
export function flightOfIndex(fi: FlightIndex, index: number): Flight | null {
  const f = fi.flightOf[index]!
  return f >= 0 ? fi.flights[f]! : null
}

/**
 * 第 `index` 架是不是它那個分隊的長機（`members[0]`）。
 *
 * 【`positionOf` 不是 `flightOf`】兩者都是 `Int32Array`，寫錯了型別上完全
 * 合法。前者是「在分隊裡的第幾位」，後者是「屬於第幾個分隊」——
 * 用錯的話第 0 個分隊的每一架都會被當成長機。
 */
export function isFlightLeader(fi: FlightIndex, index: number): boolean {
  return fi.flightOf[index]! >= 0 && fi.positionOf[index] === 0
}
```

- [ ] **Step 4: 跑測試並突變驗證**

Run: `npx vitest run test/unit/battle-flights.test.ts`
Expected: PASS。

接著兩個突變，各跑一次確認**指定的那條**轉紅，然後改回來：

| 突變 | 應該紅的 |
|---|---|
| `isFlightLeader` 的 `fi.positionOf[index] === 0` 改成 `fi.flightOf[index] === 0` | 「每個分隊的 members[0] 是長機，其餘不是」 |
| `flightOfIndex` 的 `f >= 0` 改成 `f >= -1` | 「已退場的那一架沒有分隊」（`fi.flights[-1]` 是 `undefined`，`!` 之後回傳 undefined 而不是 null） |

- [ ] **Step 5: 把 `range` 的基準改成鏡頭**

`main.ts` 第 786 行目前是：

```ts
  const refY = input.godView ? godCam.position.y : renderPos.y
```

在它上面新增一行，並把 `refY` 改成由它推出來：

```ts
  // 【`range` 的基準也要跟著鏡頭走】原本恆用 `renderPos`（玩家飛機）。
  // 那在 2026-08-09 之前無害 —— 吃 `range`／`radius` 的兩個 widget（目標框、
  // 邊緣指示）在上帝視角根本不畫。分隊標示要「框依距離縮放」之後它就變成
  // 承重的了：不改的話，鏡頭飛到戰場另一頭，框卻會因為**玩家飛機**靠近某架
  // 敵機而變大。
  const refPos = input.godView ? godCam.position : renderPos
  const refY = refPos.y
```

第 804 行：

```ts
    contact.range = v.position.distanceTo(renderPos)
```

改成：

```ts
    contact.range = v.position.distanceTo(refPos)
```

**只動 `range`。** 預瞄環那一段（`leadProbe.copy(renderPos)...`）不要碰 —— 那是
玩家的槍線，本來就該以玩家飛機為基準，而且上帝視角下不畫。

- [ ] **Step 6: 填三個分隊欄位**

把 import 補上兩個名字（`main.ts` 已經從 `./battle/flights` import 過東西，
加進那一行即可；若沒有就新增一行 `import { flightOfIndex, isFlightLeader } from './battle/flights'`）。

第 811~812 行目前是：

```ts
    contact.flightMate = playerFlightIndex >= 0
      && battle.flights.flightOf[c.index] === playerFlightIndex
```

把它連同新的三行一起換成：

```ts
    contact.flightMate = playerFlightIndex >= 0
      && battle.flights.flightOf[c.index] === playerFlightIndex
    // 【分隊標示只認長機】`compactFlights` 每個物理步重壓，所以長機陣亡時
    // 標示自動跳到繼任者，這裡不需要任何同步。玩家那一架恆為 true ——
    // 他釘死在 `members[0]`（`FlightIndex.pinned`）。
    const cFlight = flightOfIndex(battle.flights, c.index)
    contact.flightLeader = isFlightLeader(battle.flights, c.index)
    contact.flightAlive = cFlight?.count ?? 0
    contact.flightSize = cFlight?.roster.length ?? 0
```

**`flightMate` 那兩行一個字都不要動。** 它需要 `playerFlightIndex >= 0` 這道
守衛：玩家退場時 `playerFlightIndex` 是 −1，而場上每一架已退場者的 `flightOf`
也是 −1 —— 少了守衛就會 `-1 === -1`，一整批飛機被畫成隊友色。

**這一段對 `flightOf` 讀了兩次**（一次給 `flightMate`、一次在 `flightOfIndex`
與 `isFlightLeader` 裡）。Codex 建議合併成一次；**不採納** —— 那要把守衛的
語意攤平回呼叫端，而上一段講的正是那道守衛有多容易寫錯。代價是每幀每架多
兩次 `Int32Array` 索引（40 架 × 60 fps ≈ 每秒五千次讀取，不配置），換到的是
兩條規則從「一行都沒測」變成「有測試守著」。這個交換是划算的。

- [ ] **Step 7: 型別檢查與全套回歸**

Run: `npx tsc --noEmit && npx vitest run --reporter=basic`

Expected: `tsc` 通過。測試方面 —— **這個專案有五條已知的紅**（三條是 2026-08-09
傷害 ×3 之後待裁定的 20v20 護欄，兩條是更早的既有紅，全部記在
`docs/superpowers/specs/2026-08-02-m2-weapons-design.md` §6.3.1 與
`2026-08-09-recovery-altitude-degeneracy-design.md` §13.7）。**不得多出第六條。**
`perf-gate` 與 `rematch` 要單獨跑：

```
npx vitest run test/unit/perf-gate.test.ts
npx vitest run test/integration/rematch.test.ts
```

跑效能測試前要先確認 5173 沒有殘留的 dev server（`netstat -ano | grep :5173`）。

- [ ] **Step 8: Commit**

```bash
git add src/battle/flights.ts src/main.ts test/unit/battle-flights.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

訊息主旨：`feat: main.ts 填分隊欄位，並修掉上帝視角下算錯的 range`

---

### Task 4：e2e 的中央判準換成只數綠色，跑 Playwright 驗收，回填 spec

**Files:**
- Modify: `test/e2e/god-view.e2e.ts:74-110`（檔頭註解與 `hudInk`）
- Modify: `docs/superpowers/specs/2026-08-09-god-view-flight-markers-design.md`（§10 回填）

**Interfaces:**
- Consumes: Task 1~3 的全部成果
- Produces: 無程式介面。產出是驗收證據與回填。

- [ ] **Step 1: 換掉中央的計數方式**

`test/e2e/god-view.e2e.ts` 的 `hudInk` 目前用同一個 `count` 數中央與儀表區的
**任何**不透明像素。中央那一半會被新標示變成偽陽性 —— 任何一架長機投影到畫面
中央附近，方框的邊就落在離中心 9~46 CSS px（dpr 2 下 18~92 裝置像素）處，直接
進到那個 ±40 的框裡，於是它會**間歇性地紅**。

把 `hudInk` 換成：

```ts
    const hudInk = (half: number): Promise<{ centre: number, dials: number }> =>
      page.evaluate((h: number) => {
        const c = document.querySelector<HTMLCanvasElement>('#hud')
        if (c === null) return { centre: -1, dials: -1 }
        const ctx = c.getContext('2d')
        if (ctx === null) return { centre: -1, dials: -1 }
        // 【兩塊一起在同一次 evaluate 裡讀完】分兩次呼叫會落在不同幀，
        // 於是「中央有、整塊沒有」這種自相矛盾的讀數就出現了（實測踩過）
        const count = (x: number, y: number, w: number, hh: number): number => {
          const d = ctx.getImageData(x, y, w, hh).data
          let n = 0
          for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++
          return n
        }
        // 【中央只數綠色】2026-08-09 上帝視角長出分隊標示之後，中央不再是
        // 「必須全空」—— 任何一架長機飛到畫面中央，框的邊就會落進這個範圍。
        // 而這一條真正要守的一直是「準星不得出現」，因為準星是**誤導**不是
        // 雜訊。準星的三個部件（滑鼠圈、機首十字、兩者間的虛線）全部是綠的
        // （`HUD_COLORS.primary` #7dfba8 與 `dim`），分隊標示是紅（#ff5a4d）
        // 或藍（#5aa9ff）。`g > r && g > b` 因此正好切開兩者：紅的 g > r
        // 不成立、藍的 g > b 不成立。
        //
        // **這比原本的判準更強不是更弱** —— 原本只要中央有任何墨水就算違規，
        // 包含與準星無關的東西；現在它真正只盯準星。
        //
        // 【`a >= 128` 這道下限是必要的，不是保守】`getImageData` 回傳的是
        // **未預乘**的 RGB，而瀏覽器內部存的是預乘值。除回來時在極低 alpha
        // 下捨入誤差會大到把色相整個換掉：α = 1/255 的紅色 (255,90,77) 預乘後
        // 是 (1.0, 0.35, 0.30)，取整成 (1,0,0)，再除以 α 還原就變成
        // (255,0,0)；同一條路徑上別的顏色可能被還原成綠色最大的值，於是
        // 一個紅框的邊緣像素被算成準星。準星的筆畫在 dpr 2 下有大量
        // α = 255 的像素（第 16 條會驗證這件事），所以這道下限不會削弱偵測。
        const greenCount = (x: number, y: number, w: number, hh: number): number => {
          const d = ctx.getImageData(x, y, w, hh).data
          let n = 0
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3]! >= 128 && d[i + 1]! > d[i]! && d[i + 1]! > d[i + 2]!) n++
          }
          return n
        }
        const cx = Math.round(c.width / 2)
        const cy = Math.round(c.height / 2)
        return {
          centre: greenCount(cx - h, cy - h, h * 2, h * 2),
          // 右下角的儀表／血條／能量區。不經過 3D 相機。
          // 【名冊不在這一區】它畫在畫面**上方**置中（`roster.ts` 的
          // `y = L.height * 0.04`），而且上帝視角下照畫 —— 它是留下的
          // widget 之一
          dials: count(
            Math.round(c.width * 0.66), Math.round(c.height * 0.72),
            Math.round(c.width * 0.34), Math.round(c.height * 0.28),
          ),
        }
      }, half)
```

把第 150 行與 153 行的訊息改成講清楚它現在量什麼：

```ts
    // 17. 上帝視角下中央不得有**綠色**的墨水（＝準星），右下角儀表區必須全空
    const inGod = await hudInk(40)
    console.log(`[17] 上帝視角：中央的綠色 ${inGod.centre}、儀表區 ${inGod.dials}（都必須是 0）`)
    if (inGod.centre !== 0) throw new Error('上帝視角下畫面中央還有綠色 —— 準星沒有被關掉？')
```

檔頭第 48~51 行那段說明也要跟著改，把「中央必須是空的」換成「中央不得有綠色」，
並寫一句為什麼（分隊標示是紅／藍，會落進中央）。

- [ ] **Step 2: 確認新判準沒有變成永遠綠**

**這一步不必新增程式碼** —— 第 138~143 行的第 16 條已經在守它：

```ts
    // 16. 座艙裡畫面中央有準星、右下角有儀表
    const cockpit = await hudInk(40)
    if (cockpit.centre <= 0) {
      throw new Error('座艙裡畫面中央沒有準星 —— 這一條驗收本身壞了，不是上帝視角的問題')
    }
```

`centre` 換成綠色計數之後，這一條就自動變成「`g > r && g > b` 真的抓得到準星」
的反面驗證。**跑起來若 `[16] 座艙：中央 0`，表示判準本身壞掉，不得繼續往下** ——
那不是上帝視角的問題，是這把新尺是瞎的。把它記在 spec §10。

- [ ] **Step 3: 跑 Playwright**

兩個終端機：

```
npm run dev
npx vite-node test/e2e/god-view.e2e.ts
```

Expected：全部通過，console 錯誤 0 則。

- [ ] **Step 4: 也跑一次戰場視覺那一支**

```
npx vite-node test/e2e/battlefield-visuals.e2e.ts
```

它會經過上帝視角，可以確認新 widget 不會噴 console 錯誤或圖形 warning。

- [ ] **Step 5: 人工看截圖**

把 `.shots/god-2-entered.png` 交給專案負責人，要看的三件事：

1. **雙方都要有框** —— 紅的與藍的都在
2. 框套的是長機，僚機身上沒有框
3. 框下面是 `(n/4)`

**這是一道阻擋式的人工關卡。** 顏色、大小、位置好不好只有專案負責人判定得了。

- [ ] **Step 6: 回填 spec §10**

把實測寫進 `docs/superpowers/specs/2026-08-09-god-view-flight-markers-design.md`
的 §10：Playwright 的兩個讀數、座艙／上帝視角的綠色墨水對照、截圖路徑、
以及專案負責人的判定。**§10 的「專案負責人判定」那一格不得由實作者代填。**

- [ ] **Step 7: Commit**

```bash
git add test/e2e/god-view.e2e.ts docs/superpowers/specs/2026-08-09-god-view-flight-markers-design.md
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

訊息主旨：`test: e2e 的中央判準改成只數綠色，並回填分隊標示的驗收`

---

## 審查紀錄（Codex，2026-08-09）

Codex 第一輪**完全讀不到檔案**（`codex-windows-sandbox-setup.exe` not found、
MCP 被拒、node 備援模組找不到），所以它誠實地回報「不會假裝已讀過檔案」。
把十個檔案的相關片段貼進第二輪之後才拿到實質意見。

| Codex 的意見 | 判定 | 處置 |
|---|---|---|
| Critical：`contacts.ts` 沒說要補 import、沒說要刪 `BOX_MIN`/`BOX_MAX` | **誤判** | 計畫 Task 1 Step 4 兩件事都寫了。是我貼給它的摘要省略了 |
| Critical：`Hud.ts` 沒說要 import `drawGodMarkers` | **誤判** | 同上，Task 2 Step 4 第一行就是 |
| Critical：`drawGodMarkers` 每幀建字串，不是零配置 | **成立** | 註解裡那句「熱路徑：不配置」是假的，改成誠實的說明。`hudFont` 提到迴圈外 |
| Important：`contactBoxRadius` 的突變描述不準 | **成立，而且是我算錯** | 先夾再乘的突變下，18／92 兩條**照樣過**。改成兩個互補的突變，各自指名該紅的那條 |
| Minor：`not.toBe(HUD_COLORS.warn)` 是恆真的 | **成立** | 刪掉，理由寫進留下那條的註解 |
| Critical：`main.ts` 那一段一行都沒測 | **成立** | 抽出 `flightOfIndex` 與 `isFlightLeader` 到 `flights.ts`，五條測試 + 兩個突變 |
| Critical：`drawGodMarkers` 本身沒測，刪掉 switch case 仍全綠 | **成立** | 加一個記錄呼叫的假 `CanvasRenderingContext2D`，三條測試（畫幾個、畫在哪、字是什麼） |
| Critical：池子塞滿時後面分隊的長機會靜靜消失 | **成立但目前不會發生** | `MAX_COMBATANTS = 40` < `HUD_MAX_CONTACTS = 48`。加一條護欄把這個不等式釘住 |
| Important：`flightOf` 被讀兩次，應合併 | **成立但不採納** | 合併要把 `flightMate` 的守衛語意攤回呼叫端，而那道守衛正是最容易寫錯的地方。理由寫在 Task 3 Step 6 |
| Important：上帝視角下池子只收長機，可以整個省掉 `flightLeader` | **否決** | **會把小地圖清空。** 小地圖畫的就是接觸點池，而它在上帝視角是主要的資訊來源（`main.ts:789` 的註解記著「不放進來的話玩家自己那一架一個像素都沒有」）。只收長機等於把 40 架的小地圖砍成 10 個點 |
| Important：`f.contacts[i]!` 是非空斷言不是執行期保護 | **不改** | `contacts` 是 `Array.from({length: HUD_MAX_CONTACTS}, createHudContact)`，而迴圈上界是 `contactCount ≤ HUD_MAX_CONTACTS`。與 `drawContacts` 同一個既有寫法 |
| Minor：`refPos` 型別沒問題、長機接手沒問題、單機分隊沒問題、命名不衝突 | **確認** | 無 |

§4 的 e2e 判準意見另外處理：Codex 假設讀的是合成後的畫面，所以抗鋸齒邊緣會與
3D 背景混色 —— **那個前提不成立**，`hudInk` 讀的是 `#hud` 這張獨立的透明 2D
canvas。但順著它的方向查下去有一個真的漏洞：`getImageData` 回傳未預乘的 RGB，
極低 alpha 下除回來的捨入誤差足以換掉色相。已加一道 `a >= 128` 的下限。

## 自我檢查

**Spec 覆蓋**

| Spec 節 | 對應 |
|---|---|
| §1 四項要求 | Task 1（資料）+ Task 2（只畫長機、`(2/4)`、兩色）+ Task 3（接線讓它真的出現） |
| §2 四個裁決 | Task 2 Step 3（框 + 標籤、畫面外不畫、兩色）、Task 1 Step 3（框依距離縮放，共用夾制） |
| §4 `range` 的缺陷 | Task 3 Step 1 |
| §5.1 三個欄位與否決的兩個做法 | Task 1 Step 3、Task 3 Step 2 |
| §5.2 widget 與三個純函數 | Task 2 |
| §5.3 夾制搬進 `types.ts` | Task 1 Step 3~4 |
| §5.4 繪製內容 | Task 2 Step 3 |
| §6 三件不必特例的事 | Task 3 Step 2 的註解（長機陣亡、玩家恆為長機）；全隊覆沒由 `contactCount` 自然涵蓋 |
| §7 e2e 判準換掉 | Task 4 Step 1~2 |
| §8.1 十四條單元測試 | Task 1（6 條）+ Task 2（12 條，含改寫既有那條）+ Codex 審查後追加：`drawGodMarkers` 三條、池子容量一條、`flights.ts` 五條 |
| §8.2 e2e | Task 4 |
| §9 不做 | 全計畫沒有任何一個 task 碰它們 |
| §10 回填 | Task 4 Step 6 |

**佔位符掃描**：無 TBD／TODO；每個程式步驟都有可直接貼上的完整程式碼；每條測試都寫出來了。

**型別一致性**：`flightLeader` / `flightAlive` / `flightSize` 在 Task 1 定義、Task 2 讀、Task 3 寫，三處拼字一致。`contactBoxRadius(radius, unit, scale)` 的參數順序在 Task 1 定義、Task 2 使用，一致。`flightStrengthLabel` 全程沒有寫成 `flightLabel`（那是 `roster.ts` 既有的另一個函數）。
