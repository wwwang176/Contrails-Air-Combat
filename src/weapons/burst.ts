import { ROOT3, SILVER } from './turret'

/**
 * 點放（開一段、停一段）的跨格狀態。
 *
 * 【為什麼是結構型介面而不是一個 class】`TurretState` 在這個介面存在之前
 * 就有這三個欄位，而它被兩支快照測試逐位元釘住（`turret-replay`、
 * `spawn-snapshot`）。維持同名欄位，砲塔那一側**一個字都不用改**，
 * 結構上自動滿足這個介面。
 *
 * 【誰在用】砲塔（`world/turrets.ts`）與 AI 戰鬥機的扳機
 * （`ai/AiController.ts`）。AI 的戰鬥機與轟炸機的機槍有同樣的冷卻，只是
 * 頻率高一點 —— **同一份實作，只是餵不同的 `on` / `off`。**
 */
export interface BurstCycle {
  /** 現在是開火段還是停火段。 */
  burstFiring: boolean
  /** 目前這一段還剩幾秒。**恆為正。** */
  burstTimer: number
  /**
   * 這一座（這一架）自己的週期倍率。開火段與停火段**同時**乘它，所以
   * 工作週期恆為 `on / (on + off)`，**火力總量不變**，變的只有節奏。
   * 見 `BURST_SCATTER`。
   */
  burstScale: number
}

/** 砲塔點放的開火秒數。**起始值。** */
export const BURST_ON = 1.2
/** 砲塔點放的停火秒數。**起始值。** */
export const BURST_OFF = 0.8
/**
 * 點放週期的分散幅度，±這個比例。**起始值，由試飛裁定。**
 *
 * ── 為什麼需要它 ────────────────────────────────────────
 *
 * 沒有它時整台轟炸機的機槍**完全同步**開火與冷卻：
 * `resetTurretStates` 對每一座都寫死 `burstFiring = true` 與
 * `burstTimer = BURST_ON`，而 `stepBurst` 只吃 `dt` —— 沒有任何一項與砲塔
 * 或載機有關，所以一旦同步就永遠同步。20 架 B-17G + 20 架 He 111 = 260 座
 * 砲塔跑 60 秒，同時開火的座數**每一步不是 260 就是 0**，60% 的時間全開、
 * 40% 的時間全關。整個機隊像同一根扳機。
 *
 * ── 為什麼「錯開起點」還不夠 ──────────────────────────
 *
 * 只錯開起點的話，260 座是一組**頻率相同、只差相位**的方波：相對關係凍結，
 * 每一座自己也永遠是精準的 1.2 開 / 0.8 關。週期也散開之後，任兩座的相對
 * 關係一直在漂，聽起來才不像節拍器。
 *
 * ── 為什麼是倍率而不是各自加一個隨機量 ──────────────
 *
 * 開火段與停火段乘同一個數，**工作週期完全不變** —— 每一座仍然是 60% 的
 * 時間在開火，所以火力總量與 `TURRET_DAMAGE_SCALE` 都不受影響。分別加減
 * 的話會連帶動到平衡，那是另一個決定。
 *
 * 0.25 → 砲塔的週期落在 1.5 … 2.5 秒（開火段 0.9 … 1.5 秒）。
 */
export const BURST_SCATTER = 0.25

/**
 * 推進點放一步，回傳**這一步**是否在開火段。
 *
 * 【為什麼用 while 而不是 if】低更新率（工具程式可能用 0.3 s 甚至更大的
 * 步長）下一步可能跨過好幾個週期。用 if 會讓 `burstTimer` 變成負數而
 * 永遠不再回復。
 *
 * 【`on` / `off` 為什麼有預設值】砲塔那一側在這個函數被抽出來之前就存在，
 * 呼叫端（含四支測試與探針）寫的是 `stepBurst(s, dt)`。給預設值等於
 * **既有行為逐字不變**，新的呼叫端自己帶參數。
 */
export function stepBurst(
  s: BurstCycle, dt: number, on: number = BURST_ON, off: number = BURST_OFF,
): boolean {
  const firingThisStep = s.burstFiring
  s.burstTimer -= dt
  while (s.burstTimer <= 0) {
    s.burstFiring = !s.burstFiring
    // 兩段乘同一個倍率 —— 工作週期不變，只有節奏跟著這一座走
    s.burstTimer += (s.burstFiring ? on : off) * s.burstScale
  }
  return firingThisStep
}

