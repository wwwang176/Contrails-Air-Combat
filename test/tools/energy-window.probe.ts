/**
 * **「我沒有低對方一大截」這個新條件，有沒有作用空間？**
 * 不是測試（`.probe.ts`）。跑法：npx vite-node test/tools/energy-window.probe.ts
 *
 * 【要回答什麼】提案是把 `extend` 的出場改成「速度回來了**而且**能量沒有
 * 低對方一大截」。展開之後那等於「把 `energyExit` 放寬到 E，再加一個
 * `cornerRatio` 的合取項」——所以新條件唯一的作用範圍是
 *
 * ```
 *   energyAdvantage ∈ (E, energyExit)      E ∈ (energyEnter, energyExit)
 * ```
 *
 * 能量回升是連續而且有動量的。如果 AI 從 −800 爬起來之後一路衝過 +100，
 * 那個窗口的停留時間就趨近於零，**機制寫出來也不會觸發**。這一支在寫任何
 * spec 之前先量它。
 *
 * 【為什麼要三種判準對照】上一輪把「放寬能量門檻」與「加速度條件」綁在
 * 一起做完，最後分不出是哪一半在起作用。三種各自量反事實：
 *
 * ```
 *   A 只看速度      cornerRatio > cornerExit          ← 上一輪，已否決
 *   B 只放寬能量    energyAdvantage > E               ← 改一個數字，零新機制
 *   C 合取          兩者同一拍都成立                   ← 本次提案
 * ```
 *
 * C 必然晚於或等於 A 與 B（多一個合取項）。**B 是 C 的下界**：若 B 本身
 * 就足夠好，C 不必做。
 *
 * 【首次「同時成立」不是兩個首次取 max】`cornerRatio` 可能先到又掉下去。
 * 合取要逐拍判定，與 `latch()` 的讀取端一致。
 *
 * 【為什麼只看純能量段落】新條件掛在 `extendEnergyLatch` 的合取上，迴旋與
 * 見底兩條路徑不受影響（見 `rules.ts` 的 `weakAndSlow`）。混合段落無法乾淨
 * 歸因，一併排除。歸類逐拍 OR、整段結束才判定 —— 沿用 `extend-exit.probe`
 * 修過的那一版，第一版只看進場那一拍是錯的。
 *
 * 【右設限要排除】自機死亡、失去目標、觀測窗結束的段落是被外部截斷的。
 * 反事實條件可能在截斷之後才成立，納入會系統性高估效果。
 *
 * 【目標切換是 20v20 專屬的失效模式】`energyAdvantage` 是對**當前**目標算的，
 * 而 `target` 每一拍重選（`AiController` 的 `chooseTarget`）。脫離途中換到
 * 一台更弱的僚機，這個量會憑空跳正 —— 新條件於是成立、AI 掉頭，而真正壓著
 * 它的那台還在高處。1v1 量不到，上一輪壞的正是 20v20。
 *
 * 擾動與現有探針同一套整數雜湊（**不得用 `Math.random`**，那會讓兩次跑不可比）。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_RULES, type RuleConfig } from '../../src/ai/rules'
import type { Combatant } from '../../src/world/World'
import type { Aircraft } from '../../src/flight/Aircraft'

const DT = 1 / 240
const SECONDS = 300
const SEED = 20260805
const STRIDE = 24
const STEP = DT * STRIDE

const CARDS: [string, 'allies' | 'axis'][] = [
  ['axis-escort', 'axis'],
  ['allies-escort', 'allies'],
]

/** 五次微擾。0 = 不擾動的那一次 */
const SALTS = [0, 101, 202, 303, 404]

/**
 * 「低對方一大截」的候選門檻，m 比能量。必須落在
 * (`energyEnter` −300, `energyExit` +100) 之間才有作用 —— 見檔頭。
 */
const ES = [-200, -100, 0]

/** 直方圖的分箱邊界。−300 與 +100 是現行的進場／出場門檻 */
const BINS = [-1000, -600, -300, -100, 100]
const BIN_LABEL = [
  '< −1000', '−1000..−600', '−600..−300',
  '−300..−100', '−100..+100', '> +100',
]

const n = (v: number, w: number, d = 1): string =>
  (Number.isFinite(v) ? v.toFixed(d) : '—').padStart(w)

function jitter(b: ReturnType<typeof createBattle>, salt: number): void {
  if (salt === 0) return
  for (const c of b.world.combatants) {
    let h = (salt ^ (c.index * 0x9e3779b1)) >>> 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
    c.aircraft.state.velocity.multiplyScalar(1 + ((h >>> 8) / 0xffffff - 0.5) * 0.01)
  }
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))
  return sorted[i]!
}

