# PLAN：艦隊防空

> **給執行者：** 這份計畫用 `superpowers:subagent-driven-development` 或
> `superpowers:executing-plans` 逐項執行。步驟是 `- [ ]` 的核取方塊。

**目標**：把 `src/world/shipAA.ts` 那張砲位表接進戰鬥——四艘船在海上緩速
直航、三層防空火力開火、砲位可以被打掉，並且把 `japan-m4` 倫內爾島這一關
從 `battle: null` 做出來。

**架構**：船是**獨立實體**（`World.ships`），不是 `Combatant`。砲位借用
`weapons/turret.ts` 那幾支純函數瞄準，但射速時鐘、傷害公式、目標來源各走
各的。5 吋砲不進彈丸池，另開一個小池只算引信與引爆。

**技術**：TypeScript 5.7、three.js 0.180、vitest 2.1、Playwright 1.62。

**Spec**：`docs/superpowers/specs/2026-09-04-carrier-group-design.md`
（第二版，已折進 Codex 的七個 P0）。**執行時兩份一起讀。**

**分支**：`feat/carrier-group`

---

## 全域限制

每一項任務都隱含這些要求：

- **`npx tsc --noEmit` 維持 23 行。** 這是基準，不是「越少越好」——多一行就是
  這一步引入的，少一行代表你順手改了不該改的東西。
- **單元測試一次只跑一個 vitest。** 兩個並行會 OOM。用
  `npx vitest run test/unit/<檔名>` 指名跑，不要用 `npm test`。
- **熱路徑零配置。** 240 Hz 的固定步模擬。模組私有的 `Vector3` 暫存重用，
  禁止在每步的迴圈裡 `new`。暫存**不得跨模組共用**。
- **e2e 用 `npx vite-node`，不能用 `tsx`**（`tsx` 會在 `page.evaluate` 裡
  `__name is not defined`）。dev server 用 5178。
- **提交訊息只留 `Co-Authored-By`**，不附 session 網址。
- **效能閘門現在本來就是紅的**（20v20 1,274 µs > 900 等三項）。這與
  `docs/backlog.md` §1.1 一致。**不要為了讓它變綠而改任何東西**，見 T10。
- 註解寫現狀不寫沿革；可調參數就地改掉，不要在註解裡疊一行歷史。

---

## 檔案地圖

| 檔案 | 職責 | 任務 |
|---|---|---|
| `src/world/hit.ts` | 抽出 `Box`，`segmentBox` 改收 `Box` | T1 |
| `src/world/obb.ts` | **新**。兩個帶姿態的盒相交嗎（分離軸） | T1 |
| `src/world/ships.ts` | **新**。艦級表、船的建立／重設／直航 | T2 |
| `src/world/Projectiles.ts` | 加 `team` 與 `life` 兩個必填欄位 | T3 |
| `src/world/shipGuns.ts` | **新**。砲位狀態、瞄準、開火 | T4 |
| `src/world/flak.ts` | **新**。高砲彈池、引信、引爆事件 | T5 |
| `src/world/World.ts` | `ships` 陣列、step 三段、對船的命中、撞船 | T6 |
| `src/world/turrets.ts` | 飛機砲塔可以瞄船上的砲位 | T7 |
| `src/battle/missions.ts` | `MissionFleet` 型別、`japan-m4` 的 battle | T8 |
| `src/battle/setup.ts` | `BattleConfig.fleet`、建船、`resetBattle` 重設 | T8 |
| `src/render/ships.ts` | **新**。船的 GLB、砲管、槍焰 | T9 |
| `src/render/flakBursts.ts` | **新**。黑雲粒子池 | T9 |
| `src/main.ts` | 接線 | T9 |

---

## Task 1：`Box` 抽出與 OBB 相交

**檔案**
- 修改：`src/world/hit.ts:27`（`HitBox`）、`:65`（`segmentBox`）
- 新增：`src/world/obb.ts`
- 測試：`test/unit/obb.test.ts`

**介面**
- 產出給後續任務：
  ```ts
  export interface Box { center: Vector3; half: Vector3 }
  export interface HitBox extends Box { part: HitPart }
  export function obbOverlap(
    ac: Vector3, ah: Vector3, aq: Quaternion,
    bc: Vector3, bh: Vector3, bq: Quaternion,
  ): boolean
  ```

- [ ] **步驟 1：寫紅的測試**

建立 `test/unit/obb.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { obbOverlap } from '../../src/world/obb'
import { DEG } from '../../src/core/math'

const I = new Quaternion()
const half = (x: number, y: number, z: number) => new Vector3(x, y, z)

describe('obbOverlap', () => {
  it('分開的兩個軸對齊盒不相交', () => {
    expect(obbOverlap(
      new Vector3(0, 0, 0), half(1, 1, 1), I,
      new Vector3(3, 0, 0), half(1, 1, 1), I,
    )).toBe(false)
  })

  it('重疊的兩個軸對齊盒相交', () => {
    expect(obbOverlap(
      new Vector3(0, 0, 0), half(1, 1, 1), I,
      new Vector3(1.5, 0, 0), half(1, 1, 1), I,
    )).toBe(true)
  })

  /**
   * 【這一條才是真正要守的】兩個盒的**面**都分不開它們，只有「A 的某一軸
   * 叉乘 B 的某一軸」那九條軸分得開。只測前六軸的實作會在這裡回傳 true。
   *
   * 兩根細長棒十字交叉、錯開一點高度：不相交，但六個面軸投影全部重疊。
   */
  it('十字交叉但錯開高度的兩根細棒 —— 只有叉乘軸分得開', () => {
    const a = new Quaternion()
    const b = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 90 * DEG)
    expect(obbOverlap(
      new Vector3(0, 0, 0), half(5, 0.2, 0.2), a,
      new Vector3(0, 0.5, 0), half(5, 0.2, 0.2), b,
    )).toBe(false)
  })

  it('十字交叉且同高度的兩根細棒相交', () => {
    const b = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 90 * DEG)
    expect(obbOverlap(
      new Vector3(0, 0, 0), half(5, 0.2, 0.2), new Quaternion(),
      new Vector3(0, 0, 0), half(5, 0.2, 0.2), b,
    )).toBe(true)
  })

  it('45° 旋轉的盒 —— 世界 AABB 會相交但實際不相交', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 45 * DEG)
    // 邊長 2 的正方，旋轉 45° 之後對角半徑 1.414；心距 2.6 沿 X
    expect(obbOverlap(
      new Vector3(0, 0, 0), half(1, 1, 1), q,
      new Vector3(2.6, 0, 0), half(1, 1, 1), q,
    )).toBe(false)
  })

  it('一個盒完全在另一個盒內 —— 相交', () => {
    expect(obbOverlap(
      new Vector3(0, 0, 0), half(10, 10, 10), new Quaternion(),
      new Vector3(1, 1, 1), half(0.5, 0.5, 0.5), new Quaternion(),
    )).toBe(true)
  })
})
```

- [ ] **步驟 2：跑測試確認它紅**

```
npx vitest run test/unit/obb.test.ts
```

預期：`Failed to resolve import "../../src/world/obb"`。

- [ ] **步驟 3：抽出 `Box`**

`src/world/hit.ts`，把現有的 `HitBox` 換成：

```ts
/**
 * 一個軸對齊盒，**擁有者的區域座標**。
 *
 * 【為什麼與 `HitBox` 分開】船的砲位盒不需要 `HitPart` ——那是飛機的六個
 * 部位。而 `segmentBox` 本來就只讀 `center` 與 `half`，強迫船帶一個
 * 「機翼」或「座艙」的標籤只是為了通過型別檢查。
 */
export interface Box { center: Vector3; half: Vector3 }

/**
 * 一個命中盒，**機體座標**的 AABB。
 *
 * 【為什麼定義在機體座標而不是世界座標】判定前把線段轉進機體座標，
 * 等價於世界座標的 OBB，飛機滾轉不失真。世界座標的 AABB 在 45° 滾轉時
 * 會膨脹到 1.41 倍——機翼是薄板，那等於憑空長出一公尺厚。
 */
export interface HitBox extends Box { part: HitPart }
```

`segmentBox` 的參數型別 `box: HitBox` 改成 `box: Box`。**其餘一行不動。**

- [ ] **步驟 4：確認既有測試全綠**

```
npx vitest run test/unit/hit.test.ts
npx vitest run test/unit/weapons.test.ts
npx tsc --noEmit
```

預期：測試綠，tsc 23 行。這一步**沒有任何行為改變**，只是型別放寬。

- [ ] **步驟 5：寫 `src/world/obb.ts`**

