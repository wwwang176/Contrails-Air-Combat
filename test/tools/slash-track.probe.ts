/**
 * **掠襲時「機頭追不追得上預瞄點」的時間曲線。** 不是測試（`.probe.ts`）。跑法：
 *   npx vite-node test/tools/slash-track.probe.ts
 *
 * 【它在回答什麼】人工回報：真人飛行員在敵機由下方穿越時，
 * 「準星跟不上預瞄點」是收手改為佈局下一次攻擊的訊號。那件事的量是
 * **視線角速度 ÷ 瞬時轉彎率上限** —— 前者是「預瞄點在視野裡跑多快」，
 * 後者是「我的機頭最快能轉多快」。比值 > 1 就是追不上。
 *
 * 護送關（`escort-trace.probe.ts`）已經量到那個尖峰：交會瞬間 2.36 倍，
 * 而接近途中只有 0.04~0.33。這一支問的是**同一個量在高能量掠襲裡長什麼樣**
 * —— 因為掠襲的循環正是「俯衝射擊 → 爬升 → 回頭 → 再俯衝」，若回頭那一段
 * 也爆表，依這個量收手會把掠襲一起打壞。
 *
 * 【為什麼一定要先量這個】收手判準若在掠襲的回頭段也觸發，高能量的 1v1
 * 會由幾十秒內擊落變成整場互不接觸。判準要先在掠襲場景驗證過才能上。
 *
 * 【場景】高能量開局（預設的 `high`）：藍方 P-51D 在 5500 m / 250 m/s，
 * 紅方 Bf 109K-4 在 4000 m / 170 m/s，相距 800 m 對頭。零延遲、零瞄準誤差、
 * 無亂數。
 *
 * 【輸出】stderr 一張逐秒表 + 一段摘要；stdout 一份 JSON。
 */
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
// 【`RAD` 不是 `DEG`】專案的慣例是 `DEG = π/180`（度→弧度）、
// `RAD = 180/π`（弧度→度）。這裡要的是後者。而 `escort-trace.probe.ts` 自己
// 定義了一個叫 `DEG` 的 `180/π` —— 別跟著抄。
import { RAD } from '../../src/core/math'
import { instantaneousTurnRate } from '../../src/analysis/envelope'
import { DEFAULT_STEER, engageKnobs, type Knobs } from '../../src/ai/steer'
import type { AircraftSpec } from '../../src/specs/types'

const DT = 1 / 240
const SECONDS = 200
const STRIDE = 12
const STEP = DT * STRIDE

interface Side {
  spec: AircraftSpec
  altitude: number
  tas: number
  offset: [number, number, number]
  headingDeg: number
}

/**
 * 三組開局，用環境變數 `CARD` 選，預設 `high`。
 *
 * 【為什麼三組都要量】判準要通用就得在**不同的打法**下都成立：
 *   high —— 能量戰法。距離拉得開，比值該一直很低
 *   co   —— 純纏鬥。兩台貼在一起繞，比值最可能爆表，而那時候繼續轉才對
 *   low  —— 吃虧的一方。它會一直被咬，防禦動作最多
 */
const CARDS: Record<string, [Side, Side]> = {
  high: [
    { spec: P51D, altitude: 5500, tas: 250, offset: [0, 0, 800], headingDeg: 180 },
    { spec: BF109K4, altitude: 4000, tas: 170, offset: [0, 0, 0], headingDeg: 0 },
  ],
  co: [
    { spec: P51D, altitude: 4000, tas: 190, offset: [400, 0, 400], headingDeg: 135 },
    { spec: BF109K4, altitude: 4000, tas: 190, offset: [0, 0, 0], headingDeg: 0 },
  ],
  low: [
    { spec: P51D, altitude: 3000, tas: 150, offset: [0, -1000, 0], headingDeg: 0 },
    { spec: BF109K4, altitude: 4000, tas: 250, offset: [0, 0, 600], headingDeg: 0 },
  ],
}

declare const process: { env: Record<string, string | undefined> }
const CARD = process.env.CARD ?? 'high'
const HIGH_ENERGY = CARDS[CARD] ?? CARDS.high!

