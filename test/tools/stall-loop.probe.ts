/**
 * 「AI 在原地垂直繞圈、始終掛在失速邊緣」的量測。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/stall-loop.probe.ts
 *
 * 【它要回答什麼】人工試飛回報：AI 俯衝加速 → 馬上抬升到沒速度 → 又俯衝，
 * 循環不止，而且幾乎不往前跑。現有的護欄一條都看不到這件事 —— 它們量的
 * 是勝負、傷害與目標選擇，而這個症狀在那些量上可以完全不留痕跡（兩邊都
 * 在原地繞圈，傷害交換仍然「正常」）。
 *
 * 【三個量，刻意分開】
 *
 *   1. 失速邊緣佔時    speedMargin < STALL_EDGE 的樣本比例
 *   2. 俯仰翻轉頻率    航跡角穿越 ±FLIP_ANGLE 的次數，次/分鐘
 *   3. 直線度          淨水平位移 ÷ 水平航程。1 = 直線、0 = 繞回原點
 *
 * 「垂直繞圈」= 2 高且 3 低。單看任何一個都會誤判：正常的 yo-yo 也會讓 2
 * 升高，正常的纏鬥也會讓 3 降低。**要兩個同時發生。**
 *
 * 【為什麼分意圖統計】症狀若集中在某一個意圖，根因就在那一支；若平均分佈
 * 在所有意圖上，根因在共用的後處理或安全層。這是 Phase 1 的證據，不是結論。
 *
 * 【必須走 createBattle】它是 `applyFeel(…, GAME_FEEL)` 的唯一入口。護欄
 * 走史實 spec，量的不是玩家看到的那台飛機。
 */
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { cornerSpeed, stallSpeed } from '../../src/analysis/envelope'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 180
const SEED = 20260811
const RAD = 180 / Math.PI
/** 每 0.1 s 採一次。翻轉的週期是數秒，這個解析度綽綽有餘。 */
const STRIDE = 24
/** 直線度的統計視窗，s。取 20 s —— 一次完整的垂直圈約 8–15 s。 */
const WINDOW = 20
/** 航跡角穿越這個角度才算一次翻轉，rad。小於它的是巡航微調。 */
const FLIP_ANGLE = 15 / RAD
/** `speedMargin`（TAS ÷ 1 G 失速速度）低於此值算「掛在失速邊緣」。 */
const STALL_EDGE = 1.25

interface Track {
  /** 上一次確認的航跡角號誌：+1 爬升、−1 俯衝、0 還沒定 */
  sign: number
  flips: number
  samples: number
  stallEdge: number
  belowCorner: number
  /** 每個視窗的直線度 */
  straightness: number[]
  /**
   * 每個視窗的 `{ 直線度, 視窗內翻轉數, 視窗內失速邊緣佔時 }`。
   *
   * 【為什麼翻轉要在視窗內數，不能用整場的率】第一版用整場的翻轉率去判定
   * 每一個視窗，結果把**爆發**稀釋掉了：一架飛機繞了 40 秒圈、其餘 140 秒
   * 正常，整場的率只有 2 次/分，於是那 40 秒一個視窗都不算數。實測 main
   * 的最糟直線度 0.016（幾乎回到原點）、最糟失速佔時 9.6%（四個 commit
   * 裡最高），卻被第一版判成「垂直繞圈 0.0%」—— 儀器把要找的東西濾掉了。
   */
  windows: { straight: number; flips: number; stall: number }[]
  windowStart: Vector3
  pathLength: number
  prev: Vector3
  windowSamples: number
  windowFlips: number
  windowStall: number
  /** 意圖 → 該意圖下的失速邊緣樣本數 */
  byIntent: Map<string, { n: number; stall: number; flips: number }>
}

/**
 * 【三個開局，不是三顆種子】種子只決定飛行員名字，不進入任何物理路徑
 * —— 重跑同一個開局會得到逐位元相同的結果。要有誤差棒就得換**開局**。
 * 三個都在合理的交戰範圍內，不是刻意找極端。
 */
