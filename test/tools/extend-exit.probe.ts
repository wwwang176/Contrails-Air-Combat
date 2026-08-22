/**
 * **每一段 `extend` 是被哪一條路徑結束的？如果早有絕對出路，會短多少？**
 * 不是測試（`.probe.ts`）。跑法：npx vite-node test/tools/extend-exit.probe.ts
 *
 * 【為什麼要這一支】`2026-08-22-extend-recovery-design.md` §4 的整個賭注是
 * 「能量型 `extend` 拖很久，而速度其實 3~5 秒就補完了」。但那個推論有一個
 * 沒有量過的前提：**`extend` 真的是被能量閂鎖決定結束的嗎？**
 *
 * 若大多數段落其實是被距離或射擊解結束的，那麼 §4 新增一條絕對出路
 * **什麼都不會改變** —— 整份 spec 是空轉。這一支在**改動前**回答那個問題。
 *
 * 【歸類要照 `arbitrate` 的真實優先序】第一版把「閂鎖全滅」排在「相對出場」
 * 之前，而相對出場的定義就是能量閂鎖被 `energyAdvantage > energyExit` 解除
 * —— 那一刻閂鎖當然是全滅的，於是相對出場恆為 0，被吃掉了。改成**比對前
 * 一拍的閂鎖狀態看是哪一個翻掉的**。
 *
 * 【反事實怎麼量】對每一段，記下 `cornerRatio` 第一次**嚴格大於**
 * `cornerExit` 的時刻（`latch()` 用的是嚴格 `>`，要一致）。§4 上線後那一刻
 * 就會結束這一段，所以
 *
 * ```
 *   反事實長度 = min(實際長度, cornerRatio 首次 > 0.95 的時刻)
 * ```
 *
 * 兩者的差是 §4 能省下來的時間**上界** —— 段落變短之後後續的態勢整個不同，
 * 那不是這一支答得了的。
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
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_RULES } from '../../src/ai/rules'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 300
const SEED = 20260805
const STRIDE = 24
const STEP = DT * STRIDE

const CARDS: [string, 'allies' | 'axis'][] = [
  ['axis-escort', 'axis'],
  ['allies-escort', 'allies'],
]

/** 五次微擾，0 = 不擾動。與 extend-trigger.probe.ts 同一個雜湊 */
const SALTS = [0, 101, 202, 303, 404]

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

/** 結束原因。前五個是規則出場，後三個是右設限（被外部截斷） */
const CAUSES = [
  'defend', 'merge', 'rally', '射擊解', '距離',
  '相對出場', '迴旋解除', '見底解除', '其他',
  '失去目標*', '自機死亡*', '觀測窗結束*',
] as const
type Cause = typeof CAUSES[number]
/** 右設限：段落不是被規則結束的，長度不可信 */
const CENSORED = new Set<Cause>(['失去目標*', '自機死亡*', '觀測窗結束*'])

/** 進場那一拍的理由組合 */
type Kind = '純能量' | '混合' | '純迴旋' | '見底' | '其他'

interface Seg {
  seconds: number
  /** cornerRatio 首次 > cornerExit 的時刻，相對段落起點。從未達到 = Infinity */
  recoveredAt: number
  cause: Cause
  kind: Kind
  /** 段落結束到同一架下一次進場的間隔。沒有下一次 = Infinity */
  gap: number
}

function kindOf(energy: boolean, turn: boolean, floor: boolean): Kind {
  if (floor) return '見底'
  if (energy && turn) return '混合'
  if (energy) return '純能量'
  if (turn) return '純迴旋'
  return '其他'
}

