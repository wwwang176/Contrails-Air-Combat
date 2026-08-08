# 撤退令棘輪 實作計畫（v2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal** 把撤退令的集合點從「相對分隊自己」改成「錨在敵群的固定球殼」、
拿掉高度加碼、殼外不發令，並讓見底的取樣可以不只看最低那一架 ——
消掉分隊無限外擴與無限爬升的棘輪。

**Architecture** 只改 `src/ai/command.ts` 的三個地方：`CommandConfig`、
`planFlightOrder` 的點算法與發令閘門、`stepCommand` 的見底取樣。命令的形狀
（`FlightOrder`）不變，所以 `rally.ts`／`AiController.ts`／`setup.ts`／
`steer.ts` 一個字都不動。

**Tech Stack** TypeScript、three.js（只用 `Vector3`）、vitest。

**依據** `docs/superpowers/specs/2026-08-09-withdraw-anchor-design.md`（v2）。

> **v2 的四個結構性修訂**（審查後）
> 1. **護欄移到 Task 1**。v1 把它排在實作之後，然後用 `git stash push
>    src/ai/command.ts` 驗紅 —— 但那時改動早已 commit，工作區是乾淨的，
>    stash 是空操作、pop 會失敗，護欄實際上跑在新程式上。**先寫護欄、在
>    現行程式上看它紅**，順序問題就不存在。
> 2. **`planFlightOrder` 多一條「殼外不發令」的閘門**（spec §3.1）。少了它，
>    棘輪只是換成空轉，而且會把見底的分隊叫回敵人身邊。
> 3. **護欄的佔時指標改用既有那把尺**（`leavingSamples / aliveSamples`），
>    並新增一條「撤退令要真的補到能量」的配對比較。
> 4. **`scene()` 要一併改**，否則 `spentRank = 1` 會打紅五條既有測試。

## Global Constraints

- **絕不 `git add -A`** —— `bash.exe.stackdump` 是被追蹤且已修改的檔案。一律
  列明確路徑。
- **沒有 `@types/node`**：不得用 `node:path`、`__dirname`、`process`、`fs`。
- `noUncheckedIndexedAccess` 開著，`Float32Array` / `Uint8Array` 也適用。
- `noUnusedLocals` / `noUnusedParameters` 開著。
- **`src/ai/` 不得 import `src/battle/`**。跨層 import 只允許出現在測試裡。
- **`stepCommand` 在 240 Hz 的熱路徑上，不得配置。** `planFlightOrder` 每
  `planPeriod`(2 s) 才可能發令一次，發令那一格配置一個 `Vector3` 是既有且
  被接受的行為。
- **絕不為了讓測試變綠而放寬門檻。** 護欄紅了要先量、先報告、先問。
- 每一條新測試都要**先驗紅**，除非計畫明白標示它是正控制。
- 型別檢查是 `npx tsc --noEmit`（沒有 `npm run typecheck`）。`tsconfig.json`
  的 `include` **含 `"test"`**，所以測試檔的型別錯誤會讓它紅。
- 含中文的 commit message 走 `$CLAUDE_JOB_DIR/tmp/msg.txt` + `git commit -F`。
- `perf-gate` 與 `rematch` 必須單獨跑，跑之前先關掉 dev server。
- 暫存檔放 `$CLAUDE_JOB_DIR/tmp`。
- 絕不用 PowerShell 讀寫含中文的檔案（用 Read 工具，或 Python 搭
  `io.open(..., encoding='utf-8')`）。

## 檔案結構

| 檔案 | 動作 | 責任 |
|---|---|---|
| `test/integration/ai-withdraw-anchor.test.ts` | **新** | 護欄：20v20 × 300 s |
| `src/ai/command.ts` | 改 | `CommandConfig`、`planFlightOrder`、`stepCommand` |
| `test/unit/ai-command.test.ts` | 改 + 增 | 純函數層 |
| `test/integration/ai-command-channel.test.ts` | 改 | `:380` 用了 `DEFAULT_COMMAND.withdrawClimb`，刪它會讓 `tsc` 紅 |
| `docs/superpowers/specs/2026-08-09-withdraw-anchor-design.md` | 改 | Task 5 的回填 |

---