```ts
import { Matrix3, Quaternion, Vector3 } from 'three'

/**
 * 兩個帶姿態的盒相交嗎（分離軸測試）。
 *
 * 【為什麼一定要 15 條軸而不是 6 條】只測兩個盒各自的三個面法線，會漏掉
 * 「兩根細棒十字交叉」那一類：六個面軸的投影全部重疊，只有 `a_i × b_j`
 * 那九條叉乘軸分得開。漏掉的症狀是**飛機從艦橋旁邊擦過去卻判成撞上**，
 * 而且只在特定角度發生。
 *
 * 【為什麼不加 epsilon 容差】平行軸的叉乘長度是 0，那時投影恆為 0、
 * 不可能分離，所以直接跳過即可；加容差反而會讓「剛好貼面」變成不相交。
 */
export function obbOverlap(
  ac: Vector3, ah: Vector3, aq: Quaternion,
  bc: Vector3, bh: Vector3, bq: Quaternion,
): boolean
```

實作要點（熱路徑之外，但仍不配置——模組私有暫存重用）：

1. 取 A 與 B 的三個軸向量（各自四元數旋轉出的基底），存進模組私有的
   六個 `Vector3`。
2. `d = bc − ac`。
3. 對 15 條候選軸各做一次：`|d·L| > Σ|ah_i · (a_i·L)| + Σ|bh_j · (b_j·L)|`
   則分離、回傳 false。
4. 叉乘軸的長度平方小於 `1e-12` 時**跳過那一條**（兩軸平行）。
5. 15 條都不分離 → 回傳 true。

- [ ] **步驟 6：跑測試確認全綠**

```
npx vitest run test/unit/obb.test.ts
```

預期：六條全過。特別確認「十字交叉但錯開高度」那一條是 `false`——那條紅
代表你只做了六條面軸。

- [ ] **步驟 7：提交**

```bash
git add src/world/hit.ts src/world/obb.ts test/unit/obb.test.ts
git commit -m "feat: Box 從 HitBox 抽出；新增 OBB 分離軸相交測試

船的砲位盒不需要 HitPart。segmentBox 本來就只讀 center 與 half。

obb.ts 是給「飛機撞船」用的：飛機的命中盒是機體 AABB ＋ 姿態 ＝ OBB，
船體盒同理。15 條軸，少了那九條叉乘軸會把「從艦橋旁擦過」判成撞上。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：`world/ships.ts` —— 艦級表、建隊、直航

**檔案**
- 新增：`src/world/ships.ts`
- 測試：`test/unit/ships.test.ts`

**介面**
- 取用：T1 的 `Box`
- 產出：
  ```ts
  export type ShipClassId = 'essex' | 'fletcher' | 'wichita'
  export interface ShipClass {
    readonly id: ShipClassId
    readonly name: string
    readonly url: string
    readonly hull: readonly Box[]
    readonly radius: number
    readonly hp: number
    readonly zones: readonly ShipAAZone[]
  }
  export const SHIP_CLASSES: Readonly<Record<ShipClassId, ShipClass>>
  export interface Ship {
    readonly index: number
    readonly team: Team
    readonly cls: ShipClass
    readonly position: Vector3
    readonly orientation: Quaternion
    readonly spawn: Vector3        // 重設用
    readonly heading: number
    speed: number
    hp: number
    guns: ShipGun[]                // T4 填，這一步先給空陣列
    gunCooldowns: Float32Array     // T4 用
  }
  export function createShip(
    index: number, cls: ShipClass, team: Team,
    x: number, z: number, heading: number, speed: number,
  ): Ship
  export function resetShip(s: Ship): void
  export function stepShips(ships: readonly Ship[], dt: number): void
  ```

- [ ] **步驟 1：寫紅的測試**

建立 `test/unit/ships.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { SHIP_CLASSES, createShip, resetShip, stepShips } from '../../src/world/ships'
import { SHIP_AA_ZONES } from '../../src/world/shipAA'
import { boundingRadius } from '../../src/world/hit'

describe('SHIP_CLASSES', () => {
  it('三個艦級都有，砲區表對得上 shipAA', () => {
    expect(SHIP_CLASSES.wichita.zones).toBe(SHIP_AA_ZONES.wichita)
    expect(SHIP_CLASSES.fletcher.zones).toBe(SHIP_AA_ZONES.fletcher)
    expect(SHIP_CLASSES.essex.zones).toBe(SHIP_AA_ZONES.essex)
  })

  /**
   * 【包圍球必須是上界】算小了會靜靜地漏掉命中 —— 子彈穿過艦艏卻不扣血，
   * 而且只在特定角度發生。與 `hit.ts` 的 `boundingRadius` 同一條規則。
   *
   * 這裡連砲位一起檢查：砲位在上層建築上，可能比船體盒更遠。
   */
  it('包圍球半徑覆蓋得住船體盒與所有砲位', () => {
    for (const cls of Object.values(SHIP_CLASSES)) {
      const hullR = boundingRadius(cls.hull.map((b) => ({ ...b, part: 'fuselage' as const })))
      expect(cls.radius).toBeGreaterThanOrEqual(hullR)
      for (const z of cls.zones) {
        expect(cls.radius).toBeGreaterThanOrEqual(z.position.length())
      }
    }
  })

  it('船體盒不是空的', () => {
    for (const cls of Object.values(SHIP_CLASSES)) {
      expect(cls.hull.length).toBeGreaterThan(0)
    }
  })
})

describe('stepShips', () => {
  it('艏向 0 時朝 −Z 前進，60 秒走 480 m', () => {
    const s = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 8)
    for (let i = 0; i < 60 * 240; i++) stepShips([s], 1 / 240)
    expect(s.position.z).toBeCloseTo(-480, 2)
    expect(s.position.x).toBeCloseTo(0, 6)
    expect(s.position.y).toBe(0)
  })

  it('艏向 90° 時朝 −X 前進', () => {
    const s = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, Math.PI / 2, 8)
    for (let i = 0; i < 240; i++) stepShips([s], 1 / 240)
    expect(s.position.x).toBeCloseTo(-8, 4)
    expect(s.position.z).toBeCloseTo(0, 6)
  })

  /** 【不轉向】負責人裁定：固定艏向、不閃避。 */
  it('艏向從頭到尾不變', () => {
    const s = createShip(0, SHIP_CLASSES.wichita, 'red', 100, 200, 1.1, 8)
    const q = s.orientation.clone()
    for (let i = 0; i < 1000; i++) stepShips([s], 1 / 240)
    expect(s.orientation.equals(q)).toBe(true)
  })
})

describe('resetShip', () => {
  it('位置回到起點、血量回滿', () => {
    const s = createShip(0, SHIP_CLASSES.wichita, 'red', 300, -400, 0.5, 8)
    for (let i = 0; i < 2400; i++) stepShips([s], 1 / 240)
    s.hp = 1
    resetShip(s)
    expect(s.position.x).toBeCloseTo(300, 6)
    expect(s.position.z).toBeCloseTo(-400, 6)
    expect(s.hp).toBe(SHIP_CLASSES.wichita.hp)
  })
})
```

- [ ] **步驟 2：跑測試確認它紅**

```
npx vitest run test/unit/ships.test.ts
```

預期：`Failed to resolve import "../../src/world/ships"`。

- [ ] **步驟 3：量出船體盒**

**不要用猜的。** 三艘船的 GLB 在 `public/models/`，建模腳本在
`tools/blender/build_*.py`。用腳本裡的尺寸推船體盒——`build_wichita.py`
與 `build_fletcher.py` 的開頭有全長、舷寬、水線高與上層建築的高度帶。

每艘兩個盒：

- **艦體**：從艦艏到艦艉、舷寬、水線到主甲板。
- **上層建築**：艦橋與桅的那一段，較短、較窄、較高。

寫成 `makeBox(min, max)`（照 `hit.ts:36` 的 `makeHitBox` 的形式，但不帶
`part`）。**座標系與 `shipAA.ts` 一致**：+X 右舷、Y 上、−Z 艦首，
原點在水線 × 艦體中點 × 中線。

`radius` 取「船體盒最遠角」與「最遠砲位」兩者的最大值，**再加 5 m 餘裕**。

- [ ] **步驟 4：寫 `src/world/ships.ts`**

血量起始值（spec §5.2）：Wichita 40,000、Fletcher 20,000、Essex 60,000。

`stepShips` 的實作要點：

```ts
/** 模組私有暫存，熱路徑零配置。禁止跨模組共用。 */
const FWD = /* @__PURE__ */ new Vector3()

export function stepShips(ships: readonly Ship[], dt: number): void {
  for (const s of ships) {
    // 艏向 0 = 朝 −Z，與艦體座標一致
    FWD.set(0, 0, -1).applyQuaternion(s.orientation)
    s.position.addScaledVector(FWD, s.speed * dt)
  }
}
```

`createShip` 的 `orientation` 用 `setFromAxisAngle(UP, heading)`；
`position.y` 恆為 0（水線）。

- [ ] **步驟 5：跑測試確認全綠**

```
npx vitest run test/unit/ships.test.ts
npx tsc --noEmit
```

- [ ] **步驟 6：提交**

```bash
git add src/world/ships.ts test/unit/ships.test.ts
git commit -m "feat: 船的資料與運動 —— 艦級表、建隊、緩速直航

