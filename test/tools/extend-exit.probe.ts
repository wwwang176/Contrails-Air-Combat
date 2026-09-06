/**
 * **每一段 `extend` 是被哪一條路徑結束的？`recoverExit` 該訂多少？**
 * 不是測試（`.probe.ts`）。跑法：npx vite-node test/tools/extend-exit.probe.ts
 *
 * 【為什麼要這一支】`2026-08-22-extend-recovery-design.md` §4 的整個賭注是
 * 「能量型 `extend` 拖很久，而速度其實 3~5 秒就補完了」。但那個推論有一個
 * 沒有量過的前提：**`extend` 真的是被能量閂鎖決定結束的嗎？** 若大多數段落
 * 其實是被距離或射擊解結束的，那麼新增一條絕對出路什麼都不會改變。
 *
 * 它同時是 `recoverExit` 的**掃描器** —— `EXITS` 的每一檔各跑一遍。
 * `null` 那一檔關閉新閂鎖，精確重現改動前的行為（state 初始為 false、
 * `recoveredExit: false` 時永不更新，合取因而退化成原式）。
 *
 * 【歸類要照 `arbitrate` 的真實優先序】**比對前一拍的閂鎖狀態，看是哪一個
 * 翻掉的**。把「閂鎖全滅」排在「相對出場」之前的話，相對出場恆為 0 被整個
 * 吃掉 —— 相對出場的定義就是能量閂鎖被 `energyAdvantage > energyExit`
 * 解除，那一刻閂鎖本來就是全滅的。
 *
 * 【`kind` 要看整段，不能只看進場那一拍】迴旋閂鎖可能中途成立又解除，
 * 那一段就不是純能量型了。逐拍把 turn/floor 的成立 OR 進一個 mask，
 * **整段結束才歸類**。
 *
 * 【反事實怎麼量】對每一段，記下 `cornerRatio` 第一次**嚴格大於**
 * `cornerExit` 的時刻（`latch()` 用的是嚴格 `>`，要一致）：
 *
 * ```
 *   反事實長度 = min(實際長度, cornerRatio 首次 > 0.95 的時刻)
 * ```
 *
 * 那是新出路能省下來的時間**上界** —— 段落變短之後後續的態勢整個不同，
 * 那不是這一支答得了的。**只有 `null` 那一檔需要它**，其餘檔位的實際長度
 * 就是答案。
 *
 * 【右設限要標出來，不能靜默丟掉】自機死亡、失去目標、觀測窗結束這三種
 * 情況下段落是被外部截斷的，不是被任何規則結束的。把它們算成「成功出場」
 * 會系統性低估段落長度。
 *
 * 【為什麼量全部的 AI 不是只量玩家座位】這一題問的是機制（哪一條路徑結束
 * 了它），不是人工回報的主觀感受。機制的樣本越多越好。與
 * `extend-trigger.probe.ts` 的取捨相反，理由也相反。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_RULES, type RuleConfig } from '../../src/ai/rules'
import type { Combatant } from '../../src/world/World'
import { readyCard } from '../fixtures/mission'

const DT = 1 / 240
const SECONDS = 300
const SEED = 20260805
const STRIDE = 24
const STEP = DT * STRIDE

const CARDS: [string, 'allies' | 'axis'][] = [
  ['allies-m1', 'axis'],
  ['allies-m1', 'allies'],
]

/** 五次微擾。0 = 不擾動的那一次 */
const SALTS = [0, 101, 202, 303, 404]

/** `recoverExit` 的掃描檔位。`null` = 關閉新閂鎖，重現改動前 */
const EXITS: (number | null)[] = [null, 0.80, 0.85, 0.90]

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

/** 結束原因。前八個是規則出場，後三個是右設限（被外部截斷） */
const CAUSES = [
  'defend', 'merge', 'rally', '射擊解', '距離',
  '絕對出場', '相對出場', '迴旋解除', '見底解除', '其他',
  '失去目標*', '自機死亡*', '觀測窗結束*',
] as const
type Cause = typeof CAUSES[number]
const CENSORED = new Set<Cause>(['失去目標*', '自機死亡*', '觀測窗結束*'])

/** 進場理由 —— **整段結束才判定** */
type Kind = '純能量' | '混合' | '純迴旋' | '見底' | '其他'

interface Seg {
  seconds: number
  recoveredAt: number
  cause: Cause
  kind: Kind
  /** 段落結束到同一架下一次進場的間隔。沒有下一次 = Infinity */
  gap: number
}

interface Live {
  t0: number
  rec: number
  entryEnergy: boolean
  entryTurn: boolean
  entryFloor: boolean
  everTurn: boolean
  everFloor: boolean
}

