# 撤退令棘輪 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal** 把撤退令的集合點從「相對分隊自己」改成「錨在敵群」，拿掉高度加碼，
並讓見底的取樣可以不只看最低那一架 —— 消掉分隊無限外擴與無限爬升的棘輪。

**Architecture** 只改 `src/ai/command.ts` 的兩個地方：`planFlightOrder` 的
點算法、`stepCommand` 的見底取樣。命令的形狀（`FlightOrder`）不變，所以
`rally.ts`／`AiController.ts`／`setup.ts`／`steer.ts` 一個字都不動。

**Tech Stack** TypeScript、three.js（只用 `Vector3`）、vitest。

## Global Constraints

- **絕不 `git add -A`** —— `bash.exe.stackdump` 是被追蹤且已修改的檔案。一律
  列明確路徑。
- **沒有 `@types/node`**：不得用 `node:path`、`__dirname`、`process`、`fs`。
- `noUncheckedIndexedAccess` 開著，`Float32Array` / `Uint8Array` 也適用。
- `noUnusedLocals` / `noUnusedParameters` 開著。
- **`src/ai/` 不得 import `src/battle/`**。跨層 import 只允許出現在測試裡。
- 熱路徑不得配置。`planFlightOrder` 每 `planPeriod`(2 s) 才可能發令一次，
  發令那一格配置一個 `Vector3` 是既有且被接受的行為。
- **絕不為了讓測試變綠而放寬門檻。** 護欄紅了要先量、先報告、先問。
- 每一條新測試都要**先驗紅**。
- 型別檢查是 `npx tsc --noEmit`（沒有 `npm run typecheck`）。
- 含中文的 commit message 走 `$CLAUDE_JOB_DIR/tmp/msg.txt` + `git commit -F`。
- `perf-gate` 與 `rematch` 必須單獨跑，跑之前先關掉 dev server。
- 暫存檔放 `$CLAUDE_JOB_DIR/tmp`。
- 絕不用 PowerShell 讀寫含中文的檔案（用 Read 工具，或 Python 搭
  `io.open(..., encoding='utf-8')`）。

## 檔案結構

| 檔案 | 動作 | 責任 |
|---|---|---|
| `src/ai/command.ts` | 改 | `CommandConfig` 換欄位；`planFlightOrder` 換點算法；`stepCommand` 換見底取樣 |
| `test/unit/ai-command.test.ts` | 改 + 增 | 純函數層：點算得對不對、名次取得對不對 |
| `test/integration/ai-withdraw-anchor.test.ts` | 新 | 護欄：20v20 × 300 s，戰鬥不得漂出戰場 |
| `docs/superpowers/specs/2026-08-09-withdraw-anchor-design.md` | 改 | Task 5 的回填 |

---

### Task 1：`CommandConfig` 換欄位

**Files**
- Modify: `src/ai/command.ts`（`CommandConfig` 介面、`DEFAULT_COMMAND`）
- Test: `test/unit/ai-command.test.ts`

**Interfaces**
- Produces：`CommandConfig.spentRank: number`（新增）；
  `CommandConfig.withdrawClimb` **刪除**。

- [ ] **Step 1：改介面**

`CommandConfig` 裡把

```ts
  /** 集合點比小隊質心高多少，m */
  withdrawClimb: number
```

整段刪掉，並把 `withdrawRange` 的註解改成新語意：

```ts
  /**
   * 集合點離**敵群質心**多遠，m。
   *
   * 【語意在 2026-08-09 改過】舊版是「離**小隊自己**多遠」，那讓撤退變成
   * 一個沒有不動點的純積分器 —— 每撤一次就再往外 3 km，實測 300 秒漂到
   * 平均 9 km、最大 18 km。錨在敵群之後這是一個固定的球殼：跑太遠的分隊
   * 會被叫回來，撤退本身也不再移動錨點。
   */
  withdrawRange: number
```

在 `spentSeconds` 後面加：

