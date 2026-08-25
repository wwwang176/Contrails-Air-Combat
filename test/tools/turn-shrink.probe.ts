/**
 * 「把迴轉半徑縮 25%」的候選做法，各自在**真實戰鬥裡**縮到多少。
 * **不是測試**（`.probe.ts`）。跑法：npx vite-node test/tools/turn-shrink.probe.ts
 *
 * 【為什麼不能只看包絡表】turn-regime.probe.ts 量到 AI 只用掉 81% 的可用
 * 迴旋性能（升降舵指令中位 0.15），所以「包絡縮 25%」不等於「畫面上的
 * 圈縮 25%」。這支對每個候選各跑一場完整戰鬥，量實際航跡半徑。
 *
 * 【候選怎麼注入】`createBattle` 內部固定套 `GAME_FEEL`，改不了。但
 * `BattleConfig.blueSpec/redSpec` 是入口，先在 spec 上乘一次，`applyFeel`
 * 會再乘 `GAME_FEEL` —— 兩者相乘就是有效倍率。`limits` 不被 feel 碰，
 * 所以 gPositive 直接寫進去就是最終值。
 */
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { HEAD_ON } from '../../src/battle/entry'
import { lineAbreast } from '../../src/battle/order'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { instantaneousTurnRate } from '../../src/analysis/envelope'
import type { AircraftSpec } from '../../src/specs/types'

/** 讀環境變數，避免在瀏覽器型別環境裡直接碰 process */
const env = (k: string): string | undefined =>
  (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process?.env[k]

const DT = 1 / 240
const SECONDS = 120
/**
 * 【不是用種子取變異】`createBattle` 的 seed **只決定飛行員名字**
 * （setup.ts 的參數註解：「不進入任何物理路徑」），實測三個種子的中位半徑
 * 一模一樣。模擬是完全決定性的，重播拿不到誤差棒。
 * 真正的變異要換**開局條件** —— 不同高度／進場距離／初速會長出不同的一場仗。
 */
const VARIANTS: { tag: string; alt: number; tas: number; entry: number }[] = [
  { tag: '標準', alt: 4000, tas: 200, entry: 10000 },
  { tag: '高空', alt: 5500, tas: 200, entry: 10000 },
  { tag: '近距高速', alt: 4000, tas: 240, entry: 6000 },
]
const SEED = 20260811
const RAD = 180 / Math.PI
const KMH = 3.6
const HARD_TURN = 10 / RAD
const SAMPLE_STRIDE = 24

/** CLmax 倍率（乘在 clAlpha 上，與 feel.lift 同一個機制） */
function withLift(s: AircraftSpec, m: number): AircraftSpec {
  return { ...s, lift: { ...s.lift, clAlpha: s.lift.clAlpha * m } }
}
/** 結構過載倍率 */
function withG(s: AircraftSpec, m: number): AircraftSpec {
  return { ...s, limits: { ...s.limits, gPositive: s.limits.gPositive * m } }
}
/** 推力與寄生阻力同倍率 —— 極速不動（V_max^3 正比 P/cd0） */
function withPowerCd0(s: AircraftSpec, k: number): AircraftSpec {
  return {
    ...s,
    engine: {
      ...s.engine,
      gears: s.engine.gears.map((g) => ({
        ...g,
        powerSeaLevel: g.powerSeaLevel * k,
        powerCritical: g.powerCritical * k,
      })),
    },
    drag: { ...s.drag, cd0: s.drag.cd0 * k },
  }
}
/** 有效質量 m（相對史實）—— GAME_FEEL 已含 0.9，這裡要先除掉 */
const relMass = (s: AircraftSpec, m: number): AircraftSpec =>
  ({ ...s, mass: s.mass * (m / 0.9) })

interface Result {
  n: number
  radP10: number
  radMed: number
  radP90: number
  tasMed: number
  rateMed: number
  util: number
  limitMed: number
}

function pct(arr: number[], p: number): number {
  const a = [...arr].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))]!
}