三個艦級的船體盒從 tools/blender/build_*.py 的尺寸推出來，座標系與
shipAA.ts 一致。包圍球是上界（含砲位）—— 算小了會靜靜地漏掉命中。

固定艏向、不轉向、不閃避（負責人裁定）。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：彈丸池加 `team` 與 `life`

**這一步不加任何新行為，只加欄位。** 護欄是逐位元不變。

**檔案**
- 修改：`src/world/Projectiles.ts`、`src/world/World.ts:459`、
  `src/world/turrets.ts:268`、`src/tools/propdisc.ts:160`，以及所有其他
  `spawn` 呼叫點（全樹 64 處、16 個檔案）
- 修改：`test/tools/spawn-snapshot.ts`（加一個帶砲塔的場景）
- 修改：`test/fixtures/spawn-baseline.ts`（**改動前**先抓新場景的基準）

**介面**
- 產出：
  ```ts
  spawn(
    px: number, py: number, pz: number,
    vx: number, vy: number, vz: number,
    damage: number, owner: number, team: number, life: number,
  ): number
  ```
  `team`：0 = blue、1 = red。與 `resolveHits` 現有的 0/1 約定同一套。

- [ ] **步驟 1：先加砲塔場景並在改動前抓基準**

**順序很重要**：這一步要在動 `Projectiles.ts` **之前**做完並提交，
否則抓到的基準是改動後的，等於自己證明自己。

`test/tools/spawn-snapshot.ts` 的 `SCENES` 加一個：

```ts
  /**
   * 【為什麼要第三個場景】前兩個是 P-51D 與 Bf 109，只跑得到 `World.fire`
   * 的固定掛架，**跑不到 `stepTurrets` 生彈丸那一行**。而
   * `turret-replay.test.ts` 是把新實作跑兩次互相比較 —— 參數順序接反的話
   * 兩次會一樣地錯，測試照樣綠。
   */
  ESCORT_B17: (): BattleConfig => ({
    ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, B17G, 4, BF109K4, 8),
  }),
```

（`B17G` 從 `../../src/specs/b17g` import。）

跑 `test/tools/spawn-baseline.probe.ts` 重抓 `test/fixtures/spawn-baseline.ts`，
確認既有兩個場景的數字**一格都沒變**（只多出第三個場景的段落），然後提交：

```bash
git add test/tools/spawn-snapshot.ts test/fixtures/spawn-baseline.ts
git commit -m "test: 快照加一個帶砲塔的場景 —— 在動彈丸池之前先抓基準

前兩個場景只跑得到固定掛架。turret-replay 是自己比自己，參數接反時
兩次一樣地錯。這一筆刻意排在 Projectiles 改動之前。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **步驟 2：寫紅的測試**

`test/unit/projectiles.test.ts`（若已存在就加一個 describe）：

```ts
import { describe, it, expect } from 'vitest'
import { Projectiles, PROJECTILE_LIFETIME } from '../../src/world/Projectiles'

describe('Projectiles 的 team 與 life', () => {
  it('spawn 記下陣營', () => {
    const p = new Projectiles(8)
    const i = p.spawn(0, 0, 0, 1, 0, 0, 10, 3, 1, PROJECTILE_LIFETIME)
    expect(p.team[i]).toBe(1)
  })

  /**
   * 【壽命是每發自己的】40 mm 要飛 2.4 秒才到得了 2,110 m，而固定槍仍然
   * 是 1.2 秒。共用一個全域常數的話兩者只能有一個是對的。
   */
  it('壽命各自獨立，到期各自回收', () => {
    const p = new Projectiles(8)
    p.spawn(0, 0, 0, 1, 0, 0, 10, 0, 0, 1.2)
    p.spawn(0, 0, 0, 1, 0, 0, 10, 0, 0, 2.4)
    expect(p.live).toBe(2)
    for (let i = 0; i < 130; i++) p.step(1 / 100)   // 1.30 s
    expect(p.live).toBe(1)
    for (let i = 0; i < 120; i++) p.step(1 / 100)   // 2.50 s
    expect(p.live).toBe(0)
  })

  it('clear 之後兩個陣列都回到空槽', () => {
    const p = new Projectiles(4)
    p.spawn(0, 0, 0, 1, 0, 0, 10, 2, 1, 3)
    p.clear()
    expect(p.live).toBe(0)
    expect(p.owner[0]).toBe(-1)
  })
})
```

- [ ] **步驟 3：跑測試確認它紅**

```
npx vitest run test/unit/projectiles.test.ts
```

預期：TypeScript 抱怨 `spawn` 參數過多，或 `p.team` 不存在。

- [ ] **步驟 4：改 `Projectiles.ts`**

加兩個陣列，`spawn` 加兩個**必填**參數，`step` 的過期判斷改讀 `life`：

```ts
  /**
   * 射手的陣營：0 = blue、1 = red。**與 `resolveHits` 現有的 0/1 同一套。**
   *
   * 【為什麼不繼續從 owner 反查】船不是 combatant，反查不到 —— 同隊過濾
   * 會靜靜失效，船會打自己人。而射手可能在彈丸落地前就死了。
   */
  readonly team: Int8Array
  /**
   * 這一發的壽命，秒。
   *
   * 【為什麼不是全域常數】艦上的 40 mm 要飛 2.4 秒才到得了 2,110 m，
   * 而飛機的固定槍仍然是 1.2 秒。`PROJECTILE_LIFETIME` **留著**：它同時是
   * 砲塔與 HUD 預瞄環的射程判準，那條「看得到預瞄環＝打得到」的等式不能動。
   */
  readonly life: Float32Array