function binOf(v: number): number {
  for (let i = 0; i < BINS.length; i++) if (v < BINS[i]!) return i
  return BINS.length
}

/** 一段完成的純能量 `extend` */
interface Seg {
  seconds: number
  /** 逐拍落在各箱的時間，秒 */
  bins: number[]
  /** A：`cornerRatio` 首次超過 `cornerExit` 的時刻，秒。未達 = Infinity */
  firstCorner: number
  /** B：`energyAdvantage` 首次超過各 E 的時刻 */
  firstEnergy: number[]
  /** C：兩者**同一拍**都成立的首次時刻 */
  firstBoth: number[]
  /** 段落期間換目標的次數 */
  switches: number
  /** 換目標當拍 `energyAdvantage` 由 ≤E 跳到 >E 的次數（各 E 一格） */
  jumps: number[]
}

interface Live extends Seg {
  t0: number
  entryEnergy: boolean
  everTurn: boolean
  everFloor: boolean
  /** 上一拍的目標與能量差，供切換偵測 */
  target: Aircraft | null
  prevEnergy: number
}

function newLive(t: number, r: {
  extendEnergyLatch: boolean, extendTurnLatch: boolean, extendFloorLatch: boolean,
}, target: Aircraft | null, energy: number): Live {
  return {
    seconds: 0,
    bins: new Array(BINS.length + 1).fill(0),
    firstCorner: Infinity,
    firstEnergy: ES.map(() => Infinity),
    firstBoth: ES.map(() => Infinity),
    switches: 0,
    jumps: ES.map(() => 0),
    t0: t,
    entryEnergy: r.extendEnergyLatch,
    everTurn: r.extendTurnLatch,
    everFloor: r.extendFloorLatch,
    target,
    prevEnergy: energy,
  }
}

function run(id: string, faction: 'allies' | 'axis', salt: number): Seg[] {
  const card = MISSIONS[faction].find((m) => m.id === id)!
  const b = createBattle(new AiController(), missionConfigFrom(card, faction), SEED)
  jitter(b, salt)

  // 現況 —— 量的是反事實，不需要開新機制
  const cfg: RuleConfig = { ...DEFAULT_RULES, recoveredExit: false }
  for (const c of b.world.combatants) {
    if (c.controller instanceof AiController) c.controller.rulesConfig = cfg
  }

  const cs: Combatant[] = b.world.combatants
  const out: Seg[] = []
  const live: (Live | null)[] = cs.map(() => null)
  let t = 0

  /** `censored` 為真時整段丟掉 —— 被外部截斷，反事實不可信 */
  const close = (i: number, censored: boolean, at: number): void => {
    const l = live[i] ?? null
    if (l === null) return
    live[i] = null
    if (censored) return
    // 【整段結束才歸類】迴旋／見底中途成立過就不是純能量段落
    if (!l.entryEnergy || l.everTurn || l.everFloor) return
    l.seconds = at - l.t0
    out.push(l)
  }

  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    if (k % STRIDE !== 0) continue
    t += STEP

    for (const c of cs) {
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      const i = c.index

      if (!c.alive) { close(i, true, t); continue }
      // 【失去目標時 stepRules 不跑】intent 可能殘留 'extend'
      if (ai.target === null) { close(i, true, t); continue }

      const r = ai.rules
      const isExtend = ai.intent === 'extend'
      const energy = ai.sit.energyAdvantage

      if (!isExtend) { close(i, false, t); continue }

      let l = live[i] ?? null
      if (l === null) {
        l = newLive(t, r, ai.target, energy)
        live[i] = l
      } else {
        if (r.extendTurnLatch) l.everTurn = true
        if (r.extendFloorLatch) l.everFloor = true
        if (ai.target !== l.target) {
          l.switches++
          // 【失效模式】換目標讓這個量從「低一大截」跳成「沒低一大截」
          for (let e = 0; e < ES.length; e++) {
            if (l.prevEnergy <= ES[e]! && energy > ES[e]!) l.jumps[e]!++
          }
          l.target = ai.target
        }
      }

      const dt = t - l.t0
      l.bins[binOf(energy)]! += STEP
      // 【嚴格 `>`】與 latch() 一致
      const fast = ai.sit.cornerRatio > DEFAULT_RULES.cornerExit
      if (fast && l.firstCorner === Infinity) l.firstCorner = dt
      for (let e = 0; e < ES.length; e++) {
        const rich = energy > ES[e]!
        if (rich && l.firstEnergy[e]! === Infinity) l.firstEnergy[e] = dt
        // 【合取逐拍判定】不是兩個首次取 max
        if (rich && fast && l.firstBoth[e]! === Infinity) l.firstBoth[e] = dt
      }
      l.prevEnergy = energy
    }
  }
  for (const c of cs) close(c.index, true, t)

  return out
}