function run(blue: AircraftSpec, red: AircraftSpec, vi: number): Result {
  const V = VARIANTS[vi]!
  const b = createBattle(
    new AiController(),
    {
      ...DEFAULT_BATTLE,
      units: lineAbreast(HEAD_ON, blue, 20, red, 20),
      altitude: V.alt,
      tas: V.tas,
      entryRange: V.entry,
    },
    SEED,
  )
  const cs = b.world.combatants
  const prevVel = cs.map((c) => new Vector3().copy(c.aircraft.state.velocity))
  const tmp = new Vector3()
  const tmp2 = new Vector3()
  const rad: number[] = []
  const tas: number[] = []
  const rate: number[] = []
  const limit: number[] = []

  const steps = Math.round(SECONDS / DT)
  for (let s = 0; s < steps; s++) {
    stepBattle(b, DT)
    if (s % SAMPLE_STRIDE !== 0) continue
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      const v = c.aircraft.state.velocity
      const pv = prevVel[i]!
      if (c.alive) {
        const sp = v.length()
        const psp = pv.length()
        if (sp > 1 && psp > 1) {
          tmp.copy(v).divideScalar(sp)
          tmp2.copy(pv).divideScalar(psp)
          let d = tmp.dot(tmp2)
          if (d > 1) d = 1
          else if (d < -1) d = -1
          const w = Math.acos(d) / (SAMPLE_STRIDE * DT)
          if (w > HARD_TURN) {
            const alt = c.aircraft.state.position.y
            const lw = instantaneousTurnRate(c.aircraft.spec, alt, sp)
            rad.push(sp / w)
            tas.push(sp * KMH)
            rate.push(w * RAD)
            limit.push(lw > 1e-6 ? sp / lw : Infinity)
          }
        }
      }
      pv.copy(v)
    }
  }
  const limMed = pct(limit, 0.5)
  return {
    n: rad.length,
    radP10: pct(rad, 0.1),
    radMed: pct(rad, 0.5),
    radP90: pct(rad, 0.9),
    tasMed: pct(tas, 0.5),
    rateMed: pct(rate, 0.5),
    util: limMed / pct(rad, 0.5),
    limitMed: limMed,
  }
}