```

`step()` 裡：

```ts
      const age = this.age[i]! + dt
      if (age > this.life[i]!) {
```

**兩個參數都不給預設值。** 全樹 64 個呼叫點會變成編譯錯誤——那正是要的：
給了預設值就是靜默的 `life = 0`，而 `life = 0` 的彈丸下一步就過期消失，
症狀是「某些槍不會發射」。

- [ ] **步驟 5：修所有呼叫點**

`npx tsc --noEmit` 會列出全部。逐一補上：

- `World.ts:459`（固定槍）：`c.team === 'blue' ? 0 : 1`、`PROJECTILE_LIFETIME`
- `turrets.ts:268`（砲塔）：`c.team === 'blue' ? 0 : 1`、`PROJECTILE_LIFETIME`
- `tools/propdisc.ts:160` 與其餘工具、benchmark、測試：`0`、
  `PROJECTILE_LIFETIME`

- [ ] **步驟 6：確認逐位元不變**

```
npx vitest run test/integration/replay-determinism.test.ts
npx vitest run test/integration/order-of-battle-replay.test.ts
npx vitest run test/integration/turret-replay.test.ts
npx vitest run test/unit/projectiles.test.ts
npx tsc --noEmit
```

預期：全綠、tsc 23 行。**三個場景的快照都必須對上步驟 1 提交的那一份
基準，一格不差。** 有任何一格不同就是接錯了參數順序——回去看，不要重抓基準。

- [ ] **步驟 7：提交**

```bash
git add -A src/ test/
git commit -m "feat: 彈丸帶自己的陣營與壽命

陣營：船不是 combatant，從 owner 反查不到 —— 同隊過濾會靜靜失效。
壽命：艦上 40 mm 要飛 2.4 秒，固定槍仍是 1.2 秒。

兩個參數都必填。給預設值的話漏改的呼叫點會拿到 life = 0，那種彈丸
下一步就消失，症狀是「某些槍不發射」而且不報錯。

三份快照逐位元不變。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：`world/shipGuns.ts` —— 砲位的瞄準與開火

**檔案**
- 新增：`src/world/shipGuns.ts`
- 修改：`src/world/ships.ts`（`createShip` 填 `guns` 與 `gunCooldowns`）
- 測試：`test/unit/ship-guns.test.ts`

**介面**
- 取用：T2 的 `Ship`／`ShipClass`、T3 的 `spawn` 新簽章、
  `world/turrets.ts:36` 的 `TurretCombatant`（砲位挑目標時的最小介面）
- 產出：
  ```ts
  export interface ShipGunSpec {
    readonly muzzleVelocity: number
    readonly roundsPerMinute: number
    readonly life: number          // flak 用不到，填 0
    readonly damage: number
    readonly hp: number
    readonly boxHalf: number       // 立方盒的半邊長，已含 ×1.5
    readonly rotationRate: number  // rad/s
  }
  export const SHIP_GUN_SPECS: Readonly<Record<ShipAATier, ShipGunSpec>>
  export const SHIP_OWNER_BASE = -1000
  export function shipOwner(shipIndex: number): number
  export function ownerShipIndex(owner: number): number   // 不是船就回 −1
  export interface ShipGun extends BurstCycle { … }
  export function createShipGuns(cls: ShipClass): ShipGun[]
  export function resetShipGuns(ship: Ship): void
  export function stepShipGuns(
    ship: Ship, all: readonly TurretCombatant[],
    projectiles: Projectiles, time: number, dt: number,
  ): void
  ```

> **這一步只做直射兩層**（`mg` 與 `autocannon`）。`tier === 'flak'` 的
> 分支先 `continue`，T5 建好高砲彈池之後再回來接，那時
> `stepShipGuns` 才多收一個 `flak` 參數。這樣 T4 不依賴任何還不存在的
> 型別，紅綠循環是完整的。

- [ ] **步驟 1：寫紅的測試**

建立 `test/unit/ship-guns.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'
import {
  SHIP_GUN_SPECS, SHIP_OWNER_BASE, shipOwner, ownerShipIndex, stepShipGuns,
} from '../../src/world/shipGuns'
import { Projectiles } from '../../src/world/Projectiles'
import type { TurretCombatant } from '../../src/world/turrets'

/** 一架不會動的假飛機。只填 `stepShipGuns` 讀得到的欄位。 */
function target(index: number, x: number, y: number, z: number): TurretCombatant {
  return {
    index, team: 'blue', alive: true, hp: 100,
    aircraft: {
      spec: { turrets: [] },
      state: {
        position: new Vector3(x, y, z),
        velocity: new Vector3(0, 0, 0),
        orientation: new Quaternion(),
      },
    },
    turretStates: [], turretCooldowns: new Float32Array(0),
  } as unknown as TurretCombatant
}

describe('船砲彈的來源編碼', () => {
  /**
   * 【為什麼不能用 −1 也不能用 0..3】−1 是 Projectiles 的空槽標記，
   * 用它會讓 liveCount 加上去卻永遠不推進；0..3 會被 resolveHits 當成
   * 同索引的飛機，錯誤排除那一架還把命中數記到它頭上。
   */
  it('編碼落在 −1 與所有 combatant 索引之外', () => {
    for (let i = 0; i < 8; i++) {
      expect(shipOwner(i)).toBeLessThan(-1)
      expect(shipOwner(i)).toBeLessThanOrEqual(SHIP_OWNER_BASE)
      expect(ownerShipIndex(shipOwner(i))).toBe(i)
    }
    expect(ownerShipIndex(-1)).toBe(-1)
    expect(ownerShipIndex(0)).toBe(-1)
    expect(ownerShipIndex(37)).toBe(-1)
  })
})

describe('stepShipGuns', () => {
  const step = (
    ship: ReturnType<typeof createShip>, all: TurretCombatant[], seconds: number,
  ) => {
    const p = new Projectiles(2048)
    const dt = 1 / 240
    for (let i = 0; i < seconds * 240; i++) stepShipGuns(ship, all, p, i * dt, dt)
    return p
  }

  it('沒有目標時一發都不打', () => {
    const s = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 0)
    expect(step(s, [], 3).live).toBe(0)
  })

  it('目標在正上方 600 m 時 20 mm 會開火', () => {
    const s = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 0)
    const p = step(s, [target(0, 0, 600, 0)], 3)
    expect(p.live).toBeGreaterThan(0)
  })

  /** 【射程】20 mm 是 1,330 m。3,000 m 外它不該有解。 */
  it('20 mm 打不到 3,000 m 外的目標', () => {
    const only20mm = {
      ...SHIP_CLASSES.fletcher,
      zones: SHIP_CLASSES.fletcher.zones.filter((z) => z.tier === 'mg'),
    }
    const s = createShip(0, only20mm, 'red', 0, 0, 0, 0)
    expect(step(s, [target(0, 3000, 0, 0)], 3).live).toBe(0)
  })

  it('同隊的飛機不是目標', () => {
    const s = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 0)
    const friend = target(0, 0, 600, 0)
    ;(friend as { team: string }).team = 'red'
    expect(step(s, [friend], 3).live).toBe(0)
  })

  it('目標死了就不打', () => {
    const s = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 0)
    const t = target(0, 0, 600, 0)
    ;(t as { alive: boolean }).alive = false
    expect(step(s, [t], 3).live).toBe(0)
  })

  /** 【砲位死了完全不動】不搜尋、不轉、不開火。 */
  it('砲位全部打掉之後一發都不打', () => {
    const s = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 0)
    for (const g of s.guns) g.alive = false
    expect(step(s, [target(0, 0, 600, 0)], 3).live).toBe(0)
  })

  /**
   * 【傷害是表上的值】照抄 stepTurrets 會套 TURRET_DAMAGE_SCALE (0.9375)
   * 與 guns —— 四聯裝 40 mm 會從 40 變成 150。
   */
  it('單發傷害等於表上的值，不乘 guns 也不乘 TURRET_DAMAGE_SCALE', () => {
    const only20mm = {
      ...SHIP_CLASSES.fletcher,
      zones: SHIP_CLASSES.fletcher.zones.filter((z) => z.tier === 'mg'),
    }
    const s = createShip(0, only20mm, 'red', 0, 0, 0, 0)
    const p = step(s, [target(0, 0, 600, 0)], 3)
    const dmg = new Set<number>()
    for (let i = 0; i < p.capacity; i++) {
      if (p.owner[i] !== -1) dmg.add(p.damage[i]!)
    }
    expect([...dmg]).toEqual([SHIP_GUN_SPECS.mg.damage])
  })

  it('彈丸帶的是船的陣營與該層的壽命', () => {
    const only20mm = {
      ...SHIP_CLASSES.fletcher,
      zones: SHIP_CLASSES.fletcher.zones.filter((z) => z.tier === 'mg'),
    }
    const s = createShip(0, only20mm, 'red', 0, 0, 0, 0)
    const p = step(s, [target(0, 0, 600, 0)], 3)
    const i = p.owner.findIndex((o) => o !== -1)
    expect(p.team[i]).toBe(1)                       // red
    expect(p.life[i]).toBe(SHIP_GUN_SPECS.mg.life)
    expect(p.owner[i]).toBe(shipOwner(0))
  })
})
```

- [ ] **步驟 2：跑測試確認它紅**

```
npx vitest run test/unit/ship-guns.test.ts
```

- [ ] **步驟 3：寫 `SHIP_GUN_SPECS`**

照 spec §5.2 的表。**每一個數字都要帶一句「起始值，由試飛裁定」。**

```ts
export const SHIP_GUN_SPECS: Readonly<Record<ShipAATier, ShipGunSpec>> = {
  mg:         { muzzleVelocity: 830, roundsPerMinute: 240, life: 1.6,
                damage: 12, hp: 60,  boxHalf: 1.2, rotationRate: 60 * DEG },
  autocannon: { muzzleVelocity: 880, roundsPerMinute: 110, life: 2.4,
                damage: 40, hp: 120, boxHalf: 2.0, rotationRate: 45 * DEG },
  flak:       { muzzleVelocity: 450, roundsPerMinute: 20,  life: 0,
                damage: 200, hp: 200, boxHalf: 3.0, rotationRate: 20 * DEG },
}
```

`boxHalf` 是**半**邊長：spec 的「2.4 m 立方」＝ 半邊長 1.2。

- [ ] **步驟 4：寫 `stepShipGuns`**

骨架照 `world/turrets.ts:198`，五處差別（spec §3.3）：

1. 候選是 `TurretCombatant[]`，船不在裡面，不必排除自傷。
2. 槍口 = `zone.position` 經船的 `orientation` 旋轉再加 `position`。
3. `tier === 'flak'` 這一步先 `continue`（T5 接）。
4. 射速時鐘用 `ship.gunCooldowns` 這個 `Float32Array` ＋ 砲位索引。
5. **傷害直接用 `spec.damage`**，不乘 `guns`、不乘 `TURRET_DAMAGE_SCALE`。

射界錐：軸的水平分量朝**舷外**（`zone.position.x` 的正負決定），
中線上的砲（`|x| < 1`）改成朝正上；仰角與半角讀
`SHIP_AA_ARC_DEFAULTS[tier]`（`shipAA.ts:105`）。

搜尋節流、開火門檻、搖晃（振幅 `1.2 * DEG`）、點放，全部沿用
`turrets.ts` 的常數與 `weapons/burst.ts`。相位種子用
`ship.index * 8 + gunIndex`。

- [ ] **步驟 5：跑測試確認全綠**

```
npx vitest run test/unit/ship-guns.test.ts
npx tsc --noEmit
```

- [ ] **步驟 6：提交**

```bash
git add src/world/shipGuns.ts src/world/ships.ts test/unit/ship-guns.test.ts
git commit -m "feat: 艦上砲位的瞄準與開火（直射兩層）

骨架照 stepTurrets，但五處不同：候選來源、槍口座標、flak 不進彈丸池、
射速時鐘住在船身上、傷害不套 TURRET_DAMAGE_SCALE 也不乘 guns。

彈丸的 owner 用 −1000 − 船編號：−1 是空槽，0..3 會被 resolveHits
當成飛機而冒名記分。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：`world/flak.ts` —— 引信與範圍傷害

**檔案**
- 新增：`src/world/flak.ts`
- 修改：`src/world/shipGuns.ts`（把 `tier === 'flak'` 那條接上）
- 測試：`test/unit/flak.test.ts`

**介面**
- 產出：
  ```ts
  export const FLAK_CAPACITY = 256
  export const FLAK_RADIUS = 50
  export const FLAK_DAMAGE = 200
  export const FLAK_MAX_FUSE = 11
  export interface FlakShells {
    readonly capacity: number
    readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array
    readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array
    readonly fuse: Float32Array
    readonly team: Int8Array      // −1 = 空槽
    readonly live: number
  }
  export interface BurstEvents {
    readonly capacity: number
    readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array
    readonly team: Int8Array
    count: number
    dropped: number
  }
  export function createFlak(capacity?: number): FlakShells
  export function createBursts(capacity?: number): BurstEvents
  export function clearBursts(e: BurstEvents): void
  export function clearFlak(f: FlakShells): void
  export function spawnFlak(
    f: FlakShells, px: number, py: number, pz: number,
    vx: number, vy: number, vz: number, fuse: number, team: number,
  ): number
  export function stepFlak(f: FlakShells, dt: number, out: BurstEvents): void
  export function flakDamage(distance: number): number
  ```

- [ ] **步驟 1：寫紅的測試**

建立 `test/unit/flak.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  FLAK_DAMAGE, FLAK_RADIUS, createBursts, createFlak, clearFlak,
  flakDamage, spawnFlak, stepFlak,
} from '../../src/world/flak'

