/**
 * 「垂直繞圈」的**轉向歸因**。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/reversal-cause.probe.ts
 *
 * 【為什麼需要這一支】讀程式碼猜根因，連續兩個假設被實測否決：
 *
 *   一、`extendPitchAngle` 是無阻尼的比例控制 → **否決**。最小重現
 *       （一架 AI + 一個不機動的目標，120 秒）翻轉 0 次，它自己不會振盪。
 *   二、`extend` 進入看能量、退出看距離（`extendRange`）→ **否決**。
 *       把 `extendRange` 拿掉，繞圈由 3.9% 惡化到 5.9%。
 *
 * 所以改成不猜：把每一次**航跡角翻轉**的前後兩秒發生的事全部記下來，
 * 看哪一種事件與翻轉同時出現。同時出現不等於因果，但它會把候選收斂到
 * 一兩個，而不是十個。
 *
 * 【對照組是關鍵】只數「翻轉時有多少次剛換過目標」會被基底率騙 —— 若
 * AI 本來就每兩秒換一次目標，那個數字自然很高。所以每一欄都同時印
 * **翻轉時**與**隨機時刻**的比例，看兩者差多少。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { engageKnobs, type Knobs } from '../../src/ai/steer'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 600
const SEED = 20260811
const RAD = 180 / Math.PI
const STRIDE = 24
/** 航跡角穿越這個角度才算一次翻轉，rad。 */
const FLIP_ANGLE = 15 / RAD
/** 「剛剛才發生」的認定範圍，s。 */
const RECENT = 2

interface Track {
  sign: number
  intent: string
  mode: string
  targetIdx: number
  /** 各事件最後一次發生在第幾個取樣點 */
  lastIntentChange: number
  lastModeChange: number
  lastTargetChange: number
  lastSafety: number
  /** 上一格的垂直旋鈕號誌（−1 壓低／0 中性／+1 拉高） */
  vSign: number
  lastVerticalFlip: number
}

interface Tally {
  n: number
  intentChange: number
  targetChange: number
  modeChange: number
  safety: number
  verticalFlip: number
  /** 翻轉當下的意圖分佈 */
  byIntent: Map<string, number>
}

/**
 * 【必須用 `battleConfigFrom`，不是 `DEFAULT_BATTLE`】兩者差一個 `aiProfile`：
 * 前者是玩家實際玩到的 `VETERAN`（反應延遲 0.3 s），後者是 `ACE`（零延遲）。
 * 實測 600 秒：`ACE` 下指揮層**一道命令都不發**（AI 太準，永遠握著射擊解、
 * 判不出「閒」），`VETERAN` 下持有命令的取樣有 85,688 次。
 * **全部的護欄都跑在 ACE 上，所以它們看不到指揮層的任何行為。**
 */
const b = createBattle(new AiController(), battleConfigFrom(DEFAULT_SKIRMISH), SEED)
const cs: Combatant[] = b.world.combatants
const tracks = cs.map((): Track => ({
  sign: 0, intent: '', mode: '', targetIdx: -1,
  lastIntentChange: -1e9, lastModeChange: -1e9, lastTargetChange: -1e9, lastSafety: -1e9,
  vSign: 0, lastVerticalFlip: -1e9,
}))
const knobs: Knobs = { leadLag: 0, vertical: 0, diveIas: 0 }

const mk = (): Tally => ({
  n: 0, intentChange: 0, targetChange: 0, modeChange: 0, safety: 0, verticalFlip: 0,
  byIntent: new Map(),
})
const atFlip = mk()
const baseline = mk()
const recentSamples = Math.round(RECENT / (DT * STRIDE))

function record(t: Tally, tr: Track, sample: number): void {
  t.n++
  if (sample - tr.lastIntentChange <= recentSamples) t.intentChange++
  if (sample - tr.lastTargetChange <= recentSamples) t.targetChange++
  if (sample - tr.lastModeChange <= recentSamples) t.modeChange++
  if (sample - tr.lastSafety <= recentSamples) t.safety++
  if (sample - tr.lastVerticalFlip <= recentSamples) t.verticalFlip++
  t.byIntent.set(tr.intent, (t.byIntent.get(tr.intent) ?? 0) + 1)
}

let sample = 0
for (let s = 0; s < Math.round(SECONDS / DT); s++) {
  stepBattle(b, DT)
  if (s % STRIDE !== 0) continue
  sample++
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    if (!c.alive) continue
    const tr = tracks[i]!
    const ai = c.controller as AiController

    if (ai.intent !== tr.intent) { tr.lastIntentChange = sample; tr.intent = ai.intent }
    if (ai.mode !== tr.mode) { tr.lastModeChange = sample; tr.mode = ai.mode }
    const tIdx = ai.target === null
      ? -1
      : cs.findIndex((o) => o.aircraft === ai.target)
    if (tIdx !== tr.targetIdx) { tr.lastTargetChange = sample; tr.targetIdx = tIdx }
    if (ai.safetyAction !== 'none') tr.lastSafety = sample
    // 【垂直旋鈕在外部重算】`engageKnobs` 是純函數、`sit` 是公開唯讀，
    // 所以不必為了觀測去改 `AiController`。
    engageKnobs(ai.sit, knobs)
    const vs = knobs.vertical > 0.05 ? 1 : knobs.vertical < -0.05 ? -1 : 0
    if (vs !== tr.vSign) {
      if (vs !== 0 && tr.vSign !== 0) tr.lastVerticalFlip = sample
      tr.vSign = vs
    }

    const vel = c.aircraft.state.velocity
    const sp = vel.length()
    const gamma = sp > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, vel.y / sp))) : 0
    let flipped = false
    if (gamma > FLIP_ANGLE && tr.sign !== 1) {
      if (tr.sign === -1) flipped = true
      tr.sign = 1
    } else if (gamma < -FLIP_ANGLE && tr.sign !== -1) {
      if (tr.sign === 1) flipped = true
      tr.sign = -1
    }

    if (flipped) record(atFlip, tr, sample)
    // 對照組：每 40 個取樣點（4 秒）取一次，與翻轉互相獨立
    if (sample % 40 === i % 40) record(baseline, tr, sample)
  }
}

function show(name: string, t: Tally): void {
  const p = (x: number) => `${(x / Math.max(t.n, 1) * 100).toFixed(1)}%`
  console.log(`${name}（樣本 ${t.n}）`)
  console.log(`  前 ${RECENT} 秒內換過意圖   ${p(t.intentChange).padStart(6)}`)
  console.log(`  前 ${RECENT} 秒內換過目標   ${p(t.targetChange).padStart(6)}`)
  console.log(`  前 ${RECENT} 秒內換過模式   ${p(t.modeChange).padStart(6)}`)
  console.log(`  前 ${RECENT} 秒內安全層介入 ${p(t.safety).padStart(6)}`)
  console.log(`  前 ${RECENT} 秒內垂直旋鈕變號 ${p(t.verticalFlip).padStart(6)}`)
  const sorted = [...t.byIntent].sort((a, c) => c[1] - a[1])
  console.log(`  當下意圖：${sorted.map(([k, v]) => `${k} ${p(v)}`).join('　')}`)
}

console.log(`20v20、${SECONDS} 秒、每 ${(DT * STRIDE).toFixed(2)} s 取樣\n`)
show('翻轉的那一刻', atFlip)
console.log('')
show('對照組（隨機時刻）', baseline)
console.log('\n【怎麼讀】兩組差很多的那一欄才是嫌疑；差不多的表示它只是背景常態。')
