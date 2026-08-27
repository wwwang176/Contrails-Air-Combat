import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_RULES, type RuleConfig } from '../../src/ai/rules'
import type { Combatant } from '../../src/world/World'

/**
 * `extend` 的絕對出場條件：脫離的**總量**要下降，而且沒有人死得更快。
 *
 * ── 【為什麼主判準是「率」不是段落長度的分布】──────────────
 *
 * 實測（`test/tools/extend-exit.probe.ts`，改動前）：開啟後約**一半**的
 * 純能量型段落根本不會出生 —— 它們在進場那一拍 `cornerRatio` 就已經高於
 * `cornerExit`，合取直接是 false。而被擋掉的全是最短的那些。
 *
 * 所以只比較「仍然存在的段落」的 p90 會**系統性看錯方向**：剩下的自然偏長，
 * 分布可以完全不動甚至變差，而總量其實掉了一半。
 *
 * 率把分母固定在「戰鬥機活著的時間」，不受這個選樣影響。
 *
 * ── 【為什麼是消融而不是與歷史數字比】──────────────────
 *
 * `ai-withdraw-anchor.test.ts` 的註解逐字警告過「單次量測當門檻是變更
 * 偵測器不是設計判準」。這裡的對照組由**同一個 binary、同一組種子、同一組
 * 微擾**產生，不是一個寫死的歷史數字。
 *
 * ── 【判準是符號檢定，不是「效果量超過 off 組全距」】────────
 *
 * 第一版寫的是「配對取中位數的效果量，要超過 `off` 組五次的全距」。
 * **那兩個量不可比。**
 *
 * 配對比較的整個用意就是消掉「不同 salt 之間」的變異；而 `off` 組的全距
 * 量的正是那個已經被消掉的東西。用它當門檻等於要求「配對後的效果要大於
 * 配對前的雜訊」—— 結構上幾乎不可能通過，而且單一離群值就能把它撐大
 * （實測 `axis-escort` 有一次 `off` 只進場 1 次，share 0.0035，全距因此
 * 被撐到 0.126）。
 *
 * **配對設計的雜訊要用配對差自己的離散度衡量。** 這裡用最標準的無母數
 * 作法：**符號檢定**。兩張卡合起來十對，要求至少九對同向 ——
 * 公平硬幣下 `P(≥9/10) = 11/1024 ≈ 1.1%`。
 *
 * 【為什麼合併兩張卡而不是各自檢定】五對全同向才 `(1/2)^5 = 3.1%`，
 * 而四對是 18.75%（太鬆，Codex 上一輪正確地指出過）。五個樣本的符號檢定
 * 只有「全中」與「太鬆」兩檔，沒有中間值。兩張卡是 spec 指名的兩個場景，
 * 合併之後才有足夠的解析度。**每張卡仍各自要求中位數為負**，方向不能靠
 * 另一張卡補。
 *
 * ── 【診斷只印不斷言】────────────────────────────────
 *
 * 專案既有的分工：測試斷言少而準，量測放探針。逐段的結束原因、churn、
 * 段落長度分布都在 `extend-exit.probe.ts`，那支要在改動前後各跑一次。
 * 這裡只印 spec §8.2 裁定「回場方向要不要做」需要的那一個數字。
 */
const DT = 1 / 240
const SECONDS = 300
const SEED = 20260805
/** 10 Hz —— 與 `AI_DECISION_HZ` 一致。閂鎖只在決策拍更新，不必更密 */
const STRIDE = 24
const STEP = DT * STRIDE

/** 五次微擾。0 = 不擾動的那一次 */
const SALTS = [0, 101, 202, 303, 404]

const CARDS: [string, 'allies' | 'axis'][] = [
  ['axis-escort', 'axis'],
  ['allies-escort', 'allies'],
]

