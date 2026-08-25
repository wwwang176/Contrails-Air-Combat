/**
 * **轉彎到底要花多少能量？** 單機試飛台。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/turn-cost.probe.ts
 *
 * 【為什麼要這一支】`extend` 的回場偏置需要一個「不要大幅度轉彎」的上限，
 * 而該上限一度是從「誘導阻力 ∝ n²、n = 1/cos φ」反推出來的 15° 傾斜角。
 * 那個反推只算了**誘導阻力這一項**，而 `extend` 期間飛機加滿油門在加速，
 * 總阻力裡誘導阻力佔多少從來沒量過。專案既有的教訓（`etaMax` 那次）：
 * 拿上界反推工作值，兩份 spec 都高估了 10–18%。
 *
 * 【為什麼是單機不是 20v20】要問的是「轉彎這個動作本身的代價」。戰場上
 * 追擊幾何、僚機站位、指揮命令、對手的機動同時在改變能量，那裡量得到的
 * 是「打一場仗掉多少能量」，不是這一題。
 *
 * 比能量 `E = h + V² / 2g`，單位公尺 —— 與爬升率同單位，可直接相加減。
 *
 * ## 表一：能不能用「每拍偏一點點」來控制轉彎率
 *
 * 想法是每個決策拍（10 Hz）把瞄準方向設成「**當下**速度航向 + Δψ」保持
 * 水平。因為每一拍都從當下航向重算，指令不會滾雪球（`unloadAim` 的既有
 * 設計），穩態轉彎率理論上趨近 `Δψ × 10 Hz`，於是「Δψ 上限」與「傾斜角
 * 上限」互換 —— 而前者在 `aimWorld` 介面下寫得出來。
 *
 * **實測否決。** 指揮儀對小橫向誤差的處理不是壓坡度：
 *
 * ```
 *   誤差 < 1.5°（deadZoneAngle）        完全不下滾轉指令
 *   1.5°~2.5°（wingsLevelFadeAngle）    機翼改平還在搶權
 *   任何小誤差                          方向舵那一路（yawAim）先把它抹平
 * ```
 *
 * 結果是平飛側滑而不是轉彎。這張表留著，因為「試過、不行、為什麼不行」
 * 本身就是設計依據。
 *
 * ## 表二：直接指一個方向，看指揮儀給什麼
 *
 * 這才是這個介面真正能下的指令：瞄準方向固定不動，飛機自己轉過去。
 * 坡度是**結果**，量它；能量代價也是結果，量它。
 *
 * 表二同時回答 180° 那個奇異點 —— `FlightDirector` 對接近正後方的瞄準
 * 方向會沿用上一格滾轉指令（`reverseHysteresis`），而「戰場在正後方」
 * 正是 `extend` 回場的常態。
 */
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { manoeuvreSpeed, energyPull, DEFAULT_DOCTRINE } from '../../src/ai/doctrine'
import { shrinkTowardNose } from '../../src/ai/steer'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import type { AircraftSpec } from '../../src/specs/types'

const DT = 1 / 240
/** 決策週期，步。240 Hz ÷ 24 = 10 Hz，與 `AI_DECISION_HZ` 一致 */
const DECIDE = 24
const G0 = 9.80665
const RAD = 180 / Math.PI
/** 高空與低空 —— 低空是 `extendFloorLatch`（我飛不動了）真正會觸發的地方 */
const ALTS = [4000, 1200]

/** 表一：起始暫態與量測窗，秒 */
const SETTLE = 6
const WINDOW = 20
/** 表二：轉不完的逾時，秒 */
const CAP = 200
/** 表二：航向與指令方向差到這個角度以內就算轉完，度 */
const DONE = 5

/** 表一：每個決策拍允許偏離當前航向的角度，度 */
const OFFSETS = [0, 1, 1.5, 2, 3, 5, 8]
/** 表二：固定的瞄準方向，相對起始航向，度 */
const HEADINGS = [15, 30, 45, 60, 90, 135, 180]

/** `extend` 進場（速度見底）與補完兩個能量狀態 */
const RATIOS = [0.75, 1.0]