const ALL: Record<string, { name: string; blue: AircraftSpec; red: AircraftSpec }> = {
  A: { name: 'A 現行', blue: P51D, red: BF109K4 },
  B: { name: 'B CLmax ×1.33', blue: withLift(P51D, 1.33), red: withLift(BF109K4, 1.33) },
  F: { name: 'F 結構 ×1.5（12 / 11.25）', blue: withG(P51D, 1.5), red: withG(BF109K4, 1.5) },
  G: {
    name: 'G CLmax ×1.33 + 結構 ×1.5',
    blue: withG(withLift(P51D, 1.33), 1.5),
    red: withG(withLift(BF109K4, 1.33), 1.5),
  },
  H: { name: 'H CLmax ×1.2 + 結構 ×1.5', blue: withG(withLift(P51D, 1.2), 1.5), red: withG(withLift(BF109K4, 1.2), 1.5) },
  I: { name: 'I CLmax ×1.5 + 結構 ×1.5', blue: withG(withLift(P51D, 1.5), 1.5), red: withG(withLift(BF109K4, 1.5), 1.5) },
  K: {
    name: 'K 質量 ×0.8 + 結構 ×1.5',
    blue: withG({ ...P51D, mass: P51D.mass * 0.8 }, 1.5),
    red: withG({ ...BF109K4, mass: BF109K4.mass * 0.8 }, 1.5),
  },
  // M：專案負責人的提案 —— 軟夾到**史實結構極限**（gPositive 原封不動，
  // 由 PROBE_PILOT_G 放開飛行員夾）＋ 減重 10%
  M: {
    name: 'M 質量 ×0.9（結構極限原值）',
    blue: { ...P51D, mass: P51D.mass * 0.9 },
    red: { ...BF109K4, mass: BF109K4.mass * 0.9 },
  },
  N: {
    name: 'N 質量 ×0.85（結構極限原值）',
    blue: { ...P51D, mass: P51D.mass * 0.85 },
    red: { ...BF109K4, mass: BF109K4.mass * 0.85 },
  },
  O: {
    name: 'O 質量 ×0.8（結構極限原值）',
    blue: { ...P51D, mass: P51D.mass * 0.8 },
    red: { ...BF109K4, mass: BF109K4.mass * 0.8 },
  },
  // ── 「−20% 要付多少」的刻度尺 ────────────────────────────────
  // 軟夾已經進 limiters.ts，GAME_FEEL.mass 已經是 0.9，所以這裡注入的是
  // **相對於出貨值的再縮**：有效質量 = 注入值 × 0.9。
  ...Object.fromEntries(
    ([[0.85, 'P85'], [0.80, 'P80'], [0.75, 'P75'], [0.70, 'P70']] as [number, string][])
      .map(([eff, key]) => [key, {
        name: `有效質量 ${eff.toFixed(2)}`,
        blue: { ...P51D, mass: P51D.mass * (eff / 0.9) },
        red: { ...BF109K4, mass: BF109K4.mass * (eff / 0.9) },
      }]),
  ),
  // ── 爬升中性的三個配方（推力倍率由 turn-climbneutral.probe.ts 解出）──
  N1: {
    name: '乙 質量0.80 + 推力×0.794',
    blue: withPowerCd0(relMass(P51D, 0.80), 0.794),
    red: withPowerCd0(relMass(BF109K4, 0.80), 0.794),
  },
  N2: {
    name: '甲 CLmax ×1.30（質量原值）',
    blue: withLift(relMass(P51D, 1), 1.30),
    red: withLift(relMass(BF109K4, 1), 1.30),
  },
  N3: {
    name: '丙 質量0.90 + CLmax×1.15 + 推力×0.897',
    blue: withPowerCd0(withLift(relMass(P51D, 0.90), 1.15), 0.897),
    red: withPowerCd0(withLift(relMass(BF109K4, 0.90), 1.15), 0.897),
  },
  // 混血：減重少一點，用 CLmax 補剩下的
  MIX: {
    name: '有效質量 0.85 + CLmax ×1.15',
    blue: withLift({ ...P51D, mass: P51D.mass * (0.85 / 0.9) }, 1.15),
    red: withLift({ ...BF109K4, mass: BF109K4.mass * (0.85 / 0.9) }, 1.15),
  },
}
const PICK = (env('PROBE_CASES') ?? 'A,B,F,G,H').split(',')
const CASES = PICK.map((k: string) => ALL[k]!).filter(Boolean)

console.log(`每個候選 ×${VARIANTS.length} 種開局、各 ${SECONDS} s、20v20`
  + `　飛行員 G 上限 = ${env('PROBE_PILOT_G') ?? 6.5}`)
console.log(`開局：${VARIANTS.map((v) => `${v.tag} ${v.alt}m/${v.tas}m·s/${v.entry}m`).join('　')}\n`)
console.log('候選                          ' + VARIANTS.map((v) => v.tag.padStart(7)).join('')
  + '    平均  全距  中位TAS 中位率 利用率')
for (const c of CASES) {
  const rs = VARIANTS.map((_, i) => run(c.blue, c.red, i))
  const meds = rs.map((r) => r.radMed)
  const mean = meds.reduce((a, x) => a + x, 0) / meds.length
  const spread = Math.max(...meds) - Math.min(...meds)
  const avg = (f: (r: Result) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length
  console.log(
    c.name.padEnd(30)
    + meds.map((m) => m.toFixed(0).padStart(6)).join('') + '   '
    + `${mean.toFixed(0).padStart(5)}m ${spread.toFixed(0).padStart(4)}m `
    + `${avg((r) => r.tasMed).toFixed(0).padStart(6)} `
    + `${avg((r) => r.rateMed).toFixed(1).padStart(5)}°/s `
    + `${avg((r) => r.util).toFixed(2).padStart(5)}`,
  )
}
