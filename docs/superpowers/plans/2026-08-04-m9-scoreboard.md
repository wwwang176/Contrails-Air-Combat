# M9 戰績與接手僚機 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓一場遭遇戰有結果（勝／敗），並記錄每一位飛行員的擊墜、陣亡與助攻；玩家陣亡改為接手僚機而不是無限重生。

**Architecture:** 擊墜歸屬留在 `src/world/`（誰打死誰、誰在窗口內打過），飛行員名冊與接手邏輯留在 `src/battle/`（誰是誰、誰接誰），呈現留在 `src/ui/`（DOM 表格）。三層之間只靠座位索引溝通 —— 這是既有程式碼裡所有歸屬資訊已經在用的鍵。

**Tech Stack:** TypeScript 5.7、three.js 0.180、Vite 6、Vitest 2.1（node 環境）。無 UI 框架、無新相依。

**Spec:** `docs/superpowers/specs/2026-08-04-m9-scoreboard-design.md`

## Global Constraints

- 所有註解、提交訊息、文件一律**繁體中文**。
- 註解寫**為什麼**，不寫做什麼。既有程式碼用【】標記關鍵理由，跟著這個格式。
- **不寫飛機外形的測試。**
- **不碰 `DifficultyProfile`** —— 難度調整已明確延後，`ACE` 的兩個欄位維持 0。
- 提交一律**列出明確路徑**，絕不用 `git add -A`（`bash.exe.stackdump` 是被追蹤且早已修改的檔案，會被誤帶進去）。
- 每一條新測試都要**先確認它會紅**再實作。門檻不合就找出真正原因，**絕不放寬門檻讓它過**。
- `src/world/` **不得 import `src/render/`**（既有的分層約束）。
- 效能閘門（`test/unit/perf-gate.test.ts`）在整套並行跑時偶爾會閃紅。單獨跑 `npx vitest run test/unit/perf-gate.test.ts` 全過即可視為並行雜訊，**不要為此調整門檻**。
- `noUncheckedIndexedAccess` 是開的：所有陣列索引存取都要 `!` 或先判空。
- 純函數與 DOM 工廠可以放同一個檔（`hud/widgets/*.ts` 已是這個做法），但**模組載入時不得碰 DOM**，否則 node 環境的測試會炸。

---

## 檔案結構

**新增**

| 檔案 | 職責 |
|---|---|
| `src/world/assists.ts` | `ASSIST_WINDOW` 與純函數 `assistCredits` —— 從傷害時刻表掃出該記助攻的座位 |
| `src/battle/names.ts` | `Faction`、`factionOf`、`mulberry32`、兩份名冊、`pilotNames` |
| `src/battle/pilots.ts` | `Pilot`、`Roster`、`createRoster`、`swapPilots`、`recordKill` |
| `src/battle/takeover.ts` | 純函數 `pickTakeover` —— 選接手目標 |
| `src/ui/scoreboard.ts` | 純函數 `scoreRows` / `sortScoreRows` ＋ DOM 工廠 `createScoreboard` |

**修改**

| 檔案 | 改什麼 |
|---|---|
| `src/world/kills.ts` | `KILL_STRIDE` 7 → 8，第 8 欄是兇手 |
| `src/world/World.ts` | `time`、`damageTime`、`damageStride`、`destroy` 收兇手、`add` 重配、`respawn` 清欄、`clearDamageLog` |
| `src/battle/setup.ts` | `Outcome`、名冊、擊墜與助攻記錄、接手狀態機、`player` 改可寫、移除倒數 |
| `src/hud/types.ts` | 移除 `HudFrame.resetCountdown` |
| `src/hud/widgets/roster.ts` | 移除 `countdownLabel` 與倒數那一段繪製 |
| `src/input/InputState.ts` | 新增 `scoreboardHeld` |
| `src/input/bindings.ts` | Tab 按住／放開 |
| `src/main.ts` | 移除死亡即重生、接手時的視覺轉移、記分板與橫幅接線 |
| `index.html` | 記分板與橫幅的 DOM 與 CSS |

**測試檔**

| 檔案 | 動作 |
|---|---|
| `test/unit/kills.test.ts` | 改 stride 斷言、加兇手欄 |
| `test/unit/world.test.ts` | 加擊墜歸屬、世界時鐘、傷害時刻表 |
| `test/unit/assists.test.ts` | 新增 |
| `test/unit/names.test.ts` | 新增 |
| `test/unit/pilots.test.ts` | 新增 |
| `test/unit/takeover.test.ts` | 新增 |
| `test/unit/scoreboard.test.ts` | 新增 |
| `test/unit/battle-setup.test.ts` | 倒數三條改成 outcome；加名冊、接手、重開復原 |
| `test/unit/hud.test.ts` | 刪 `countdownLabel` 那一組與 `resetCountdown` 斷言 |
| `test/unit/bindings.test.ts` | 加 Tab |
| `test/integration/multi-battle.test.ts` | 移除 `resets` 觀測與倒數測試；加守恆律與 2v2 分勝負 |

---

### Task 1: 擊墜事件帶著兇手

**Files:**
- Modify: `src/world/kills.ts`
- Modify: `src/world/World.ts`（`applyDamage`、`destroy`）
- Test: `test/unit/kills.test.ts`、`test/unit/world.test.ts`

**Interfaces:**
- Consumes: 無
- Produces: `KILL_STRIDE = 8`；`pushKill(e, x, y, z, vx, vy, vz, index, killer?: number)`，第 8 欄 `data[o + 7]` 是兇手座位索引，−1 表示無兇手；`World.destroy(c: Combatant, killer?: Combatant)`

- [ ] **Step 1: 改既有的 stride 斷言並加新測試**

`test/unit/kills.test.ts` —— 把兩處既有斷言改掉：

```ts
    expect(KILL_STRIDE).toBe(8)
```

```ts
    expect(Array.from(e.data.slice(0, KILL_STRIDE))).toEqual([1, 2, 3, 10, 20, 30, 7, -1])
```

（第二處原本是 `pushKill(e, 1, 2, 3, 10, 20, 30, 7)` 之後比對七個值，現在多一個預設的 −1。）

在 `describe('擊墜事件的緩衝'…)` 或檔案裡對應的 describe 內加一條：

```ts
  it('第八欄是兇手的座位索引，省略時是 −1', () => {
    // 【為什麼要有「省略時是 −1」】撞海與自摔走的是不帶兇手的那條路徑。
    // 預設值若是 0，每一次自摔都會變成第 0 座位的擊墜。
    const e = createKills(2)
    pushKill(e, 1, 2, 3, 10, 20, 30, 7, 4)
    pushKill(e, 0, 0, 0, 0, 0, 0, 1)
    expect(e.data[7]).toBe(4)
    expect(e.data[KILL_STRIDE + 7]).toBe(-1)
  })
```

- [ ] **Step 2: 跑測試確認會紅**

Run: `npx vitest run test/unit/kills.test.ts`
Expected: FAIL —— `expected 7 to be 8`

- [ ] **Step 3: 改 `src/world/kills.ts`**

把 `KILL_STRIDE` 改成 8，並在它的註解末尾加一段：

```ts
/**
 * （既有註解保留）
 *
 * 【M9 加到 8】第 8 欄是兇手的座位索引。擊墜歸屬需要「誰打死的」，而
 * 「誰死了」這件事已經有一個緩衝在傳 —— 再開一個平行的緩衝就是兩份要
 * 同步的真相（M9 spec §4.2）。
 */
export const KILL_STRIDE = 8
```

`KillEvents.data` 的註解改成：

```ts
  /** 每筆 `KILL_STRIDE` 個 float：x, y, z, vx, vy, vz, combatant 索引, 兇手索引（−1 = 無） */
```

`pushKill` 加一個有預設值的參數並寫入：

```ts
export function pushKill(
  e: KillEvents,
  x: number, y: number, z: number,
  vx: number, vy: number, vz: number,
  index: number,
  killer = -1,
): void {
  if (e.count >= e.capacity) {
    e.dropped++
    return
  }
  const o = e.count * KILL_STRIDE
  const d = e.data
  d[o] = x
  d[o + 1] = y
  d[o + 2] = z
  d[o + 3] = vx
  d[o + 4] = vy
  d[o + 5] = vz
  d[o + 6] = index
  d[o + 7] = killer
  e.count++
}
```

【為什麼用預設參數而不是必填】`debris.test.ts`、`fireball.test.ts`、`smoke.test.ts` 裡有數十處 `pushKill(...)` 只傳七個引數，那些測試關心的不是兇手。預設值讓它們原封不動繼續成立。

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run test/unit/kills.test.ts`
Expected: PASS

- [ ] **Step 5: 寫 `World` 的歸屬測試**

`test/unit/world.test.ts` 檔尾加：

```ts
describe('擊墜歸屬（M9 spec §4）', () => {
  it('被打爆時，事件帶著兇手的座位索引', () => {
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    const b = w.add(new Aircraft(BF109G6), new Fixed(), 'red', new Vector3(0, 0, -800))
    w.applyDamage(b, 99999, 'fuselage', a)
    expect(w.killEvents.count).toBe(1)
    expect(w.killEvents.data[6]).toBe(b.index)
    expect(w.killEvents.data[7]).toBe(a.index)
  })

  it('兇手是第 0 座位時也記得住', () => {
    // 【為什麼特別測 0】`killer ? killer.index : -1` 這種寫法在索引為 0 時
    // 會把真正的兇手寫成 −1。要判斷的是「有沒有射手」，不是索引的真假值。
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    const b = w.add(new Aircraft(BF109G6), new Fixed(), 'red', new Vector3(0, 0, -800))
    expect(a.index).toBe(0)
    w.applyDamage(b, 99999, 'fuselage', a)
    expect(w.killEvents.data[7]).toBe(0)
  })

  it('撞海不算任何人的擊墜 —— 兇手欄是 −1', () => {
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    w.destroy(a)
    expect(w.killEvents.count).toBe(1)
    expect(w.killEvents.data[7]).toBe(-1)
  })
})
```

- [ ] **Step 6: 跑測試確認會紅**

Run: `npx vitest run test/unit/world.test.ts`
Expected: FAIL —— 兇手欄讀到 0（`data` 的初值）而不是 `a.index` / −1

- [ ] **Step 7: 改 `src/world/World.ts`**

`applyDamage` 把射手傳下去：

```ts
    victim.hp -= damage * PART_MULTIPLIER[part]
    if (shooter) shooter.hitsDealt++
    if (victim.hp > 0) return

    this.destroy(victim, shooter)
```

`destroy` 收兇手：

```ts
  /**
   * 退場。被打爆與撞地走同一條路徑（spec §7）。
   *
   * （既有註解保留）
   *
   * 【`killer` 省略＝沒有人的功勞】撞海與自摔走的就是這一條。事件的兇手欄
   * 寫 −1，記分板於是不會把它算給任何人（M9 spec §4.1）。
   */
  destroy(c: Combatant, killer?: Combatant): void {
    c.hp = 0
    if (c.respawnOnDestroy) {
      this.respawn(c)
      return
    }
    const p = c.aircraft.state.position
    const v = c.aircraft.state.velocity
    // 【判物件而不是判索引】索引 0 是合法的兇手，`killer ? ... : -1` 會把
    // 第 0 座位的擊墜寫成「無兇手」
    pushKill(
      this.killEvents, p.x, p.y, p.z, v.x, v.y, v.z, c.index,
      killer === undefined ? -1 : killer.index,
    )
    c.alive = false
  }
```

- [ ] **Step 8: 跑測試確認轉綠**

Run: `npx vitest run test/unit/world.test.ts test/unit/kills.test.ts test/unit/debris.test.ts test/unit/fireball.test.ts test/unit/smoke.test.ts`
Expected: 全 PASS

- [ ] **Step 9: 提交**

```bash
git add src/world/kills.ts src/world/World.ts test/unit/kills.test.ts test/unit/world.test.ts
git commit -m "feat: 擊墜事件帶著兇手的座位索引"
```

---

### Task 2: 世界時鐘與傷害時刻表

**Files:**
- Modify: `src/world/World.ts`
- Test: `test/unit/world.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `destroy(c, killer?)`
- Produces: `World.time: number`（每個 `step` 累加）；`World.damageTime: Float32Array`；`World.damageStride: number`；`World.clearDamageLog(): void`。索引式 `damageTime[攻擊者 * damageStride + 受害者]`，初值 `-Infinity`

- [ ] **Step 1: 寫測試**

`test/unit/world.test.ts` 檔尾加：