function kindOf(l: Live): Kind {
  if (l.entryFloor || l.everFloor) return '見底'
  if (l.entryEnergy && l.everTurn) return '混合'
  if (l.entryEnergy) return '純能量'
  if (l.entryTurn || l.everTurn) return '純迴旋'
  return '其他'
}

interface Run {
  segs: Seg[]
  /** 存活積分，aircraft-seconds */
  protectedAlive: number
  fighterAlive: number
}

function run(id: string, salt: number, exit: number | null): Run {
  const card = readyCard(id)
  const b = createBattle(new AiController(), missionConfigFrom(card), SEED)
  jitter(b, salt)

  const cfg: RuleConfig = exit === null
    ? { ...DEFAULT_RULES, recoveredExit: false }
    : { ...DEFAULT_RULES, recoveredExit: true, recoverExit: exit }
  for (const c of b.world.combatants) {
    if (c.controller instanceof AiController) c.controller.rulesConfig = cfg
  }

  const cs: Combatant[] = b.world.combatants
  const guarded = cs.filter((c) => b.board.protectedMask[c.index] !== 0)
  const mine = cs.filter((c) => c.team === b.player.team
    && c.controller instanceof AiController
    && c.aircraft.spec.role === 'fighter')

  const segs: Seg[] = []
  const live: (Live | null)[] = cs.map(() => null)
  const pe = new Uint8Array(cs.length)
  const pt = new Uint8Array(cs.length)
  const pf = new Uint8Array(cs.length)
  const pr = new Uint8Array(cs.length)
  const lastEnd = new Float64Array(cs.length).fill(Number.NaN)
  let protectedAlive = 0
  let fighterAlive = 0
  let t = 0

  const close = (i: number, cause: Cause, at: number): void => {
    const l = live[i] ?? null
    if (l === null) return
    live[i] = null
    segs.push({
      seconds: at - l.t0,
      recoveredAt: l.rec,
      cause,
      kind: kindOf(l),
      gap: Infinity,
    })
    lastEnd[i] = at
  }

  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    if (k % STRIDE !== 0) continue
    t += STEP

    for (const c of guarded) if (c.alive) protectedAlive += STEP

    for (const c of cs) {
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      const i = c.index

      if (!c.alive) { close(i, '自機死亡*', t); continue }
      // 【失去目標時 stepRules 不跑】那條路徑改飛站位／集合點／平飛，
      // 而 ai.intent 可能仍殘留 'extend' —— 不能只靠字串判斷段落。
      if (ai.target === null) { close(i, '失去目標*', t); continue }

      const r = ai.rules
      const isExtend = ai.intent === 'extend'
      const l = live[i] ?? null

      if (isExtend && l === null) {
        if (!Number.isNaN(lastEnd[i]!)) {
          for (let j = segs.length - 1; j >= 0; j--) {
            if (!Number.isFinite(segs[j]!.gap)) { segs[j]!.gap = t - lastEnd[i]!; break }
          }
        }
        live[i] = {
          t0: t,
          rec: Infinity,
          entryEnergy: r.extendEnergyLatch,
          entryTurn: r.extendTurnLatch,
          entryFloor: r.extendFloorLatch,
          everTurn: r.extendTurnLatch,
          everFloor: r.extendFloorLatch,
        }
      } else if (isExtend && l !== null) {
        // 【逐拍 OR 進 mask】整段結束才歸類
        if (r.extendTurnLatch) l.everTurn = true
        if (r.extendFloorLatch) l.everFloor = true
      }

      const cur = live[i] ?? null
      // 【嚴格 `>`】latch() 用的就是嚴格比較，量測要一致
      if (cur !== null && cur.rec === Infinity
        && ai.sit.cornerRatio > DEFAULT_RULES.cornerExit) {
        cur.rec = t - cur.t0
      }

      if (!isExtend && l !== null) {
        let cause: Cause = '其他'
        if (ai.intent === 'defend') cause = 'defend'
        else if (ai.intent === 'merge') cause = 'merge'
        else if (ai.intent === 'rally') cause = 'rally'
        else if (ai.sit.shotInstant > 0) cause = '射擊解'
        else if (ai.sit.range >= DEFAULT_RULES.extendRange) cause = '距離'
        // 【新的絕對出路】recovered 由假翻真，而能量閂鎖仍開著
        else if (pr[i] === 0 && r.extendRecoveredLatch && r.extendEnergyLatch) {
          cause = '絕對出場'
        }
        // 【看是哪一個閂鎖翻掉的】相對出場的定義就是能量閂鎖被
        // energyAdvantage > energyExit 解除
        else if (pe[i] === 1 && !r.extendEnergyLatch) cause = '相對出場'
        else if (pt[i] === 1 && !r.extendTurnLatch) cause = '迴旋解除'
        else if (pf[i] === 1 && !r.extendFloorLatch) cause = '見底解除'
        close(i, cause, t)
      }

      pe[i] = r.extendEnergyLatch ? 1 : 0
      pt[i] = r.extendTurnLatch ? 1 : 0
      pf[i] = r.extendFloorLatch ? 1 : 0
      pr[i] = r.extendRecoveredLatch ? 1 : 0
    }

    for (const c of mine) if (c.alive && c.controller instanceof AiController) fighterAlive += STEP
  }
  for (const c of cs) close(c.index, '觀測窗結束*', t)

  return { segs, protectedAlive, fighterAlive }
}

