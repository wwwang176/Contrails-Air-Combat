import { ROOT3, SILVER } from './turret'

/**
 * 點放（開一段、停一段）的跨格狀態。
 *
 * 【為什麼是結構型介面而不是一個 class】`TurretState` 在這個介面存在之前
 * 就有這三個欄位，而它被兩支快照測試逐位元釘住（`turret-replay`、
 * `spawn-snapshot`）。維持同名欄位，砲塔那一側**一個字都不用改**，
 * 結構上自動滿足這個介面。
 *
 * 【誰在用】砲手（`world/turrets.ts`、`world/shipGuns.ts`）與 AI 戰鬥機的
 * 扳機（`ai/AiController.ts`）—— **同一份 `stepRandomBurst`，只是餵不同的
 * 週期與工作週期。**
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

/** 砲手點放的開火秒數，**平均值**；每一段的實際長度見 `stepGunnerBurst`。 */
export const BURST_ON = 1.2
/** 砲手點放的停火秒數。**起始值。** */
export const BURST_OFF = 0.8
/**
 * 點放週期的分散幅度，±這個比例。**起始值，由試飛裁定。**
 *
 * 每一座（每一架）一個倍率，開火段與停火段**同時**乘它，所以工作週期不變
 * —— 火力總量與 `TURRET_DAMAGE_SCALE` 都不受影響，變的只有節奏。停火段
 * 固定長度，沒有這個倍率的話同一批砲塔的停火段全部一樣長，聽起來像節拍器。
 *
 * 0.25 → 砲手的平均週期落在 1.5 … 2.5 秒。
 */
export const BURST_SCATTER = 0.25

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
 * 開火段長度隨機的點放。AI 戰鬥機與砲手（`stepGunnerBurst`）都用它。
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

/** 砲手（轟炸機砲塔、船上與地面砲位）一段開火最短幾秒。 */
export const GUNNER_BURST_SHORTEST = 0.3
/**
 * 砲手開火段長度相對 `BURST_ON × burstScale` 的倍數範圍，均勻抽樣。
 *
 * 【下限由最短秒數反推】週期倍率最小的那一座（`1 − BURST_SCATTER`）抽到
 * 下限時恰好是 `GUNNER_BURST_SHORTEST`。
 *
 * 【上限 = 2 − 下限】抽樣的平均才會是 1，工作週期維持
 * `BURST_ON / (BURST_ON + BURST_OFF)`。上下限不對稱的話火力總量會跟著變。
 */
export const GUNNER_BURST_MIN = GUNNER_BURST_SHORTEST / (BURST_ON * (1 - BURST_SCATTER))
export const GUNNER_BURST_MAX = 2 - GUNNER_BURST_MIN

/**
 * 砲手的點放推進一步，回傳這一步開始時是否在開火段。停火段固定
 * `BURST_OFF × burstScale`，開火段每一段各抽一次長度。
 *
 * `k` 是這一座在全場的唯一編號，與 `resetBurst` 用的是同一個。
 */
export function stepGunnerBurst(s: RandomBurstCycle, dt: number, k: number): boolean {
  return stepRandomBurst(
    s, dt, BURST_ON + BURST_OFF, BURST_ON / (BURST_ON + BURST_OFF),
    k, GUNNER_BURST_MIN, GUNNER_BURST_MAX,
  )
}