```ts
describe('世界時鐘與傷害時刻表（M9 spec §5.1）', () => {
  it('時鐘隨 step 累加', () => {
    const w = new World()
    w.add(new Aircraft(P51D, 4000, 200), new Fixed(), 'blue', new Vector3(0, 4000, 0))
    expect(w.time).toBe(0)
    w.step(DT)
    w.step(DT)
    expect(w.time).toBeCloseTo(DT * 2, 9)
  })

  it('表格的初值是 −Infinity', () => {
    // 【為什麼不能是 0】世界時間從 0 開始。用 0 當「沒打過」等於宣稱每個人
    // 在 t=0 都打過每個人，於是第一次擊墜會發出滿場的助攻。
    const w = new World()
    w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    w.add(new Aircraft(BF109G6), new Fixed(), 'red', new Vector3(0, 0, -800))
    for (let i = 0; i < w.damageTime.length; i++) {
      expect(w.damageTime[i]).toBe(-Infinity)
    }
  })

  it('表格的邊長跟著參戰架數長', () => {
    const w = new World()
    for (let i = 0; i < 5; i++) {
      w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3(i * 100, 0, 0))
    }
    expect(w.damageStride).toBe(5)
    expect(w.damageTime.length).toBe(25)
  })

  it('命中會記下當時的世界時間', () => {
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    const b = w.add(new Aircraft(BF109G6), new Fixed(), 'red', new Vector3(0, 0, -800))
    w.time = 12.5
    w.applyDamage(b, 10, 'wingLeft', a)
    expect(w.damageTime[a.index * w.damageStride + b.index]).toBeCloseTo(12.5, 4)
    // 反向沒有被寫到
    expect(w.damageTime[b.index * w.damageStride + a.index]).toBe(-Infinity)
  })

  it('沒有射手的傷害不寫表格', () => {
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    w.time = 3
    w.applyDamage(a, 10, 'fuselage')
    for (let i = 0; i < w.damageTime.length; i++) {
      expect(w.damageTime[i]).toBe(-Infinity)
    }
  })

  it('重生清掉打過它的那一欄', () => {
    // 【為什麼】不清的話，重生後的第一次擊墜會把上一條命的攻擊者算進助攻。
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    const b = w.add(new Aircraft(BF109G6), new Fixed(), 'red', new Vector3(0, 0, -800))
    w.time = 5
    w.applyDamage(b, 10, 'fuselage', a)
    w.respawn(b)
    expect(w.damageTime[a.index * w.damageStride + b.index]).toBe(-Infinity)
  })

  it('clearDamageLog 把整張表清成 −Infinity', () => {
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    const b = w.add(new Aircraft(BF109G6), new Fixed(), 'red', new Vector3(0, 0, -800))
    w.time = 5
    w.applyDamage(b, 10, 'fuselage', a)
    w.clearDamageLog()
    for (let i = 0; i < w.damageTime.length; i++) {
      expect(w.damageTime[i]).toBe(-Infinity)
    }
  })
})
```

- [ ] **Step 2: 跑測試確認會紅**

Run: `npx vitest run test/unit/world.test.ts`
Expected: FAIL —— `w.time` / `w.damageTime` 不存在（TypeScript 也會報錯）

- [ ] **Step 3: 實作**

`src/world/World.ts` 的 class 欄位區（`killEvents` 底下）加：

```ts
  /**
   * 世界時鐘，s。每個 `step` 開頭累加。
   *
   * 【為什麼世界要有自己的時鐘】助攻的時間窗口需要一個單調的時間基準，而
   * `main.ts` 的 `elapsed` 是**幀**的時間、還會被慢動作縮放（試驗場就有）。
   * 判定用的東西不該掛在畫面那一側。
   */
  time = 0

  /**
   * `damageTime[攻擊者 * damageStride + 受害者]` = 最後一次命中的世界時間。
   * 初值 `-Infinity`。
   *
   * 【為什麼是完整的 N×N 而不是每架一份清單】20v20 是 1,600 個 float，
   * 一次性配置；查一個「a 有沒有在窗口內打過 v」是 O(1)，而擊墜時掃一欄
   * 是 O(N)。清單版本要維護新增與過期，換來的只是省下幾 KB。
   *
   * 【為什麼初值不是 0】世界時間從 0 開始 —— 0 會被讀成「t=0 打過」
   * （M9 spec §5.1）。
   */
  damageTime = new Float32Array(0)

  /**
   * `damageTime` 的邊長。**等於配置當時的參戰架數。**
   *
   * 【為什麼公開】`stepBattle` 掃助攻時要用它當索引乘數。用
   * `combatants.length` 在組裝完成後恆等，但那是一個沒有東西保護的巧合。
   */
  damageStride = 0
```

`add()` 在 `killEvents` 那段之後加：

```ts
    // 【重配就整張清掉】`add` 只發生在場景組裝期，那時還沒有任何傷害。
    // 邊長一變，舊資料的索引全部失效 —— 搬移是一個沒有人會需要的功能。
    if (this.damageStride < this.combatants.length) {
      const n = this.combatants.length
      this.damageStride = n
      this.damageTime = new Float32Array(n * n).fill(-Infinity)
    }
```

`step()` 第一行：

```ts
  step(dt: number): void {
    // 【時鐘先走】這一步之內記下的命中時刻屬於這一步的結束時間，
    // 而同一步之內發生的擊墜用同一個 `time` 判窗口 —— 兩者一致。
    this.time += dt

    // 1. 各控制器產生指令
```

`applyDamage` 記時刻：

```ts
    victim.hp -= damage * PART_MULTIPLIER[part]
    if (shooter) {
      shooter.hitsDealt++
      this.damageTime[shooter.index * this.damageStride + victim.index] = this.time
    }
    if (victim.hp > 0) return

    this.destroy(victim, shooter)
```

`respawn` 清欄：

```ts
  respawn(c: Combatant): void {
    c.aircraft.reset(c.spawnAltitude, c.spawnTas)
    c.aircraft.state.position.copy(c.spawnPosition)
    c.aircraft.prevPosition.copy(c.spawnPosition)
    c.hp = c.aircraft.spec.hp
    c.cooldowns.fill(0)
    c.hitsDealt = 0
    c.alive = true
    // 【上一條命的傷害紀錄要作廢】不清的話，重生後的第一次擊墜會把上一條
    // 命的攻擊者算進助攻（M9 spec §5.2）
    const n = this.damageStride
    for (let a = 0; a < n; a++) this.damageTime[a * n + c.index] = -Infinity
  }
```

class 末尾加：

```ts
  /** 整張傷害時刻表歸位。整場重開時用。 */
  clearDamageLog(): void {
    this.damageTime.fill(-Infinity)
  }
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run test/unit/world.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/world/World.ts test/unit/world.test.ts
git commit -m "feat: World 的世界時鐘與傷害時刻表"
```

---

### Task 3: 助攻掃描

**Files:**
- Create: `src/world/assists.ts`
- Test: `test/unit/assists.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `damageTime` / `damageStride` 佈局
- Produces: `ASSIST_WINDOW = 20`；`assistCredits(damageTime: Float32Array, n: number, victim: number, killer: number, now: number, out: number[]): number[]` —— 就地清空並填入該記助攻的座位索引，回傳同一個陣列

- [ ] **Step 1: 寫測試**

建立 `test/unit/assists.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { ASSIST_WINDOW, assistCredits } from '../../src/world/assists'

/** 造一張 n×n 的表，全部 −Infinity。 */
function table(n: number): Float32Array {
  return new Float32Array(n * n).fill(-Infinity)
}

const OUT: number[] = []

describe('assistCredits（M9 spec §5.2）', () => {
  it('窗口內打過的算助攻', () => {
    const n = 4
    const t = table(n)
    t[1 * n + 3] = 100
    expect(assistCredits(t, n, 3, 2, 105, OUT)).toEqual([1])
  })

  it('兇手不重複拿助攻', () => {
    const n = 4
    const t = table(n)
    t[2 * n + 3] = 100
    t[1 * n + 3] = 100
    expect(assistCredits(t, n, 3, 2, 105, OUT)).toEqual([1])
  })

  it('受害者自己不算', () => {
    // 【為什麼要擋】自傷目前不可能發生（彈丸判定排除自己），但一條
    // 「自己助攻自己」的縫隙不該留著等某天被打開。
    const n = 4
    const t = table(n)
    t[3 * n + 3] = 100
    expect(assistCredits(t, n, 3, 2, 105, OUT)).toEqual([])
  })

  it('從沒打過的不算', () => {
    const n = 4
    expect(assistCredits(table(n), n, 3, 2, 1e6, OUT)).toEqual([])
  })

  it('窗口的兩側：剛好之內算，剛好之外不算', () => {
    const n = 4
    const t = table(n)
    t[0 * n + 3] = 0
    expect(assistCredits(t, n, 3, 2, ASSIST_WINDOW - 0.1, OUT)).toEqual([0])
    expect(assistCredits(t, n, 3, 2, ASSIST_WINDOW + 0.1, OUT)).toEqual([])
  })

  it('沒有兇手時，窗口內的人照樣拿助攻', () => {
    // 撞海：沒有人拿擊墜，但打傷過它的人仍然參與了這件事
    const n = 4
    const t = table(n)
    t[1 * n + 3] = 100
    expect(assistCredits(t, n, 3, -1, 105, OUT)).toEqual([1])
  })

  it('多個人各記一次，依座位順序', () => {
    const n = 5
    const t = table(n)
    t[0 * n + 4] = 100
    t[2 * n + 4] = 101
    t[3 * n + 4] = 102
    expect(assistCredits(t, n, 4, 2, 105, OUT)).toEqual([0, 3])
  })

  it('重複呼叫不會累積 —— out 每次先清空', () => {
    const n = 4
    const t = table(n)
    t[1 * n + 3] = 100
    assistCredits(t, n, 3, 2, 105, OUT)
    assistCredits(t, n, 3, 2, 105, OUT)
    expect(OUT).toEqual([1])
  })

  it('窗口是 20 秒', () => {
    expect(ASSIST_WINDOW).toBe(20)
  })
})
```

- [ ] **Step 2: 跑測試確認會紅**

Run: `npx vitest run test/unit/assists.test.ts`
Expected: FAIL —— 找不到模組 `src/world/assists`

- [ ] **Step 3: 實作**

建立 `src/world/assists.ts`：

```ts
/**
 * 助攻的時間窗口，s。
 *
 * 【20 秒怎麼來】專案負責人裁決。一次對頭通場到脫離大約就是這個尺度 ——
 * 「我把他打傷了，他拉起來逃，我僚機補上」這種最典型的助攻拿得到；
 * 三分鐘前擦到的那一發拿不到（M9 spec §12）。
 */
export const ASSIST_WINDOW = 20

/**
 * 掃出這一次擊墜該記助攻的座位。
 *
 * 規則：除了兇手與受害者本人之外，任何在最近 `ASSIST_WINDOW` 秒內對受害者
 * 造成過傷害的人各記一次。
 *
 * @param damageTime `damageTime[攻擊者 * n + 受害者]` = 最後一次命中的世界時間
 * @param n          表格邊長（`World.damageStride`）
 * @param killer     兇手的座位；−1 表示無兇手（撞海、自摔）
 * @param out        **就地清空後填入**。熱路徑之外，但沿用專案的不配置慣例
 *
 * 【為什麼是純函數而不是 World 的方法】它只是一次查表，沒有任何狀態。
 * 抽出來之後窗口邊界可以直接測，不必組一個世界出來（M9 spec §11）。
 */
export function assistCredits(
  damageTime: Float32Array,
  n: number,
  victim: number,
  killer: number,
  now: number,
  out: number[],
): number[] {
  out.length = 0
  for (let a = 0; a < n; a++) {
    if (a === killer || a === victim) continue
    // 【初值 −Infinity 讓「沒打過」自動落在窗口外】不必額外判斷
    if (now - damageTime[a * n + victim]! > ASSIST_WINDOW) continue
    out.push(a)
  }
  return out
}
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run test/unit/assists.test.ts`
Expected: PASS（10 條）

- [ ] **Step 5: 提交**

```bash
git add src/world/assists.ts test/unit/assists.test.ts
git commit -m "feat: 助攻的窗口掃描"
```

---

### Task 4: 飛行員名字

**Files:**
- Create: `src/battle/names.ts`
- Test: `test/unit/names.test.ts`

**Interfaces:**
- Consumes: 無
- Produces: `type Faction = 'allies' | 'axis'`；`factionOf(specId: string): Faction`；`mulberry32(seed: number): () => number`；`ALLIED_NAMES` / `AXIS_NAMES`（各 24 個）；`pilotNames(seed: number, faction: Faction, count: number): string[]`

- [ ] **Step 1: 寫測試**

建立 `test/unit/names.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  ALLIED_NAMES, AXIS_NAMES, factionOf, mulberry32, pilotNames,
} from '../../src/battle/names'