for (const [id, faction] of CARDS) {
  const segs: Seg[] = []

  for (const salt of SALTS) {
    const card = MISSIONS[faction].find((m) => m.id === id)!
    const b = createBattle(new AiController(), missionConfigFrom(card, faction), SEED)
    jitter(b, salt)
    const cs: Combatant[] = b.world.combatants

    const inSeg = new Uint8Array(cs.length)
    const t0 = new Float64Array(cs.length)
    const rec = new Float64Array(cs.length)
    const kind: Kind[] = cs.map(() => '其他')
    // 前一拍的閂鎖狀態 —— 用來看是哪一個翻掉的
    const pe = new Uint8Array(cs.length)
    const pt = new Uint8Array(cs.length)
    const pf = new Uint8Array(cs.length)
    const hadTarget = new Uint8Array(cs.length)
    const lastEnd = new Float64Array(cs.length).fill(Number.NaN)
    let t = 0

    const close = (i: number, cause: Cause, at: number): void => {
      inSeg[i] = 0
      segs.push({
        seconds: at - t0[i]!,
        recoveredAt: rec[i]!,
        cause,
        kind: kind[i]!,
        gap: Number.isNaN(lastEnd[i]!) ? Infinity : Number.NaN,
      })
      lastEnd[i] = at
    }

    for (let k = 0; k < Math.round(SECONDS / DT); k++) {
      stepBattle(b, DT)
      if (k % STRIDE !== 0) continue
      t += STEP

      for (const c of cs) {
        const ai = c.controller
        if (!(ai instanceof AiController)) continue
        const i = c.index

        if (!c.alive) {
          if (inSeg[i] === 1) close(i, '自機死亡*', t)
          continue
        }
        // 【失去目標時 stepRules 不跑】那條路徑改飛站位／集合點／平飛，
        // 而 ai.intent 可能仍殘留 'extend' —— 不能只靠字串判斷段落。
        if (ai.target === null) {
          if (inSeg[i] === 1) close(i, '失去目標*', t)
          hadTarget[i] = 0
          continue
        }
        hadTarget[i] = 1

        const r = ai.rules
        const isExtend = ai.intent === 'extend'

        if (isExtend && inSeg[i] === 0) {
          // 【段落起點】上一段的結束到這裡就是 churn 的間隔
          if (!Number.isNaN(lastEnd[i]!)) {
            for (let j = segs.length - 1; j >= 0; j--) {
              if (!Number.isFinite(segs[j]!.gap)) { segs[j]!.gap = t - lastEnd[i]!; break }
            }
          }
          inSeg[i] = 1
          t0[i] = t
          rec[i] = Infinity
          kind[i] = kindOf(r.extendEnergyLatch, r.extendTurnLatch, r.extendFloorLatch)
        }
        // 【嚴格 `>`】latch() 用的就是嚴格比較，量測要一致
        if (inSeg[i] === 1 && rec[i] === Infinity
          && ai.sit.cornerRatio > DEFAULT_RULES.cornerExit) {
          rec[i] = t - t0[i]!
        }

        if (!isExtend && inSeg[i] === 1) {
          let cause: Cause = '其他'
          if (ai.intent === 'defend') cause = 'defend'
          else if (ai.intent === 'merge') cause = 'merge'
          else if (ai.intent === 'rally') cause = 'rally'
          else if (ai.sit.shotInstant > 0) cause = '射擊解'
          else if (ai.sit.range >= DEFAULT_RULES.extendRange) cause = '距離'
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
      }
    }
    // 觀測窗結束時仍在段落中的，全部右設限
    for (const c of cs) {
      if (inSeg[c.index] === 1) close(c.index, '觀測窗結束*', t)
    }
  }

  const clean = segs.filter((s) => !CENSORED.has(s.cause))
  const energy = clean.filter((s) => s.kind === '純能量')
  const mixed = clean.filter((s) => s.kind === '混合')
  const censored = segs.length - clean.length

  console.log(`\n══ ${id}　${SECONDS} s × 5 次微擾　共 ${segs.length} 段`
    + `（右設限 ${censored} 段，下列統計已排除）══`)

  console.log('  進場理由      段數    佔比')
  for (const kd of ['純能量', '混合', '純迴旋', '見底', '其他'] as Kind[]) {
    const a = clean.filter((s) => s.kind === kd).length
    if (a > 0) {
      console.log(`  ${kd.padEnd(10)}${n(a, 6, 0)}  ${n(100 * a / clean.length, 5, 1)}%`)
    }
  }

  console.log('\n  結束原因         全部          純能量型')
  for (const c of CAUSES) {
    if (CENSORED.has(c)) continue
    const a = clean.filter((s) => s.cause === c).length
    const e = energy.filter((s) => s.cause === c).length
    if (a === 0) continue
    console.log(`  ${c.padEnd(12)}${n(a, 6, 0)} 段 ${n(100 * a / clean.length, 5, 1)}%`
      + `${n(e, 9, 0)} 段 ${n(100 * e / Math.max(1, energy.length), 5, 1)}%`)
  }

  for (const [label, set] of [['純能量型', energy], ['混合型', mixed]] as const) {
    if (set.length === 0) continue
    const dur = set.map((s) => s.seconds).sort((a, x) => a - x)
    const cut = set.map((s) => Math.min(s.seconds, s.recoveredAt)).sort((a, x) => a - x)
    const shorter = set.filter((s) => s.recoveredAt < s.seconds).length
    const never = set.filter((s) => !Number.isFinite(s.recoveredAt)).length
    console.log(`\n  ${label}段落的長度（秒），${set.length} 段`)
    console.log('                    p50     p75     p90     max')
    console.log(`  實際          ${n(pct(dur, 0.5), 8, 1)}${n(pct(dur, 0.75), 8, 1)}`
      + `${n(pct(dur, 0.9), 8, 1)}${n(dur[dur.length - 1] ?? NaN, 8, 1)}`)
    console.log(`  §4 反事實     ${n(pct(cut, 0.5), 8, 1)}${n(pct(cut, 0.75), 8, 1)}`
      + `${n(pct(cut, 0.9), 8, 1)}${n(cut[cut.length - 1] ?? NaN, 8, 1)}`)
    console.log(`  §4 會縮短 ${shorter} / ${set.length}`
      + `（${(100 * shorter / set.length).toFixed(0)}%）`
      + `　整段沒補到 ${DEFAULT_RULES.cornerExit} 的 ${never} 段`)
  }

  // 【churn 基準】§4.3 主張「不需要冷卻」，那句話要有現況的對照
  const gaps = segs.map((s) => s.gap).filter((g) => Number.isFinite(g))
    .sort((a, x) => a - x)
  console.log(`\n  現況的 churn：段落結束到同一架下一次進場的間隔（${gaps.length} 筆）`)
  console.log(`    p10 ${n(pct(gaps, 0.1), 6, 1)} s   p50 ${n(pct(gaps, 0.5), 6, 1)} s`
    + `   p90 ${n(pct(gaps, 0.9), 6, 1)} s`)
  const tight = gaps.filter((g) => g <= DEFAULT_RULES.minDwell * 2).length
  console.log(`    間隔 ≤ 2×minDwell（${(DEFAULT_RULES.minDwell * 2).toFixed(1)} s）的：`
    + `${tight} 筆（${(100 * tight / Math.max(1, gaps.length)).toFixed(1)}%）`)
}

console.log(`\n【怎麼讀】「§4 反事實」= min(實際長度, cornerRatio 首次 > `
  + `${DEFAULT_RULES.cornerExit} 的時刻)，是 §4 能省下來的時間**上界**。`)
console.log('帶 * 的結束原因是右設限（被外部截斷），已從長度統計排除。')
console.log('churn 那一段是 §4.3「不需要冷卻」的現況對照 —— '
  + '改動後這幾個數字不該惡化。')