/**
 * 【設定覆寫】與 `escort-trace.probe.ts` 同一個做法 —— `TP` 是一段 JSON，
 * 逐欄蓋掉 `DEFAULT_STEER`。掃描 `trackHold` 時少了它，每一組都會跑到預設值。
 *
 *   TP='{"trackEnter":0}'  —— 整個機制關掉，等於改動前
 *   TP='{"trackHold":5}'   —— 掃描單一參數
 */
const override = process.env.TP
if (override !== undefined && override !== '') {
  Object.assign(DEFAULT_STEER, JSON.parse(override) as Partial<typeof DEFAULT_STEER>)
  console.error('TP override: ' + override)
}

interface Sample {
  t: number
  /** 高度，m */
  y: number
  /** 空速，m/s */
  v: number
  /** 目標距離，m */
  r: number
  /** 接近率，m/s。正 = 拉近 */
  clo: number
  /** 視線角速度，°/s */
  lr: number
  /** 瞬時轉彎率上限，°/s */
  itr: number
  /** lr ÷ itr。> 1 = 機頭追不上預瞄點 */
  ratio: number
  /** 前置／後置旋鈕，−1..1 */
  ll: number
  /** 交戰平面上下旋鈕，−1..1 */
  vt: number
  intent: string
  mode: string
  /** 坡度，度 */
  bk: number
  /** 航跡角，度 */
  ga: number
  /** 自機位置的水平分量，m */
  x: number
  z: number
  /** 自機姿態四元數 */
  q: [number, number, number, number]
  /** `Situation.trackRatio` —— 出貨路徑算的那一份（本檔的 `ratio` 是探針自算） */
  tr2: number
  /** 閂鎖有沒有閂上，0 / 1 */
  lat: number
  /** 目標位置與姿態 */
  tx: number
  ty: number
  tz: number
  oq: [number, number, number, number]
}

function make(side: Side) {
  const a = new Aircraft(side.spec, side.altitude, side.tas)
  const pos = new Vector3(side.offset[0], side.altitude, side.offset[2])
  const h = side.headingDeg * RAD
  const dir = new Vector3(-Math.sin(h), 0, -Math.cos(h))
  a.state.position.copy(pos)
  a.state.velocity.copy(dir).multiplyScalar(side.tas)
  a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
  return { a, pos }
}