/** 反事實：新條件首次成立時就結束的話，這批段落會變成多長 */
function counterfactual(segs: Seg[], firstAt: (s: Seg) => number): string {
  const cut = segs.map((s) => Math.min(s.seconds, firstAt(s))).sort((a, x) => a - x)
  const shorter = segs.filter((s) => firstAt(s) < s.seconds).length
  const total = segs.reduce((a, s) => a + s.seconds, 0)
  const kept = segs.reduce((a, s) => a + Math.min(s.seconds, firstAt(s)), 0)
  return `${n(pct(cut, 0.5), 5, 1)} ${n(pct(cut, 0.9), 6, 1)}`
    + ` ${n(cut[cut.length - 1] ?? NaN, 7, 1)}`
    + `　${n(100 * shorter / Math.max(1, segs.length), 5, 0)}%`
    + `　${n(100 * (1 - kept / Math.max(1e-9, total)), 6, 1)}%`
}

for (const [id, faction] of CARDS) {
  const segs: Seg[] = []
  for (const salt of SALTS) segs.push(...run(id, faction, salt))

  const total = segs.reduce((a, s) => a + s.seconds, 0)
  console.log(`\n══════ ${id} ══════ ${SECONDS} s × ${SALTS.length} 次微擾 ══════`)
  console.log(`純能量 extend ${segs.length} 段（右設限與混合段落已排除）`
    + `　共 ${total.toFixed(0)} 機秒`)

  console.log('\n【1】段落期間 energyAdvantage 的時間分布')
  const bins = new Array(BINS.length + 1).fill(0)
  for (const s of segs) for (let i = 0; i < bins.length; i++) bins[i] += s.bins[i]!
  console.log('  ' + BIN_LABEL.map((l) => l.padStart(11)).join(''))
  console.log('  ' + bins.map((v) =>
    `${(100 * v / Math.max(1e-9, total)).toFixed(1)}%`.padStart(11)).join(''))
  const window = bins[3]! + bins[4]!
  console.log(`  作用窗口（−300..+100）佔 `
    + `${(100 * window / Math.max(1e-9, total)).toFixed(1)}%`
    + `　—— 低於 10% 就是機制沒有出手機會`)

  console.log('\n【2】反事實：新條件首次成立時結束，段落會變多長')
  console.log('  判準                        p50    p90     max　 會縮短　省下總時')
  console.log(`  A 只看速度（已否決）      ${counterfactual(segs, (s) => s.firstCorner)}`)
  for (let e = 0; e < ES.length; e++) {
    console.log(`  B 只放寬能量 E=${String(ES[e]).padStart(4)}       `
      + counterfactual(segs, (s) => s.firstEnergy[e]!))
  }
  for (let e = 0; e < ES.length; e++) {
    console.log(`  C 合取       E=${String(ES[e]).padStart(4)}       `
      + counterfactual(segs, (s) => s.firstBoth[e]!))
  }

  console.log('\n【3】目標切換（20v20 專屬的失效模式）')
  const withSwitch = segs.filter((s) => s.switches > 0).length
  const sw = segs.reduce((a, s) => a + s.switches, 0)
  console.log(`  段落期間換過目標的佔 `
    + `${(100 * withSwitch / Math.max(1, segs.length)).toFixed(1)}%`
    + `　共 ${sw} 次　平均每段 ${(sw / Math.max(1, segs.length)).toFixed(2)} 次`)
  for (let e = 0; e < ES.length; e++) {
    const j = segs.reduce((a, s) => a + s.jumps[e]!, 0)
    console.log(`  E=${String(ES[e]).padStart(4)}：換目標讓 energyAdvantage `
      + `由 ≤E 跳到 >E 共 ${j} 次`
      + `　佔全部切換 ${(100 * j / Math.max(1, sw)).toFixed(1)}%`)
  }
}

console.log('\n【怎麼讀】')
console.log('  【1】作用窗口太窄 → 機制寫出來不會觸發，提案在 spec 之前就否決')
console.log('  【2】B 是 C 的下界。B 已經夠好 → 改一個數字就收工，不做新機制')
console.log('       C 明顯晚於 A → 新提案確實比上一輪保守，那是它該有的樣子')
console.log('  【3】跳變佔比高 → 「對方」是誰本身就不穩，spec 必須正面處理')