describe('mulberry32', () => {
  it('同種子同序列', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    for (let i = 0; i < 20; i++) expect(a()).toBe(b())
  })

  it('不同種子不同序列', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    let same = 0
    for (let i = 0; i < 20; i++) if (a() === b()) same++
    expect(same).toBe(0)
  })

  it('值域是 [0, 1)', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 500; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('factionOf', () => {
  it('P-51 是同盟國、Bf109 是軸心國', () => {
    expect(factionOf('p51d')).toBe('allies')
    expect(factionOf('bf109g6')).toBe('axis')
  })
})

describe('pilotNames（M9 spec §6.1）', () => {
  it('同種子同結果 —— 一場內名字不會變', () => {
    expect(pilotNames(999, 'allies', 20)).toEqual(pilotNames(999, 'allies', 20))
  })

  it('不同種子換一批名字', () => {
    const a = pilotNames(1, 'allies', 20)
    const b = pilotNames(2, 'allies', 20)
    expect(a).not.toEqual(b)
  })

  it('一場內不重複', () => {
    const names = pilotNames(42, 'axis', 20)
    expect(new Set(names).size).toBe(20)
  })

  it('名字來自該陣營的名冊', () => {
    for (const n of pilotNames(5, 'allies', 20)) expect(ALLIED_NAMES).toContain(n)
    for (const n of pilotNames(5, 'axis', 20)) expect(AXIS_NAMES).toContain(n)
  })

  it('兩個陣營的名冊沒有交集', () => {
    for (const n of ALLIED_NAMES) expect(AXIS_NAMES).not.toContain(n)
  })

  it('名冊要夠大 —— 每隊上限 20', () => {
    // 【為什麼要守這一條】名冊小於隊伍上限時 pilotNames 會開始加羅馬數字，
    // 那是一個沒有人想看到的降級。上限是 M10 的每隊 20。
    expect(ALLIED_NAMES.length).toBeGreaterThanOrEqual(20)
    expect(AXIS_NAMES.length).toBeGreaterThanOrEqual(20)
  })

  it('超出名冊時加羅馬數字，不會無聲重複', () => {
    const names = pilotNames(3, 'allies', ALLIED_NAMES.length + 2)
    expect(new Set(names).size).toBe(names.length)
  })

  it('count 為 0 時回傳空陣列', () => {
    expect(pilotNames(3, 'allies', 0)).toEqual([])
  })
})
```

- [ ] **Step 2: 跑測試確認會紅**

Run: `npx vitest run test/unit/names.test.ts`
Expected: FAIL —— 找不到模組 `src/battle/names`

- [ ] **Step 3: 實作**

建立 `src/battle/names.ts`：

```ts
/**
 * 陣營。**不是隊伍顏色** —— 隊伍顏色是敵我（藍＝友方），陣營是史實的那一邊。
 *
 * 【為什麼名冊綁陣營】M10 讓玩家選陣營之後，藍隊有可能飛 Bf109。名字要
 * 跟著機種所屬的那一邊走，不是跟著 HUD 的顏色（M9 spec §6.1）。
 */
export type Faction = 'allies' | 'axis'

/** 機種代號 → 陣營。 */
export function factionOf(specId: string): Faction {
  return specId === 'bf109g6' ? 'axis' : 'allies'
}

/**
 * mulberry32 —— 32 位種子的小型 PRNG。
 *
 * 【為什麼自己帶一個而不是用 `Math.random`】名字要「一場內不變、重打重抽」。
 * `Math.random` 只能做到後者。這裡只用它抽一顆種子（見 `battle/setup.ts`），
 * 之後全部走這個確定性序列 —— 種子記下來就能重現同一場的名單。
 *
 * 名字不進入任何物理路徑，所以 M5 spec §3.1 的「同一組設定跑兩次要逐幀
 * 一致」不受影響。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 同盟國飛行員名冊。24 個 —— 每隊上限 20，留一點餘裕讓每場的前 20 個不一樣。 */
export const ALLIED_NAMES: readonly string[] = [
  'Ray Bishop', 'Hal Carter', 'Ned Foster', 'Gus Hartley', 'Cal Weaver',
  'Vic Sanders', 'Dale Munroe', 'Roy Whitcomb', 'Chuck Danvers', 'Milt Rearden',
  'Sam Ellery', 'Buzz Kendall', 'Art Delaney', 'Wes Trumbull', 'Curt Rawlings',
  'Lou Prentice', 'Jack Ashford', 'Ted Marlowe', 'Dutch Halloran', 'Pete Sallinger',
  'Nash Coburn', 'Rudy Vance', 'Guy Lockhart', 'Frank Mercer',
]

/** 軸心國飛行員名冊。24 個。 */
export const AXIS_NAMES: readonly string[] = [
  'Hans Richter', 'Kurt Vogel', 'Otto Brandt', 'Erich Sauer', 'Franz Keller',
  'Walter Nolte', 'Heinz Kruger', 'Rudolf Mainz', 'Karl Deitrich', 'Ernst Wieland',
  'Georg Halder', 'Josef Lindner', 'Willi Osterman', 'Gunther Reiss', 'Fritz Bergmann',
  'Klaus Ehrhardt', 'Anton Sieber', 'Dieter Falk', 'Helmut Rossler', 'Martin Zeller',
  'Ulrich Baumann', 'Wolfgang Strauss', 'Emil Hartmann', 'Bruno Steiner',
]

/**
 * 抽 `count` 個名字。同種子同結果，而且**彼此不重複**。
 *
 * 【為什麼是洗牌而不是逐個抽】逐個抽會撞名，而同一場裡兩個「Hans Richter」
 * 在記分板上完全讀不出來誰是誰。洗牌保證不重複，代價只是複製一份名冊。
 */
export function pilotNames(seed: number, faction: Faction, count: number): string[] {
  const pool = (faction === 'axis' ? AXIS_NAMES : ALLIED_NAMES).slice()
  const rand = mulberry32(seed)
  // Fisher–Yates
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = pool[i]!
    pool[i] = pool[j]!
    pool[j] = t
  }
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const base = pool[i % pool.length]!
    const round = Math.floor(i / pool.length)
    // 【超出名冊就加羅馬數字】名冊 24、每隊上限 20，走不到這裡。留著是為了
    // 「名字重複」永遠不會無聲發生 —— 有一天有人把上限調到 30 的時候。
    out.push(round === 0 ? base : `${base} ${'I'.repeat(round + 1)}`)
  }
  return out
}
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run test/unit/names.test.ts`
Expected: PASS（12 條）

- [ ] **Step 5: 提交**

```bash
git add src/battle/names.ts test/unit/names.test.ts
git commit -m "feat: 飛行員名冊與確定性洗牌"
```

---

### Task 5: 飛行員名冊資料結構

**Files:**
- Create: `src/battle/pilots.ts`
- Test: `test/unit/pilots.test.ts`

**Interfaces:**
- Consumes: 無
- Produces: `interface Pilot { name: string; kills: number; deaths: number; assists: number; alive: boolean; isPlayer: boolean }`；`interface Roster { readonly pilots: Pilot[] }`；`createRoster(names: readonly string[], playerSeat: number): Roster`；`swapPilots(r: Roster, a: number, b: number): void`；`recordKill(r: Roster, victimSeat: number, killerSeat: number, assistSeats: readonly number[]): void`

- [ ] **Step 1: 寫測試**

建立 `test/unit/pilots.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { createRoster, recordKill, swapPilots } from '../../src/battle/pilots'

const NAMES = ['A', 'B', 'C', 'D']

describe('createRoster', () => {
  it('每個座位一位飛行員，戰績歸零、全員存活', () => {
    const r = createRoster(NAMES, 0)
    expect(r.pilots).toHaveLength(4)
    for (const p of r.pilots) {
      expect(p.kills).toBe(0)
      expect(p.deaths).toBe(0)
      expect(p.assists).toBe(0)
      expect(p.alive).toBe(true)
    }
  })

  it('只有一位是玩家，而且在指定的座位', () => {
    const r = createRoster(NAMES, 2)
    expect(r.pilots.filter((p) => p.isPlayer)).toHaveLength(1)
    expect(r.pilots[2]!.isPlayer).toBe(true)
  })

  it('名字依座位順序', () => {
    const r = createRoster(NAMES, 0)
    expect(r.pilots.map((p) => p.name)).toEqual(NAMES)
  })
})

describe('recordKill（M9 spec §4）', () => {
  it('受害者陣亡、兇手加一次擊墜', () => {
    const r = createRoster(NAMES, 0)
    recordKill(r, 3, 1, [])
    expect(r.pilots[3]!.alive).toBe(false)
    expect(r.pilots[3]!.deaths).toBe(1)
    expect(r.pilots[1]!.kills).toBe(1)
  })

  it('兇手是 −1 時沒有人加擊墜', () => {
    const r = createRoster(NAMES, 0)
    recordKill(r, 3, -1, [])
    expect(r.pilots[3]!.alive).toBe(false)
    expect(r.pilots.reduce((s, p) => s + p.kills, 0)).toBe(0)
  })

  it('助攻各加一次', () => {
    const r = createRoster(NAMES, 0)
    recordKill(r, 3, 1, [0, 2])
    expect(r.pilots[0]!.assists).toBe(1)
    expect(r.pilots[2]!.assists).toBe(1)
    expect(r.pilots[1]!.assists).toBe(0)
  })

  it('同一位不會死兩次', () => {
    // 【為什麼要守】擊墜事件在呼叫端沒有排空時會累積。重複處理不該讓
    // 陣亡數與擊墜數失衡 —— 那會直接打破整合測試的守恆律。
    const r = createRoster(NAMES, 0)
    recordKill(r, 3, 1, [0])
    recordKill(r, 3, 1, [0])
    expect(r.pilots[3]!.deaths).toBe(1)
    expect(r.pilots[1]!.kills).toBe(1)
    expect(r.pilots[0]!.assists).toBe(1)
  })
})

describe('swapPilots（M9 spec §7.1）', () => {
  it('名字與戰績一起搬', () => {
    const r = createRoster(NAMES, 0)
    r.pilots[0]!.kills = 3
    r.pilots[0]!.assists = 2
    r.pilots[1]!.kills = 7
    swapPilots(r, 0, 1)
    expect(r.pilots[0]!.name).toBe('B')
    expect(r.pilots[0]!.kills).toBe(7)
    expect(r.pilots[1]!.name).toBe('A')
    expect(r.pilots[1]!.kills).toBe(3)
    expect(r.pilots[1]!.assists).toBe(2)
  })

  it('玩家的標記跟著人走', () => {
    const r = createRoster(NAMES, 0)
    swapPilots(r, 0, 2)
    expect(r.pilots[0]!.isPlayer).toBe(false)
    expect(r.pilots[2]!.isPlayer).toBe(true)
  })

  it('交換自己是空操作', () => {
    const r = createRoster(NAMES, 0)
    swapPilots(r, 1, 1)
    expect(r.pilots[1]!.name).toBe('B')
  })
})
```

- [ ] **Step 2: 跑測試確認會紅**

Run: `npx vitest run test/unit/pilots.test.ts`
Expected: FAIL —— 找不到模組 `src/battle/pilots`

- [ ] **Step 3: 實作**

建立 `src/battle/pilots.ts`：

```ts
/**
 * 一位飛行員的戰績。
 *
 * 【為什麼不掛在 `Combatant` 上】玩家會換座位（接手僚機）。掛在座位上的話，
 * 玩家接手之後自己的擊墜數會留在那具殘骸上，畫面上看起來像戰果被清掉了
 * （M9 spec §3）。
 */
export interface Pilot {
  /** 顯示名。一場內不變，**跟著人走** */
  name: string
  kills: number
  deaths: number
  assists: number
  /** 還在天上 */
  alive: boolean
  /** 玩家本人。接手時跟著人走 */
  isPlayer: boolean
}

export interface Roster {
  /**
   * 依**座位**索引：`pilots[i]` 是目前坐在 `world.combatants[i]` 裡的人。
   *
   * 【為什麼仍然依座位排】所有既有的歸屬資訊（彈丸的 `owner`、擊墜事件的
   * 受害者與兇手欄）都是座位索引。名冊跟著座位排，那些一行都不用改；
   * 而「換人」就只是交換陣列裡的兩個元素。
   */
  readonly pilots: Pilot[]
}

export function createRoster(names: readonly string[], playerSeat: number): Roster {
  return {
    pilots: names.map((name, i) => ({
      name,
      kills: 0,
      deaths: 0,
      assists: 0,
      alive: true,
      isPlayer: i === playerSeat,
    })),
  }
}

/**
 * 兩位飛行員交換座位。**接手僚機就是這個動作。**
 *
 * 交換的是整個 `Pilot` 物件 —— 名字、擊墜、陣亡、助攻、玩家標記全部一起搬。
 */
export function swapPilots(r: Roster, a: number, b: number): void {
  if (a === b) return
  const t = r.pilots[a]!
  r.pilots[a] = r.pilots[b]!
  r.pilots[b] = t
}

/**
 * 記一次擊墜。
 *
 * @param killerSeat −1 表示無兇手（撞海、自摔）
 *
 * 【已經陣亡的直接略過】擊墜事件在呼叫端沒有排空時會累積，重複處理不該讓
 * 陣亡數與擊墜數失衡 —— 那會直接打破整合測試的守恆律。
 */
export function recordKill(
  r: Roster, victimSeat: number, killerSeat: number, assistSeats: readonly number[],
): void {
  const victim = r.pilots[victimSeat]
  if (victim === undefined || !victim.alive) return
  victim.alive = false
  victim.deaths++
  if (killerSeat >= 0) {
    const killer = r.pilots[killerSeat]
    if (killer !== undefined) killer.kills++
  }
  for (const s of assistSeats) {
    const p = r.pilots[s]
    if (p !== undefined) p.assists++
  }
}
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run test/unit/pilots.test.ts`
Expected: PASS（11 條）

- [ ] **Step 5: 提交**

```bash
git add src/battle/pilots.ts test/unit/pilots.test.ts
git commit -m "feat: 飛行員名冊 —— 飛行員與座位分離"
```

---

### Task 6: 接手目標選取

**Files:**
- Create: `src/battle/takeover.ts`
- Test: `test/unit/takeover.test.ts`

**Interfaces:**
- Consumes: `FlightIndex`（`src/battle/flights.ts`）、`Team`（`src/world/World.ts`）
- Produces: `TAKEOVER_DELAY = 2`；`interface TakeoverSeat { readonly alive: boolean; readonly team: Team }`；`pickTakeover(flights: FlightIndex, seats: readonly TakeoverSeat[], playerSeat: number): number` —— 回傳座位索引，沒有可接的回傳 −1

- [ ] **Step 1: 寫測試**

建立 `test/unit/takeover.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { pickTakeover, TAKEOVER_DELAY } from '../../src/battle/takeover'
import { createFlights, SCHWARM_SIZE } from '../../src/battle/flights'
import type { Team } from '../../src/world/World'