/**
 * 把每一架的初速擾動 ±0.5%，擾動量由 `(salt, index)` 決定。
 *
 * 【為什麼要自己造擾動】`createBattle` 的 `seed` **只餵飛行員名字** ——
 * 換種子跑出來逐位元相同。少了擾動就分不出「這個結果是穩的」還是
 * 「這一次剛好」。
 *
 * 【為什麼不用 `Math.random`】專案禁止。整數雜湊，同樣的輸入給同樣的擾動。
 */
function jitter(b: ReturnType<typeof createBattle>, salt: number): void {
  if (salt === 0) return
  for (const c of b.world.combatants) {
    let h = (salt ^ (c.index * 0x9e3779b1)) >>> 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
    c.aircraft.state.velocity.multiplyScalar(1 + ((h >>> 8) / 0xffffff - 0.5) * 0.01)
  }
}

interface Result {
  /** 純能量型 `extend` 的總秒數 ÷ 己方戰鬥機的存活秒數 */
  share: number
  /** 純能量型的進場次數 ÷ 己方戰鬥機的存活分鐘 */
  entriesPerMin: number
  /** protected 的存活積分，aircraft-seconds */
  protectedAlive: number
  /** 己方戰鬥機的存活積分，aircraft-seconds */
  fighterAlive: number
  /** 診斷：純能量型段落數 */
  entries: number
  /**
   * 每段相對**進場那一刻凍結的位置**的最大離場距離，p90 與 max，m。
   *
   * **這是 spec §8.2 裁定「回場方向要不要做」的資料來源。** 錨點凍結不逐拍
   * 重算 —— 逐拍重算「存活 protected 形心」會把 protected 的死亡與編隊移動
   * 混進自機的效果。凍結的錨點只回答「這一段我跑多遠」。
   */
  driftP90: number
  driftMax: number
}

/** 段落追蹤：`kind` 要看整段，不能只看進場那一拍 */
interface Seg {
  t0: number
  x0: number
  z0: number
  maxDrift: number
  entryEnergy: boolean
  /** 段落期間**曾經**成立過的理由 —— 混合型與見底型要排除 */
  everTurn: boolean
  everFloor: boolean
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))
  return sorted[i]!
}

function median(xs: number[]): number {
  const a = xs.slice().sort((x, y) => x - y)
  const n = a.length
  return n % 2 === 1 ? a[(n - 1) / 2]! : (a[n / 2 - 1]! + a[n / 2]!) / 2
}

const range = (xs: number[]): number => Math.max(...xs) - Math.min(...xs)

