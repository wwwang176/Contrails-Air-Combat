import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { createArchipelago, type IslandDesc } from '../../src/world/archipelago'
import { createFarmland, outsideZero } from '../../src/world/farmland'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { AiController } from '../../src/ai/AiController'
import { isCrashed } from '../../src/aircraft/crash'
import { DEFAULT_SAFETY } from '../../src/ai/safety'
import { ALTITUDES } from '../../src/battle/skirmish'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

/**
 * 【這一支問的是「地形進得了場嗎」】上一輪把群島放進畫面、也把地形感知
 * 接進 AI，但開工前的量測顯示它在真實的仗裡**一次都沒跑到**：跑遍十張
 * 任務卡加遭遇戰，繞島佔時全部 0.00%。原因是開場恆為 4,000 m 而島最高
 * 1,000 m —— 20v20 實跑 600 秒，全場最低只到 2,292 m。
 *
 * 所以這一輪做了兩件事：開場高度變成一個設定（`ALTITUDES`），地圖在交會區
 * 兩側各釘一座 900 m 的錨島。這一支驗那兩件事合起來真的讓山擋得住路。
 *
 * ── 為什麼地形是「注入」的，不是走接線 ────────────────────
 *
 * 真實遊玩的接線在 `main.ts`（`wireTerrain` 與 `world.crashPolicy`），
 * 那裡碰不到 headless。**這一支的題目是幾何，不是接線**：高度 × 山 → AI
 * 真的被擋。接線的護欄仍然只有走 `main.ts` 的 e2e。這是刻意的取捨。
 *
 * ── 判準為什麼是 `safetyAction`，不是 `sense.island` ──────
 *
 * `safetyAction` 已經是公開欄位，而且語意更強：**地形真的改寫了控制輸出**，
 * 不只是「感知到有一座島」。`sense` 是 private，為了測試把鎖存索引公開
 * 出去是 test-only API 污染。
 *
 * ── 「撞山」怎麼數 ────────────────────────────────────────
 *
 * **在 `crashPolicy` 這個 predicate 裡讀 `hp`。** `World.destroy` 第一行
 * 就是 `c.hp = 0`，所以**事後**讀 hp 分不出撞山與被打下來 —— 那樣寫的判準
 * 會靜靜地恆為「沒撞山」（初稿犯過，實測永遠回 0）。而只數「死在陸地上」
 * 也不對：被打下來的殘骸落在島上會被算成撞山（實測一場數到 1，實際 0）。
 *
 * predicate 裡的那一刻 `hp` 還是真值，所以兩者分得開，而且兩個數字都印
 * 出來 —— 分母看得見，這一條才不是一個孤零零的 0。
 *
 * ── 2026-08-27 的實測 ────────────────────────────────────
 *
 * ```
 *   規模     繞島佔時   被地形接管過   繞的是
 *    4v4       3.45%        1 / 8       錨島
 *    8v8       0.00%        0 / 16      —
 *   12v12      0.50%        1 / 24      錨島
 *   16v16      6.23%        2 / 32      錨島
 *   20v20      9.46%        7 / 40      兩座錨島都有
 * ```
 *
 * **8v8 那一格是 0，那是實情不是缺陷** —— 纏鬥那一團漂到哪裡是這一場的
 * 結果，規模改變它的半徑。護欄因此訂在 20v20（也就是預設編制），
 * 而不是宣稱「任何規模都會用到地形」。
 *
 * ── 這一條是承重的 ──────────────────────────────────────
 *
 * 把兩座錨島拿掉、`TIERS[0].count` 還原成 2（也就是回到上一輪那張隨機
 * 地圖），同一場 600 m 的 20v20 量到 **0/40**。**護欄立刻紅。**
 * 那正是這一輪開工前量到的那件事。
 */

class Idle implements Controller {
  private readonly aim = new Vector3(0, 0, -1)
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim)
    out.throttle = 0.7
    out.firing = false
  }
}