for (const [id] of CARDS) {
  console.log(`\n══════ ${id} ══════ ${SECONDS} s × ${SALTS.length} 次微擾 ══════`)

  for (const exit of EXITS) {
    const segs: Seg[] = []
    let protectedAlive = 0
    let fighterAlive = 0
    for (const salt of SALTS) {
      const r = run(id, salt, exit)
      segs.push(...r.segs)
      protectedAlive += r.protectedAlive
      fighterAlive += r.fighterAlive
    }

    const clean = segs.filter((s) => !CENSORED.has(s.cause))
    const energy = clean.filter((s) => s.kind === '純能量')
    const label = exit === null ? '關閉（改動前）' : `recoverExit ${exit.toFixed(2)}`

    console.log(`\n── ${label} ── 共 ${segs.length} 段`
      + `（右設限 ${segs.length - clean.length}）`
      + `　存活積分 protected ${protectedAlive.toFixed(0)}`
      + `／戰鬥機 ${fighterAlive.toFixed(0)} 機秒`)

    const kinds = ['純能量', '混合', '純迴旋', '見底', '其他'] as Kind[]
    console.log('  進場理由 '
      + kinds.map((kd) => {
        const a = clean.filter((s) => s.kind === kd).length
        return `${kd} ${a}`
      }).join('　'))

    const causes = CAUSES.filter((c) => !CENSORED.has(c)
      && energy.some((s) => s.cause === c))
    console.log('  純能量的結束原因 '
      + causes.map((c) => {
        const e = energy.filter((s) => s.cause === c).length
        return `${c} ${(100 * e / Math.max(1, energy.length)).toFixed(0)}%`
      }).join('　'))

    const dur = energy.map((s) => s.seconds).sort((a, x) => a - x)
    console.log(`  純能量段落 ${energy.length} 段　長度 p50 ${n(pct(dur, 0.5), 5, 1)}`
      + `　p90 ${n(pct(dur, 0.9), 5, 1)}　max ${n(dur[dur.length - 1] ?? NaN, 6, 1)} s`)

    if (exit === null) {
      const cut = energy.map((s) => Math.min(s.seconds, s.recoveredAt)).sort((a, x) => a - x)
      const shorter = energy.filter((s) => s.recoveredAt < s.seconds).length
      console.log(`  反事實上界   長度 p50 ${n(pct(cut, 0.5), 5, 1)}`
        + `　p90 ${n(pct(cut, 0.9), 5, 1)}　max ${n(cut[cut.length - 1] ?? NaN, 6, 1)} s`
        + `　會縮短 ${(100 * shorter / Math.max(1, energy.length)).toFixed(0)}%`)
    }

    // 【churn】§4.3 主張「不需要冷卻」，這幾個數字是它唯一的證據
    const gaps = segs.map((s) => s.gap).filter((g) => Number.isFinite(g))
      .sort((a, x) => a - x)
    const tight = gaps.filter((g) => g <= DEFAULT_RULES.minDwell * 2).length
    console.log(`  churn 間隔 p10 ${n(pct(gaps, 0.1), 5, 1)}`
      + `　p50 ${n(pct(gaps, 0.5), 5, 1)}　p90 ${n(pct(gaps, 0.9), 5, 1)} s`
      + `　≤ ${(DEFAULT_RULES.minDwell * 2).toFixed(1)} s 的佔 `
      + `${(100 * tight / Math.max(1, gaps.length)).toFixed(1)}%`)
  }
}

console.log('\n【選值規則】兩階段：')
console.log('  一、安全先過 —— protected 與戰鬥機的存活積分都不得比「關閉」那一檔差')
console.log('  二、在通過的檔位裡取 churn（≤ 2×minDwell 的佔比）最低者')
console.log('不用效果量選值 —— recoverExit 只控制 recovered 何時失效，')
console.log('它不影響第一次達到 cornerExit，三檔在效果量上很可能同分。')