function main(): void {
  const world = new World()
  const [blue, red] = HIGH_ENERGY
  const b = make(blue)
  const r = make(red)

  const blueAi = new AiController()
  const redAi = new AiController()
  const bc = world.add(b.a, blueAi, 'blue', b.pos, blue.altitude, blue.tas)
  const rc = world.add(r.a, redAi, 'red', r.pos, red.altitude, red.tas)
  blueAi.target = r.a
  redAi.target = b.a
  bc.respawnOnDestroy = false
  rc.respawnOnDestroy = false

  const right = new Vector3()
  const knobs: Knobs = { leadLag: 0, vertical: 0, diveIas: 0 }
  const out: Sample[] = []

  const total = SECONDS * 240
  for (let i = 0; i < total; i++) {
    world.step(DT)
    if (!bc.alive || !rc.alive) break
    if (i % STRIDE !== 0) continue

    const a = b.a
    const speed = a.state.velocity.length()
    const alt = a.state.position.y
    const itr = instantaneousTurnRate(a.spec, alt, speed) * RAD
    const lr = blueAi.sit.losRate * RAD

    right.set(1, 0, 0).applyQuaternion(a.state.orientation)
    const bk = -Math.asin(Math.max(-1, Math.min(1, right.y))) * RAD
    const ga = speed > 1e-3 ? Math.asin(a.state.velocity.y / speed) * RAD : 0

    // 【自己重算旋鈕】`AiController` 的那一份是 private。同一支 `engageKnobs`、
    // 同一個 `Situation`，所以是精確值不是代理量。
    engageKnobs(blueAi.sit, knobs)

    out.push({
      t: +(i * DT).toFixed(2),
      y: +alt.toFixed(0),
      v: +speed.toFixed(1),
      r: +blueAi.sit.range.toFixed(0),
      clo: +blueAi.sit.closureRate.toFixed(1),
      lr: +lr.toFixed(1),
      itr: +itr.toFixed(1),
      ratio: +(itr > 0 ? lr / itr : 99).toFixed(2),
      ll: +knobs.leadLag.toFixed(2),
      vt: +knobs.vertical.toFixed(2),
      intent: blueAi.intent,
      mode: blueAi.mode,
      bk: +bk.toFixed(0),
      ga: +ga.toFixed(1),
      x: +a.state.position.x.toFixed(0),
      z: +a.state.position.z.toFixed(0),
      q: [
        +a.state.orientation.x.toFixed(4), +a.state.orientation.y.toFixed(4),
        +a.state.orientation.z.toFixed(4), +a.state.orientation.w.toFixed(4),
      ],
      tr2: +blueAi.sit.trackRatio.toFixed(3),
      lat: blueAi.track.latched ? 1 : 0,
      tx: +r.a.state.position.x.toFixed(0),
      ty: +r.a.state.position.y.toFixed(0),
      tz: +r.a.state.position.z.toFixed(0),
      oq: [
        +r.a.state.orientation.x.toFixed(4), +r.a.state.orientation.y.toFixed(4),
        +r.a.state.orientation.z.toFixed(4), +r.a.state.orientation.w.toFixed(4),
      ],
    })
  }

  // ── 逐秒表（只印前 60 秒，那是掠襲循環最密的一段）──────
  const every = Math.max(1, Math.round(1 / STEP))
  const rows: string[] = []
  rows.push('場景 ' + CARD)
  rows.push('')
  rows.push('   t    高度   距離   接近率  視線ω  上限ω  比值   判定     旋鈕 前後/上下  意圖    坡度')
  for (let i = 0; i < out.length; i += every) {
    const s = out[i]!
    if (s.t > 60) break
    const verdict = s.ratio > 1 ? '追不上 ←' : s.ratio > 0.6 ? '吃緊' : '追得上'
    rows.push(
      `${s.t.toFixed(1).padStart(5)} ${String(s.y).padStart(6)} ${String(s.r).padStart(6)}`
      + ` ${s.clo.toFixed(0).padStart(7)} ${s.lr.toFixed(1).padStart(6)}`
      + ` ${s.itr.toFixed(1).padStart(6)} ${s.ratio.toFixed(2).padStart(6)}  ${verdict.padEnd(9)}`
      + ` ${s.ll.toFixed(2).padStart(6)} ${s.vt.toFixed(2).padStart(6)}  ${s.intent.padEnd(9)}`
      + ` ${s.bk.toFixed(0).padStart(4)}`,
    )
  }

  // ── 摘要 ────────────────────────────────────────────────
  const over = out.filter(s => s.ratio > 1)
  const tight = out.filter(s => s.ratio > 0.6)
  const sorted = out.map(s => s.ratio).sort((x, y) => x - y)
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
  rows.push('')
  rows.push(`取樣 ${out.length} 個（${(out.length * STEP).toFixed(0)} s）`)
  rows.push(`比值 > 1（追不上）：${over.length} 個 = ${(100 * over.length / out.length).toFixed(1)}%`)
  rows.push(`比值 > 0.6（吃緊）：${tight.length} 個 = ${(100 * tight.length / out.length).toFixed(1)}%`)
  rows.push(`比值分位 p50 ${pct(0.5).toFixed(2)}  p90 ${pct(0.9).toFixed(2)}`
    + `  p99 ${pct(0.99).toFixed(2)}  最大 ${pct(1).toFixed(2)}`)
  if (over.length > 0) {
    const near = over.filter(s => s.r < 600).length
    rows.push(`追不上的取樣裡，距離 < 600 m 的佔 ${(100 * near / over.length).toFixed(0)}%`
      + `（距離中位數 ${over.map(s => s.r).sort((x, y) => x - y)[over.length >> 1]} m）`)
  }
  const latched = out.filter(s => s.lat === 1).length
  rows.push(`閂鎖佔時 ${(100 * latched / out.length).toFixed(1)}%`)
  console.error(rows.join('\n'))

  console.log(JSON.stringify({ card: CARD, step: STEP, samples: out }))
}

main()