const DT = 1 / 240
const SECONDS = 180
const SEED = 20260805
/** 每隊架數。預設編制 —— 護欄訂在玩家最常打的那一種 */
const SIDE = 20

/**
 * 拉平一次要幾秒。**推導的，不是挑的**：P-51D 在 400 km/h 拉 5 G 的轉彎
 * 半徑是 V²/(g√(n²−1)) = 256 m，把航跡由 −40° 拉平要走 179 m 弧長 ——
 * 111 m/s 下是 1.6 秒。取 2 留一點餘裕。
 */
const RECOVERY_SECONDS = 2

const DECK = ALTITUDES[0]!.value
const HIGH = ALTITUDES[ALTITUDES.length - 1]!.value

const arch = createArchipelago()

/**
 * 一張圖給 AI 的兩樣東西：避障用的圓盤，與地表高度。
 *
 * 【為什麼要參數化】內陸農地是第二張有陸地的圖，而它的丘陵只有 120 m 高 ——
 * 那件事會不會讓地形感知在那張圖上完全跑不到，是量出來的，不是猜的。
 */
interface Land {
  readonly islands: readonly IslandDesc[]
  ground(x: number, z: number): number
}

/** 群島。海面在別處，這裡只要陸地 —— 場外回 0 */
const SEA_LAND: Land = {
  islands: arch.islands,
  ground(x, z) {
    const h = arch.field.sample(x, z)
    return Number.isFinite(h) && h > 0 ? h : 0
  },
}

const farm = createFarmland()
const farmField = outsideZero(farm.field)

/** 內陸農地。丘陵當「島」用 —— 見 `world/farmland.ts` 的檔頭 */
const FARM_LAND: Land = {
  islands: farm.hills,
  ground(x, z) { return farmField.sample(x, z) },
}

interface Run {
  /** 被打下來、殘骸落在陸地上的架數。**不是撞山** */
  fellOnLand: number
  /** 每一次撞山當下的接近率，m/s */
  closures: number[]
  /** 每一次撞山當下安全層在做什麼 */
  crashActions: string[]
  /** 這一場曾經被地形接管過的飛機數 */
  touched: number
  /** 地形接管的步數佔比 */
  share: number
  hitLand: number
  /** 出生時每一架離地的最小值，m */
  spawnClear: number
  minMargin: number
}