### Task 1：護欄（先寫，在現行程式上驗紅）

**Files**
- Create: `test/integration/ai-withdraw-anchor.test.ts`

**Interfaces**
- Consumes：`createBattle` / `stepBattle`（`src/battle/setup`）、`AiController`、
  `DEFAULT_BATTLE`（讀 `entryRange` 只為寫註解，不當門檻）
- Produces：無（純測試）

- [ ] **Step 1：先讀既有那把尺**

`test/integration/ai-command-channel.test.ts` 的 `leavingSamples`（約 `:111`）
與 `:426` 的 `share` 算法。**護欄的佔時必須用同一個定義** —— 每架飛機、
每取樣。不要自己發明「分隊格數 ÷ 總格數」：`createCommandState` 是用**全部**
分隊數建的（`src/battle/setup.ts:362-363`），對方那五格與玩家那支恆為 `null`，
分母整個是錯的。

- [ ] **Step 2：寫護欄**

場景固定：

```ts
const b = createBattle(new AiController())   // 玩家座位交給 AI → 十支分隊全受指揮
const DT = 1 / 240
const SECONDS = 300
```

**每一步都要量的**：

- 每架存活飛機的 `hypot(position.x, position.z)`；`t = 60 s` 與 `t = 300 s`
  各取一次隊平均，全程取最大值。
- `aliveSamples`（每步每架存活 +1）與 `leavingSamples`（該架所屬分隊此刻
  持有 `kind === 'rally'` 的命令 +1）。分隊歸屬由 `b.flights` 反查。
- 撤退令的生命：`orders[f]` 由 `null`／別的種類變成 `rally` 時，記下該分隊
  存活成員的平均 `cornerRatio`；變回 `null` 時再記一次，配成一對。
- 開場 `hp` 快照，結束相減。
- 觀測值（不設門checked）：兩隊存活數、平均 TAS、平均高度、同時持有 rally
  的分隊比例的最大值、撤退令期間陣亡的架數。

**斷言**（spec §7.2；每一條的註解都要寫上修前基準）：

```ts
// ── 主判準一：戰鬥不得漂出戰場 ──
expect(r300.blue).toBeLessThanOrEqual(r60.blue + 2000)   // 基準 1676 → 8944（仍在升）
expect(r300.red).toBeLessThanOrEqual(r60.red + 2000)
expect(maxRadius).toBeLessThanOrEqual(6000)              // 基準 18188；開場半徑 5287

// ── 主判準二：撤退令要真的補到能量 ──
// 【為什麼是配對比較而不是絕對值】TAS／cornerRatio 是結果不是判準，訂一個
// 數字等於把飛行模型寫死在 AI 的測試裡。配對前後比的門檻是 0.5，沒有可調的
// 數字。與 ai-command-channel.test.ts 的「命令期間編隊收攏」同一個手法。
expect(pairs.length).toBeGreaterThan(0)                  // 沒有命令 = 沒有量到東西
expect(improved / pairs.length).toBeGreaterThan(0.5)

// ── 次判準 ──
expect(leavingShare).toBeGreaterThan(0.05)               // 基準 24.34%
expect(leavingShare).toBeLessThan(0.25)
expect(blueDmg + redDmg).toBeGreaterThanOrEqual(7345)    // 基準 9181 的八成，粗篩
```

**`console.log` 印出全部觀測值**，Task 5 要回填。

- [ ] **Step 3：跑，確認它紅**

```
npx vitest run test/integration/ai-withdraw-anchor.test.ts
```

預期：主判準一的三條大幅紅（`r300 − r60` 約 +7268、`maxRadius` 約 18188）。
其餘可能綠 —— **那沒關係，主判準紅就夠了**。

**若主判準也綠，停下來** —— 代表場景搭錯了（最可能是 `createBattle` 傳錯
controller，或秒數不夠）。先對回 spec §1 的那張表：`t=60s r≈1676`、
`t=240s r≈8944`。

- [ ] **Step 4：commit**