```ts
  /**
   * 見底取分隊 `cornerRatio` 由低到高第幾個。0 = 最低（2026-08-09 之前的
   * 行為），1 = 次低。人數不足時夾到最後一個。
   *
   * 【為什麼需要它】四機小隊的最小值遠低於中位數。實測 `< 0.6` 的時間佔比：
   * 最低 30.6%、次低 10.5%、中位數 2.1% —— 一架落單掉速的僚機就足以把整支
   * 分隊拖出戰場三成的時間。
   *
   * 【為什麼是名次不是分位數】分隊固定 4 人，名次是整數、可窮舉、寫得進
   * 測試；4 個樣本的分位數插值只會製造一個沒有人看得懂的數字。
   */
  spentRank: number
```

`DEFAULT_COMMAND` 裡刪掉 `withdrawClimb: 800`，加上 `spentRank: 0`。

**`spentRank` 先留 0** —— 這一步只換介面，行為完全不變，Task 4 才由掃描定值。

- [ ] **Step 2：跑型別檢查，看它指出所有用到 `withdrawClimb` 的地方**

```
npx tsc --noEmit
```

預期：`src/ai/command.ts` 裡 `planFlightOrder` 那一行報 `withdrawClimb` 不存在。
Task 2 會處理它。**這一步的目的就是讓編譯器把清單列出來** —— 不要用搜尋
代替它。

- [ ] **Step 3：commit（與 Task 2 一起）**

介面改完但實作還沒改，中間狀態不編譯，所以 Task 1 與 Task 2 合成一個 commit。

---

### Task 2：`planFlightOrder` 換點算法

**Files**
- Modify: `src/ai/command.ts:424-446`
- Test: `test/unit/ai-command.test.ts`

**Interfaces**
- Consumes：Task 1 的 `CommandConfig`（無 `withdrawClimb`）
- Produces：`planFlightOrder` 的回傳不變（`FlightOrder`），只有 `point` 的值變

- [ ] **Step 1：先改既有那一條與新設計衝突的測試**

`test/unit/ai-command.test.ts` 的

```ts
  it('真的補得到能量：高於小隊質心', () => {
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    expect(o.point.y).toBeGreaterThan(4000)
  })
```

換成：

```ts
  /**
   * 【撤退不再改變高度】舊設計是「小隊質心 + withdrawClimb(800)」，理由是
   * 「爬起來的高度之後換得回速度」。實測沒有發生：20v20 四分鐘裡高度
   * +2000 m 而 TAS 一直停在 110。
   *
   * 而且高度不能像水平那樣錨在敵群 —— 那會變成互相加價（紅爬到藍 +800，
   * 藍下一張就是紅 +800 = 原本的 +1600），一路頂到升限。垂直方向沒有
   * 「背對」這種把兩隊分開的自由度。
   *
   * 撤退要補的是**速度**（`cornerRatio` 是 TAS ÷ 角落速度），而爬升是消耗
   * 速度的動作。平飛 + 全推力 + 遠離敵人，才是把推力換成速度的做法。
   */
  it('撤退不改變高度', () => {
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    expect(o.point.y).toBeCloseTo(4000, 6)
  })
```

- [ ] **Step 2：加四條新的、會紅的測試**

加在同一個 `describe('planFlightOrder：集合點給得對不對')` 裡：

```ts
  /**
   * 【殼的半徑是「離敵群多遠」】舊設計是「離小隊自己多遠」，那讓撤退
   * 變成純積分器。
   */
  it('集合點離敵群質心恰好 withdrawRange（水平）', () => {
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    const foe = new Vector3(50, 4000, 1000)   // 兩架敵機的質心
    expect(Math.hypot(o.point.x - foe.x, o.point.z - foe.z))
      .toBeCloseTo(cfg.withdrawRange, 3)
  })

  /**
   * 【回復力】已經在殼外的分隊，集合點必須比它現在更靠近敵群 —— 也就是
   * 「撤退令」會把它叫回戰場。舊設計不可能通過這一條：它永遠只往外推。
   */
  it('小隊已經在殼外時，集合點比小隊更靠近敵群', () => {
    const far = [unit({ z: -9000 }), unit({ z: -9000, x: 200 })]
    const o = planFlightOrder(far, [unit({ z: 1000 })], SPENT, cfg)!
    const foe = new Vector3(0, 4000, 1000)
    const own = new Vector3(100, 4000, -9000)
    expect(o.point.distanceTo(foe)).toBeLessThan(own.distanceTo(foe))
  })

  /**
   * 【棘輪的直接反例】把小隊搬到第一張的集合點上再發一次，第二張的點必須
   * 幾乎在同一個地方。舊設計會再往外 withdrawRange。
   */
  it('連發兩張不會愈跑愈遠', () => {
    const foes = [unit({ z: 1000 })]
    const a = planFlightOrder(members, foes, SPENT, cfg)!
    const moved = [
      unit({ x: a.point.x, y: a.point.y, z: a.point.z }),
      unit({ x: a.point.x + 200, y: a.point.y, z: a.point.z }),
    ]
    const b = planFlightOrder(moved, foes, SPENT, cfg)!
    expect(a.point.distanceTo(b.point)).toBeLessThan(cfg.arriveRadius)
  })
```