const SPECS: [string, AircraftSpec][] = [
  ['Bf 109 G-6', applyFeel(BF109K4, GAME_FEEL)],
  ['P-51D', applyFeel(P51D, GAME_FEEL)],
]

const n = (v: number, w: number, d = 1): string =>
  (Number.isFinite(v) ? v.toFixed(d) : '—').padStart(w)

/** 比能量，公尺 */
function specificEnergy(a: Aircraft): number {
  const v = a.state.velocity.length()
  return a.state.position.y + (v * v) / (2 * G0)
}

const R = new Vector3()
const U = new Vector3()

/** 傾斜角絕對值，度 */
function bankDeg(a: Aircraft): number {
  const right = R.set(1, 0, 0).applyQuaternion(a.state.orientation)
  const up = U.set(0, 1, 0).applyQuaternion(a.state.orientation)
  return Math.abs(Math.atan2(-right.y, up.y) * RAD)
}

function heading(a: Aircraft): number {
  return Math.atan2(a.state.velocity.x, -a.state.velocity.z)
}

function ratioOf(a: Aircraft, spec: AircraftSpec): number {
  return a.diag.aero.tas / manoeuvreSpeed(spec, a.state.position.y, DEFAULT_DOCTRINE)
}

function fresh(spec: AircraftSpec, ratio0: number, alt: number): Aircraft {
  const a = new Aircraft(spec, alt, manoeuvreSpeed(spec, alt, DEFAULT_DOCTRINE) * ratio0)
  a.state.position.set(0, alt, 0)
  return a
}

/** 中位數。就地排序 */
function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  xs.sort((a, b) => a - b)
  return xs[Math.floor(xs.length / 2)]!
}

// ══ 表一：每拍偏置 Δψ ═══════════════════════════════════════
interface RowA {
  rate: number
  bank: number
  ePerSec: number
}

function flyOffset(
  spec: AircraftSpec, ratio0: number, offsetDeg: number, alt: number,
): RowA {
  const self = fresh(spec, ratio0, alt)
  const aim = new Vector3()
  const offset = offsetDeg / RAD
  const banks: number[] = []

  let prev = heading(self)
  let turned = 0
  let e0 = Number.NaN
  let turned0 = 0
  const settle = Math.round(SETTLE / DT)
  const end = Math.round((SETTLE + WINDOW) / DT)

  for (let s = 0; s <= end; s++) {
    if (s % DECIDE === 0) {
      const h = heading(self) + offset
      aim.set(Math.sin(h), 0, -Math.cos(h))
    }
    self.update(aim, WEP_THROTTLE, DT, 0)

    const h = heading(self)
    let d = h - prev
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    turned += Math.abs(d)
    prev = h

    if (s === settle) { e0 = specificEnergy(self); turned0 = turned }
    if (s > settle) banks.push(bankDeg(self))
  }
  return {
    rate: ((turned - turned0) * RAD) / WINDOW,
    bank: median(banks),
    ePerSec: (specificEnergy(self) - e0) / WINDOW,
  }
}

// ══ 表二：固定瞄準方向 ══════════════════════════════════════
interface RowB {
  /** 轉到剩 DONE 度所需秒數 */
  seconds: number
  /** 過程中的傾斜角中位數與峰值，度 */
  bankMid: number
  bankPeak: number
  /** 轉完為止的比能量變化，公尺。正 = 還在賺 */
  energy: number
  /** 同一段時間直飛會賺多少，公尺 —— 兩者之差才是轉彎的代價 */
  straight: number
  /** 轉完時離起點的水平距離，公尺 */
  distance: number
  /** 轉完為止的高度變化，公尺。負 = 掉下去了 */
  dAlt: number
  /** 過程中最低 cornerRatio */
  ratioMin: number
}

/**
 * @param shrink 是否套 `shrinkTowardNose(pullCeiling)` —— 既有的能量拉桿
 *               紀律。`steerCommand` 對每一個意圖都套了它，所以「不套」
 *               那一組是對照，不是實際會發生的行為。
 */