```
git add test/integration/ai-withdraw-anchor.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

commit message 要寫明「這一版是紅的，Task 2-3 才會轉綠」。

---

### Task 2：`CommandConfig` 換欄位 + `planFlightOrder` 換點算法

介面與實作合成一個 commit —— 中間狀態不編譯。

**Files**
- Modify: `src/ai/command.ts`（`CommandConfig` 約 `:82-115`、
  `DEFAULT_COMMAND` 約 `:270-290`、`planFlightOrder` 約 `:424-446`、
  舊掃描表註解 `:137-195`）
- Modify: `test/integration/ai-command-channel.test.ts:380`
- Test: `test/unit/ai-command.test.ts`

**Interfaces**
- Produces：`CommandConfig.spentRank: number`（新增，Task 3 才用到）；
  `CommandConfig.withdrawClimb` **刪除**；`planFlightOrder` 回傳型別不變，
  但**多了一條回 `null` 的路徑**。

- [ ] **Step 1：先改既有那條與新設計衝突的測試**

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
   * +2000 m 而 TAS 一直停在 110（spec §2.1）。
   *
   * 而且高度不能像水平那樣錨在敵群 —— 那會變成互相加價（紅爬到藍 +800，
   * 藍下一張就是紅 +800 = 原本的 +1600），一路頂到升限。垂直方向沒有
   * 「背對」這種把兩隊分開的自由度。
   *
   * 撤退要補的是**速度**（`cornerRatio` 是 TAS ÷ 角落速度），而爬升是消耗
   * 速度的動作。
   */
  it('撤退不改變高度', () => {
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    expect(o.point.y).toBeCloseTo(4000, 6)
  })
```

- [ ] **Step 2：加六條新測試**

加在 `describe('planFlightOrder：集合點給得對不對')` 裡。
`members` 在原點附近、`enemies` 在 +Z 1000 —— 所以 `d ≈ 1005`，在殼內。

```ts
  /** 【殼的半徑是「離敵群多遠」】舊設計是「離小隊自己多遠」，那是純積分器。 */
  it('集合點離敵群質心恰好 withdrawRange（水平）', () => {
    const o = planFlightOrder(members, enemies, SPENT, cfg)!
    const foe = new Vector3(50, 4000, 1000)   // 兩架敵機的質心
    expect(Math.hypot(o.point.x - foe.x, o.point.z - foe.z))
      .toBeCloseTo(cfg.withdrawRange, 3)
  })

  /**
   * 【棘輪的直接反例】把小隊搬到第一張的集合點上再發一次 —— 它已經在殼上，
   * 閘門必須擋掉，回 `null`。舊設計會再往外一個 withdrawRange。
   */
  it('連發兩張：第二張被閘門擋掉', () => {
    const foes = [unit({ z: 1000 })]
    const a = planFlightOrder(members, foes, SPENT, cfg)!
    const moved = [
      unit({ x: a.point.x, y: a.point.y, z: a.point.z }),
      unit({ x: a.point.x + 200, y: a.point.y, z: a.point.z }),
    ]
    expect(planFlightOrder(moved, foes, SPENT, cfg)).toBeNull()
  })

  /**
   * 【已經在殼外就不發令】它本來就脫離了，需要的是時間而不是一張把它送回
   * 敵人身邊的命令 —— 那正是 spec §3.1 記的兩個失敗之一。
   */
  it('已經在殼外的分隊不發撤退令', () => {
    const far = [unit({ z: -9000 }), unit({ z: -9000, x: 200 })]
    expect(planFlightOrder(far, [unit({ z: 1000 })], SPENT, cfg)).toBeNull()
  })

  /**
   * 【閘門的邊界：防空轉】行程若短於 arriveRadius，命令會在下一格就被判
   * 到達、`spent` 被歸零，飛機一步都沒動 —— 撤退機制在那一帶等於失效，
   * 而「多數命令要到得了」會變成假綠。
   */
  it('離殼只差不到 arriveRadius 時不發令', () => {
    const d = cfg.withdrawRange - cfg.arriveRadius + 1
    const near = [unit({ z: -d }), unit({ z: -d, x: 1 })]
    expect(planFlightOrder(near, [unit({ z: 0 })], SPENT, cfg)).toBeNull()
  })

  /**
   * 【低空：下界從死碼變活碼】舊設計要 own.y < −300 才咬得到 clearanceScale
   * （own.y + 800 < 500），等於永遠不觸發。新設計下任何 500 m 以下的分隊都會
   * 被抬上來 —— 也就是「撤退不改變高度」在低空是假的，這個分支要有測試。
   */
  it('低空時集合點被抬到 clearanceScale', () => {
    const low = [unit({ y: 200 }), unit({ y: 200, x: 200 })]
    const o = planFlightOrder(low, [unit({ y: 200, z: 1000 })], SPENT, cfg)!
    expect(o.point.y).toBeCloseTo(DEFAULT_STEER.clearanceScale, 6)
  })

  /**
   * 【敵群散開時剩下的不變式】spec §3.3：錨是敵**隊**質心，質心距離 3000 m
   * **不保證**最近的一架在武器射程外 —— 舊設計「相對自己再退 3 km」給的是
   * 實的保證，新設計換成一個對敵群分布的假設。真正還成立的只有這一條：
   * 集合點離敵群質心比分隊現在更遠（由 §3.1 的閘門保證）。
   */
  it('敵群沿撤退方向散開數公里時，集合點仍比分隊現在更遠離敵群質心', () => {
    const spread = [unit({ z: 1000 }), unit({ z: 4000 }), unit({ z: -2000 })]
    const o = planFlightOrder(members, spread, SPENT, cfg)!
    const foe = new Vector3(0, 4000, 1000)   // 三架的質心
    const own = new Vector3(100, 4000, 0)
    expect(Math.hypot(o.point.x - foe.x, o.point.z - foe.z))
      .toBeGreaterThan(Math.hypot(own.x - foe.x, own.z - foe.z))
  })
```