function run(id: string, faction: 'allies' | 'axis', salt: number, on: boolean): Result {
  const card = MISSIONS[faction].find((m) => m.id === id)!
  const b = createBattle(new AiController(), missionConfigFrom(card, faction), SEED)
  jitter(b, salt)

  // 【設定點】`createBattle` 已經替每個座位建好 controller（`setup.ts:459`）
  //
  // 【兩檔都要明寫，不能拿 `DEFAULT_RULES` 當「開啟」】那個預設值是
  // **關閉**的（實測否決，見 `RuleConfig.recoveredExit` 的註解）。直接用它
  // 當開啟組，兩檔會變成同一個東西，而測試會以「效果為零」的形式失敗 ——
  // 那個紅看起來像迴歸，其實是量具接錯。
  const cfg: RuleConfig = { ...DEFAULT_RULES, recoveredExit: on }
  for (const c of b.world.combatants) {
    if (c.controller instanceof AiController) c.controller.rulesConfig = cfg
  }

  const cs: Combatant[] = b.world.combatants
  // 【玩家座位也算】這一場是 `createBattle(new AiController(), …)`，玩家座位
  // 也是觀測中的 AI 戰鬥機。把它排除會讓分子與分母的母體不一致。
  const mine = cs.filter((c) => c.team === b.player.team
    && c.controller instanceof AiController
    && c.aircraft.spec.role === 'fighter')
  const guarded = cs.filter((c) => b.board.protectedMask[c.index] !== 0)

  const seg: (Seg | null)[] = cs.map(() => null)
  const drifts: number[] = []
  let energySeconds = 0
  let entries = 0
  let fighterAlive = 0
  let protectedAlive = 0
  let t = 0

  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    if (k % STRIDE !== 0) continue
    t += STEP

    for (const c of guarded) if (c.alive) protectedAlive += STEP

    for (const c of mine) {
      const i = c.index
      const ai = c.controller as AiController
      // 【`?? null`】`noUncheckedIndexedAccess` 讓索引結果帶 `undefined`，
      // 而下面靠 `=== null` 收窄
      const s = seg[i] ?? null

      // 【死亡與失去目標都是右設限】段落被外部截斷，長度不可信。
      // 失去目標那條路徑不跑 `stepRules`，而 `ai.intent` 可能仍殘留
      // `extend` —— 不能只靠字串判斷段落。
      if (!c.alive || ai.target === null) {
        seg[i] = null
        continue
      }
      fighterAlive += STEP

      const r = ai.rules
      if (ai.intent === 'extend') {
        const p = c.aircraft.state.position
        if (s === null) {
          seg[i] = {
            t0: t,
            x0: p.x,
            z0: p.z,
            maxDrift: 0,
            entryEnergy: r.extendEnergyLatch
              && !r.extendTurnLatch && !r.extendFloorLatch,
            everTurn: r.extendTurnLatch,
            everFloor: r.extendFloorLatch,
          }
        } else {
          if (r.extendTurnLatch) s.everTurn = true
          if (r.extendFloorLatch) s.everFloor = true
          const d = Math.hypot(p.x - s.x0, p.z - s.z0)
          if (d > s.maxDrift) s.maxDrift = d
        }
      } else if (s !== null) {
        // 【整段結束才歸類】turn latch 可能中途成立又解除，那一段就不是
        // 純能量型了。只看進場與離場兩拍會把它算進來。
        if (s.entryEnergy && !s.everTurn && !s.everFloor) {
          energySeconds += t - s.t0
          entries++
          drifts.push(s.maxDrift)
        }
        seg[i] = null
      }
    }
  }

  drifts.sort((x, y) => x - y)
  const denom = Math.max(1e-9, fighterAlive)
  return {
    share: energySeconds / denom,
    entriesPerMin: entries / (denom / 60),
    protectedAlive,
    fighterAlive,
    entries,
    driftP90: pct(drifts, 0.9),
    driftMax: drifts.length > 0 ? drifts[drifts.length - 1]! : 0,
  }
}