const OPENINGS = [
  { name: '預設 10 km/200 TAS', cfg: DEFAULT_BATTLE },
  { name: '近距 6 km/240 TAS', cfg: { ...DEFAULT_BATTLE, entryRange: 6000, tas: 240 } },
  { name: '遠距 14 km/170 TAS', cfg: { ...DEFAULT_BATTLE, entryRange: 14000, tas: 170 } },
]
for (const opening of OPENINGS) {
run(opening.name, opening.cfg)
}

function run(openingName: string, cfg: typeof DEFAULT_BATTLE): void {
const b = createBattle(new AiController(), cfg, SEED)
const cs: Combatant[] = b.world.combatants
const tracks = new Map<number, Track>()
for (const c of cs) {
  tracks.set(c.index, {
    sign: 0, flips: 0, samples: 0, stallEdge: 0, belowCorner: 0,
    straightness: [], windows: [], windowStart: c.aircraft.state.position.clone(),
    pathLength: 0, prev: c.aircraft.state.position.clone(), windowSamples: 0,
    windowFlips: 0, windowStall: 0,
    byIntent: new Map(),
  })
}
const windowSampleCount = Math.round(WINDOW / (DT * STRIDE))

for (let s = 0; s < Math.round(SECONDS / DT); s++) {
  stepBattle(b, DT)
  if (s % STRIDE !== 0) continue
  for (const c of cs) {
    if (!c.alive) continue
    const t = tracks.get(c.index)!
    const a = c.aircraft
    const pos = a.state.position
    const alt = pos.y
    const tas = a.diag.aero.tas
    const vel = a.state.velocity
    const speed = vel.length()
    const gamma = speed > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, vel.y / speed))) : 0

    t.samples++
    const vs = Math.max(stallSpeed(a.spec, alt, 1), 1)
    const speedMargin = tas / vs
    const onEdge = speedMargin < STALL_EDGE
    if (onEdge) { t.stallEdge++; t.windowStall++ }
    if (tas < cornerSpeed(a.spec, alt)) t.belowCorner++

    // ── 俯仰翻轉 ──
    let flipped = false
    if (gamma > FLIP_ANGLE && t.sign !== 1) {
      if (t.sign === -1) { t.flips++; t.windowFlips++; flipped = true }
      t.sign = 1
    } else if (gamma < -FLIP_ANGLE && t.sign !== -1) {
      if (t.sign === 1) { t.flips++; t.windowFlips++; flipped = true }
      t.sign = -1
    }

    // ── 直線度 ──
    const dx = pos.x - t.prev.x
    const dz = pos.z - t.prev.z
    t.pathLength += Math.hypot(dx, dz)
    t.prev.copy(pos)
    t.windowSamples++
    if (t.windowSamples >= windowSampleCount) {
      const net = Math.hypot(pos.x - t.windowStart.x, pos.z - t.windowStart.z)
      if (t.pathLength > 1) {
        const straight = net / t.pathLength
        t.straightness.push(straight)
        t.windows.push({
          straight,
          flips: t.windowFlips,
          stall: t.windowStall / windowSampleCount,
        })
      }
      t.windowStart.copy(pos)
      t.pathLength = 0
      t.windowSamples = 0
      t.windowFlips = 0
      t.windowStall = 0
    }

    // ── 分意圖 ──
    const ai = c.controller
    const intent = ai instanceof AiController ? ai.intent : 'player'
    let bucket = t.byIntent.get(intent)
    if (bucket === undefined) {
      bucket = { n: 0, stall: 0, flips: 0 }
      t.byIntent.set(intent, bucket)
    }
    bucket.n++
    if (onEdge) bucket.stall++
    if (flipped) bucket.flips++
  }
}

const all = [...tracks.values()].filter((t) => t.samples > 100)
const pct = (xs: number[], p: number) =>
  [...xs].sort((a, c) => a - c)[Math.round((xs.length - 1) * p)] ?? 0

const stallShare = all.map((t) => t.stallEdge / t.samples)
const cornerShare = all.map((t) => t.belowCorner / t.samples)
const flipRate = all.map((t) => t.flips / (t.samples * DT * STRIDE / 60))
const straight = all.flatMap((t) => t.straightness)