describe('flakDamage', () => {
  it('爆心最痛、邊界為零、線性衰減', () => {
    expect(flakDamage(0)).toBe(FLAK_DAMAGE)
    expect(flakDamage(FLAK_RADIUS)).toBe(0)
    expect(flakDamage(FLAK_RADIUS / 2)).toBeCloseTo(FLAK_DAMAGE / 2, 6)
  })

  /** 【半徑外是 0 不是負數】不擋的話遠方的飛機會被「治療」。 */
  it('半徑外是 0，不是負的', () => {
    expect(flakDamage(FLAK_RADIUS * 3)).toBe(0)
  })
})

describe('stepFlak', () => {
  it('引信到期才引爆，引爆點就是那一刻的位置', () => {
    const f = createFlak()
    const out = createBursts()
    spawnFlak(f, 0, 0, 0, 100, 0, 0, 1, 1)
    for (let i = 0; i < 99; i++) stepFlak(f, 1 / 100, out)
    expect(out.count).toBe(0)
    expect(f.live).toBe(1)
    stepFlak(f, 1 / 100, out)
    expect(out.count).toBe(1)
    expect(out.x[0]).toBeCloseTo(100, 4)
    expect(out.team[0]).toBe(1)
    expect(f.live).toBe(0)
  })

  it('引爆之後槽位釋放，同一發不會爆第二次', () => {
    const f = createFlak()
    const out = createBursts()
    spawnFlak(f, 0, 0, 0, 0, 0, 0, 0.5, 0)
    for (let i = 0; i < 200; i++) stepFlak(f, 1 / 100, out)
    expect(out.count).toBe(1)
  })

  it('clearFlak 之後池是空的', () => {
    const f = createFlak()
    const out = createBursts()
    spawnFlak(f, 0, 0, 0, 0, 0, 0, 5, 0)
    clearFlak(f)
    expect(f.live).toBe(0)
    for (let i = 0; i < 1000; i++) stepFlak(f, 1 / 100, out)
    expect(out.count).toBe(0)
  })
})
```

- [ ] **步驟 2：跑測試確認它紅**

```
npx vitest run test/unit/flak.test.ts
```

- [ ] **步驟 3：寫 `src/world/flak.ts`**

要點：

- 環狀游標＋`team === -1` 當空槽，與 `Projectiles` 同一套做法。
- `stepFlak` **先推進再減引信**，引信 ≤ 0 就推一筆 burst 並釋放槽位。
- `BurstEvents` 滿了就 `dropped++` 並丟棄，**不擴容**（與
  `world/events.ts` 的 `ImpactEvents` 同一個約定：呼叫端負責排空）。
- `flakDamage(d) = d >= FLAK_RADIUS ? 0 : FLAK_DAMAGE * (1 - d / FLAK_RADIUS)`

- [ ] **步驟 4：把 `shipGuns.ts` 的 flak 分支接上**

`stepShipGuns` 現在多收一個參數：
`stepShipGuns(ship, all, projectiles, flak, time, dt)`。
T4 的測試輔助函數要跟著補上 `createFlak()`。

`tier === 'flak'` 時：

```ts
// 引信 = 發射那一刻解出來的攔截時間。目標之後閃避的話，雲就開在空的地方
// —— 那正是要的手感：黑雲是危險的招牌，不是必中的判決。
const tt = solveLead(P, V, spec.muzzleVelocity, LEAD)
if (tt === NO_INTERCEPT || tt > FLAK_MAX_FUSE) continue
spawnFlak(flak, MUZZLE.x, MUZZLE.y, MUZZLE.z, VEL.x, VEL.y, VEL.z, tt, team)
```

- [ ] **步驟 5：`ship-guns.test.ts` 加一條 flak 的斷言**

```ts
  it('5 吋砲產生高砲彈而不是彈丸', () => {
    const onlyFlak = {
      ...SHIP_CLASSES.wichita,
      zones: SHIP_CLASSES.wichita.zones.filter((z) => z.tier === 'flak'),
    }
    const s = createShip(0, onlyFlak, 'red', 0, 0, 0, 0)
    const p = new Projectiles(2048)
    const f = createFlak()
    const dt = 1 / 240
    for (let i = 0; i < 3 * 240; i++) stepShipGuns(s, [target(0, 0, 2000, 0)], p, f, i * dt, dt)
    expect(p.live).toBe(0)
    expect(f.live).toBeGreaterThan(0)
  })
```

- [ ] **步驟 6：跑測試確認全綠**

```
npx vitest run test/unit/flak.test.ts
npx vitest run test/unit/ship-guns.test.ts
npx tsc --noEmit
```

- [ ] **步驟 7：提交**

```bash
git add src/world/flak.ts src/world/shipGuns.ts test/unit/flak.test.ts test/unit/ship-guns.test.ts
git commit -m "feat: 5 吋砲的近炸引信與黑雲事件

高砲彈不進彈丸池：飛行途中什麼都不會發生，只有引爆那一刻算數。
引信是發射瞬間解出的攔截時間 —— 目標一閃避，雲就開在空的地方。

初速刻意訂 450（真砲 790）：慢彈才有看得見的飛行時間。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6：`World` 接線 —— 船的命中、範圍傷害、撞船

**檔案**
- 修改：`src/world/World.ts`（`ships` 欄位、`step`、`resolveHits`、
  新增 `resolveShipHit` 與 `applyBursts`、撞船）
- 測試：`test/integration/ship-aa.test.ts`

**介面**
- 取用：T1 `obbOverlap`、T2 `Ship`／`stepShips`、T4 `stepShipGuns`／
  `ownerShipIndex`、T5 `stepFlak`／`flakDamage`
- 產出：
  ```ts
  // World 新增
  readonly ships: Ship[]
  readonly flak: FlakShells
  readonly burstEvents: BurstEvents
  ```

- [ ] **步驟 1：寫紅的測試**

建立 `test/integration/ship-aa.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'
import { shipOwner, SHIP_GUN_SPECS } from '../../src/world/shipGuns'
import { PROJECTILE_LIFETIME } from '../../src/world/Projectiles'

/** 把一發子彈直接放在砲位前面，朝它打。 */
function shootAt(w: World, target: Vector3, from: Vector3, damage: number): void {
  const d = target.clone().sub(from).normalize().multiplyScalar(400)
  w.projectiles.spawn(from.x, from.y, from.z, d.x, d.y, d.z, damage, 0, 0, PROJECTILE_LIFETIME)
  w.projectiles.step(1 / 240)
  w.resolveHits()
}

describe('彈丸打船', () => {
  const build = () => {
    const w = new World()
    const s = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 0)
    w.ships.push(s)
    return { w, s }
  }

  it('打中砲位：砲位與船同時扣血', () => {
    const { w, s } = build()
    const g = s.guns[0]!
    const hp0 = s.hp
    const world = g.zone.position.clone()          // 船在原點、艏向 0
    shootAt(w, world, world.clone().add(new Vector3(0, 60, 0)), 30)
    expect(g.hp).toBe(SHIP_GUN_SPECS[g.zone.tier].hp - 30)
    expect(s.hp).toBe(hp0 - 30)
  })

  it('砲位血量歸零之後盒子消失 —— 第二發穿過去', () => {
    const { w, s } = build()
    const g = s.guns[0]!
    const world = g.zone.position.clone()
    const from = world.clone().add(new Vector3(0, 60, 0))
    shootAt(w, world, from, 10_000)
    expect(g.alive).toBe(false)
    const hp1 = s.hp
    shootAt(w, world, from, 30)
    // 打不到砲位了；若這一發打中船體，扣的是船體那一條路
    expect(g.hp).toBeLessThanOrEqual(0)
    expect(s.hp).toBeLessThanOrEqual(hp1)
  })

  /**
   * 【自傷】砲口就在砲位盒裡，segmentBox 對「起點已在盒內」回傳 t = 0。
   * 沒有排除規則的話，每一發直射彈在出膛那一步就打中自己的砲位。
   */
  it('船自己打出去的彈丸不會打中自己', () => {
    const { w, s } = build()
    const g = s.guns[0]!
    const p = g.zone.position
    w.projectiles.spawn(p.x, p.y, p.z, 0, 300, 0, 50, shipOwner(0), 1, 1.6)
    w.projectiles.step(1 / 240)
    w.resolveHits()
    expect(g.hp).toBe(SHIP_GUN_SPECS[g.zone.tier].hp)
  })

  it('同隊的船不會被彼此的彈丸打到', () => {
    const { w } = build()
    const s2 = createShip(1, SHIP_CLASSES.fletcher, 'red', 800, 0, 0, 0)
    w.ships.push(s2)
    const g = s2.guns[0]!
    const p = g.zone.position.clone().add(new Vector3(800, 0, 0))
    w.projectiles.spawn(p.x, p.y + 60, p.z, 0, -300, 0, 50, shipOwner(0), 1, 1.6)
    w.projectiles.step(1 / 240)
    w.resolveHits()
    expect(g.hp).toBe(SHIP_GUN_SPECS[g.zone.tier].hp)
  })
})
```

