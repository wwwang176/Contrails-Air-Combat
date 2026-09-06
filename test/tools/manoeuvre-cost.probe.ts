/**
 * **三個迴轉候選的代價 —— 俯衝迴旋 / 水平迴旋 / 拉高迴旋**
 * 不是測試（`.probe.ts`）。跑法：
 *   npx vite-node test/tools/manoeuvre-cost.probe.ts > cost.json
 *   CARD=escort|high|co|low npx vite-node test/tools/manoeuvre-cost.probe.ts > /dev/null
 *
 * 【為什麼要這一支】現行的 `Situation.trackRatio` 只用了**角速度**，把**角度**
 * 丟掉了。實測 t=38 s 那一格：敵人在機體仰角 +86°（座艙罩正上方）、機鼻夾角
 * 87°，而比值只有 0.45（「追得上」）—— 兩個都對，因為比值問的是「對準之後跟
 * 不跟得上飄動」，不是「轉過去要多久、期間要付多少」。
 *
 * 【這一支只量，不改行為】它逐格對三個候選各跑一次前向積分，印出「轉過去要
 * 幾秒、高度變化多少、結束時多快」。要回答的是三件事：
 *
 *   1. 三者的代價**分不分得開**？永遠同一個贏的話就不需要選擇器
 *   2. t=38 s 那一格它會選哪個？（依 corner speed 的位置，預期是拉高）
 *   3. 掠襲場景會不會亂選？（那邊機鼻夾角小，三者應該都很便宜）
 *
 * 【模型與它的簡化】兩個狀態量前向積分（0.1 s 步長，上限 20 s）：
 *
 *   比能量  Es = h + v²/2g          dEs/dt = specificExcessPower(spec, h, v, n, 1)
 *   高度    dh/dt = v·sin(γ)
 *   剩餘角  d(remaining)/dt = −(ω − losRate)     ω = instantaneousTurnRate
 *
 * 過載 `n` 由轉彎率反推（ω = g√(n²−1)/v），所以 `Ps` 吃到的是這個轉彎率真正
 * 的誘導阻力代價。**候選之間唯一的差別是航跡角 γ** —— 那正是「俯衝／水平／
 * 拉高」的定義。
 *
 * **簡化的地方要講明**：真正的高 yo-yo 是「拉起、轉、再下來」，不是固定 γ 的
 * 螺旋；這裡用固定 γ 是為了讓三個候選有可比的封閉形式。它算得出「轉過去要
 * 多久、付多少高度」，算不出「轉完之後機頭正好指著哪」。第二件事要等這一輪
 * 確認前三個問題之後再說。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { Vector3 } from 'three'
import type { Combatant } from '../../src/world/World'
import {
  instantaneousTurnRate, specificExcessPower, stallSpeed,
} from '../../src/analysis/envelope'
import { manoeuvreSpeed } from '../../src/ai/doctrine'
import { G0 } from '../../src/core/math'
import type { AircraftSpec } from '../../src/specs/types'
import { readyCard } from '../fixtures/mission'

const DT = 1 / 240
const SECONDS = 300
const SEED = 20260805
const STRIDE = 24            // 10 Hz —— 代價評估比軌跡貴，不必 20 Hz
const STEP = DT * STRIDE
const RAD = 180 / Math.PI
const DEG = Math.PI / 180

// 【就地宣告而不裝 @types/node】與其他探針同一個做法
declare const process: { env: Record<string, string | undefined> }

/** 三個候選的航跡角 */
const CANDIDATES = [
  { name: '俯衝迴旋', gamma: -30 * DEG },
  { name: '水平迴旋', gamma: 0 },
  { name: '拉高迴旋', gamma: +30 * DEG },
] as const

/** 前向積分的步長與上限 */
const SIM_DT = 0.1
const SIM_MAX = 20

/**
 * 用多少比例的可用過載，`NF` 覆寫（0~1，預設 1 = 拉到極限）。
 *
 * 【為什麼要掃這個】第一版整段假設全程拉極限過載，而那會把速度很快耗光 ——
 * 「拉高迴旋不可行」的判定有很大一部分是這個假設造成的，不是真的做不到。
 * 真人不會連拉十秒的極限 G。掃它才知道結論對模型有多敏感。
 */
const LOAD_FRAC = Math.max(0.05, Math.min(1, Number(process.env.NF ?? '1')))

interface Cost {
  /** 把機鼻轉到預瞄點要幾秒。轉不過去回 Infinity */
  seconds: number
  /** 期間的高度變化，m。正 = 賺 */
  deltaAlt: number
  /** 結束時的空速，m/s */
  endTas: number
  /** 結束時的 cornerRatio */
  endCorner: number
  /**
   * 轉完之後的**能量高度變化**，m。`Es = 高度 + 速度²/2g`。
   *
   * 【為什麼這一個數字就夠】三個候選的終點是同一件事（機鼻對上目標），
   * 差別只在路上付了多少。轉得久 = 誘導阻力吃得久 = 這個數字低，所以
   * **時間已經算在裡面了**，不必再給時間一個權重。
   */
  deltaEs: number
  /** 為什麼失敗：'' = 成功、'stall' = 掉到失速速度、'slow' = 轉不贏視線 */
  fail: string
}