console.log(`
===== ${openingName} =====`)
console.log(`架數 ${all.length}　每架樣本 ${all[0]!.samples}（${SECONDS} s、每 ${(DT * STRIDE).toFixed(2)} s 一次）`)
console.log('')
console.log(`失速邊緣佔時（speedMargin < ${STALL_EDGE}）  中位 ${(pct(stallShare, 0.5) * 100).toFixed(1)}%　p90 ${(pct(stallShare, 0.9) * 100).toFixed(1)}%　最糟 ${(pct(stallShare, 1) * 100).toFixed(1)}%`)
console.log(`角落速度以下佔時                          中位 ${(pct(cornerShare, 0.5) * 100).toFixed(1)}%　p90 ${(pct(cornerShare, 0.9) * 100).toFixed(1)}%`)
console.log(`俯仰翻轉（穿越 ±${(FLIP_ANGLE * RAD).toFixed(0)}°）          中位 ${pct(flipRate, 0.5).toFixed(1)} 次/分　p90 ${pct(flipRate, 0.9).toFixed(1)}　最糟 ${pct(flipRate, 1).toFixed(1)}`)
console.log(`直線度（淨位移÷航程，${WINDOW} s 視窗）      中位 ${pct(straight, 0.5).toFixed(3)}　p10 ${pct(straight, 0.1).toFixed(3)}　最低 ${pct(straight, 0).toFixed(3)}`)

// ── 「垂直繞圈」= 視窗內翻轉多 且 直線度低，兩個同時 ──
// 【判準值的來歷】20 s 視窗裡翻轉 ≥2 次 = 至少一次完整的上下循環；
// 直線度 <0.3 = 20 秒下來淨位移不到航程的三成。兩個同時才算。
const LOOPY_FLIPS = 2
const LOOPY_STRAIGHT = 0.3
const windows = all.flatMap((t) => t.windows)
const loopy = windows.filter((w) => w.flips >= LOOPY_FLIPS && w.straight < LOOPY_STRAIGHT)
console.log('')
console.log(`【垂直繞圈】20 s 視窗裡翻轉 ≥${LOOPY_FLIPS} 次 且 直線度 <${LOOPY_STRAIGHT}：`
  + ` ${loopy.length}/${windows.length}（${(loopy.length / Math.max(windows.length, 1) * 100).toFixed(1)}%）`)
if (loopy.length > 0) {
  console.log(`　　這些視窗裡掛在失速邊緣的佔時：中位 ${(pct(loopy.map((w) => w.stall), 0.5) * 100).toFixed(1)}%`
    + `　最高 ${(pct(loopy.map((w) => w.stall), 1) * 100).toFixed(1)}%`)
  console.log(`　　最糟的三個視窗：`
    + loopy.slice().sort((a, c) => a.straight - c.straight).slice(0, 3)
      .map((w) => `直線度 ${w.straight.toFixed(3)}／翻轉 ${w.flips}／失速 ${(w.stall * 100).toFixed(0)}%`).join('　'))
}
// 【只有繞圈、沒有掛失速】的視窗要分開看 —— 正常的纏鬥就長這樣
const loopyAndSlow = loopy.filter((w) => w.stall > 0.1)
console.log(`　　其中「同時掛在失速邊緣 >10% 的時間」：${loopyAndSlow.length}`
  + `（${(loopyAndSlow.length / Math.max(windows.length, 1) * 100).toFixed(1)}% 的視窗）`)

// ── 分意圖 ──
const merged = new Map<string, { n: number; stall: number; flips: number }>()
for (const t of all) {
  for (const [k, v] of t.byIntent) {
    const m = merged.get(k) ?? { n: 0, stall: 0, flips: 0 }
    m.n += v.n; m.stall += v.stall; m.flips += v.flips
    merged.set(k, m)
  }
}
console.log('')
console.log('意圖        佔時     該意圖下掛在失速邊緣   該意圖下的翻轉數')
for (const [k, v] of [...merged].sort((a, c) => c[1].n - a[1].n)) {
  const share = v.n / all.reduce((s, t) => s + t.samples, 0)
  console.log(`${k.padEnd(10)}  ${(share * 100).toFixed(1).padStart(5)}%   ${(v.stall / v.n * 100).toFixed(1).padStart(8)}%          ${String(v.flips).padStart(6)}`)
}
console.log(`（各意圖的「掛在失速邊緣」若差異很大，根因就在那一支；若都差不多，根因在共用的後處理或安全層）`)
}