/** 造 n 架藍、n 架紅的假座位，並依此建編制。玩家釘在座位 0。 */
function scene(bluePerSide: number, redPerSide: number) {
  const seats: { index: number; team: Team; alive: boolean }[] = []
  for (let i = 0; i < bluePerSide; i++) {
    seats.push({ index: seats.length, team: 'blue', alive: true })
  }
  for (let i = 0; i < redPerSide; i++) {
    seats.push({ index: seats.length, team: 'red', alive: true })
  }
  const flights = createFlights(seats, 0)
  return { seats, flights }
}

describe('pickTakeover（M9 spec §7.1）', () => {
  it('同分隊還有僚機時接他', () => {
    const { seats, flights } = scene(8, 8)
    expect(pickTakeover(flights, seats, 0)).toBe(1)
  })

  it('同分隊的僚機死光了就往同分隊後面找', () => {
    const { seats, flights } = scene(8, 8)
    seats[1]!.alive = false
    expect(pickTakeover(flights, seats, 0)).toBe(2)
  })

  it('整個分隊只剩玩家時，接別的分隊', () => {
    const { seats, flights } = scene(8, 8)
    for (let i = 1; i < SCHWARM_SIZE; i++) seats[i]!.alive = false
    expect(pickTakeover(flights, seats, 0)).toBe(SCHWARM_SIZE)
  })

  it('絕不回傳敵方的座位', () => {
    const { seats, flights } = scene(4, 4)
    for (let i = 1; i < 4; i++) seats[i]!.alive = false
    expect(pickTakeover(flights, seats, 0)).toBe(-1)
  })

  it('絕不回傳玩家自己', () => {
    const { seats, flights } = scene(4, 4)
    for (let i = 1; i < 4; i++) seats[i]!.alive = false
    // 玩家自己標成還活著也一樣
    seats[0]!.alive = true
    expect(pickTakeover(flights, seats, 0)).toBe(-1)
  })

  it('只剩玩家一架時回傳 −1', () => {
    const { seats, flights } = scene(1, 4)
    expect(pickTakeover(flights, seats, 0)).toBe(-1)
  })

  it('不會挑已經陣亡的', () => {
    const { seats, flights } = scene(8, 8)
    seats[1]!.alive = false
    seats[2]!.alive = false
    expect(pickTakeover(flights, seats, 0)).toBe(3)
  })

  it('延遲是 2 秒', () => {
    expect(TAKEOVER_DELAY).toBe(2)
  })
})
```

- [ ] **Step 2: 跑測試確認會紅**

Run: `npx vitest run test/unit/takeover.test.ts`
Expected: FAIL —— 找不到模組 `src/battle/takeover`

- [ ] **Step 3: 實作**

建立 `src/battle/takeover.ts`：

```ts
import type { FlightIndex } from './flights'
import type { Team } from '../world/World'

/**
 * 玩家陣亡到接手僚機之間的停頓，s。
 *
 * 【為什麼要這 2 秒】M8 的人工驗收條件 17（「玩家自己被擊墜時看不看得到
 * 火球與零件」）到 M9 之前無法驗收，正是因為玩家死掉的同一幀就重生到別的
 * 地方去了。火球活 0.5 s、零件散開約 1.5~2 s —— 2 秒剛好看得完。
 */
export const TAKEOVER_DELAY = 2

/**
 * `pickTakeover` 需要知道的最小資訊。
 *
 * 【為什麼另外定義而不是直接用 `Combatant`】選誰來接手與射速時鐘、包圍球
 * 半徑、出生點統統無關。與 `flights.ts` 的 `FlightMember` 是同一個做法 ——
 * 測試因此不必組一個世界出來。
 */
export interface TakeoverSeat {
  readonly alive: boolean
  readonly team: Team
}

/**
 * 選一個座位給玩家接手。沒有可接的回傳 −1。
 *
 * 順序：同分隊出生編制上第一個還活著的其他人，再來是同隊索引順序第一個
 * 還活著的人。
 *
 * 【為什麼掃 `roster` 而不是壓縮後的 `members`】兩者在這裡等價 —— 玩家釘在
 * `members[0]`，而壓縮保序，所以「roster 上第一個非玩家的存活者」就是
 * `members[1]`。但 `roster` **不隨陣亡改變**，所以這個函數與
 * `compactFlights` 在同一步裡跑過沒跑過無關。少一個順序相依。
 */
export function pickTakeover(
  flights: FlightIndex, seats: readonly TakeoverSeat[], playerSeat: number,
): number {
  const team = seats[playerSeat]?.team
  if (team === undefined) return -1

  for (const f of flights.flights) {
    if (!f.roster.includes(playerSeat)) continue
    for (const i of f.roster) {
      if (i !== playerSeat && seats[i]!.alive) return i
    }
    break
  }

  for (let i = 0; i < seats.length; i++) {
    if (i === playerSeat) continue
    const s = seats[i]!
    if (s.alive && s.team === team) return i
  }
  return -1
}
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run test/unit/takeover.test.ts`
Expected: PASS（8 條）

- [ ] **Step 5: 提交**

```bash
git add src/battle/takeover.ts test/unit/takeover.test.ts
git commit -m "feat: 接手目標的選取規則"
```

---

### Task 7: 勝負結果取代自動重置

**Files:**
- Modify: `src/battle/setup.ts`
- Modify: `src/hud/types.ts`（移除 `resetCountdown`）
- Modify: `src/hud/widgets/roster.ts`（移除 `countdownLabel` 與那段繪製）
- Modify: `src/main.ts:413`
- Test: `test/unit/battle-setup.test.ts`、`test/unit/hud.test.ts`、`test/integration/multi-battle.test.ts`

**Interfaces:**
- Consumes: 無
- Produces: `type Outcome = 'fighting' | 'victory' | 'defeat'`；`Battle.outcome: Outcome`。`BattleConfig.resetCountdown` 與 `Battle.countdown` **移除**

- [ ] **Step 1: 改 `battle-setup.test.ts` 的倒數三條**

把 `describe('全滅與重置', …)` 裡的前三條整組換成：

```ts
describe('勝負（M9 spec §8）', () => {
  it('雙方都還有人時仍在交戰', () => {
    const b = createBattle(new Idle())
    stepBattle(b, DT)
    expect(b.outcome).toBe('fighting')
  })

  it('紅隊全滅 = 勝利', () => {
    const b = createBattle(new Idle())
    for (const c of b.red) c.alive = false
    stepBattle(b, DT)
    expect(b.outcome).toBe('victory')
  })

  it('藍隊全滅 = 落敗', () => {
    const b = createBattle(new Idle())
    for (const c of b.blue) c.alive = false
    stepBattle(b, DT)
    expect(b.outcome).toBe('defeat')
  })

  it('分出勝負之後不會自己重置', () => {
    // 【為什麼要守這一條】M5 到 M8 的行為是 3 秒後自動回到滿編。主選單一
    // 進來那條路徑就必須消失，否則玩家永遠回不到結算畫面。
    const b = createBattle(new Idle())
    for (const c of b.red) c.alive = false
    for (let i = 0; i < Math.ceil(10 / DT); i++) stepBattle(b, DT)
    expect(b.outcome).toBe('victory')
    expect(aliveCount(b.red)).toBe(0)
  })

  it('分出勝負之後結果不再翻轉', () => {
    const b = createBattle(new Idle())
    for (const c of b.red) c.alive = false
    stepBattle(b, DT)
    for (const c of b.blue) c.alive = false
    stepBattle(b, DT)
    expect(b.outcome).toBe('victory')
  })
})
```

（同一個 `describe` 底下原本還有「重置把血量、位置、指派板一起清乾淨」、「重置後彈丸池是空的」、「重置後方位與速度回到開局狀態」三條 —— 它們不碰倒數，原封不動保留，只要把 `describe` 的標題改成 `'重置'`。）

- [ ] **Step 2: 跑測試確認會紅**

Run: `npx vitest run test/unit/battle-setup.test.ts`
Expected: FAIL —— `b.outcome` 不存在

- [ ] **Step 3: 改 `src/battle/setup.ts`**

刪掉 `BattleConfig.resetCountdown` 的欄位與註解、`DEFAULT_BATTLE` 的 `resetCountdown: 3`，並把 `BattleConfig` 開頭那段 JSDoc 裡提到 `resetCountdown` 的段落一併刪除。

`Battle` 介面：把 `countdown: number` 換成

```ts
  /**
   * 這一場的結果。
   *
   * 【為什麼取代了自動重置】M5 到 M8 是「一方全滅 → 3 秒 → 回到滿編」。
   * 主選單一進來那條路徑就必須消失，否則玩家永遠回不到結算畫面
   * （M9 spec §8）。
   */
  outcome: Outcome
```

檔案上方加型別：

```ts
/** 一場戰鬥的結果。`victory` = 敵方全滅，`defeat` = 我方全滅。 */
export type Outcome = 'fighting' | 'victory' | 'defeat'
```

`createBattle` 裡的 `countdown: 0,` 改成 `outcome: 'fighting',`。

`stepBattle` 結尾那一段整個換掉：

```ts
  if (b.outcome !== 'fighting') return

  // 【玩家恆在藍隊】M9 的機種與陣營都還是寫死的（M10 才做選擇），所以
  // 「我方」就是藍隊。M10 交換的是兩邊的機種，不是隊伍顏色。
  if (aliveCount(b.red) === 0) b.outcome = 'victory'
  else if (aliveCount(b.blue) === 0) b.outcome = 'defeat'
```

`resetBattle` 的 `b.countdown = 0` 改成 `b.outcome = 'fighting'`。

- [ ] **Step 4: 清掉 HUD 的倒數**

`src/hud/types.ts`：刪掉 `HudFrame` 的 `resetCountdown: number` 欄位與它的註解，並把 `createHudFrame` 裡的 `resetCountdown: 0` 從那一行移除（該行變成 `blueAlive: 0, redAlive: 0, flightAlive: 0, flightSize: 0,`）。

`src/hud/widgets/roster.ts`：刪掉 `countdownLabel` 整個函數與它的 JSDoc，並刪掉 `drawRoster` 末尾那一段：

```ts
  const label = countdownLabel(f.resetCountdown)
  if (label !== null) {
    ctx.font = hudFont(Math.round(20 * L.scale), true)
    ctx.fillStyle = HUD_COLORS.warn
    ctx.fillText(label, L.cx, y + size * 1.6)
  }
```

`src/main.ts`：刪掉 `hudFrame.resetCountdown = battle.countdown` 那一行。

`test/unit/hud.test.ts`：刪掉 `describe('countdownLabel', …)` 整組（四條）、`import` 裡的 `countdownLabel`、以及 `expect(f.resetCountdown).toBe(0)` 那一行。

- [ ] **Step 5: 清掉整合測試裡的倒數**

`test/integration/multi-battle.test.ts`：

- 觀測介面刪掉 `resets: number`（第 123 行附近）
- 初始化刪掉 `resets: 0`（第 187 行附近的 `switches: 0, maxDecisionsInOneStep: 0, resets: 0,` → `switches: 0, maxDecisionsInOneStep: 0,`）
- 迴圈裡刪掉這兩行：

```ts
    if (prevCountdown > 0 && b.countdown === 0) o.resets++
    prevCountdown = b.countdown
```

- 刪掉 `let prevCountdown = 0` 的宣告
- `describe('全滅重置（M5 spec §3.1 條件 9）', …)` 整組換成：

```ts
describe('全滅之後的結果（M9 spec §8）', () => {
  it('人為打光紅隊後判定勝利，而且不會自己回到滿編', () => {
    const b = createBattle(new Idle())
    for (const c of b.red) b.world.destroy(c)
    for (let i = 0; i < Math.ceil(10 / DT); i++) {
      stepBattle(b, DT)
      clearKills(b.world.killEvents)
    }
    expect(b.outcome).toBe('victory')
    expect(aliveCount(b.red)).toBe(0)
  })
})
```

（`clearKills` 已經在這個檔案的 import 裡。若 `DEFAULT_BATTLE` 因此變成未使用的 import，一併移除。）

- [ ] **Step 6: 跑全套確認轉綠**

Run: `npm test`
Expected: 全 PASS（`perf-gate` 若閃紅，單獨重跑確認）

Run: `npm run build`
Expected: 無型別錯誤

- [ ] **Step 7: 提交**

```bash
git add src/battle/setup.ts src/hud/types.ts src/hud/widgets/roster.ts src/main.ts \
  test/unit/battle-setup.test.ts test/unit/hud.test.ts test/integration/multi-battle.test.ts