/**
 * 對一個候選跑前向積分。
 *
 * @param swing   要轉的角度，rad（機鼻到預瞄點）
 * @param losRate 視線角速度，rad/s —— 目標在轉的期間還會繼續飄
 */
function evaluate(
  spec: AircraftSpec, alt0: number, tas0: number,
  swing: number, losRate: number, gamma: number,
): Cost {
  let h = alt0
  let v = tas0
  let remaining = swing
  let t = 0

  while (t < SIM_MAX) {
    // 由上限轉彎率反推可用過載，再按 `LOAD_FRAC` 收斂到實際要用的那一個
    const omegaMax = instantaneousTurnRate(spec, h, v)
    const nMax = Math.sqrt(1 + (omegaMax * v / G0) ** 2)
    const n = 1 + (nMax - 1) * LOAD_FRAC
    const omega = n > 1 ? G0 * Math.sqrt(n * n - 1) / v : 0
    // 【轉不贏視線就永遠收斂不了】這正是 trackRatio 在問的那件事，
    // 所以舊判準是這個模型的一個特例。
    if (!(omega > losRate)) {
      return {
        seconds: Infinity, deltaAlt: h - alt0, endTas: v, endCorner: 0,
        deltaEs: -Infinity, fail: 'slow',
      }
    }
    if (v <= stallSpeed(spec, h, n)) {
      return {
        seconds: Infinity, deltaAlt: h - alt0, endTas: v, endCorner: 0,
        deltaEs: -Infinity, fail: 'stall',
      }
    }

    const ps = specificExcessPower(spec, h, v, n, 1)
    // Es = h + v²/2g，先讓能量走一步，再讓高度走一步，剩下的還給速度
    const es = h + (v * v) / (2 * G0) + ps * SIM_DT
    h += v * Math.sin(gamma) * SIM_DT
    const vv = 2 * G0 * (es - h)
    v = vv > 1 ? Math.sqrt(vv) : 1

    remaining -= (omega - losRate) * SIM_DT
    t += SIM_DT
    if (remaining <= 0) {
      const vc = manoeuvreSpeed(spec, h)
      return {
        seconds: t, deltaAlt: h - alt0, endTas: v,
        endCorner: vc > 0 ? v / vc : 0,
        deltaEs: (h + (v * v) / (2 * G0)) - (alt0 + (tas0 * tas0) / (2 * G0)),
        fail: '',
      }
    }
  }
  return {
    seconds: Infinity, deltaAlt: h - alt0, endTas: v, endCorner: 0,
    deltaEs: -Infinity, fail: 'slow',
  }
}

interface Sample {
  t: number
  /** 我的高度、空速、cornerRatio */
  y: number
  v: number
  cr: number
  /** 機鼻到預瞄點要轉的角度，度 */
  swing: number
  /** 視線角速度，度/s */
  lr: number
  /** 現行判準的值 —— 拿來對照 */
  ratio: number
  intent: string
  /** 三個候選：秒數與高度變化 */
  sec: [number, number, number]
  dh: [number, number, number]
  /** 三個候選結束時的 cornerRatio */
  ec: [number, number, number]
  /** 三個候選的能量高度變化，m。不可行回 −99999 */
  es: [number, number, number]
  /** 依「結束時能量高度最高」會選第幾個（0/1/2），全部不可行回 −1 */
  pick: number
  /** 距離 */
  r: number
}

