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
 * （`ai/AiController.ts`）。專案負責人 2026-08-21：「AI 的戰鬥機也要跟
 * 轟炸機的機槍一樣，會有冷卻時間（只是頻率可以高一點）」——「一樣」在
 * 這裡是字面的：同一份實作，只是餵不同的 `on` / `off`。
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
 * ── 為什麼需要它（人工回報 2026-08-21）──────────────────
 *
 * 「轟炸機上的機槍，開火時間、冷卻時間都一樣」。實測確認是**完全同步**：
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