git commit -m "feat: 勝負結果取代全滅自動重置"
```

---

### Task 8: `stepBattle` 記錄擊墜與助攻

**Files:**
- Modify: `src/battle/setup.ts`
- Test: `test/unit/battle-setup.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `assistCredits` / `ASSIST_WINDOW`、Task 4 的 `pilotNames` / `factionOf`、Task 5 的 `createRoster` / `recordKill`
- Produces: `createBattle(playerController: Controller, cfg?: BattleConfig, seed?: number): Battle`；`Battle.roster: Roster`；`Battle.seed: number`

- [ ] **Step 1: 寫測試**

`test/unit/battle-setup.test.ts` 檔尾加：

```ts
describe('名冊（M9 spec §6）', () => {
  it('每個座位一位飛行員，玩家只有一位', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 1234)
    expect(b.roster.pilots).toHaveLength(b.world.combatants.length)
    expect(b.roster.pilots.filter((p) => p.isPlayer)).toHaveLength(1)
    expect(b.roster.pilots[b.player.index]!.isPlayer).toBe(true)
  })

  it('同種子同名單', () => {
    const a = createBattle(new Idle(), DEFAULT_BATTLE, 777)
    const c = createBattle(new Idle(), DEFAULT_BATTLE, 777)
    expect(a.roster.pilots.map((p) => p.name))
      .toEqual(c.roster.pilots.map((p) => p.name))
  })

  it('全場名字不重複', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 55)
    const names = b.roster.pilots.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('藍隊拿同盟國的名字、紅隊拿軸心國的', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 9)
    for (const c of b.blue) expect(ALLIED_NAMES).toContain(b.roster.pilots[c.index]!.name)
    for (const c of b.red) expect(AXIS_NAMES).toContain(b.roster.pilots[c.index]!.name)
  })
})

describe('stepBattle 的戰績記錄（M9 spec §4.3）', () => {
  it('擊墜記在兇手身上、陣亡記在受害者身上', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 1)
    const killer = b.blue[1]!
    const victim = b.red[0]!
    b.world.applyDamage(victim, 99999, 'fuselage', killer)
    stepBattle(b, DT)
    expect(b.roster.pilots[killer.index]!.kills).toBe(1)
    expect(b.roster.pilots[victim.index]!.deaths).toBe(1)
    expect(b.roster.pilots[victim.index]!.alive).toBe(false)
  })

  it('窗口內打過的拿助攻', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 1)
    const killer = b.blue[1]!
    const helper = b.blue[2]!
    const victim = b.red[0]!
    b.world.applyDamage(victim, 10, 'wingLeft', helper)
    b.world.applyDamage(victim, 99999, 'fuselage', killer)
    stepBattle(b, DT)
    expect(b.roster.pilots[helper.index]!.assists).toBe(1)
    expect(b.roster.pilots[killer.index]!.assists).toBe(0)
  })

  it('撞海不算任何人的擊墜', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 1)
    const victim = b.red[0]!
    b.world.destroy(victim)
    stepBattle(b, DT)
    expect(b.roster.pilots[victim.index]!.deaths).toBe(1)
    expect(b.roster.pilots.reduce((s, p) => s + p.kills, 0)).toBe(0)
  })

  it('呼叫端沒有排空時也不會重複計數', () => {
    // 【為什麼這條非有不可】`main.ts` 每個子步排空擊墜事件，headless 的
    // 測試不排。不排的話同一筆事件會在後續每一步被再掃一次 —— 靠的是
    // `recordKill` 的「已陣亡就略過」讓重掃變成空操作。這條測試守的就是
    // 那個冪等性；它一破，守恆律會永遠失衡而症狀離成因很遠。
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 1)
    const killer = b.blue[1]!
    const victim = b.red[0]!
    b.world.applyDamage(victim, 99999, 'fuselage', killer)
    for (let i = 0; i < 20; i++) stepBattle(b, DT)
    expect(b.roster.pilots[killer.index]!.kills).toBe(1)
    expect(b.roster.pilots[victim.index]!.deaths).toBe(1)
  })
})
```

`import` 補上：

```ts
import { ALLIED_NAMES, AXIS_NAMES } from '../../src/battle/names'
```

- [ ] **Step 2: 跑測試確認會紅**

Run: `npx vitest run test/unit/battle-setup.test.ts`
Expected: FAIL —— `b.roster` 不存在

- [ ] **Step 3: 實作**

`src/battle/setup.ts` 的 import 補上：

```ts
import { KILL_STRIDE } from '../world/kills'
import { ASSIST_WINDOW, assistCredits } from '../world/assists'
import { factionOf, pilotNames } from './names'
import { createRoster, recordKill, type Roster } from './pilots'
```

（`ASSIST_WINDOW` 只是為了讓 `assistCredits` 的窗口出現在這個檔案的 import 清單裡；若 lint 抱怨未使用，改成只 import `assistCredits`。）

`Battle` 介面加：

```ts
  /** 這一場的飛行員名冊，依座位索引 */
  readonly roster: Roster
  /** 名字用的隨機種子。記下來就能重現同一場的名單 */
  seed: number
```

`createBattle` 的簽章加第三個參數：

```ts
/**
 * 造一場 N vs N。
 *
 * （既有註解保留）
 *
 * @param seed 名字用的種子。省略時抽一個 —— **這是專案唯一一處
 *             `Math.random`**，而且只影響顯示用的字串，不進入任何物理路徑
 *             （M9 spec §6.2）。
 */
export function createBattle(
  playerController: Controller,
  cfg: BattleConfig = DEFAULT_BATTLE,
  seed: number = (Math.random() * 0x100000000) >>> 0,
): Battle {
```

在 `createFlights` 之後、`const battle: Battle = {` 之前插入名冊建立：

```ts
  // 【名字依陣營而不是隊伍顏色】M10 讓玩家選陣營之後藍隊可能飛 Bf109，
  // 那時德文名要跟著機種走（M9 spec §6.1）。這裡讀每一隊實際的機種。
  const blueNames = pilotNames(seed, factionOf(blue[0]!.aircraft.spec.id), blue.length)
  const redNames = pilotNames(seed, factionOf(red[0]!.aircraft.spec.id), red.length)
  let bi = 0
  let ri = 0
  const roster = createRoster(
    world.combatants.map((c) => (c.team === 'blue' ? blueNames[bi++]! : redNames[ri++]!)),
    player.index,
  )
```

`const battle: Battle = { … }` 加上 `roster,` 與 `seed,`。

檔案模組層加一個共用的助攻暫存：

```ts
/** 助攻掃描的暫存。熱路徑之外，但沿用專案的不配置慣例。 */
const ASSISTS: number[] = []
```

`stepBattle` 開頭改成：

```ts
export function stepBattle(b: Battle, dt: number): void {
  b.world.step(dt)
  drainKills(b)
```

在 `stepBattle` 之前加：

```ts
/**
 * 把擊墜緩衝裡的每一筆記進名冊。
 *
 * 【為什麼在 `stepBattle` 而不是 `World`】`World` 不該知道有「名字」或
 * 「玩家」這回事 —— 它連隊伍都只知道 `'blue' | 'red'`。而且放在這裡，
 * 接手的身分互換與擊墜的記錄可以保證在同一個地方、同一個順序
 * （M9 spec §4.3、§7.1）。
 *
 * 【為什麼每次都從 0 掃】`main.ts` 每個子步排空這個緩衝，headless 的測試
 * 不排 —— 於是同一筆事件會被重掃。這裡不記游標，靠的是 `recordKill` 的
 * 「已陣亡就略過」讓重掃變成空操作；身分互換同理（互換之後那個座位的
 * `isPlayer` 已經是 false）。用游標反而危險：呼叫端排空之後 `count` 歸零，
 * 任何「處理到哪裡」的記錄都會與新的一批事件錯位。
 */
function drainKills(b: Battle): void {
  const ke = b.world.killEvents
  const w = b.world
  for (let e = 0; e < ke.count; e++) {
    const o = e * KILL_STRIDE
    const victim = ke.data[o + 6]!
    const killer = ke.data[o + 7]!
    assistCredits(w.damageTime, w.damageStride, victim, killer, w.time, ASSISTS)
    recordKill(b.roster, victim, killer, ASSISTS)
  }
}
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run test/unit/battle-setup.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/battle/setup.ts test/unit/battle-setup.test.ts
git commit -m "feat: stepBattle 記錄擊墜與助攻"
```

---

### Task 9: 玩家陣亡接手僚機

**Files:**
- Modify: `src/battle/setup.ts`
- Test: `test/unit/battle-setup.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `swapPilots`、Task 6 的 `pickTakeover` / `TAKEOVER_DELAY`
- Produces: `Battle.player` 由 `readonly` 改為可寫；`Battle.playerSeat: number`（開局座位，唯讀）；`Battle.playerController: Controller`（唯讀）；`Battle.takeoverSeat: number`（−1 = 沒有在等待）；`Battle.takeoverTimer: number`

- [ ] **Step 1: 寫測試**

`test/unit/battle-setup.test.ts` 檔尾加：

```ts
describe('玩家陣亡接手僚機（M9 spec §7）', () => {
  /**
   * 玩家的僚機座位。
   *
   * 【為什麼不能寫 `b.blue[1]`】玩家是**正中央分隊的長機**，perSide 20 時
   * 落在座位 8，他的分隊是 [8, 9, 10, 11] —— 座位 1 是另一個分隊的人，
   * 根本不是接手目標。
   */
  function wingmanSeat(b: ReturnType<typeof createBattle>): number {
    return playerFlight(b)!.members[1]!
  }

  /** 打爆玩家，並走完接手延遲。 */
  function killPlayerAndWait(b: ReturnType<typeof createBattle>, killer: Combatant) {
    b.world.applyDamage(b.player, 99999, 'fuselage', killer)
    stepBattle(b, DT)
    for (let i = 0; i < Math.ceil(TAKEOVER_DELAY / DT) + 2; i++) stepBattle(b, DT)
  }

  it('身分互換發生在記錄之前 —— 陣亡記在那位 AI 身上，玩家的戰績原封不動', () => {
    // 【為什麼這是本任務的核心】反過來的話，這次陣亡與兇手的擊墜對象都會
    // 記到玩家頭上，畫面上看起來像自己的戰果被清掉了（M9 spec §7.1）。
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    const seat = b.player.index
    const wingSeat = wingmanSeat(b)
    const playerName = b.roster.pilots[seat]!.name
    const wingName = b.roster.pilots[wingSeat]!.name
    b.roster.pilots[seat]!.kills = 4
    b.roster.pilots[seat]!.assists = 2

    const killer = b.red[0]!
    b.world.applyDamage(b.player, 99999, 'fuselage', killer)
    stepBattle(b, DT)

    // 殘骸那個座位現在坐的是那位 AI，而且他被記為陣亡
    expect(b.roster.pilots[seat]!.name).toBe(wingName)
    expect(b.roster.pilots[seat]!.alive).toBe(false)
    expect(b.roster.pilots[seat]!.deaths).toBe(1)
    expect(b.roster.pilots[seat]!.isPlayer).toBe(false)

    // 玩家搬到僚機的座位，戰績一格也沒少
    expect(b.roster.pilots[wingSeat]!.name).toBe(playerName)
    expect(b.roster.pilots[wingSeat]!.isPlayer).toBe(true)
    expect(b.roster.pilots[wingSeat]!.alive).toBe(true)
    expect(b.roster.pilots[wingSeat]!.kills).toBe(4)
    expect(b.roster.pilots[wingSeat]!.assists).toBe(2)
    expect(b.roster.pilots[wingSeat]!.deaths).toBe(0)

    // 兇手記的是那位 AI 的人頭
    expect(b.roster.pilots[killer.index]!.kills).toBe(1)
  })

  it('操縱權在延遲之後才移交', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    const seat = b.player.index
    const wingSeat = wingmanSeat(b)
    b.world.applyDamage(b.player, 99999, 'fuselage', b.red[0]!)
    stepBattle(b, DT)
    // 才過一步：還沒交
    expect(b.player.index).toBe(seat)
    for (let i = 0; i < Math.ceil(TAKEOVER_DELAY / DT) + 2; i++) stepBattle(b, DT)
    expect(b.player.index).toBe(wingSeat)
  })

  it('移交之後控制器換人、編制改釘新座位', () => {
    const controller = new Idle()
    const b = createBattle(controller, DEFAULT_BATTLE, 3)
    const wingSeat = wingmanSeat(b)
    killPlayerAndWait(b, b.red[0]!)
    expect(b.world.combatants[wingSeat]!.controller).toBe(controller)
    expect(b.flights.pinned).toBe(wingSeat)
    expect(playerFlight(b)!.members[0]).toBe(wingSeat)
  })

  it('舊機體維持陣亡 —— 不再重生，所以渲染層會留下殘骸', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    const seat = b.player.index
    killPlayerAndWait(b, b.red[0]!)
    expect(b.world.combatants[seat]!.alive).toBe(false)
  })

  it('沒有人可以接手時判落敗', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    for (const c of b.blue) if (c !== b.player) c.alive = false
    b.world.applyDamage(b.player, 99999, 'fuselage', b.red[0]!)
    stepBattle(b, DT)
    expect(b.outcome).toBe('defeat')
    // 沒有互換，陣亡就記在玩家自己頭上
    expect(b.roster.pilots[b.player.index]!.isPlayer).toBe(true)
    expect(b.roster.pilots[b.player.index]!.deaths).toBe(1)
  })

  it('延遲期間接手目標又被打死 —— 再換一次，玩家再吃一次陣亡', () => {
    // 【為什麼要有這條】那 2 秒裡接手目標仍由它原本的 AI 在飛，所以它有
    // 可能先死（M9 spec §7.4）。行為要明確，不是「怎麼會這樣」。
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    const wingSeat = wingmanSeat(b)
    b.world.applyDamage(b.player, 99999, 'fuselage', b.red[0]!)
    stepBattle(b, DT)
    expect(b.roster.pilots[wingSeat]!.isPlayer).toBe(true)

    b.world.applyDamage(b.world.combatants[wingSeat]!, 99999, 'fuselage', b.red[1]!)
    stepBattle(b, DT)
    expect(b.roster.pilots[wingSeat]!.isPlayer).toBe(false)
    const player = b.roster.pilots.find((p) => p.isPlayer)!
    expect(player.alive).toBe(true)
    expect(player.deaths).toBe(0)
  })
})
```

`import` 補上 `TAKEOVER_DELAY`：

```ts
import { TAKEOVER_DELAY } from '../../src/battle/takeover'
```

【注意】最後一條裡玩家的 `deaths` 是 0 —— 兩次陣亡都記在被互換出去的那兩位 AI 身上。這正是設計要的：玩家的那一列從頭到尾沒有死過。

- [ ] **Step 2: 跑測試確認會紅**

Run: `npx vitest run test/unit/battle-setup.test.ts`
Expected: FAIL —— `b.takeoverSeat` 不存在、`b.player` 不會改變

- [ ] **Step 3: 實作**

`src/battle/setup.ts` 的 import 補上：

```ts
import { swapPilots } from './pilots'
import { pickTakeover, TAKEOVER_DELAY } from './takeover'
```

（`swapPilots` 與 Task 8 的 `createRoster, recordKill` 併在同一行 import。）

`Battle` 介面把 `readonly player: Combatant` 改成：

```ts
  /**
   * 玩家目前開的那一架。恆在 `blue` 裡。
   *
   * 【M9 起不是 readonly】玩家陣亡會接手僚機，那時這個參考會換一架
   * （M9 spec §7.2）。`main.ts` 每幀比對它有沒有變，變了就把鏡頭、
   * 觀測用 AI 與第一人稱眼點一起搬過去。
   */
  player: Combatant
  /** 玩家的**開局**座位。R 重開時要還原回這裡 */
  readonly playerSeat: number
  /** 玩家的控制器。接手時要把它裝到新座位上 */
  readonly playerController: Controller
  /** 正在等待接手的座位；−1 = 沒有在等待 */
  takeoverSeat: number
  /** 接手倒數的剩餘秒數 */
  takeoverTimer: number
