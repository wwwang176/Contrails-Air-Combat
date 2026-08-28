import type { HeightFieldData } from './heightfield'

/**
 * 地形遮蔽 —— 山擋不擋得住視線與子彈。
 *
 * ```
 *   losBlocked   AI 用。漏判 = 多開一輪空槍，彈丸那一側仍然會收掉子彈
 *   landHitT     彈丸用。漏判 = 子彈穿過山，那是正確性問題
 * ```
 *
 * **兩者的失效方向不同，所以精度要求不同。** 這也是為什麼它們不合成一個
 * 函式：合了之後只有一個步長，而那個步長會同時對兩邊都錯。
 *
 * 【與 `terrainSense` 的分工】那一層的避障刻意**不查高度場**（沿航跡取樣
 * 會漏掉窄峰，而那一層漏判的代價是撞山）。這一層相反：它要的正是
 * 「畫面上那個面」，所以讀的就是 mesh 用的那一份。
 *
 * 熱路徑：不配置。
 */

/** 這一場的陸地。**沒有陸地時呼叫端持有 `null`，不要造一個假的平原** */
export interface LandField {
  /** 與 `render/island.ts` 切 mesh 用的是同一份 */
  readonly field: HeightFieldData
  /** 全場陸地的最高點，m。兩端都高於它就不必查 */
  readonly ceiling: number
}

/**
 * 海平面。**陸地的判準是「高於它」，不是「高於高度場的值」。**
 *
 * 【少了這一半會怎樣】高度場沒有島的地方是 `SEA_FLOOR = −8`
 * （`archipelago.ts`）—— 一發入海的子彈會在水下 8 m 被當成撞地、爆一朵
 * 火花並提早消失。而現行行為是在 y = 0 推水柱、到 `SEA_KILL_Y = −20`
 * 才回收。海面那一條一個字都不該動。
 */
const SEA = 0

/** `losBlocked` 的取樣步長是格距的幾分之一 */
const LOS_DIVISOR = 2
/** `landHitT` 的取樣步長是格距的幾分之一。彈丸那一側要細一點 */
const HIT_DIVISOR = 4

/**
 * 兩點之間的視線被陸地擋住嗎。
 *
 * **它不是精確的。** 格內是兩個平面三角形（見 `heightfield.ts`），取樣更細
 * 確實會多知道事情。最壞的漏判約是 `坡度 × 步長 / 2`。
 *
 * ── 【真正的坡度，2026-08-28 量過】────────────────────────────────
 *
 * 這段註解原本寫「坡度 ≤ 0.5，漏判 5 m 以下」。**那個數字從來沒有對過** ——
 * 剖面最陡處是 `1.5 × (peak − SEA_FLOOR) / (radius × wobble最小)`，而最陡的
 * 從來不是錨島，是最小的那一批島。
 *
 * ```
 *                        最陡坡度   losBlocked（20 m）  landHitT（10 m）
 *   錨島 900 m   單錐        1.37         14 m               7 m
 *                多瓣        1.65         17                 8
 *   tier-1 500   單錐        2.15         22                11
 *                多瓣        3.07         31                15
 *   小礁 160 m   單錐        2.37         24                12
 *                多瓣        5.35         54                27
 * ```
 *
 * 多瓣把**小礁**推陡了一倍多，山幾乎沒動 —— 那是 `archipelago.ts` 的
 * `LOBE_LIFT_MAX` 造成的，它封的是「次峰高出主體幾公尺」，所以只咬得住
 * 大島。陡的地方換對了：這一層在一塊 160 m 的石頭上漏判一次，代價是子彈
 * 穿過它。
 *
 * **步長沒有跟著調**：這一層漏判的代價是 AI 多開一輪空槍（彈丸那一側仍然
 * 會收掉子彈），而 `LOS_DIVISOR` 在 20 Hz × 40 架的熱路徑上。要不要用 CPU
 * 換那 54 m 是專案負責人的決定，記在 `docs/backlog.md`。
 */
export function losBlocked(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  land: LandField,
): boolean {
  // 【第一道閘門】兩端都在全場最高點之上時，中間不可能有東西
  if (ay > land.ceiling && by > land.ceiling) return false

  const f = land.field
  const dx = bx - ax
  const dz = bz - az
  const len = Math.hypot(dx, dz)
  const step = f.cell / LOS_DIVISOR
  const n = len > step ? Math.ceil(len / step) : 1
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const h = f.sample(ax + dx * t, az + dz * t)
    if (h > SEA && ay + (by - ay) * t < h) return true
  }
  return false
}

/**
 * 這一段線段第一次沉進陸地的參數 t ∈ [0, 1]；沒有交點回 `Infinity`。
 *
 * 【為什麼要回參數而不是 true/false】呼叫端要拿它跟「打中飛機的那個 t」
 * 比先後。同一個物理步之內「先打中飛機、後進入地面」是合法命中 ——
 * 飛機真的會貼著坡面飛（甲板實測量到過離地 6 m），而彈丸一步走 3.7~4.5 m。
 *
 * 【為什麼不是只查終點】兩端都在地形之上，中間仍可能跨過一條稜線。
 * 10 m 的步長把漏判壓到約 27 m（最壞是小礁，山上是 8 m）—— 見 `losBlocked`
 * 那張表，數字是量出來的而不是假設的。
 */
export function landHitT(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  land: LandField,
): number {
  if (ay > land.ceiling && by > land.ceiling) return Infinity

  const f = land.field
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const len = Math.hypot(dx, dz)
  const step = f.cell / HIT_DIVISOR
  const n = len > step ? Math.ceil(len / step) : 1
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const h = f.sample(ax + dx * t, az + dz * t)
    if (h > SEA && ay + dy * t <= h) return t
  }
  return Infinity
}