function flyHeading(
  spec: AircraftSpec, ratio0: number, headingDeg: number, shrink: boolean, alt: number,
): RowB {
  const self = fresh(spec, ratio0, alt)
  const straightRef = fresh(spec, ratio0, alt)
  const level = new Vector3()

  const h0 = heading(self)
  const want = h0 + headingDeg / RAD
  const fixed = new Vector3(Math.sin(want), 0, -Math.cos(want))
  const aim = new Vector3()

  const banks: number[] = []
  let bankPeak = 0
  const e0 = specificEnergy(self)
  const eStraight0 = specificEnergy(straightRef)
  let ratioMin = Infinity
  let seconds = Number.NaN
  const done = DONE / RAD
  const steps = Math.round(CAP / DT)

  for (let s = 0; s < steps; s++) {
    if (s % DECIDE === 0) {
      aim.copy(fixed)
      if (shrink) shrinkTowardNose(self, energyPull(ratioOf(self, spec), DEFAULT_DOCTRINE), aim)
    }
    self.update(aim, WEP_THROTTLE, DT, 0)

    // 對照組：始終指著起始航向直飛
    const hs = heading(straightRef)
    level.set(Math.sin(hs), 0, -Math.cos(hs))
    straightRef.update(level, WEP_THROTTLE, DT, 0)

    const b = bankDeg(self)
    banks.push(b)
    if (b > bankPeak) bankPeak = b
    const r = ratioOf(self, spec)
    if (r < ratioMin) ratioMin = r

    let d = heading(self) - want
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    if (Math.abs(d) < done && s > DECIDE) { seconds = s * DT; break }
  }

  const p = self.state.position
  return {
    seconds,
    bankMid: median(banks),
    bankPeak,
    energy: specificEnergy(self) - e0,
    straight: specificEnergy(straightRef) - eStraight0,
    distance: Math.hypot(p.x, p.z),
    dAlt: p.y - alt,
    ratioMin,
  }
}

for (const [name, spec] of SPECS) {
 for (const ALT of ALTS) {
  for (const ratio of RATIOS) {
    const vRef = manoeuvreSpeed(spec, ALT, DEFAULT_DOCTRINE)
    console.log(`\n══ ${name}　${ALT} m　起始 cornerRatio ${ratio.toFixed(2)}`
      + `（${(vRef * ratio * 3.6).toFixed(0)} km/h）`
      + `　pullCeiling ${energyPull(ratio, DEFAULT_DOCTRINE).toFixed(3)} ══`)

    console.log('  ── 表一：每拍偏置 Δψ（想用它當轉彎率上限）─────────────')
    console.log('   Δψ/拍   指令轉彎率   實測轉彎率   實測傾斜角     dE/dt')
    const base = flyOffset(spec, ratio, 0, ALT)
    for (const o of OFFSETS) {
      const r = o === 0 ? base : flyOffset(spec, ratio, o, ALT)
      console.log(`  ${n(o, 5, 2)}°${n(o * 10, 11, 1)}°/s${n(r.rate, 12, 2)}°/s`
        + `${n(r.bank, 12, 2)}°${n(r.ePerSec, 10, 2)} m/s`)
    }

    console.log('  ── 表二：固定瞄準方向（介面真正下得出的指令）──────────')
    console.log('   目標   秒數   傾斜角中位／峰值   轉彎代價   離起點   高度變化'
      + '   最低ratio')
    for (const hd of HEADINGS) {
      const r = flyHeading(spec, ratio, hd, true, ALT)
      console.log(`  ${n(hd, 4, 0)}°${n(r.seconds, 8, 1)} s`
        + `${n(r.bankMid, 10, 1)}° /${n(r.bankPeak, 6, 1)}°`
        + `${n(r.straight - r.energy, 11, 0)} m`
        + `${n(r.distance, 9, 0)} m${n(r.dAlt, 11, 0)} m${n(r.ratioMin, 12, 3)}`)
    }
  }
 }
}

console.log('\n【怎麼讀】表二的「轉彎代價」= 直飛賺的比能量 − 轉彎賺的比能量。')
console.log('WEP 全開時飛機一直在賺，轉彎只是賺得比較慢；代價是那個差額。')
console.log('傾斜角是**結果**不是指令 —— 指揮儀自己解出來的。')