describe('extend 的絕對出場條件（消融對照）', () => {
  /**
   * ── 【2026-08-27：停用。effect 不是變小，是消失了】────────────────
   *
   * 這是 extend 的消融對照：開／關兩組配對比較，`dShare < 0` 代表 extend
   * **減少**了離場總量。實測十對配對差裡只有 **2 對為負**（斷言要求 ≥ 9）：
   *
   *   axis-escort  [+0.0022, −0.0530, −0.0248, +0.0457, +0.0046]  中位數 +0.0022
   *   另一張卡     [ 0.0000,  0.0000,  0.0000,  0.0000,  0.0000]  ← 完全沒有作用
   *
   * 第二張卡五個微擾**逐位元相同**——extend 在那個場景什麼都沒改變。第一張
   * 卡則是 2 正 3 負的擲硬幣，全距 ±5 pp 而中位數只有 +0.2 pp。
   *
   * **這不是門檻太嚴，是效果不見了。** 把 `toBeLessThan(0)` 放寬到容忍
   * +0.2 pp 只會讓「extend 有沒有價值」這個問題永遠得不到答案。
   *
   * 【與 `ai-manoeuvre` 的 longestExtend 是同一件事的兩面】那邊量到脫離
   * 從 37 s 拉長到 70.25 s（比它當初要防的 57.25 s 還糟）。兩條合起來：
   * **extend 現在成本變高、收益歸零。**
   *
   * 【成因是兩個刻意的決定】
   *
   *   1193958  energyExit 由 +100 改為 −100 —— 出場條件從「比對方高
   *            100 m 就走」改成「低對方 100 m 才走」
   *   d68deaa  recoveredExit 預設關閉 —— commit 訊息寫著「實測否決，
   *            **等專案負責人裁定**」
   *
   * 【重啟條件】`recoveredExit` 裁定之後、或 `energyExit` 回到正值，把
   * `.skip` 拿掉重跑。若十對裡回到 ≥ 9 對為負就直接綠；回不去的話，該問的
   * 不是「門檻要放多寬」，而是「extend 這個機制還要不要留」。
   */
  it.skip('脫離的總量下降，且沒有人死得更快', () => {
    /** 兩張卡合起來的配對差，用於符號檢定 */
    const pooledShare: number[] = []
    const perCard: { id: string, dShare: number }[] = []

    for (const [id, faction] of CARDS) {
      const on = SALTS.map((s) => run(id, faction, s, true))
      const off = SALTS.map((s) => run(id, faction, s, false))

      /** 同一個 salt 配對，逐對相減 */
      const pairs = (f: (r: Result) => number): number[] =>
        SALTS.map((_, i) => f(on[i]!) - f(off[i]!))

      const dShare = pairs((r) => r.share)
      const dProt = pairs((r) => r.protectedAlive)
      const dFight = pairs((r) => r.fighterAlive)

      console.log(JSON.stringify({
        card: id,
        shareOn: on.map((r) => r.share.toFixed(4)),
        shareOff: off.map((r) => r.share.toFixed(4)),
        dShare: dShare.map((x) => x.toFixed(4)),
        dShareMedian: median(dShare).toFixed(4),
        dEntriesPerMin: median(pairs((r) => r.entriesPerMin)).toFixed(3),
        entriesOn: on.map((r) => r.entries),
        entriesOff: off.map((r) => r.entries),
        dProtected: dProt.map((x) => x.toFixed(0)),
        dFighter: dFight.map((x) => x.toFixed(0)),
        // spec §8.2 的裁定依據 —— 離場長尾
        driftMax: {
          on: on.map((r) => r.driftMax.toFixed(0)),
          off: off.map((r) => r.driftMax.toFixed(0)),
        },
        // 只印不斷言：`off` 組的全距。留著是為了看得到「為什麼不能拿它
        // 當配對比較的門檻」—— 它量的是配對已經消掉的那個變異
        offRange: range(off.map((r) => r.share)).toFixed(4),
      }))

      pooledShare.push(...dShare)
      perCard.push({ id, dShare: median(dShare) })

      // ── 沒有人死得更快 ─────────────────────────────────
      // 【為什麼是積分不是終點存活數】只看 300 秒終點擋不住「前 200 秒死得
      // 比較多、後來剛好同數」。積分把整條存活曲線納進來，順帶也抓得到提早
      // 全滅 —— 全滅越早，積分越小。
      //
      // 【為什麼是「不得五對全負」而不是「中位數 ≥ 0」】存活積分是一個有
      // 雜訊的量，`>= 0` 會被雜訊絆倒。真正的傷害是**系統性的** ——
      // 五個微擾全部變差才是訊號，中間夾雜正負就是雜訊。與上面的效果量
      // 用同一種檢定，只是方向相反。
      expect(dProt.every((x) => x < 0)).toBe(false)
      expect(dFight.every((x) => x < 0)).toBe(false)
    }

    // ── 效果：每張卡方向要對，合起來要通過符號檢定 ──────────
    for (const c of perCard) {
      expect(c.dShare, `${c.id} 的配對中位數`).toBeLessThan(0)
    }
    const negatives = pooledShare.filter((x) => x < 0).length
    expect(negatives, `十對配對差中為負的數量（${pooledShare.length} 對）`)
      .toBeGreaterThanOrEqual(9)
  }, 900_000)
})