- [ ] **Step 3：跑，確認它們紅**

```
npx vitest run test/unit/ai-command.test.ts
```

預期：`集合點離敵群質心恰好 withdrawRange`、`小隊已經在殼外時…`、
`連發兩張不會愈跑愈遠`、`撤退不改變高度` 四條紅。

**若 `連發兩張` 意外綠了，停下來查** —— 那代表 `unit()` 的預設值讓兩次呼叫
拿到同一個輸入，測試沒有真的搬動小隊。

- [ ] **Step 4：改實作**

`src/ai/command.ts` 的 §「高度」與 `return` 那一段換成：

```ts
  // ── 高度：撤退不改變高度，只夾在安全下界與最低升限之間 ────
  // 【為什麼不加碼】見 spec §3.2：垂直方向錨在敵群會變成互相加價，一路頂到
  // 升限；而撤退要補的是**速度**（`cornerRatio` 是 TAS ÷ 角落速度），爬升
  // 是消耗速度的動作。實測舊設計四分鐘爬了 2000 m 而 TAS 一直停在 110。
  //
  // 【下界取 clearanceScale（500）而不是安全層的 clearance（120）】政策層
  // 不該把飛機送進硬限制的作用區。與 task #136 的六場護欄取同一條線。
  //
  // 【目前海面恆為 0】未來加入地形時這裡要與 `stationPoint` 一樣收
  // `seaHeight`，下界改成 `seaHeight + clearanceScale`。
  let y = own.y
  if (y > ceiling) y = ceiling
  if (y < DEFAULT_STEER.clearanceScale) y = DEFAULT_STEER.clearanceScale

  return {
    kind: 'rally',
    // 【錨在敵群，不是自己】見 spec §3.1。錨在自己的話位移量與「已經跑多遠」
    // 無關 —— 那是一個沒有不動點的純積分器，每撤一次就再往外一個
    // `withdrawRange`。錨在敵群之後這是一個固定的球殼：撤退本身不移動錨點
    // （敵群質心不因我方撤退而動），而且兩個方向都有回復力。
    point: new Vector3(
      foe.x + dir.x * cfg.withdrawRange,
      y,
      foe.z + dir.z * cfg.withdrawRange,
    ),
    radius: cfg.arriveRadius,
    targetFlight: -1,
    side: 0,
    focusIndex: -1,
  }
```

- [ ] **Step 5：跑，確認全綠**

```
npx vitest run test/unit/ai-command.test.ts
npx tsc --noEmit
```

既有的「不超過最低升限」「不會叫人撞海」「往遠離敵群的方向走」「不會叫人
穿過敵群」「退化與穩定性」**必須維持綠**。任何一條紅了 → 停下來報告，
不要改測試。

- [ ] **Step 6：commit**

```
git add src/ai/command.ts test/unit/ai-command.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

### Task 3：`stepCommand` 的見底取名次

**Files**
- Modify: `src/ai/command.ts:912-920`
- Test: `test/unit/ai-command.test.ts`

**Interfaces**
- Consumes：`CommandConfig.spentRank`（Task 1）
- Produces：行為不變（`spentRank` 預設 0）

- [ ] **Step 1：先寫會紅的測試**

新的 `describe`，用 `planFlightOrder` 測不到（見底計時住在 `stepCommand`），
所以直接測 `stepCommand`。加在既有的 `stepCommand` 那一組裡：

```ts
/**
 * 【為什麼要能不看最低那一架】四機小隊的最小值遠低於中位數。20v20 × 300 s
 * 實測 `cornerRatio < 0.6` 的時間佔比：最低 30.6%、次低 10.5%、中位數 2.1%
 * —— 一架落單掉速的僚機就足以把整支分隊拖出戰場三成的時間。
 */