- [ ] **步驟 2：跑測試確認它紅**

```
npx vitest run test/integration/ship-aa.test.ts
```

- [ ] **步驟 3：`World` 加欄位與 step 三段**

`step()` 裡，**順序固定才可重現**：

```ts
    // 船在飛機之後、砲塔之後。三者都往同一個彈丸池寫。
    stepShips(this.ships, dt)
    for (const s of this.ships) {
      stepShipGuns(s, this.combatants, this.projectiles, this.flak, this.time, dt)
    }
    stepFlak(this.flak, dt, this.burstEvents)
    this.applyBursts()
```

`applyBursts()` 掃 `burstEvents`，對每一筆的**敵隊**存活飛機算距離，
`flakDamage(d) > 0` 就 `applyDamage(c, flakDamage(d), 'fuselage')`。

> **`burstEvents` 由呼叫端排空**（與 `hitEvents` 同一個約定），
> 但 `applyBursts` 在 `World` 內部消費傷害那一面。渲染層讀同一份畫黑雲。

- [ ] **步驟 4：`resolveHits` 加對船的判定**

排在**飛機之後、陸地之前**（spec §7.1）：

```ts
      // ── 船 ──────────────────────────────────────────────
      //
      // 【為什麼排在飛機之後、陸地之前】同一個物理步之內「先擦過一架飛機、
      // 再撞上艦橋」是合法的，而彈丸一步走 3.7–4.5 m。順序用線段參數 t 比。
      const fromShip = ownerShipIndex(owner)
      for (let k = 0; k < ships.length; k++) {
        const sh = ships[k]!
        if (k === fromShip) continue                       // 不打自己
        if ((sh.team === 'blue' ? 0 : 1) === ownerTeam) continue   // 不打同隊
        if (segmentPointDistanceSq(ax, ay, az, bx, by, bz,
          sh.position.x, sh.position.y, sh.position.z) > sh.cls.radius ** 2) continue
        // 線段轉進艦體座標，測船體盒與**還活著的**砲位盒，取最小的 t
        …
      }
```

命中之後：推 `hitEvents`（火花）、扣血、`p.kill(i)`。
**扣血不套 `PART_MULTIPLIER`**（spec §7.2）。

- [ ] **步驟 5：撞船**

`crashPolicy` 那一段之後、開火之前，加一個迴圈：

```ts
    // 【為什麼不是重心】低空進場一定有人擦著艦體過去。用重心的話機翼會
    // 穿過上層建築而沒事。飛機的命中盒是機體 AABB ＋ 姿態 ＝ OBB。
    for (const c of this.combatants) {
      if (!c.alive) continue
      if (this.hitsShip(c)) this.destroy(c)
    }
```

`hitsShip` 先比包圍球（飛機的 `boundingRadius` ＋ 船的 `radius`），
過了才對船體盒逐一 `obbOverlap`。

- [ ] **步驟 6：測撞船**

`test/integration/ship-aa.test.ts` 加下面這個 describe。開頭要多兩個
import：

```ts
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import type { Controller } from '../../src/control/Controller'
```

```ts
/** 什麼都不做的控制器。撞船判定與 AI 無關，讓飛機保持在放上去的位置。 */
const IDLE: Controller = { update() {} }

describe('飛機撞船', () => {
  /**
   * 【一定要關掉撞海】預設的 `crashPolicy` 是海平面判定。艦體盒貼著水線，
   * 不關的話「撞船」與「撞海」分不出來 —— 測試會綠，但綠的是錯的理由。
   */
  const build = () => {
    const w = new World()
    w.crashPolicy = () => false
    const s = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 0)
    w.ships.push(s)
    return { w, s }
  }

  const put = (w: World, x: number, y: number, z: number) => {
    const c = w.add(new Aircraft(P51D), IDLE, 'blue', new Vector3(x, y, z), y, 0)
    c.aircraft.state.position.set(x, y, z)
    c.aircraft.state.velocity.set(0, 0, 0)
    return c
  }

  it('飛機在船體盒裡 → 判墜毀', () => {
    const { w, s } = build()
    // 艦體盒的中心，轉成世界座標（船在原點、艏向 0，所以就是它自己）
    const box = s.cls.hull[0]!
    const c = put(w, box.center.x, box.center.y, box.center.z)
    w.step(1 / 240)
    expect(c.alive).toBe(false)
  })

  it('從舷外通過 → 不判', () => {
    const { w, s } = build()
    const box = s.cls.hull[0]!
    // 舷外一倍半寬，高度與艦體盒同高
    const c = put(w, box.center.x + box.half.x * 3, box.center.y, box.center.z)
    w.step(1 / 240)
    expect(c.alive).toBe(true)
  })

  /**
   * 【這一條守的是「不能用重心」】飛機重心在盒外，但機翼伸進去了。
   * 用重心判定的話這一條會綠著卻是錯的 —— 所以擺在剛好差一點的位置：
   * 重心離盒面 0.6 × 翼半展，機翼尖端仍在盒內。
   */
  it('重心在盒外但機翼伸進去 → 仍然判墜毀', () => {
    const { w, s } = build()
    const box = s.cls.hull[0]!
    const semi = P51D.hitBoxes
      .filter((b) => b.part === 'wingLeft' || b.part === 'wingRight')
      .reduce((m, b) => Math.max(m, Math.abs(b.center.x) + b.half.x), 0)
    const c = put(w, box.center.x + box.half.x + semi * 0.6, box.center.y, box.center.z)
    w.step(1 / 240)
    expect(c.alive).toBe(false)
  })
})
```

- [ ] **步驟 7：跑測試確認全綠**

```
npx vitest run test/integration/ship-aa.test.ts
npx vitest run test/integration/replay-determinism.test.ts
npx tsc --noEmit
```

**重播測試必須仍然綠**：沒有船的場景，新加的三段迴圈都是零長度早退。

- [ ] **步驟 8：提交**

```bash
git add src/world/World.ts test/integration/ship-aa.test.ts
git commit -m "feat: World 接上船 —— 命中、範圍傷害、撞船

彈丸對船的判定排在飛機之後、陸地之前，同樣用線段參數 t 比先後。
兩條排除規則缺一不可：不打發射的那一艘（砲口就在砲位盒裡，
segmentBox 對起點在盒內回傳 t = 0），不打同隊的船。

撞船用 OBB 分離軸，不用重心。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7：飛機砲塔可以瞄船上的砲位

**這一步是「砲位可打掉」在座艙裡看得見的唯一途徑**——這一期玩家開 G4M
沒有扳機（spec §10.3）。

**檔案**
- 修改：`src/world/turrets.ts:198`（`stepTurrets` 多收 `ships`）、
  `:334`（`pickTarget`）
- 修改：`src/world/World.ts`（呼叫處傳 `this.ships`）
- 測試：`test/unit/ship-guns.test.ts` 加一個 describe

**介面**
- `stepTurrets(c, all, projectiles, time, dt, land, ships)` —— `ships` 排在
  最後、預設 `[]`，既有呼叫點不用改。

- [ ] **步驟 1：寫紅的測試**

在 `test/integration/ship-aa.test.ts` 加（**不要自己組假物件**——這一條
要驗的正是接線，所以走 `World`）：

```ts
import { G4M } from '../../src/specs/g4m'