/**
 * 就地把點放攤到週期上，**不配置任何物件**。
 *
 * `k` 是這一座（這一架）在全場的唯一編號。砲塔用
 * `combatantIndex * MAX_TURRETS + turretIndex`，AI 戰鬥機用自己的座位索引。
 *
 * 【兩條序列各用各的乘子】週期用 `ROOT3`、起點用 `SILVER`。共用一條的話
 * 「週期偏長的那一座必然也開火得早」，兩件事縮成一件（見 `turret.ts` 的
 * `SILVER` 註解）。它們與 `resetTurretStates` 裡搜尋節流用的 `GOLDEN`
 * 也彼此無理數比，三件事在三維上一樣鋪得開。
 *
 * 【為什麼不用亂數】逐位元重播（`test/integration/rematch.test.ts`）要求
 * 完全確定性。低差異序列在任意前綴上都接近均勻，而且是純函數。
 */
export function resetBurst(
  s: BurstCycle, k: number,
  on: number = BURST_ON, off: number = BURST_OFF, scatter: number = BURST_SCATTER,
): void {
  s.burstScale = 1 + (((k * ROOT3) % 1) - 0.5) * 2 * scatter
  const onScaled = on * s.burstScale
  const cycle = (on + off) * s.burstScale
  // 起點攤在整個週期上：落在開火段就是開火段，落在後段就是停火段
  const at = ((k * SILVER) % 1) * cycle
  s.burstFiring = at < onScaled
  s.burstTimer = s.burstFiring ? onScaled - at : cycle - at
}

/**
 * 開火段長度隨機的點放。AI 戰鬥機用；砲塔仍是固定週期的 `stepBurst`。
 *
 * `burstDraw` 是抽過幾輪，`burstLength` 是這一輪開火段的長度，s。
 */
export interface RandomBurstCycle extends BurstCycle {
  burstDraw: number
  burstLength: number
}

/**
 * 第 `n` 輪的 0..1 抽樣，`k` 是這一架的編號。**純函數** —— 逐位元重播
 * （`test/integration/rematch.test.ts`）要求完全確定性，所以不用 `Math.random`。
 */
export function burstDraw01(k: number, n: number): number {
  let h = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(n + 0x632be5ab, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/**
 * 推進一步，回傳這一步開始時是否在開火段。
 *
 * **每一次進入開火段就先決定這次扣扳機多久**：固定週期下的開火段
 * `cycle × duty` 乘上 `min`…`max` 之間的一個抽樣，再乘這一架的 `burstScale`。
 * 抽樣的平均是 1，所以時間平均下開火的比例仍是 `duty`。
 *
 * 【停火段不隨機】它維持 `cycle × (1 − duty)`。跟著開火段一起縮的話，抽到短的
 * 那一輪停火只剩 0.03 s —— 比機槍兩發之間還短，一發都沒少，看起來就是一直
 * 連發。
 *
 * 【`duty` 取切換當下的值】開火段長度在進入時就定了，瞄準品質在段中改變
 * 不會把它截短或拉長；停火段的長度取停火開始那一刻的 `duty`。
 *
 * 熱路徑：不配置。
 */
export function stepRandomBurst(
  s: RandomBurstCycle, dt: number, cycle: number, duty: number,
  k: number, min: number, max: number,
): boolean {
  const firingThisStep = s.burstFiring
  // 週期為 0 時兩段都是 0，下面的迴圈停不下來；那等於一路按著扳機
  if (!(cycle > 0)) return true
  s.burstTimer -= dt
  while (s.burstTimer <= 0) {
    s.burstFiring = !s.burstFiring
    if (s.burstFiring) {
      s.burstDraw++
      s.burstLength = cycle * duty * s.burstScale
        * (min + (max - min) * burstDraw01(k, s.burstDraw))
      s.burstTimer += s.burstLength
    } else {
      s.burstTimer += cycle * (1 - duty) * s.burstScale
    }
  }
  return firingThisStep
}