```

`createBattle` 的 `const battle: Battle = {` 加：

```ts
    playerSeat: player.index,
    playerController,
    takeoverSeat: -1,
    takeoverTimer: 0,
```

`drainKills` 在 `assistCredits` **之前**插入互換：

```ts
function drainKills(b: Battle): void {
  const ke = b.world.killEvents
  const w = b.world
  for (let e = 0; e < ke.count; e++) {
    const o = e * KILL_STRIDE
    const victim = ke.data[o + 6]!
    const killer = ke.data[o + 7]!

    // 【互換必須在記錄之前】反過來的話這次陣亡與兇手的擊墜對象都會記到
    // 玩家頭上，交換只是把它搬給 AI —— 一個順序解決兩件事（M9 spec §7.1）。
    //
    // 【判準是「這個座位坐的是不是玩家」而不是 `victim === b.player.index`】
    // 移交延遲期間玩家的身分已經在新座位上，但 `b.player` 還沒換。用後者
    // 的話，延遲期間新座位被打死就不會再觸發接手（M9 spec §7.4）。
    if (b.roster.pilots[victim]?.isPlayer === true) {
      const target = pickTakeover(b.flights, w.combatants, victim)
      if (target >= 0) {
        swapPilots(b.roster, victim, target)
        b.takeoverSeat = target
        b.takeoverTimer = TAKEOVER_DELAY
      }
    }

    assistCredits(w.damageTime, w.damageStride, victim, killer, w.time, ASSISTS)
    recordKill(b.roster, victim, killer, ASSISTS)
  }
}
```

在 `stepBattle` 裡，**`compactFlights` 之前**插入倒數：

```ts
  // 【倒數要排在壓縮之前】移交會改 `flights.pinned`，同一步的壓縮才會把
  // 玩家放到新分隊的 members[0]
  if (b.takeoverSeat >= 0) {
    b.takeoverTimer -= dt
    if (b.takeoverTimer <= 0) completeTakeover(b)
  }

  compactFlights(b.flights, cs)
  wireStations(b)
```

在 `stepBattle` 之前加：

```ts
/**
 * 把操縱權交到等待中的座位上。
 *
 * 【為什麼身分立刻換、操縱權延後】那 2 秒是給玩家看自己的火球與零件的
 * （M8 條件 17 的前提）。但擊墜的歸屬必須在事件發生的那一刻就定案，
 * 否則兇手記到的是玩家而不是那位 AI（M9 spec §7.2）。
 */
function completeTakeover(b: Battle): void {
  const seat = b.takeoverSeat
  b.takeoverSeat = -1
  b.takeoverTimer = 0
  const next = b.world.combatants[seat]
  // 【目標可能在這 2 秒裡也死了】那時 drainKills 已經又換過一次身分並重設
  // 了倒數，所以走到這裡的座位恆是活的；這一條是防禦，不是常態路徑。
  if (next === undefined || !next.alive) return
  next.controller = b.playerController
  b.player = next
  // 站位由 wireStations 依 `instanceof AiController` 自動跟上
  b.flights.pinned = seat
}
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run test/unit/battle-setup.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/battle/setup.ts test/unit/battle-setup.test.ts
git commit -m "feat: 玩家陣亡接手僚機"
```

---

### Task 10: R 重開要完整復原

**Files:**
- Modify: `src/battle/setup.ts`（`resetBattle`）
- Test: `test/unit/battle-setup.test.ts`

**Interfaces:**
- Consumes: Task 9 的接手狀態、Task 2 的 `clearDamageLog`
- Produces: `resetBattle(b: Battle, seed?: number): void` —— 座位、控制器、名冊、傷害紀錄、結果全部歸位

- [ ] **Step 1: 寫測試**

`test/unit/battle-setup.test.ts` 檔尾加：

```ts
describe('R 重開的完整復原（M9 spec §8）', () => {
  it('玩家回到開局座位，被接手過的座位還給 AI', () => {
    const controller = new Idle()
    const b = createBattle(controller, DEFAULT_BATTLE, 3)
    const seat = b.playerSeat
    // 【僚機是同分隊的下一位，不是 blue[1]】玩家是正中央分隊的長機
    const wingSeat = playerFlight(b)!.members[1]!
    b.world.applyDamage(b.player, 99999, 'fuselage', b.red[0]!)
    for (let i = 0; i < Math.ceil(TAKEOVER_DELAY / DT) + 2; i++) stepBattle(b, DT)
    expect(b.player.index).toBe(wingSeat)

    resetBattle(b)
    expect(b.player.index).toBe(seat)
    expect(b.world.combatants[seat]!.controller).toBe(controller)
    expect(b.world.combatants[wingSeat]!.controller).toBeInstanceOf(AiController)
    expect(b.flights.pinned).toBe(seat)
  })

  it('戰績歸零、結果回到交戰中、接手狀態清空', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    b.world.applyDamage(b.red[0]!, 99999, 'fuselage', b.blue[1]!)
    stepBattle(b, DT)
    expect(b.roster.pilots[b.blue[1]!.index]!.kills).toBe(1)

    resetBattle(b)
    for (const p of b.roster.pilots) {
      expect(p.kills).toBe(0)
      expect(p.deaths).toBe(0)
      expect(p.assists).toBe(0)
      expect(p.alive).toBe(true)
    }
    expect(b.outcome).toBe('fighting')
    expect(b.takeoverSeat).toBe(-1)
  })

  it('重開換一批名字', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    const before = b.roster.pilots.map((p) => p.name)
    resetBattle(b, 99)
    expect(b.roster.pilots.map((p) => p.name)).not.toEqual(before)
  })

  it('重開清掉傷害紀錄 —— 上一場的擦傷不會變成這一場的助攻', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    const helper = b.blue[2]!
    const victim = b.red[0]!
    b.world.applyDamage(victim, 10, 'wingLeft', helper)
    resetBattle(b)
    b.world.applyDamage(victim, 99999, 'fuselage', b.blue[1]!)
    stepBattle(b, DT)
    expect(b.roster.pilots[helper.index]!.assists).toBe(0)
  })
})
```

- [ ] **Step 2: 跑測試確認會紅**

Run: `npx vitest run test/unit/battle-setup.test.ts`
Expected: FAIL —— 玩家沒有回到開局座位、名冊沒有歸零

- [ ] **Step 3: 實作**

`src/battle/setup.ts` 的 `resetBattle` 整個換掉：

```ts
/**
 * 整場回到滿編。
 *
 * 【與 R 鍵共用同一條路徑】兩份長得很像的初始化，就是只有一份會被修好的
 * 那種危險 —— 與 `Aircraft.respawn`、`World.destroy` 是同一個理由。
 *
 * @param seed 新的名字種子。省略時抽一個 —— 專案負責人裁決「再打一場則
 *             重新隨機」（M9 spec §6.1）。
 */
export function resetBattle(
  b: Battle, seed: number = (Math.random() * 0x100000000) >>> 0,
): void {
  b.world.projectiles.clear()
  const combatants = b.world.combatants
  for (let i = 0; i < combatants.length; i++) {
    const c = combatants[i]!
    b.world.respawn(c)
    // 【方位與速度要另外抄回去】`World.respawn` 走的是 `Aircraft.reset`，
    // 它重建的是一個「朝預設方向平飛」的狀態，不知道紅隊該朝 +Z。
    const q = b.spawnOrientations[i]!
    c.aircraft.state.orientation.copy(q)
    c.aircraft.prevOrientation.copy(q)
    c.aircraft.state.velocity.copy(FWD).applyQuaternion(q).multiplyScalar(c.spawnTas)
  }

  // 【被接手過的座位要還給 AI】接手時那顆 AiController 被丟掉了。少了這一段，
  // 重開之後戰場上會有一架永遠不動的飛機 —— 玩家的控制器同時裝在兩個座位上，
  // 而其中一個不會收到任何輸入。
  b.player = combatants[b.playerSeat]!
  b.flights.pinned = b.playerSeat
  b.takeoverSeat = -1
  b.takeoverTimer = 0
  for (const c of combatants) {
    if (c.index === b.playerSeat) {
      c.controller = b.playerController
      continue
    }
    if (c.controller instanceof AiController) continue
    const ai = new AiController()
    c.controller = ai
  }

  // 【名字重抽】專案負責人裁決「再打一場則重新隨機」
  b.seed = seed
  const blueNames = pilotNames(seed, factionOf(b.blue[0]!.aircraft.spec.id), b.blue.length)
  const redNames = pilotNames(seed, factionOf(b.red[0]!.aircraft.spec.id), b.red.length)
  let bi = 0
  let ri = 0
  for (let i = 0; i < combatants.length; i++) {
    const p = b.roster.pilots[i]!
    p.name = combatants[i]!.team === 'blue' ? blueNames[bi++]! : redNames[ri++]!
    p.kills = 0
    p.deaths = 0
    p.assists = 0
    p.alive = true
    p.isPlayer = i === b.playerSeat
  }

  b.world.clearDamageLog()
  b.board.assignments.fill(-1)
  compactFlights(b.flights, combatants)
  // 【wireStations 要在最後】它會依 `instanceof AiController` 重接站位參考，
  // 而上面剛換過控制器
  wireStations(b)
  b.outcome = 'fighting'
}
```

【注意】新建的 `AiController` 的 `board` / `selfIndex` / `setDecisionPhase` 由緊接著的 `wireStations` 之外還需要補 —— `wireStations` 只設站位。在 `for` 迴圈裡建 AI 時一併設：

```ts
    const ai = new AiController()
    ai.board = b.board
    ai.selfIndex = c.index
    ai.setDecisionPhase(c.index / combatants.length)
    c.controller = ai
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run test/unit/battle-setup.test.ts`
Expected: PASS

Run: `npm test`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
git add src/battle/setup.ts test/unit/battle-setup.test.ts
git commit -m "feat: R 重開完整復原座位、控制器、名冊與傷害紀錄"
```

---

### Task 11: 記分板的純函數

**Files:**
- Create: `src/ui/scoreboard.ts`（只放純函數，DOM 工廠在 Task 12 補進同一個檔）
- Test: `test/unit/scoreboard.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `Roster`、`Team`
- Produces: `interface ScoreRow { name: string; kills: number; deaths: number; assists: number; alive: boolean; isPlayer: boolean }`；`scoreRows(roster: Roster, seats: readonly { team: Team }[], team: Team): ScoreRow[]`；`sortScoreRows(rows: ScoreRow[]): ScoreRow[]`（就地排序並回傳同一個陣列）

- [ ] **Step 1: 寫測試**

建立 `test/unit/scoreboard.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { scoreRows, sortScoreRows, type ScoreRow } from '../../src/ui/scoreboard'
import { createRoster } from '../../src/battle/pilots'
import type { Team } from '../../src/world/World'

