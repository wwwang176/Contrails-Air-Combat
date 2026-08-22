/**
 * **每一段 `extend` 是被哪一條路徑結束的？如果早有絕對出路，會短多少？**
 * 不是測試（`.probe.ts`）。跑法：npx vite-node test/tools/extend-exit.probe.ts
 *
 * 【為什麼要這一支】`2026-08-22-extend-recovery-design.md` §4 的整個賭注是
 * 「能量型 `extend` 拖很久，而速度其實 3~5 秒就補完了」。但那個推論有一個
 * 沒有量過的前提：**`extend` 真的是被能量閂鎖決定結束的嗎？**
 *
 * `arbitrate` 有好幾條路可以結束一段 `extend`：
 *
 * ```
 *   energyAdvantage > energyExit      相對出場
 *   range >= extendRange              跑夠遠了
 *   shotInstant > 0                   射擊解到手，插隊
 *   defendLatch                       有人打我，絕對優先
 *   rally 覆寫                        指揮層
 * ```
 *
 * 若大多數段落其實是被距離或射擊解結束的，那麼 §4 新增一條絕對出路
 * **什麼都不會改變** —— 整份 spec 是空轉。這一支在**改動前**回答那個問題。
 *
 * 【反事實怎麼量】對每一段，記下 `cornerRatio` 第一次達到 `cornerExit`
 * 的時刻。§4 上線後那一刻就會結束這一段（前提是它是能量型的），所以
 *
 * ```
 *   反事實長度 = min(實際長度, cornerRatio 首次 ≥ 0.95 的時刻)
 * ```
 *
 * 兩者的差就是 §4 能省下來的時間上界。**是上界不是預測** —— 段落變短之後
 * 後續的態勢整個不同，那不是這一支答得了的。
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

/** 結束原因，逐段歸一類。順序就是 `arbitrate` 的優先序 */
const CAUSES = ['defend', 'rally', '射擊解', '距離', '相對出場', '閂鎖全滅', '其他'] as const
type Cause = typeof CAUSES[number]

interface Seg {
  seconds: number
  /** cornerRatio 首次 ≥ cornerExit 的時刻，相對段落起點。從未達到 = Infinity */
  recoveredAt: number
  cause: Cause
  /** 進場那一拍只有能量閂鎖（不含 turn / floor） */
  pureEnergy: boolean
}

const exitFor = 0
void exitFor

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
    const pure = new Uint8Array(cs.length)
    let t = 0

    for (let k = 0; k < Math.round(SECONDS / DT); k++) {
      stepBattle(b, DT)
      if (k % STRIDE !== 0) continue
      t += STEP

      for (const c of cs) {
        const ai = c.controller
        if (!(ai instanceof AiController)) continue
        if (!c.alive) { inSeg[c.index] = 0; continue }

        const isExtend = ai.intent === 'extend'
        const i = c.index

        if (isExtend && inSeg[i] === 0) {
          inSeg[i] = 1
          t0[i] = t
          rec[i] = Infinity
          pure[i] = ai.rules.extendEnergyLatch
            && !ai.rules.extendTurnLatch && !ai.rules.extendFloorLatch ? 1 : 0
        }
        if (inSeg[i] === 1 && rec[i] === Infinity
          && ai.sit.cornerRatio >= DEFAULT_RULES.cornerExit) {
          rec[i] = t - t0[i]
        }
        if (!isExtend && inSeg[i] === 1) {
          inSeg[i] = 0
          // 【歸類用離場那一拍的狀態】arbitrate 的優先序由上往下
          let cause: Cause = '其他'
          if (ai.intent === 'defend') cause = 'defend'
          else if (ai.intent === 'rally') cause = 'rally'
          else if (ai.sit.shotInstant > 0) cause = '射擊解'
          else if (ai.sit.range >= DEFAULT_RULES.extendRange) cause = '距離'
          else if (!ai.rules.extendEnergyLatch && !ai.rules.extendTurnLatch
            && !ai.rules.extendFloorLatch) cause = '閂鎖全滅'
          else if (ai.sit.energyAdvantage > DEFAULT_RULES.energyExit) cause = '相對出場'
          segs.push({
            seconds: t - t0[i],
            recoveredAt: rec[i]!,
            cause,
            pureEnergy: pure[i] === 1,
          })
        }
      }
    }
  }

  const energy = segs.filter((s) => s.pureEnergy)
  console.log(`\n══ ${id}　${SECONDS} s × 5 次微擾　共 ${segs.length} 段 extend`
    + `，其中純能量型 ${energy.length} 段（${(100 * energy.length / Math.max(1, segs.length)).toFixed(0)}%）══`)

  console.log('  結束原因         全部        純能量型')
  for (const c of CAUSES) {
    const a = segs.filter((s) => s.cause === c).length
    const e = energy.filter((s) => s.cause === c).length
    if (a === 0) continue
    console.log(`  ${c.padEnd(12)}${n(a, 6, 0)} 段 ${n(100 * a / segs.length, 5, 1)}%`
      + `${n(e, 8, 0)} 段 ${n(100 * e / Math.max(1, energy.length), 5, 1)}%`)
  }

  const dur = energy.map((s) => s.seconds).sort((a, x) => a - x)
  const cut = energy
    .map((s) => Math.min(s.seconds, s.recoveredAt))
    .sort((a, x) => a - x)
  const shorter = energy.filter((s) => s.recoveredAt < s.seconds).length
  const never = energy.filter((s) => !Number.isFinite(s.recoveredAt)).length

  console.log('\n  純能量型段落的長度（秒）')
  console.log('                    p50     p75     p90     max')
  console.log(`  實際          ${n(pct(dur, 0.5), 8, 1)}${n(pct(dur, 0.75), 8, 1)}`
    + `${n(pct(dur, 0.9), 8, 1)}${n(dur[dur.length - 1] ?? NaN, 8, 1)}`)
  console.log(`  §4 反事實     ${n(pct(cut, 0.5), 8, 1)}${n(pct(cut, 0.75), 8, 1)}`
    + `${n(pct(cut, 0.9), 8, 1)}${n(cut[cut.length - 1] ?? NaN, 8, 1)}`)
  console.log(`  §4 會縮短的段落 ${shorter} / ${energy.length}`
    + `（${(100 * shorter / Math.max(1, energy.length)).toFixed(0)}%）`
    + `　整段都沒補到 0.95 的 ${never} 段`)
}

console.log(`\n【怎麼讀】「§4 反事實」= min(實際長度, cornerRatio 首次 ≥ `
  + `${DEFAULT_RULES.cornerExit} 的時刻)。`)
console.log('那是 §4 能省下來的時間**上界** —— 段落變短之後後續態勢整個不同，'
  + '這一支答不了那個。')
console.log('若「§4 會縮短的段落」的比例很低，或結束原因幾乎都是距離／射擊解，'
  + '那 §4 就是空轉。')