function main(): void {
  console.error('過載比例 NF = ' + LOAD_FRAC.toFixed(2))
  const which = process.env.CARD ?? 'escort'
  if (which !== 'escort') {
    console.error('目前只支援 CARD=escort（護送關）。掠襲三張卡等這一輪的結論再接。')
  }
  const card = readyCard('allies-m1')
  const b = createBattle(new AiController(), missionConfigFrom(card), SEED)

  const me: Combatant = b.player
  const ai = me.controller
  if (!(ai instanceof AiController)) throw new Error('玩家座位不是 AI 代飛')

  const out: Sample[] = []
  const fwd = new Vector3()
  const los = new Vector3()
  let t = 0

  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    if (k % STRIDE !== 0) continue
    t += STEP
    if (!me.alive) break

    const tgt = ai.target
    if (tgt === null) continue

    const a = me.aircraft
    const alt = a.state.position.y
    const tas = a.diag.aero.tas
    if (!(tas > 1)) continue

    // 機鼻到目標的夾角 —— 這就是被舊判準丟掉的那一項
    los.copy(tgt.state.position).sub(a.state.position)
    const range = los.length()
    if (!(range > 1)) continue
    los.divideScalar(range)
    fwd.set(0, 0, -1).applyQuaternion(a.state.orientation)
    const swing = Math.acos(Math.max(-1, Math.min(1, fwd.dot(los))))

    const lr = ai.sit.losRate
    const cs: Cost[] = CANDIDATES.map((c) => evaluate(a.spec, alt, tas, swing, lr, c.gamma))

    // 【挑法：結束時能量高度最高】三個候選的終點相同（機鼻對上目標），
    // 所以不需要收益項，也不需要權重 —— 比一個數字就好。
    let pick = -1
    let best = -Infinity
    for (let i = 0; i < cs.length; i++) {
      if (!Number.isFinite(cs[i]!.seconds)) continue
      if (cs[i]!.deltaEs > best) { best = cs[i]!.deltaEs; pick = i }
    }

    const vc = manoeuvreSpeed(a.spec, alt)
    out.push({
      t: +t.toFixed(2),
      y: Math.round(alt), v: Math.round(tas),
      cr: +(vc > 0 ? tas / vc : 0).toFixed(2),
      swing: +(swing * RAD).toFixed(1),
      lr: +(lr * RAD).toFixed(1),
      ratio: +(instantaneousTurnRate(a.spec, alt, tas) > 0
        ? lr / instantaneousTurnRate(a.spec, alt, tas) : 0).toFixed(2),
      intent: ai.intent,
      sec: cs.map((c) => +(Number.isFinite(c.seconds) ? c.seconds : -1).toFixed(1)) as [number, number, number],
      dh: cs.map((c) => Math.round(c.deltaAlt)) as [number, number, number],
      ec: cs.map((c) => +c.endCorner.toFixed(2)) as [number, number, number],
      es: cs.map((c) => Number.isFinite(c.deltaEs) ? Math.round(c.deltaEs) : -99999) as [number, number, number],
      pick,
      r: Math.round(range),
    })
  }

  // ── 逐秒表：交會前後 ────────────────────────────────────
  const rows: string[] = []
  rows.push('')
  rows.push('   t  | 機鼻夾角 視線速 舊判準 |   俯衝迴旋   |   水平迴旋   |   拉高迴旋   | 選 | 意圖')
  rows.push('      |   度     度/s        |  秒  Δ能量高度 |  秒  Δ能量高度 |  秒  Δ能量高度 |    |')
  for (const s of out) {
    if (s.t < 24 || s.t > 48) continue
    const cell = (i: number) => (s.sec[i]! < 0 ? '  ×       ×   ' : ''
      + String(s.sec[i]!.toFixed(1)).padStart(4) + '  '
      + String(s.es[i]! > 0 ? '+' + s.es[i]! : s.es[i]!).padStart(7) + ' ')
    rows.push('%s | %s %s %s | %s | %s | %s | %s | %s'
      .replace('%s', s.t.toFixed(1).padStart(5))
      .replace('%s', s.swing.toFixed(0).padStart(6))
      .replace('%s', s.lr.toFixed(1).padStart(6))
      .replace('%s', s.ratio.toFixed(2).padStart(6))
      .replace('%s', cell(0)).replace('%s', cell(1)).replace('%s', cell(2))
      .replace('%s', ['俯', '平', '高', '—'][s.pick < 0 ? 3 : s.pick]!.padStart(2))
      .replace('%s', s.intent))
  }

  // ── 摘要：三者分不分得開 ────────────────────────────────
  const usable = out.filter((s) => s.pick >= 0)
  const votes = [0, 0, 0]
  for (const s of usable) votes[s.pick]!++
  rows.push('')
  rows.push('全場 ' + out.length + ' 個取樣，其中 ' + usable.length + ' 個至少有一個候選可行')
  for (let i = 0; i < 3; i++) {
    rows.push('   ' + CANDIDATES[i]!.name + ' 勝出 '
      + String(votes[i]).padStart(4) + ' 次 = '
      + (100 * votes[i]! / Math.max(1, usable.length)).toFixed(1) + '%')
  }
  // 最好與最差差多少能量高度 —— 差很小就等於「選誰都一樣」
  const spread = usable
    .map((s) => {
      const ok = s.es.filter((e) => e > -99999)
      return ok.length > 1 ? Math.max(...ok) - Math.min(...ok) : 0
    })
    .sort((a, c) => a - c)
  const q = (f: number) => spread[Math.min(spread.length - 1, Math.floor(f * spread.length))] ?? 0
  rows.push('   最好與最差的能量高度差：中位數 ' + q(0.5) + ' m'
    + '  p90 ' + q(0.9) + ' m  最大 ' + q(1) + ' m')
  const only = usable.filter((s) => s.es.filter((e) => e > -99999).length === 1).length
  rows.push('   其中只有一個候選可行（沒得選）的：' + only
    + ' 個 = ' + (100 * only / Math.max(1, usable.length)).toFixed(1) + '%')

  console.error(rows.join('\n'))
  console.log(JSON.stringify({ card: 'allies-m1', seed: SEED, step: STEP, samples: out }))
}

main()