describe('飛機砲塔瞄船', () => {
  /**
   * 一架掛在敵船正上方的轟炸機。速度為 0，這樣它待在射界裡不會飄走 ——
   * 這一條問的是「會不會瞄船」，不是「追不追得上」。
   */
  const build = (shipTeam: 'blue' | 'red') => {
    const w = new World()
    w.crashPolicy = () => false
    const s = createShip(0, SHIP_CLASSES.fletcher, shipTeam, 0, 0, 0, 0)
    w.ships.push(s)
    const c = w.add(new Aircraft(G4M), IDLE, 'blue', new Vector3(0, 500, 0), 500, 0)
    c.aircraft.state.position.set(0, 500, 0)
    c.aircraft.state.velocity.set(0, 0, 0)
    return { w, s, c }
  }

  const run = (w: World, seconds: number) => {
    for (let i = 0; i < seconds * 240; i++) w.step(1 / 240)
  }

  const totalGunHp = (s: { guns: { hp: number }[] }) =>
    s.guns.reduce((n, g) => n + g.hp, 0)

  it('一式陸攻的砲塔會打敵隊船上的砲位', () => {
    const { w, s } = build('red')
    const before = totalGunHp(s)
    run(w, 8)
    expect(totalGunHp(s)).toBeLessThan(before)
  })

  it('同隊的船不會被自己的砲塔打', () => {
    const { w, s } = build('blue')
    const before = totalGunHp(s)
    run(w, 8)
    expect(totalGunHp(s)).toBe(before)
  })

  it('已經死掉的砲位不再是候選', () => {
    const { w, s } = build('red')
    for (const g of s.guns) g.alive = false
    const before = totalGunHp(s)
    run(w, 8)
    expect(totalGunHp(s)).toBe(before)
  })
})
```

> 【為什麼用 G4M 而不是 B-17G】這一關玩家開的就是它，而且它的砲塔配置
> （機腹、兩側、機尾）正是「進場時對著艦上掃」那個畫面的來源。

- [ ] **步驟 2：跑測試確認它紅**

```
npx vitest run test/unit/ship-guns.test.ts
```

- [ ] **步驟 3：`pickTarget` 加船上的砲位當候選**

候選是**存活的砲位**（世界座標＝`zone.position` 經船的姿態旋轉再平移），
速度取船的速度。`solveLead` 與 `inArc` 照用。

**只有敵隊的船是候選。** `TurretState.targetIndex` 現在只能表示飛機，
所以要多一格 `targetShip: number`（−1 = 不是船）與 `targetGun: number`。

> 【為什麼不把船塞進同一個索引空間】那會讓 `all[s.targetIndex]` 這個
> 到處都在用的寫法變成「要先問是不是船」。多兩格 int 比較便宜。

- [ ] **步驟 4：跑測試確認全綠**

```
npx vitest run test/unit/ship-guns.test.ts
npx vitest run test/integration/turret-replay.test.ts
npx tsc --noEmit
```

**`turret-replay` 必須仍然綠**：沒有船的場景，候選迴圈是零長度。

- [ ] **步驟 5：提交**

```bash
git add src/world/turrets.ts src/world/World.ts test/unit/ship-guns.test.ts
git commit -m "feat: 飛機砲塔可以瞄船上的砲位

這一期玩家開 G4M 沒有扳機（mounts 是空陣列，武器全是 AI 砲塔），
所以「砲位可以被打掉」只剩自己的銃手做得到 —— 史實上一式陸攻進場時
側方與機腹的 20 mm 銃手就是對著艦上掃的。

targetShip / targetGun 另外兩格，不與飛機共用索引空間。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8：任務接線 —— 透傳鏈、`japan-m4`、重設

**檔案**
- 修改：`src/battle/missions.ts`（`MissionFleet`／`FleetEntry` 型別、
  `MissionBattle.fleet`、`missionConfigFrom` 複製它、`japan-m4` 的 battle）
- 修改：`src/battle/setup.ts`（`BattleConfig.fleet`、`createBattle` 建船、
  `resetBattle:1466` 重設船與 flak）
- 測試：`test/unit/missions.test.ts`、`test/integration/ship-aa.test.ts`

**介面**
```ts
export interface MissionFleet {
  readonly center: Vector3
  readonly heading: number
  readonly ships: readonly FleetEntry[]
}
export interface FleetEntry {
  readonly cls: ShipClassId
  readonly team: Team
  readonly offset: Vector3
}
```

- [ ] **步驟 1：寫紅的測試**

`test/unit/missions.test.ts` 加：

```ts
describe('艦隊', () => {
  /**
   * 【為什麼這一條是關鍵】missionConfigFrom 明列回傳欄位、不透傳未知資料。
   * 只在 MissionBattle 上加一格的話型別檢查會過、卡片讀得到，但進戰鬥後
   * 一艘船都不會有，而且不報錯。
   */
  it('japan-m4 的艦隊真的流進 BattleConfig', () => {
    const card = readyCard('japan-m4')
    expect(card.battle.fleet).toBeDefined()
    const cfg = missionConfigFrom(card)
    expect(cfg.fleet?.ships.length).toBe(4)
  })

  it('沒有 fleet 的卡不產生任何船', () => {
    const cfg = missionConfigFrom(readyCard('japan-m1'))
    expect(cfg.fleet).toBeUndefined()
  })

  it('倫內爾島是兩艘 Wichita 加兩艘 Fletcher，全部紅隊', () => {
    const f = readyCard('japan-m4').battle.fleet!
    expect(f.ships.map((s) => s.cls).sort())
      .toEqual(['fletcher', 'fletcher', 'wichita', 'wichita'])
    for (const s of f.ships) expect(s.team).toBe('red')
  })
})
```

（`readyCard` 是這支測試裡既有的輔助函數；若沒有就照
`test/fixtures/mission.ts` 的做法取卡。）

`test/integration/ship-aa.test.ts` 加重設那一條：

```ts
import { createBattle, resetBattle } from '../../src/battle/setup'
import { missionConfigFrom, MISSIONS } from '../../src/battle/missions'
import type { ReadyMissionCard } from '../../src/battle/missions'

describe('resetBattle 要把船一起重設', () => {
  const card = MISSIONS.japan.find((c) => c.id === 'japan-m4') as ReadyMissionCard

  /**
   * 【為什麼這一條非有不可】japan-m4 沒有 waves，所以「再打一場」走的是
   * 就地 resetBattle，**不重建 World**。少了重設，第二局會是船停在上一局
   * 結束的位置、被打掉的砲位仍然是死的、上一局的高砲彈還在空中而且會
   * 引爆 —— 全程不報錯。
   */
  it('船回到起點、砲位滿血、flak 池清空', () => {
    const b = createBattle(IDLE, missionConfigFrom(card), 1)
    expect(b.world.ships.length).toBe(4)
    const s = b.world.ships[0]!
    const spawn = s.position.clone()

    for (let i = 0; i < 20 * 240; i++) b.world.step(1 / 240)
    s.guns[0]!.hp = 0
    s.guns[0]!.alive = false
    expect(s.position.distanceTo(spawn)).toBeGreaterThan(100)
    expect(b.world.flak.live).toBeGreaterThan(0)

    resetBattle(b, 1)

    expect(s.position.distanceTo(spawn)).toBeCloseTo(0, 6)
    expect(s.guns[0]!.alive).toBe(true)
    expect(s.guns[0]!.hp).toBe(SHIP_GUN_SPECS[s.guns[0]!.zone.tier].hp)
    expect(b.world.flak.live).toBe(0)
  })
})
```

> 【`flak.live > 0` 這一條可能要調秒數】它要求 20 秒之內至少有一發 5 吋砲
> 還在空中。開局幾何若讓艦隊離飛機太遠而完全不開火，這一條會紅——那時
> **不要放寬斷言**，去看為什麼不開火，那本身就是缺陷。

- [ ] **步驟 2：跑測試確認它紅**

```
npx vitest run test/unit/missions.test.ts
```

- [ ] **步驟 3：加型別與透傳**

四處都要動，少一處就是「型別過了但零艘船」：

1. `MissionBattle` 加 `readonly fleet?: MissionFleet`
2. `BattleConfig` 加 `readonly fleet?: MissionFleet`
3. `missionConfigFrom` 的回傳物件加
   `...(b.fleet === undefined ? {} : { fleet: b.fleet })`
   （與 `beats` 同一個寫法）
4. `createBattle` 依 `cfg.fleet` 建船並 `world.ships.push(...)`

- [ ] **步驟 4：填 `japan-m4` 的 battle**

```ts
    {
      id: 'japan-m4', title: '倫內爾島', type: '打擊',
      summary: '駕駛第 705 海軍航空隊的一式陸攻，在黃昏低空雷擊倫內爾島外的第 18 特遣艦隊。',
      place: '所羅門　倫內爾島外海', period: '1943 年 1 月',
      battle: {
        ...KILL,
        blueSpec: G4M, redSpec: F6F5,
        blueCount: 6, redCount: 6,
        terrain: 'sea',
        fleet: RENNELL_FLEET,
      },
    },
```

`RENNELL_FLEET`（spec §4.2 的陣型）：