- [ ] **Step 3：跑，確認它們紅**

```
npx vitest run test/unit/ai-command.test.ts
```

預期紅：`撤退不改變高度`（舊值 4800）、`集合點離敵群質心恰好 withdrawRange`
（舊值 4001）、`連發兩張：第二張被閘門擋掉`（舊設計回一張點在 3014 m 外的
命令）、`已經在殼外的分隊不發撤退令`、`離殼只差不到 arriveRadius 時不發令`、
`低空時集合點被抬到 clearanceScale`（舊值 1000）。

`敵群散開` 那條**舊設計也會綠**（往外推一定更遠）—— 它是不變式的紀錄，
不是新行為的驗證。這一點要寫進它的註解。

- [ ] **Step 4：改介面**

`CommandConfig` 裡刪掉

```ts
  /** 集合點比小隊質心高多少，m */
  withdrawClimb: number
```

`withdrawRange` 的註解換成新語意：

```ts
  /**
   * 集合點離**敵群質心**多遠，m。分隊已經在殼外（含 `arriveRadius` 的閘門
   * 寬度）時**不發令**。
   *
   * 【語意在 2026-08-09 改過】舊版是「離**小隊自己**多遠」，那讓撤退變成
   * 一個沒有不動點的純積分器 —— 每撤一次就再往外 3 km，實測 300 秒漂到
   * 平均 9 km、最大 18 km。錨在敵群 + 殼外不發令之後，映射是
   * 「殼內 → 殼上、殼外 → 不動」，單調且非擴張。
   *
   * 【與 `arriveRadius` 不獨立】閘門寬度就是 `arriveRadius`，兩者要一起掃。
   */
  withdrawRange: number
```

`spentSeconds` 後面加：

```ts
  /**
   * 見底取分隊 `cornerRatio` 由低到高第幾個。0 = 最低（2026-08-09 之前的
   * 行為），1 = 次低。**存活**人數不足時夾到最後一個。
   *
   * 【為什麼需要它】四機小隊的最小值遠低於中位數。實測 `< 0.6` 的時間佔比：
   * 最低 30.6%、次低 10.5%、中位數 2.1% —— 一架落單掉速的僚機就足以把整支
   * 分隊拖出戰場三成的時間。
   *
   * 【它修改了一條既有裁定】spec §2.4「編隊的能力等於最弱的那一架」被限縮
   * 成「**進攻**能力等於最弱的那一架」；「整支分隊該不該離場」改由第
   * `spentRank` 弱的那一架決定。`spentRank = 0` 時裁定原封不動。
   *
   * 【戰損中會自然退化】對存活人數夾限，所以剩 1~2 架時退回「取最低」——
   * 兩架的分隊裡「最弱的那一架」確實就是它的能力。
   *
   * 【為什麼是名次不是分位數】分隊固定 4 人，名次是整數、可窮舉、寫得進
   * 測試；4 個樣本的分位數插值只會製造一個沒有人看得懂的數字。
   */
  spentRank: number
```