describe('見底的取樣名次', () => {
  it('spentRank = 1 時，只有一架見底不算見底', () => {
    // 一架 0.3、其餘 1.5 → 次低是 1.5，不該累積
  })

  it('spentRank = 1 時，兩架見底才算見底', () => {
    // 兩架 0.3 → 次低是 0.3，該累積並在 spentSeconds 後發令
  })

  it('spentRank 超出人數時夾到最後一個，不會讀到 undefined', () => {
    // spentRank = 9、分隊只有 2 人 → 取最高的那一架，不得丟例外
  })
})
```

**實際的建構方式**：照抄檔案裡既有 `stepCommand` 測試的 `units` / `flights`
組法（同一個檔案裡已經有現成的 helper，不要另外發明），把成員的
`cornerRatio` 設成上面的值，推進 `spentSeconds + planPeriod` 秒，斷言
`state.orders[f]` 是不是 `rally`。

- [ ] **Step 2：跑，確認紅**

```
npx vitest run test/unit/ai-command.test.ts -t '見底的取樣名次'
```

前兩條預期紅（目前恆取最低），第三條可能綠（`noUncheckedIndexedAccess`
之下讀越界會是 `undefined`，比較會是 false）—— **若第三條綠，用 mutation
證明它有效**：把實作的夾限拿掉，看它會不會紅。

- [ ] **Step 3：改實作**

`command.ts` 的見底計時那一段：

```ts
    // ── 見底計時：小隊裡第 `spentRank` 低的那一架 ──────────
    // 【為什麼不是恆取最低】見 `CommandConfig.spentRank`：四機小隊的最小值
    // 遠低於中位數，一架落單掉速的僚機就能把整支分隊拖出戰場。
    //
    // 【為什麼是插入排序不是 Array.sort】分隊最多 4 人，而這一段每 dt 都跑
    // 一次（40 架 × 240 Hz）。`sort` 要先配置一個陣列 —— 熱路徑不得配置。
    RATIOS.length = 0
    for (let p = 0; p < flight.count; p++) {
      const u = units[flight.members[p]!]
      if (u === undefined || !u.alive) continue
      let i = RATIOS.length
      RATIOS.push(u.cornerRatio)
      while (i > 0 && RATIOS[i - 1]! > RATIOS[i]!) {
        const t = RATIOS[i - 1]!
        RATIOS[i - 1] = RATIOS[i]!
        RATIOS[i] = t
        i--
      }
    }
    // 【全滅的分隊沒有見底可言】上面的 `flight.count === 0` 已經 continue，
    // 但成員全部陣亡時 RATIOS 仍可能是空的
    const rank = RATIOS.length === 0
      ? Infinity
      : RATIOS[Math.min(cfg.spentRank, RATIOS.length - 1)]!
    if (rank < cfg.spentRatio) s.spent[f] = s.spent[f]! + dt
    else s.spent[f] = 0