```ts
/**
 * 第 18 特遣艦隊的一角。**兩艘重巡並列、兩艘驅逐在前方兩側外張。**
 *
 * 【為什麼沒有航母】倫內爾島海戰的 TF 18 是重巡編隊；Wichita 本人就在
 * 那支艦隊裡。Essex 1943 年 1 月還沒到太平洋 —— 航母留給 allies-m4 沖繩。
 *
 * 【offset 是艦隊座標不是世界座標】改艏向時世界座標要每一艘重算，
 * 而重算的錯誤是「陣型悄悄歪掉」，沒有任何測試會紅。
 */
const RENNELL_FLEET: MissionFleet = {
  center: new Vector3(0, 0, 0),
  heading: 0,
  ships: [
    { cls: 'wichita',  team: 'red', offset: new Vector3(-400, 0, 0) },
    { cls: 'wichita',  team: 'red', offset: new Vector3(400, 0, 0) },
    { cls: 'fletcher', team: 'red', offset: new Vector3(-1500, 0, -1200) },
    { cls: 'fletcher', team: 'red', offset: new Vector3(1500, 0, -1200) },
  ],
}
```

- [ ] **步驟 5：`resetBattle` 重設船與 flak**

`setup.ts:1466`，在 `b.world.projectiles.clear()` 旁邊加：

```ts
  // 【沒有波次的關重開走的是這條，不重建 World】少了這一段，第二局會是
  // 船停在上一局結束的位置、被打掉的砲位仍然是死的、上一局的高砲彈還在
  // 空中而且會引爆 —— 全程不報錯。
  clearFlak(b.world.flak)
  clearBursts(b.world.burstEvents)
  for (const s of b.world.ships) {
    resetShip(s)
    resetShipGuns(s)
  }
```

- [ ] **步驟 6：跑測試確認全綠**

```
npx vitest run test/unit/missions.test.ts
npx vitest run test/integration/ship-aa.test.ts
npx vitest run test/unit/campaigns.test.ts
npx tsc --noEmit
```

- [ ] **步驟 7：提交**

```bash
git add src/battle/ test/
git commit -m "feat: japan-m4 倫內爾島 —— 艦隊透傳與重開重設

fleet 要一路 MissionBattle → BattleConfig → missionConfigFrom →
createBattle。少任何一處都是「型別過了但進戰鬥零艘船」，不報錯。

編成走史實：Wichita ×2 ＋ Fletcher ×2，沒有航母。

resetBattle 要重設船與 flak —— 這一關沒有波次，重開不重建 World。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9：渲染

**檔案**
- 新增：`src/render/ships.ts`、`src/render/flakBursts.ts`
- 修改：`src/main.ts`

- [ ] **步驟 1：`render/flakBursts.ts`**

**不能借煙霧池**——壽命、上升、起訖尺寸是整池共用的建立期設定
（spec §6.4）。再開一份同一套的實例：

```ts
/**
 * 高砲雲。**與殘骸的煙是同一套粒子系統的另一份實例**，不是新的系統 ——
 * `createParticles` 本來就吃設定物件。
 *
 * 【為什麼不能共用煙霧池】那一份的壽命 2.5 s、以 3 m/s 上升、2→9 m，
 * 而 `Particles.emit` 只覆寫得了位置、速度與整體尺寸倍率。高砲雲要的是
 * 4 秒、幾乎不上升、6→14 m。
 */
export function createFlakBursts(): Particles {
  return createParticles({
    capacity: 512,
    blending: NormalBlending,
    life: 4,
    lifeJitter: 0.2,
    sizeFrom: 6,
    sizeTo: 14,
    gravity: 0.2,
    drag: 2,
    alphaFrom: 0.75,
    color: (_t, out) => out.setHex(0x151515),
  })
}

/** 每一筆 burst 噴 8 顆，方向用黃金角錯開（確定性，不用亂數）。 */
export function emitFlakBursts(pool: Particles, events: BurstEvents): void
```

- [ ] **步驟 2：`render/ships.ts`**

- 用 `GLTFLoader` 載 `SHIP_CLASSES[id].url`，每艘一個 `Group`。
  載入是非同步的，照 `render/geometry/glb.ts` 的做法：開場 await 一次
  模板，之後同步 clone。
- 每幀把 `ship.position` 與 `ship.orientation` 抄進 `Group`。
- **砲管與槍焰要自己一份**：`render/turretBarrels.ts` 與 `muzzle.ts` 的
  實例容量是「架數 × MAX_TURRETS」，寫死給 combatant 用的。船用平行的
  一份，容量「船數 × 8」。
- 砲位 `alive === false` 時把那根砲管的實例縮到 0，並在轉為 false 的那一
  幀噴一團火球（借 `render/fireball.ts`）。

- [ ] **步驟 3：`main.ts` 接線**

- `enterBattle` 建船的渲染物件、`ctx.scene.add`；換場時移除。
- 每幀：更新船的姿態、`emitFlakBursts(flakPool, world.burstEvents)`、
  **排空 `burstEvents`**（與 `hitEvents` 同一個地方、同一個約定）。

- [ ] **步驟 4：人工驗收**

```
npx vite --port 5178 --strictPort
```

進 `japan-m4`，確認：四艘船在海上、緩慢前進、曳光從艦上朝你來、
黑雲在前方開出來、自己的銃手把一座砲位打啞（砲管消失＋一團火球）。

- [ ] **步驟 5：提交**

```bash
git add src/render/ships.ts src/render/flakBursts.ts src/main.ts
git commit -m "feat: 船、艦上槍焰與黑雲的渲染

黑雲是粒子系統的另一份實例，不是共用煙霧池 —— 那一份的壽命與上升是
整池共用的建立期設定，emit 覆寫不了。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 10：e2e 與效能基準

**檔案**
- 新增：`test/e2e/ship-aa.e2e.ts`
- 新增：`test/tools/ship-perf.probe.ts`

- [ ] **步驟 1：寫 e2e**

`test/e2e/ship-aa.e2e.ts`，照 `test/e2e/mission.e2e.ts` 的體例
（**檔頭寫明用 `npx vite-node` 跑**，dev server 5178）：

1. 進 `japan-m4`，按出擊
2. 等 8 秒，`page.evaluate` 讀 `world.ships.length === 4`
3. 讀 `world.flak.live > 0`（高砲真的在空中）
4. 讀 `world.burstEvents` 這一幀有沒有引爆過
5. 等 30 秒，斷言至少有一個砲位 `alive === false`
6. `errors.length === 0`

> `page.evaluate` 的內容要**以字串傳入**——`vite-node` 會把 `import()`
> 改寫成 `__vite_ssr_dynamic_import__`，直接傳函數會在瀏覽器裡爆掉。

- [ ] **步驟 2：跑 e2e**

```
npx vite --port 5178 --strictPort &
npx vite-node test/e2e/ship-aa.e2e.ts
```

- [ ] **步驟 3：量效能的差值，不看絕對值**

**現有的閘門本來就是紅的**（20v20 1,274 µs > 900、160 砲塔追瞄
5,549 µs > 3,500），與 `docs/backlog.md` §1.1 一致。所以：

1. `git stash` 到這一支分支的**起點**，在同一台機器、關掉所有其他程式的
   條件下跑三次 `test/unit/perf-gate.test.ts`，記下三個場景的中位數。
2. 回到分支頂端，同樣條件跑三次。
3. **比差值。** 船這一段的預期成本：滿池時每步固定
   4,000 × 4 = 16,000 次 `segmentPointDistanceSq`，約 65 µs；
   飛機端 40 × 4 = 160 次球比較，SAT 只在貼近時跑。
4. 差值超過 100 µs 就要查——那代表某一條粗篩沒有生效。

**不要為了讓閘門變綠而改任何東西。** 那三項紅是既有的環境問題。

- [ ] **步驟 4：把結果寫進計畫尾巴**

在這份檔案的最後補一節「實作後的偏離與殘留」，記下：
量到的差值、任何偏離 spec 的地方與理由、以及還沒驗到的東西。

- [ ] **步驟 5：提交**

```bash
git add test/e2e/ship-aa.e2e.ts test/tools/ship-perf.probe.ts docs/superpowers/plans/2026-09-04-carrier-group.md
git commit -m "test: 艦隊防空的 e2e 與效能差值量測

閘門的絕對值在這台機器上本來就是紅的（backlog §1.1），所以比的是
改動前後的差值。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## 已知的殘留

| | 為什麼 |
|---|---|
| **玩家在 M4 沒有扳機** | `G4M_BATTERY.mounts` 是空陣列。負責人裁定跟著魚雷一起補（spec §10.3）。這一期靠自己的 AI 砲塔證明砲位打得掉 |
| 船打不沉 | 這一期不做擊沉。船血會扣、會記，但沒有歸零的路徑 |
| 沒有航跡浪、船不隨浪起伏 | 畫面，不影響手感 |
| 黃昏燈光 | 卡片寫「黃昏」，但燈光是另一件事，另案 |
| `allies-m4` 沖繩外海 | 下一期，那一關才輪到 Essex |