`DEFAULT_COMMAND` 裡刪掉 `withdrawClimb: 800`，加上 `spentRank: 0`
（**先留 0，Task 5 才由掃描定值**）。

`DEFAULT_COMMAND` 上方的舊掃描表（約 `:137-195`）：
- 刪掉 `withdrawClimb` 那四列與 §「起始值當初的來歷」中它那一段。
- `withdrawRange` 那四列保留但**加一行標註它已失效**（語意變了，量的是
  另一個東西），並刪掉「`extendRange` 的兩倍」那個理由。

- [ ] **Step 5：修 `ai-command-channel.test.ts:380`**

那一行在 `it.skip` 的掃描迴圈裡：

```ts
      restore(); DEFAULT_COMMAND.withdrawClimb = v; report('withdrawClimb', v)
```

整列刪掉（連同它上面那個 `for (const v of [...])`）。**不要留成註解** ——
`tsconfig` 的 `include` 含 `"test"`，留著會讓 `npx tsc --noEmit` 紅。

- [ ] **Step 6：改實作**

`planFlightOrder` 的「方向」那一段之後、「高度」之前，插入閘門；並換掉
高度與 `return`：

```ts
  dir.divideScalar(len)

  // ── 閘門：已經在殼外（含閘門寬度）就不發令 ──────────────
  // 【為什麼需要它】行程長度是 |withdrawRange − len|。少了閘門有兩個失敗：
  //
  //   len ∈ 殼 ± arriveRadius → 行程短於到達半徑，命令在**下一格**就被判
  //     到達（`stepCommand` 的 rally 分支）、`spent` 被歸零，飛機一步都沒動
  //     —— 撤退在那一帶等於失效，而「多數命令要到得了」會變成假綠。
  //   len > 殼 → 「撤退令」會把一支 intent 被壓成 rally、不開火、僚機被清
  //     目標的四機編隊沿徑向直線送回敵群。那正是要救的分隊。
  //
  // 閘門把兩者一起解掉：發令的前提是「真的有一段往外的行程」。已經在殼外
  // 的分隊本來就脫離了，它需要的是時間，而那由自由交戰給。
  if (len >= cfg.withdrawRange - cfg.arriveRadius) return null

  // ── 高度：撤退不改變高度，只夾在安全下界與最低升限之間 ────
  // 【為什麼不加碼】見 spec §3.2：垂直方向錨在敵群會變成互相加價，一路頂到
  // 升限；而撤退要補的是**速度**（`cornerRatio` 是 TAS ÷ 角落速度），爬升
  // 是消耗速度的動作。實測舊設計四分鐘爬了 2000 m 而 TAS 一直停在 110。
  //
  // 【下界取 clearanceScale（500）而不是安全層的 clearance（120）】政策層
  // 不該把飛機送進硬限制的作用區。與 task #136 的六場護欄取同一條線。
  //
  // 【這道下界從此是活碼】舊設計要 own.y < −300 才咬得到，等於永遠不觸發。
  //
  // 【目前海面恆為 0】未來加入地形時這裡要與 `stationPoint` 一樣收
  // `seaHeight`，下界改成 `seaHeight + clearanceScale`。
  let y = own.y
  if (y > ceiling) y = ceiling
  if (y < DEFAULT_STEER.clearanceScale) y = DEFAULT_STEER.clearanceScale

  return {
    kind: 'rally',
    // 【錨在敵群，不是自己】見 spec §3.1。錨在自己的話位移量與「已經跑多遠」
    // 無關 —— 那是一個沒有不動點的純積分器。錨在敵群之後這是一個固定的球殼，
    // 而且撤退本身不移動錨點（敵群質心不因我方撤退而動）。
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

**注意 `len` 這個變數**：它在退化階梯裡被重新賦值過（敵我水平重合時改用
速度方向），那時 `len` 是**速度的長度**不是距離。閘門要用的是**距離**，
所以必須在退化階梯**之前**另外算一個水平距離，或在階梯裡把距離另存一份。
實作時請新增一個 `const gap = Math.hypot(own.x - foe.x, own.z - foe.z)`，
閘門用 `gap`，方向仍然用 `dir`／`len`。

- [ ] **Step 7：跑，確認轉綠**

```
npx vitest run test/unit/ai-command.test.ts
npx tsc --noEmit
```

既有的「不超過最低升限」「不會叫人撞海」「往遠離敵群的方向走」「不會叫人
穿過敵群」「半徑是正數」「退化與穩定性」**必須維持綠**。

**`不會叫人穿過敵群` 要補一句註解**：它現在是真的不變式（閘門保證發令時
分隊必在殼內），不再是「剛好那個場景在殼內」的特例。

任何一條紅了 → 停下來報告，不要改測試。

- [ ] **Step 8：commit**

```
git add src/ai/command.ts test/unit/ai-command.test.ts test/integration/ai-command-channel.test.ts
git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"
```

---

### Task 3：`stepCommand` 的見底取名次

**Files**
- Modify: `src/ai/command.ts:912-920` 與模組層暫存的宣告區
- Test: `test/unit/ai-command.test.ts`

**Interfaces**
- Consumes：`CommandConfig.spentRank`（Task 2）
- Produces：`spentRank = 0` 時行為**逐位元不變**

- [ ] **Step 1：先改 `scene()`，讓五條既有測試與名次無關**

`test/unit/ai-command.test.ts:210-218` 目前是

```ts
  function scene(cornerRatio: number) {
    const units: CommandUnit[] = [
      unit({ cornerRatio }), unit({ x: 200, cornerRatio: 1.2 }), unit({ z: 1000 }),
    ]
```

第二架寫死 1.2。`spentRank = 1` 之下次低就是 1.2 → 永遠不見底 → 依賴它的
五條（`健康的小隊永遠不發令` 之後那五條）全部會紅。

**兩架都用參數值**：

```ts
  /**
   * 【兩架都用同一個 cornerRatio】原本第二架寫死 1.2，那讓這一組測試意外
   * 依賴「見底取最低那一架」。`spentRank` 出現之後那是一個隱藏的耦合 ——
   * 這五條要測的是命令的**生命週期**，不是取樣名次。取樣名次由
   * `describe('見底的取樣名次')` 專門測。
   *
   * 這不是放寬門檻：每一條原本要驗的東西一字未動，只是把場景從「意外依賴
   * 名次」改成「不依賴」。
   */
  function scene(cornerRatio: number) {
    const units: CommandUnit[] = [
      unit({ cornerRatio }), unit({ x: 200, cornerRatio }), unit({ z: 1000 }),
    ]
```

跑一次確認五條仍綠（`spentRank` 此時還是 0，本來就該綠）。

- [ ] **Step 2：寫會紅的測試**

**新的 `describe`，自備場景與一個吃 `cfg` 的 `run`** —— 既有的 `scene`／`run`
宣告在 `describe('stepCommand：命令的生命週期')` 的 callback 內部，外層取不到，
而且 `run` 把 `cfg` 寫死成模組層的 `DEFAULT_COMMAND`。

**絕對不要寫 `DEFAULT_COMMAND.spentRank = 1`** —— `cfg` 是同一個物件參考，
那會洩漏到同檔後面所有測試，造成與執行順序相關的偽紅／偽綠。

```ts
/**
 * 【為什麼要能不看最低那一架】四機小隊的最小值遠低於中位數。20v20 × 300 s
 * 實測 `cornerRatio < 0.6` 的時間佔比：最低 30.6%、次低 10.5%、中位數 2.1%
 * —— 一架落單掉速的僚機就足以把整支分隊拖出戰場三成的時間（spec §2.2）。
 */
describe('見底的取樣名次', () => {
  /** 兩架我方（ratio 各自指定）+ 一架敵機。回傳 stepCommand 要的一整組。 */
  function rankScene(a: number, b: number) {
    const units: CommandUnit[] = [
      unit({ cornerRatio: a }), unit({ x: 200, cornerRatio: b }), unit({ z: 1000 }),
    ]
    const flights = [flight(0, 1), flight(2)]
    const s = createCommandState(flights.length)
    return { units, flights, s, own: [0], foe: [1] }
  }
  function runWith(sc: ReturnType<typeof rankScene>, seconds: number, c: CommandConfig) {
    const steps = Math.round(seconds / DT)
    for (let i = 0; i < steps; i++) {
      stepCommand(sc.s, sc.flights, sc.own, sc.foe, sc.units, -1, DT, c)
    }
  }
  const rank1: CommandConfig = { ...cfg, spentRank: 1 }

  it('spentRank = 1 時，只有一架見底不發令', () => {
    const sc = rankScene(0.3, 1.2)
    runWith(sc, 30, rank1)
    expect(sc.s.orders[0]).toBeNull()
  })

  /**
   * 【這是正控制，預期綠】舊實作取最低值，兩架都 0.3 時最低也是 0.3，
   * 照樣發令。它守的是「上一條不是用錯誤的方式變綠的」，不是新行為。
   */
  it('spentRank = 1 時，兩架見底才發令', () => {
    const sc = rankScene(0.3, 0.3)
    runWith(sc, 30, rank1)
    expect(sc.s.orders[0]).not.toBeNull()
  })

  it('spentRank 超出存活人數時夾到最後一個，不丟例外', () => {
    const sc = rankScene(0.3, 0.3)
    expect(() => runWith(sc, 30, { ...cfg, spentRank: 9 })).not.toThrow()
    // 兩架都 0.3 → 夾到最後一個（也是 0.3）→ 仍然要發令
    expect(sc.s.orders[0]).not.toBeNull()
  })
})
```

**場景的距離要對**：`rankScene` 的敵機在 `z = 1000`，`d ≈ 1000 < 2700`，
在殼內，閘門不會擋。若把敵機挪遠，這一組會因為閘門而全部回 `null` —— 那時
測到的是閘門不是名次。

- [ ] **Step 3：跑，確認第一條紅、第二條綠**

```
npx vitest run test/unit/ai-command.test.ts -t '見底的取樣名次'
```

第三條可能綠（`noUncheckedIndexedAccess` 之下讀越界是 `undefined`，比較
是 false → 不發令 → 第二個 `expect` 紅）。**先看它到底紅在哪一行**再決定。

- [ ] **Step 4：改實作**

模組層暫存，與既有的 `MEMBERS` / `FOES` / `TARGET` 放同一區：

```ts
/** 見底排序用的模組層暫存。熱路徑：不配置。 */
const RATIOS: number[] = []
```

見底計時那一段（`command.ts:912-920`）換成：

```ts
    // ── 見底計時：小隊裡第 `spentRank` 低的那一架 ──────────
    // 【為什麼不是恆取最低】見 `CommandConfig.spentRank`：四機小隊的最小值
    // 遠低於中位數，一架落單掉速的僚機就能把整支分隊拖出戰場。
    //
    // 【為什麼是插入排序不是 Array.sort】分隊最多 4 人，而這一段每 dt 都跑
    // 一次（40 架 × 240 Hz）。`sort` 會配置 —— 熱路徑不得配置。
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
    // 【空的時候是 Infinity】與舊碼的 `let worst = Infinity` 逐位元等價 ——
    // 成員全部陣亡時不該累積見底
    const rank = RATIOS.length === 0
      ? Infinity
      : RATIOS[Math.min(cfg.spentRank, RATIOS.length - 1)]!
    if (rank < cfg.spentRatio) s.spent[f] = s.spent[f]! + dt
    else s.spent[f] = 0
```

- [ ] **Step 5：跑，確認轉綠且既有全綠**

```
npx vitest run test/unit/ai-command.test.ts
npx tsc --noEmit
```

- [ ] **Step 6：mutation 驗證夾限**

把 `Math.min(cfg.spentRank, RATIOS.length - 1)` 改成 `cfg.spentRank`，
確認第三條轉紅。**改回來**再 commit。

- [ ] **Step 7：跑護欄**

```
npx vitest run test/integration/ai-withdraw-anchor.test.ts
```

**主判準應該轉綠。** 次判準若紅：

- `leavingShare > 0.25` → **停下來報告**，spec §4 預告的處置是回頭加不應期，
  那是要先被批准的設計決定。
- `leavingShare < 0.05` 或 `pairs.length === 0` → 閘門擋掉太多，**停下來
  報告**，不要調閘門寬度。
- 掉血 < 7345 → 停下來報告。

- [ ] **Step 8：commit**

---

### Task 4：`ai-command-channel` 與其他既有整合測試

**Files**
- 只跑，不改（除非真的紅）

- [ ] **Step 1：單獨跑三支**

```
npx vitest run test/integration/ai-command-channel.test.ts
npx vitest run test/integration/ai-command-decision.test.ts
npx vitest run test/integration/multi-battle.test.ts
```

**特別看 `ai-command-channel` 的兩條零餘裕斷言**：`groundUnderOrder === 0`
（`:291`）與 `belowClearance === 0`（`:295`）。舊的 `+800` 保證了集合點恆在
分隊之上，拿掉之後它們有實質風險，而舊掃描表記錄過「撤退令的高度處理不當
→ 撞地接管 95~153 次」的先例。

- [ ] **Step 2：紅了怎麼辦**

**先量、先報告、不要改門檻。** `groundUnderOrder` 若從 0 變成非 0，那是
設計缺口不是雜訊 —— 可能要在 §3.2 的下界之外再給撤退一個「不得低於分隊
當下高度」的地板。那是一個設計決定，要先被批准。

- [ ] **Step 3：綠了就記錄數字，進 Task 5**

---

### Task 5：掃描 `withdrawRange` 與 `spentRank`，回填

**Files**
- Create → Delete: `test/integration/_scan.test.ts`（跑完刪掉）
- Modify: `src/ai/command.ts`（`DEFAULT_COMMAND` 兩個值 + 掃描表註解）
- Modify: `docs/superpowers/specs/2026-08-09-withdraw-anchor-design.md`

- [ ] **Step 1：掃描**

暫時的 scratch 放 **`test/integration/`**（不是 `test/unit/`）—— 六場
20v20 × 300 s，unit 目錄沒有那些長 timeout 的慣例，忘了刪會拖垮 Task 6。

```
withdrawRange ∈ {2000, 3000, 4500}
spentRank     ∈ {0, 1}
```

每一組記錄 Task 1 的**全部**觀測值，不只斷言用的那幾個。

- [ ] **Step 2：選值**

依序：
1. 主判準一（半徑）與主判準二（能量配對）必須過。
2. `leavingShare` 落在 5%~25%。
3. 總掉血愈高愈好。
4. 「撤退令期間陣亡的架數」愈低愈好 —— 它是「送人頭」那個失敗模式的觀測量。
5. 傷害比只記錄不比較（`ai-command-decision.test.ts:144-172` 已裁定這把尺
   解析不了 10% 的效果）。

**若多組並列，取語意最單純的**（`withdrawRange` 3000、`spentRank` 0）。
`spentRank` 若選 0，spec §4 那條「修改既有裁定」的說明要改成「掃描結果是
裁定原封不動」。

- [ ] **Step 3：把掃描表寫進 `DEFAULT_COMMAND` 上方**

格式照抄既有那兩張表，並寫明**這張表是在新語意下量的，與 2026-08-07 那張
不可比**。

- [ ] **Step 4：回填 spec §5 的參數表與 §8 的觀測值**

修前修後的半徑、高度、TAS、掉血、`leavingShare`、能量配對比例各一行。

- [ ] **Step 5：刪掉 scratch，commit**

```
git rm test/integration/_scan.test.ts     # 若曾 add
git add src/ai/command.ts docs/superpowers/specs/2026-08-09-withdraw-anchor-design.md
```

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
**任何其他紅都要先量、先報告** —— 移動了要判斷是「AI 變好了」還是「護欄
被打壞了」，不是直接改數字。

- [ ] **Step 3：單獨跑兩個**（先關掉 dev server）

```
npx vitest run test/unit/perf-gate.test.ts
npx vitest run test/integration/rematch.test.ts
```

- [ ] **Step 4：手動試飛**

重開 dev server，請專案負責人確認敵機不再在戰場周圍上下繞。