const SEATS: { team: Team }[] = [
  { team: 'blue' }, { team: 'blue' }, { team: 'red' }, { team: 'red' },
]

function row(name: string, kills: number, assists = 0): ScoreRow {
  return { name, kills, deaths: 0, assists, alive: true, isPlayer: false }
}

describe('scoreRows', () => {
  it('只取指定隊伍的列', () => {
    const r = createRoster(['A', 'B', 'C', 'D'], 0)
    expect(scoreRows(r, SEATS, 'blue').map((x) => x.name)).toEqual(['A', 'B'])
    expect(scoreRows(r, SEATS, 'red').map((x) => x.name)).toEqual(['C', 'D'])
  })

  it('戰績與存活、玩家標記照抄', () => {
    const r = createRoster(['A', 'B', 'C', 'D'], 1)
    r.pilots[1]!.kills = 3
    r.pilots[1]!.deaths = 1
    r.pilots[1]!.assists = 2
    r.pilots[1]!.alive = false
    const rows = scoreRows(r, SEATS, 'blue')
    expect(rows[1]).toEqual({
      name: 'B', kills: 3, deaths: 1, assists: 2, alive: false, isPlayer: true,
    })
  })
})

describe('sortScoreRows（M9 spec §9.3）', () => {
  it('依擊墜降序', () => {
    const rows = [row('A', 1), row('B', 5), row('C', 3)]
    expect(sortScoreRows(rows).map((x) => x.name)).toEqual(['B', 'C', 'A'])
  })

  it('擊墜相同時比助攻', () => {
    const rows = [row('A', 2, 1), row('B', 2, 4)]
    expect(sortScoreRows(rows).map((x) => x.name)).toEqual(['B', 'A'])
  })

  it('全部相同時比名字 —— 順序不能隨輸入順序漂移', () => {
    // 【為什麼要第三層】只比 K 的話同分的列會隨陣列順序跳動，畫面上看起來
    // 像 bug，而且測試會不穩定。
    const a = [row('Zed', 2, 1), row('Amy', 2, 1)]
    const b = [row('Amy', 2, 1), row('Zed', 2, 1)]
    expect(sortScoreRows(a).map((x) => x.name)).toEqual(['Amy', 'Zed'])
    expect(sortScoreRows(b).map((x) => x.name)).toEqual(['Amy', 'Zed'])
  })

  it('陣亡不影響排序 —— 打得好的死了還是在上面', () => {
    const dead = { ...row('A', 5), alive: false }
    const rows = [row('B', 1), dead]
    expect(sortScoreRows(rows).map((x) => x.name)).toEqual(['A', 'B'])
  })
})
```

- [ ] **Step 2: 跑測試確認會紅**

Run: `npx vitest run test/unit/scoreboard.test.ts`
Expected: FAIL —— 找不到模組 `src/ui/scoreboard`

- [ ] **Step 3: 實作**

建立 `src/ui/scoreboard.ts`：

```ts
import type { Roster } from '../battle/pilots'
import type { Team } from '../world/World'

/**
 * 記分板上的一列。
 *
 * 【為什麼另外定義而不是直接用 `Pilot`】`Pilot` 是可變的狀態、依座位索引；
 * 一列是某一隊、某一個排序下的快照。分開之後排序可以就地做而不會動到名冊。
 */
export interface ScoreRow {
  name: string
  kills: number
  deaths: number
  assists: number
  alive: boolean
  isPlayer: boolean
}

/** 取出某一隊的列。順序是座位順序 —— 排序交給 `sortScoreRows`。 */
export function scoreRows(
  roster: Roster, seats: readonly { team: Team }[], team: Team,
): ScoreRow[] {
  const out: ScoreRow[] = []
  for (let i = 0; i < seats.length; i++) {
    if (seats[i]!.team !== team) continue
    const p = roster.pilots[i]!
    out.push({
      name: p.name,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      alive: p.alive,
      isPlayer: p.isPlayer,
    })
  }
  return out
}

/**
 * 就地排序：擊墜降序 → 助攻降序 → 名字升序。
 *
 * 【為什麼一定要有第三層】只比擊墜的話，同分的列會隨著輸入順序跳動 ——
 * 畫面上看起來像 bug，而且測試會不穩定（M9 spec §9.3）。
 */