```

`RATIOS` 與檔案裡既有的 `MEMBERS` / `FOES` / `TARGET` 同一個位置宣告：

```ts
/** 見底排序用的模組層暫存。熱路徑：不配置。 */
const RATIOS: number[] = []
```

- [ ] **Step 4：跑，確認轉綠且既有全綠**

```
npx vitest run test/unit/ai-command.test.ts
npx tsc --noEmit
```

- [ ] **Step 5：commit**

---

### Task 4：護欄 —— 戰鬥不得漂出戰場

**Files**
- Create: `test/integration/ai-withdraw-anchor.test.ts`

**Interfaces**
- Consumes：`createBattle` / `stepBattle`（`src/battle/setup`）、`AiController`

- [ ] **Step 1：寫護欄**

20v20、300 秒、`DT = 1/240`、`ACE`（`createBattle` 的預設）。單一場、
一次跑完，五條斷言各自獨立。

量測：

- 每架存活飛機的 `hypot(position.x, position.z)`，在 `t = 60 s` 與
  `t = 300 s` 各取一次隊平均；全程取最大值。
- 撤退令佔時：每步對 `blueCommand.orders` + `redCommand.orders` 數
  `kind === 'rally'` 的格數 ÷ 總格數。
- 掉血：開場記 `hp`，結束時相減。

斷言（spec §7.2）：

```ts
// 主判準
expect(r300.blue).toBeLessThanOrEqual(r60.blue + 2000)
expect(r300.red).toBeLessThanOrEqual(r60.red + 2000)
expect(maxRadius).toBeLessThanOrEqual(ENTRY_RANGE)   // 10,000
// 次判準
expect(rallyShare).toBeGreaterThan(0.05)
expect(rallyShare).toBeLessThan(0.25)
expect(blueDmg + redDmg).toBeGreaterThanOrEqual(9181)
expect(Math.max(blueDmg / redDmg, redDmg / blueDmg)).toBeLessThanOrEqual(3.129)
```

**每一個門檻的來歷都要寫進註解**，含修前的基準值（1676 → 8944、
最大 18,188、24.34%、9,181、2.25）。

- [ ] **Step 2：把它跑在**改動之前**的程式上，確認它紅**

```
git stash push src/ai/command.ts
npx vitest run test/integration/ai-withdraw-anchor.test.ts
git stash pop
```

預期：主判準兩條大幅紅。**這一步不可以跳過** —— 護欄若在舊程式上也綠，
它守的就不是這個缺陷。

- [ ] **Step 3：跑在改動之後**

```
npx vitest run test/integration/ai-withdraw-anchor.test.ts
```

**若主判準綠、次判準有紅** —— 停下來，把數字報告給專案負責人，不要調門檻。
特別是「撤退令佔時 > 25%」：spec §4 已經預告那時的處置是回頭加不應期，
而那是一個要先被批准的設計決定。

- [ ] **Step 4：commit**

---

### Task 5：掃描 `withdrawRange` 與 `spentRank`，回填

**Files**
- Modify: `src/ai/command.ts`（`DEFAULT_COMMAND` 的兩個值 + 掃描表註解）
- Modify: `docs/superpowers/specs/2026-08-09-withdraw-anchor-design.md`

- [ ] **Step 1：掃描**

寫一支暫時的 scratch 測試（放 `test/unit/_scan.test.ts`，跑完刪掉），
對每一組值跑一場 20v20 × 300 s，記錄 Task 4 的五個量：

```
withdrawRange ∈ {2000, 3000, 4500}
spentRank     ∈ {0, 1}
```

六組。**`withdrawRange` 的舊掃描表不得沿用** —— 語意變了，量的是另一個東西。

- [ ] **Step 2：選值**

判準依序：
1. 主判準（半徑）必須過。
2. 撤退令佔時落在 5%~25%。
3. 總掉血愈高愈好（真的在打仗）。
4. 傷害比愈接近 1 愈好，且不得超過 3.129。

**若多組並列，取語意最單純的**（`withdrawRange` 保持 3000、`spentRank`
保持 0）—— 與 2026-08-07 那一輪「原值全部落在可用帶中央」同一個判斷方式。

- [ ] **Step 3：把掃描表寫進 `DEFAULT_COMMAND` 上方的註解**

格式照抄既有的那兩張表（參數／值／五個觀測值／過不過），並寫明
**這張表是在新語意下量的，與 2026-08-07 那張不可比**。

- [ ] **Step 4：回填 spec §5 的參數表與 §8 的觀測值**

修前修後的半徑、高度、TAS、掉血、撤退令佔時各一行。

- [ ] **Step 5：刪掉 scratch，commit**

---

### Task 6：全套回歸與驗收

- [ ] **Step 1：型別**

```
npx tsc --noEmit
```

- [ ] **Step 2：全套**

```
npx vitest run
```

已知的紅只有 `ai-command-tactics` 那條刻意留紅的側翼進入角紀錄。
**任何其他紅都要先量、先報告** —— 特別是
`ai-command-channel` / `ai-command-decision` / `ai-command-tactics` /
`multi-battle` / `ai-duel-matrix`，它們的基準數字有可能被這次改動移動。
移動了要判斷是「AI 變好了」還是「護欄被打壞了」，不是直接改數字。

- [ ] **Step 3：單獨跑兩個**（先關掉 dev server）

```
npx vitest run test/unit/perf-gate.test.ts
npx vitest run test/integration/rematch.test.ts
```

- [ ] **Step 4：手動試飛**

重開 dev server，請專案負責人確認敵機不再在戰場周圍上下繞。