function fly(altitude: number, land: Land = SEA_LAND): Run {
  const ground = (x: number, z: number): number => land.ground(x, z)
  const b = createBattle(new Idle(), {
    ...DEFAULT_BATTLE, altitude, units: lineAbreast(HEAD_ON, P51D, SIDE, BF109K4, SIDE),
  }, SEED)

  let hitLand = 0
  let fellOnLand = 0
  /** 每一次撞山當下的接近率，m/s */
  const closures: number[] = []
  /** 每一次撞山當下安全層在做什麼 */
  const crashActions: string[] = []
  // 【每一架的上一格離地餘裕】`crashPolicy` 每個物理步對每一架活著的飛機
  // 各呼叫一次（`World.step`），所以接近率在這裡算得出來
  const prevClear = new Float64Array(b.world.combatants.length).fill(Number.NaN)
  b.world.crashPolicy = (c) => {
    const p = c.aircraft.state.position
    const g = ground(p.x, p.z)
    const clear = p.y - g
    const before = prevClear[c.index]!
    prevClear[c.index] = clear
    const crashed = isCrashed(p, (x, z) => ground(x, z), 0)
    if (crashed && g > 1) {
      // 【`hp` 要在 predicate 裡讀】`World.destroy` 第一行就是 `c.hp = 0`，
      // 而這裡是它之前的那一刻 —— 現在的 hp 還是真值。被打下來掉在島上的
      // 那一架 hp 已經 ≤ 0，撞山的那一架還是正的
      if (c.hp > 0) {
        hitLand++
        // 【接近率含兩項】自己往下掉，加上腳下的地形往上升。用「離地餘裕」
        // 的變化率一次量到兩者 —— 那正是安全層在賽跑的那個量
        closures.push(Number.isNaN(before) ? Infinity : (before - clear) / DT)
        const ctl = c.controller
        crashActions.push(ctl instanceof AiController ? ctl.safetyAction : 'none')
      } else fellOnLand++
    }
    return crashed
  }
  for (const c of b.world.combatants) {
    const ctl = c.controller
    if (ctl instanceof AiController) { ctl.terrain = { islands: land.islands }; ctl.clearTerrainState() }
  }

  // 出生點的離地餘裕。**在第一步之前量** —— 之後就分不出「生在山裡」與
  // 「飛進山裡」
  let spawnClear = Infinity
  for (const c of b.world.combatants) {
    const p = c.aircraft.state.position
    const m = p.y - ground(p.x, p.z)
    if (m < spawnClear) spawnClear = m
  }

  const touched = new Set<number>()
  let ticks = 0
  let terrainTicks = 0
  let minMargin = Infinity
  for (let i = 0; i < Math.round(SECONDS / DT); i++) {
    stepBattle(b, DT)
    if (i % 12 !== 0) continue
    for (let k = 0; k < b.world.combatants.length; k++) {
      const c = b.world.combatants[k]!
      if (!c.alive) continue
      ticks++
      const p = c.aircraft.state.position
      const g = ground(p.x, p.z)
      if (g > 1 && p.y - g < minMargin) minMargin = p.y - g
      const ctl = c.controller
      if (ctl instanceof AiController && ctl.safetyAction === 'terrain') {
        terrainTicks++
        touched.add(k)
      }
    }
  }
  return {
    touched: touched.size,
    share: terrainTicks / Math.max(1, ticks),
    hitLand,
    fellOnLand,
    closures,
    crashActions,
    spawnClear,
    minMargin,
  }
}

describe('地形進得了場', () => {
  const deck = fly(DECK)
  const high = fly(HIGH)

  it('甲板高度：山真的擋得住路', () => {
    console.log(JSON.stringify({
      altitude: DECK,
      touched: `${deck.touched}/${SIDE * 2}`,
      share: (deck.share * 100).toFixed(2) + '%',
      minMargin: deck.minMargin.toFixed(0),
    }))
    expect(deck.touched).toBeGreaterThan(0)
  })

  /**
   * 【為什麼不是「撞山 0」】實測有一架撞了：滿血的 P-51D 俯衝追人，2.5 秒
   * 掉 240 m，而**腳下的地形同時升了 85 m**。安全層的 `clearance` 是 120 m，
   * 那個常數是照**平的海面**訂的 —— 地形會自己迎上來這件事不在它的模型裡。
   *
   * 把它提高到 160 m 確實歸零，但那是全域 AI 常數：同一場 20v20 的存活
   * 從 34 變 27 —— 對戰矩陣、六場機動、命令通道全部要重錄。專案負責人
   * 2026-08-28 裁定不付那個代價。
   *
   * 【所以判準換成兩條，都說得出理由】
   *
   * ```
   *   一、安全層必須正在接管    抓「地形感知根本沒觸發」
   *   二、餘裕撐不到 RECOVERY_SECONDS  抓「AI 慢慢飄進山裡」
   * ```
   *
   * `RECOVERY_SECONDS = 2` 不是挑出來的：P-51D 在 400 km/h 拉 5 G 的轉彎
   * 半徑是 256 m，把航跡由 −40° 拉平要走 179 m 弧長，也就是 1.6 秒。
   * **餘裕撐不到一次拉平，那就是來不及**，不是缺陷。
   *
   * 與上一輪「仍在鎖存中的組別，高度必須高於進場高度」是同一手：
   * **不把觀測值抄成門檻，換一個說得出理由的判準。**
   */
  it('甲板高度：撞山只能是來不及的那一種', () => {
    const limit = DEFAULT_SAFETY.clearance / RECOVERY_SECONDS
    console.log(JSON.stringify({
      hitLand: deck.hitLand,
      fellOnLand: deck.fellOnLand,
      closures: deck.closures.map((v) => v.toFixed(0)),
      actions: deck.crashActions,
      limit: limit.toFixed(0),
    }))
    for (const a of deck.crashActions) expect(a).not.toBe('none')
    for (const v of deck.closures) expect(v).toBeGreaterThan(limit)
  })

  /**
   * 【對照組】沒有它的話，上面那一條在「地形層永遠回報介入」時也會綠。
   * 這一條把「高度是那個變因」一起釘住。
   */
  it('中空高度：地形完全不相干 —— 高度就是那個變因', () => {
    console.log(JSON.stringify({
      altitude: HIGH,
      touched: `${high.touched}/${SIDE * 2}`,
      minMargin: high.minMargin.toFixed(0),
    }))
    expect(high.touched).toBe(0)
    expect(high.hitLand).toBe(0)
    expect(high.fellOnLand).toBe(0)
  })

  /**
   * 【為什麼要驗出生點】開場高度恆為 4,000 時，出生點在不在島上方無所謂
   * —— 島最高 1,000 m。可以選 600 之後，出生在山裡就變成**開局直接墜機**，
   * 而畫面上看起來像是隨機的白畫面。
   */
  it('甲板高度：沒有人生在山裡', () => {
    console.log(JSON.stringify({ spawnClear: deck.spawnClear.toFixed(0) }))
    expect(deck.spawnClear).toBeGreaterThan(DEFAULT_SAFETY.clearance)
  })
})