export function sortScoreRows(rows: ScoreRow[]): ScoreRow[] {
  rows.sort((a, b) => {
    if (b.kills !== a.kills) return b.kills - a.kills
    if (b.assists !== a.assists) return b.assists - a.assists
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
  return rows
}
```

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run test/unit/scoreboard.test.ts`
Expected: PASS（6 條）

- [ ] **Step 5: 提交**

```bash
git add src/ui/scoreboard.ts test/unit/scoreboard.test.ts
git commit -m "feat: 記分板的列建構與排序"
```

---

### Task 12: 記分板 DOM 元件與 TAB 繫結

**Files:**
- Modify: `src/ui/scoreboard.ts`（加 DOM 工廠）
- Modify: `index.html`
- Modify: `src/input/InputState.ts`
- Modify: `src/input/bindings.ts`
- Test: `test/unit/bindings.test.ts`

**Interfaces:**
- Consumes: Task 11 的 `ScoreRow` / `sortScoreRows`
- Produces: `createScoreboard(root: HTMLElement): Scoreboard`，其中 `interface Scoreboard { render(blue: ScoreRow[], red: ScoreRow[], banner: 'victory' | 'defeat' | null): void; setVisible(v: boolean): void }`；`InputState.scoreboardHeld: boolean`

- [ ] **Step 1: 寫 Tab 的測試**

`test/unit/bindings.test.ts` 檔尾加：

```ts
describe('TAB 記分板（M9 spec §9.4）', () => {
  it('按住為真、放開為假', () => {
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    expect(state.scoreboardHeld).toBe(false)
    dom.win.fire('keydown', { code: 'Tab', preventDefault() {} })
    expect(state.scoreboardHeld).toBe(true)
    dom.win.fire('keyup', { code: 'Tab' })
    expect(state.scoreboardHeld).toBe(false)
  })

  it('按住時要擋掉預設行為', () => {
    // 【為什麼】Tab 的預設行為是移動焦點 —— 不擋的話按一次就把焦點移出
    // canvas，之後所有鍵盤輸入都收不到。
    const dom = setupDom()
    const state = createInputState()
    attachInput(dom.canvas as unknown as HTMLCanvasElement, state)
    let prevented = 0
    dom.win.fire('keydown', { code: 'Tab', preventDefault() { prevented++ } })
    expect(prevented).toBe(1)
  })
})
```

（`setupDom()` 會把假的 `window` / `document` 塞進 `globalThis`，同檔的 `afterEach` 負責清掉 —— 照抄既有測試的兩行開場即可。）

- [ ] **Step 2: 跑測試確認會紅**

Run: `npx vitest run test/unit/bindings.test.ts`
Expected: FAIL —— `state.scoreboardHeld` 不存在

- [ ] **Step 3: 實作輸入**

`src/input/InputState.ts` 的 `InputState` 介面加：

```ts
  /**
   * 記分板是否按住（Tab）。
   *
   * 【為什麼是按住而不是切換】看戰績是一個「瞄一眼」的動作。切換式的話，
   * 忘了關就會擋著半個畫面繼續打。
   */
  scoreboardHeld: boolean
```

`createInputState` 的回傳物件加 `scoreboardHeld: false,`。

`src/input/bindings.ts` 的 `onKeyDown` 加一個 case：

```ts
      case 'Tab': state.scoreboardHeld = true; break
```

`onKeyUp` 加：

```ts
    if (e.code === 'Tab') state.scoreboardHeld = false
```

（`onKeyDown` 的 `switch` 末尾本來就有 `e.preventDefault()`，Tab 自動被擋掉。）

- [ ] **Step 4: 跑測試確認轉綠**

Run: `npx vitest run test/unit/bindings.test.ts`
Expected: PASS

- [ ] **Step 5: 加 DOM**

`index.html` 的 `<style>` 末尾加：

```css
      #board {
        position: fixed; inset: 0; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 18px;
        background: rgba(6, 10, 16, 0.72); pointer-events: none;
        font: 13px/1.5 ui-monospace, Consolas, monospace; color: #cfe0ef;
      }
      #board[hidden] { display: none; }
      #banner { font-size: 34px; letter-spacing: .18em; font-weight: 700; }
      #banner.victory { color: #7fd4a0; }
      #banner.defeat { color: #e08a8a; }
      #banner:empty { display: none; }
      #tables { display: flex; gap: 28px; align-items: flex-start; }
      #board table { border-collapse: collapse; min-width: 300px; }
      #board caption {
        text-align: left; padding-bottom: 4px; letter-spacing: .1em; font-weight: 700;
      }
      #board table.blue caption { color: #7fb2e0; }
      #board table.red caption { color: #e08a8a; }
      #board th {
        text-align: right; font-weight: 400; color: #6f8ba5;
        border-bottom: 1px solid #2b3f52; padding: 2px 8px;
      }
      #board th.name { text-align: left; }
      #board td { padding: 1px 8px; text-align: right; }
      #board td.name { text-align: left; }
      #board tr.dead { color: #5c6f80; }
      #board tr.me { background: rgba(90, 150, 210, 0.22); color: #eaf4ff; }
```

`<body>` 裡在兩個 canvas 之後加：

```html
    <div id="board" hidden>
      <div id="banner"></div>
      <div id="tables"></div>
    </div>
```

- [ ] **Step 6: 實作 DOM 工廠**

`src/ui/scoreboard.ts` 檔尾加（`import type` 不變，不要在模組層碰 `document`）：

```ts
export interface Scoreboard {
  /** 重畫。`banner` 為 null 時橫幅留白 */
  render(blue: ScoreRow[], red: ScoreRow[], banner: 'victory' | 'defeat' | null): void
  setVisible(v: boolean): void
}

const BANNER_TEXT = { victory: '勝　利', defeat: '落　敗' } as const

/**
 * 記分板的 DOM 元件。
 *
 * 【為什麼是 DOM 而不是 HUD 的 canvas】40 列 × 4 欄的表格、排序、灰字、
 * 高亮 —— canvas 要自己排版每一格。而且 M10 的結算畫面本來就是 DOM，
 * 兩邊共用同一個渲染函式（M9 spec §9.1）。
 *
 * 【為什麼整表重建而不是逐格更新】只在按住 TAB 或分出勝負時才呼叫，
 * 40 列的 `innerHTML` 重建在那個頻率下量不出來。逐格更新要維護一份
 * DOM 節點的索引，那是為了看不見的效能付看得見的複雜度。
 *
 * @param root 容器。必須含有 `#banner` 與 `#tables` 兩個子節點
 */
export function createScoreboard(root: HTMLElement): Scoreboard {
  const banner = root.querySelector('#banner') as HTMLElement
  const tables = root.querySelector('#tables') as HTMLElement

  function table(rows: ScoreRow[], team: 'blue' | 'red', title: string): string {
    const body = rows.map((r) => {
      const cls = [r.alive ? '' : 'dead', r.isPlayer ? 'me' : ''].filter(Boolean).join(' ')
      const name = r.isPlayer ? `${r.name}（你）` : r.name
      return `<tr class="${cls}"><td class="name">${escapeHtml(name)}</td>`
        + `<td>${r.kills}</td><td>${r.deaths}</td><td>${r.assists}</td></tr>`
    }).join('')
    return `<table class="${team}"><caption>${title}</caption>`
      + '<thead><tr><th class="name">飛行員</th><th>擊墜</th><th>陣亡</th><th>助攻</th></tr></thead>'
      + `<tbody>${body}</tbody></table>`
  }

  return {
    render(blue, red, outcome) {
      banner.textContent = outcome === null ? '' : BANNER_TEXT[outcome]
      banner.className = outcome ?? ''
      tables.innerHTML = table(blue, 'blue', '我方') + table(red, 'red', '敵方')
    },
    setVisible(v) {
      root.hidden = !v
    },
  }
}

/**
 * 名字是資料，不是標記。
 *
 * 【為什麼現在就要】名冊目前是寫死的常數，但 M10 之後很可能會有玩家自訂的
 * 呼號。到那時才補跳脫，等於留一個現成的注入點在那裡。
 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;'
      : c === '"' ? '&quot;' : '&#39;'
  ))
}
```

- [ ] **Step 7: 跑全套與建置**

Run: `npm test`
Expected: 全 PASS

Run: `npm run build`
Expected: 無型別錯誤

- [ ] **Step 8: 提交**

```bash
git add src/ui/scoreboard.ts src/input/InputState.ts src/input/bindings.ts \
  index.html test/unit/bindings.test.ts
git commit -m "feat: 記分板的 DOM 元件與 TAB 繫結"
```

---

### Task 13: `main.ts` 接線

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: Task 9 的 `Battle.player` 可寫、Task 11/12 的 `createScoreboard` / `scoreRows` / `sortScoreRows`、Task 12 的 `InputState.scoreboardHeld`
- Produces: 無（終端接線）

- [ ] **Step 1: 改玩家的參考**

把 `const player = battle.player` 改成：

```ts
/**
 * 玩家目前開的那一架。
 *
 * 【為什麼不是 const】接手僚機會換一架（M9 spec §7.2）。每幀比對
 * `battle.player`，變了就把觀測用 AI、第一人稱眼點與相機一起搬過去。
 */
let player = battle.player
```

在幀迴圈裡，`stepBattle` 的子步回呼**之後**、模型內插迴圈**之前**插入：

```ts
  if (battle.player !== player) {
    player = battle.player
    playerAi.selfIndex = player.index
    playerAi.setDecisionPhase(player.index / world.combatants.length)
    // 眼點是量出來的座艙位置，一機一個值 —— 兩隊機種不同時位置不一樣
    rig.options.firstPersonOffset.copy(visuals.get(player)!.model.eyePoint)
    // 【相機要瞬移過去】不 snap 的話會從舊機體的位置一路飛到新機體，
    // 那是一段跨越幾百公尺的鏡頭
    rig.snapTo(input.aimWorld)
    // 接手前八成正在拉大 G；不清掉的話接手後畫面還是黑的
    resetGEffect()
  }
```

- [ ] **Step 2: 移除死亡即重生**

刪掉這一段：

```ts
  // 【玩家陣亡與撞海走同一條路徑】…（既有註解）
  if (!player.alive) respawnPlayer()
```

連同它上方那段註解一起刪，並在原地留下：

```ts
  // 【玩家陣亡不再重生】M9 起改為接手僚機（`stepBattle` 的 takeover），
  // 舊機體於是像所有人一樣被殘骸池接管 —— M8 spec §10 預告的那件事現在
  // 自動成立了。
```

`respawnPlayer()` 保留 —— R 鍵那條路徑還在用。把它裡面的 `player` 換成 `battle.player`：

```ts
function respawnPlayer() {
  const p = battle.player
  p.aircraft.respawn(input.aimWorld, START_ALTITUDE, START_TAS)
  p.aircraft.state.position.copy(p.spawnPosition)
  p.aircraft.prevPosition.copy(p.spawnPosition)
  p.hp = p.aircraft.spec.hp
  p.alive = true
  p.cooldowns.fill(0)
  rig.snapTo(input.aimWorld)
  resetGEffect()
}
```

【注意】模組層的 `respawnPlayer()` 呼叫（初始化那一次）在 `battle` 建立之後，`battle.player` 已經有值，沒有問題。

R 鍵那一段在 `resetBattle(battle)` 之後補一行同步：

```ts
  if (input.resetRequested) {
    resetBattle(battle)
    player = battle.player
    respawnPlayer()
    input.resetRequested = false
  }
```

同時，重開時殘骸旗標要清掉，否則上一場變成殘骸的模型永遠不會回到內插迴圈：

```ts
    // 【殘骸旗標要一起清】不清的話上一場死掉的那些飛機在新的一場裡
    // 位置永遠停在殘骸池最後寫進去的地方 —— 看起來像一批不會動的飛機
    for (const v of visuals.values()) v.wrecked = false
```

放在 `resetBattle(battle)` 之後。

- [ ] **Step 3: 接記分板**

檔案上方 import 加：

```ts
import { createScoreboard, scoreRows, sortScoreRows } from './ui/scoreboard'
```

在 `const hud = new Hud(...)` 附近加：

```ts
const scoreboard = createScoreboard(document.getElementById('board') as HTMLElement)
```

在幀迴圈的 `ctx.renderer.render(...)` 之後、HUD 投影那一段之前（或迴圈末尾，順序不影響）加：

```ts
  // 【只在看得到的時候才重建】40 列的 innerHTML 重建不便宜到可以每幀做
  const finished = battle.outcome !== 'fighting'
  const showBoard = input.scoreboardHeld || finished
  if (showBoard) {
    scoreboard.render(
      sortScoreRows(scoreRows(battle.roster, world.combatants, 'blue')),
      sortScoreRows(scoreRows(battle.roster, world.combatants, 'red')),
      finished ? (battle.outcome === 'victory' ? 'victory' : 'defeat') : null,
    )
  }
  scoreboard.setVisible(showBoard)
```

- [ ] **Step 4: 建置與手動檢查**

Run: `npm run build`
Expected: 無型別錯誤

Run: `npm run dev`，開 `http://localhost:5173/`，逐一走一次 §13 的人工驗收條件 1–11。

- [ ] **Step 5: 提交**

```bash
git add src/main.ts
git commit -m "feat: main.ts 接上記分板、勝敗橫幅與接手僚機的視覺轉移"
```

---

### Task 14: 整合測試 —— 守恆律與 2v2 分勝負

**Files:**
- Modify: `test/integration/multi-battle.test.ts`

**Interfaces:**
- Consumes: Task 8/9/10 的完整 `stepBattle`
- Produces: 無

- [ ] **Step 1: 寫測試**

`test/integration/multi-battle.test.ts` 檔尾加：

```ts
describe('戰績的守恆律（M9 spec §11）', () => {
  it('全體擊墜數 = 全體陣亡數 − 自摔數', () => {
    // 【為什麼這是最有力的一條】任何漏記或重複記都會讓它失衡。逐條斷言
    // 「這一次擊墜記對了嗎」只覆蓋得到想得到的情況；這一條覆蓋全部。
    const b = createBattle(new Idle())
    let selfDestructs = 0
    for (let i = 0; i < Math.ceil(90 / DT); i++) {
      stepBattle(b, DT)
      const ke = b.world.killEvents
      for (let e = 0; e < ke.count; e++) {
        if (ke.data[e * KILL_STRIDE + 7] === -1) selfDestructs++
      }
      clearKills(b.world.killEvents)
      clearImpacts(b.world.hitEvents)
      clearImpacts(b.world.splashEvents)
      if (b.outcome !== 'fighting') break
    }
    const kills = b.roster.pilots.reduce((s, p) => s + p.kills, 0)
    const deaths = b.roster.pilots.reduce((s, p) => s + p.deaths, 0)
    expect(deaths).toBeGreaterThan(0)
    expect(kills).toBe(deaths - selfDestructs)
  })

  it('陣亡的飛行員數等於退場的座位數', () => {
    // 【為什麼要分開測】上一條守的是「記了幾次」，這一條守的是「記在誰身上」。
    // 接手時身分互換，兩者仍然必須對得起來。
    const b = createBattle(new Idle())
    for (let i = 0; i < Math.ceil(90 / DT); i++) {
      stepBattle(b, DT)
      clearKills(b.world.killEvents)
      clearImpacts(b.world.hitEvents)
      clearImpacts(b.world.splashEvents)
      if (b.outcome !== 'fighting') break
    }
    const deadSeats = b.world.combatants.filter((c) => !c.alive).length
    const deadPilots = b.roster.pilots.filter((p) => !p.alive).length
    expect(deadPilots).toBe(deadSeats)
  })
})

describe('小規模殲滅（M9 spec §8）', () => {
  it('2v2 打到分出勝負，而且戰績對得上', () => {
    const cfg = { ...DEFAULT_BATTLE, perSide: 2, entryRange: 1500 }
    const b = createBattle(new Idle(), cfg, 1)
    let steps = 0
    const limit = Math.ceil(180 / DT)
    while (b.outcome === 'fighting' && steps < limit) {
      stepBattle(b, DT)
      clearKills(b.world.killEvents)
      clearImpacts(b.world.hitEvents)
      clearImpacts(b.world.splashEvents)
      steps++
    }
    expect(b.outcome).not.toBe('fighting')
    if (b.outcome === 'victory') expect(aliveCount(b.red)).toBe(0)
    else expect(aliveCount(b.blue)).toBe(0)
    // 名冊裡活著的人數 = 場上活著的座位數
    expect(b.roster.pilots.filter((p) => p.alive).length)
      .toBe(b.world.combatants.filter((c) => c.alive).length)
  })
})
```

`import` 補上：

```ts
import { KILL_STRIDE } from '../../src/world/kills'
```

（`clearKills`、`clearImpacts`、`aliveCount`、`DEFAULT_BATTLE` 這個檔案已經有了。）

- [ ] **Step 2: 跑測試**

Run: `npx vitest run test/integration/multi-battle.test.ts`
Expected: PASS。

**若守恆律紅了，那是真的缺陷，不要調整斷言。** 依這個順序找：

1. `recordKill` 的「已陣亡就略過」是不是被繞過了 —— 那是重掃冪等性的唯一依靠。
2. 有沒有哪條路徑繞過 `World.destroy` 直接把 `alive` 設成 false（那樣就不會推事件）。
3. 接手的身分互換排在 `recordKill` 之後的話，兇手會記到玩家頭上，**但總數仍然守恆** —— 所以守恆律紅了不會是這一項，別往那裡找。

**若 2v2 在 180 秒內沒有分出勝負**，先把 `entryRange` 再調小（例如 800）確認是不是接近時間不夠；仍然不行的話，改成人為打光一方並斷言 `outcome`，並在測試裡註明為什麼放棄真打（AI 在 2v2 下可能陷入互相追不到的僵局，那是 AI 的性質不是這一版的缺陷）。

- [ ] **Step 3: 跑全套與建置**

Run: `npm test`
Expected: 全 PASS（`perf-gate` 若閃紅，單獨重跑）

Run: `npm run build`
Expected: 無型別錯誤

- [ ] **Step 4: 更新 spec 的交付紀錄**

在 `docs/superpowers/specs/2026-08-04-m9-scoreboard-design.md` 末尾加一節：

```markdown
---

## 15. 交付紀錄

### 15.1 實作中發現並修掉的缺陷

（實作時填入實際遇到的問題、怎麼發現的、為什麼會發生。沒有就寫「無」。）

### 15.2 與 spec 的偏離

（實作時填入。沒有就寫「無」。）
```

實作過程中若有與 spec 不符的決定，一律記在這裡並說明理由 —— 與 M8 spec §17 同一個做法。

- [ ] **Step 5: 提交**

```bash
git add test/integration/multi-battle.test.ts docs/superpowers/specs/2026-08-04-m9-scoreboard-design.md
git commit -m "test: 戰績的守恆律與 2v2 殲滅整合測試"
```

---

## 人工驗收（全部任務完成後）

依 spec §13 逐條走一次。開 `npm run dev` → `http://localhost:5173/`：

1. 按住 TAB 看得到雙方各 20 列，依擊墜排序，自己那一列高亮並標「（你）」。
2. 打下一架敵機 → 自己的擊墜加一。
3. 打傷一架、由僚機補掉 → 自己拿到助攻。
4. 只擦到一發、二十幾秒後那架才被打掉 → **沒有**助攻。
5. 自己撞海 → 沒有任何人的擊墜增加。
6. 自己被打下來 → 看得到火球與零件散開約兩秒，然後接手僚機。
7. 接手之後記分板上自己的名字在活著那一列、擊墜數沒有歸零，被接手的那位在陣亡列。
8. 接手後按 V 切第一人稱，眼點在座艙裡而不是機外。
9. 接手後僚機隊形沒有亂掉（自己仍然是分隊長機）。
10. 打光敵人 → 勝利橫幅 + 記分板攤開；按 R 重開，戰績歸零、名字換一批。
11. 藍隊被打光 → 落敗橫幅。
12. 一場打完，記分板上雙方擊墜的總和等於陣亡數減去自摔數。

---

## 自我覆核

**spec 覆蓋**

| spec 章節 | 由哪個任務實作 |
|---|---|
| §3 飛行員與座位分離 | Task 5 |
| §4.1 兇手 | Task 1 |
| §4.2 事件多帶一欄 | Task 1 |
| §4.3 誰來記 | Task 8 |
| §5 助攻 | Task 2（表格）＋ Task 3（掃描）＋ Task 8（接線） |
| §6 名冊與名字 | Task 4（產生）＋ Task 8（指派）＋ Task 10（重抽） |
| §7.1 互換順序 | Task 9 |
| §7.2 延遲與轉移 | Task 9（邏輯）＋ Task 13（視覺） |
| §7.3 無人可接 | Task 9 |
| §7.4 延遲期間目標陣亡 | Task 9 |
| §8 勝負結果 | Task 7 |
| §9 記分板 | Task 11（純函數）＋ Task 12（DOM 與 TAB） |
| §11 測試 | 各任務 ＋ Task 14 |
| §12 常數 | `ASSIST_WINDOW`（Task 3）、`TAKEOVER_DELAY`（Task 6）、名冊大小（Task 4） |

**型別一致性**：`Roster` / `Pilot`（Task 5）→ `scoreRows`（Task 11）→ `createScoreboard`（Task 12）；`TakeoverSeat`（Task 6）由 `Combatant` 結構性滿足；`Outcome`（Task 7）→ `scoreboard.render` 的 `banner` 參數（Task 12）→ `main.ts`（Task 13）。`KILL_STRIDE = 8`（Task 1）在 Task 8 與 Task 14 被引用。

**已知的順序相依**（實作時要守住）：

- Task 8 的 `drainKills` **不記游標**，重掃的冪等性靠 `recordKill` 的「已陣亡就略過」。動那個守衛之前先想清楚這件事。
- Task 9 的 `swapPilots` 必須在 `recordKill` **之前**。
- Task 9 的接手倒數必須在 `compactFlights` **之前**。
- Task 10 的 `wireStations` 必須在換完控制器**之後**。