/**
 * **內陸農地的基準。** 這一組不是護欄，是**紀錄**：植被那一輪之後，
 * 這張圖在真實的仗裡長什麼樣子。
 *
 * 【為什麼與群島分開】丘陵的峰高上限是 120 m，而群島的錨島是 900 m ——
 * 兩張圖的「地形擋不擋得住路」根本不是同一個問題。把農地塞進上面那組
 * 護欄會逼著它去滿足一個對它沒有意義的門檻。
 */
describe('內陸農地的基準（紀錄，不是護欄）', () => {
  const deck = fly(DECK, FARM_LAND)

  it('印出這張圖的基準', () => {
    console.log(JSON.stringify({
      丘陵數: FARM_LAND.islands.length,
      峰高最大: Math.max(...FARM_LAND.islands.map((i) => i.peak)).toFixed(0) + ' m',
      出生離地最小: deck.spawnClear.toFixed(0) + ' m',
      全場離地最小: deck.minMargin.toFixed(0) + ' m',
      撞山: deck.hitLand,
      被打下來落在陸上: deck.fellOnLand,
      地形接管佔時: (deck.share * 100).toFixed(2) + '%',
      被接管過幾架: deck.touched + ' / ' + (SIDE * 2),
    }, null, 1))
    expect(FARM_LAND.islands.length).toBeGreaterThan(20)
  })

  /**
   * 【沒有人生在山裡】丘陵最高 120 m 而甲板開場高度遠高於它，所以這一條
   * 應該是穩穩的。它守的是「生成器改了之後有沒有人被塞進山裡」。
   */
  it('沒有人生在山裡', () => {
    expect(deck.spawnClear).toBeGreaterThan(0)
  })

  /**
   * 【撞山不該多】丘陵矮而緩（最陡 8.5°），撞上去只可能是纏鬥時貼地貼過頭。
   */
  it('撞山的架數是個位數', () => {
    console.log(JSON.stringify({ 撞山: deck.hitLand, 接近率: deck.closures.map((c) => c.toFixed(0)) }))
    expect(deck.hitLand).toBeLessThan(10)
  })
})
