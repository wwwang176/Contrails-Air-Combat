/**
 * **`extend` 期間我離戰場多遠、還打不打得動？** 單機試飛台。
 * **不是測試**（`.probe.ts`）。跑法：npx vite-node test/tools/extend-return.probe.ts
 *
 * 【為什麼要這一支 —— `turn-cost.probe.ts` 的判準是錯的】那一支量比能量
 * `h + V²/2g`，把高度與速度加在一起。它給出「轉 180° 只花 179 m，很便宜」，
 * 但同一列高度 **+205 m**、`cornerRatio` 由 1.00 掉到 **0.826** —— 比能量守
 * 住了，速度沒有。而 `extend` 要補的正是速度：`cornerExit` 是它的解除條件，
 * `cornerRatio` 是「我還打不打得動」的那把尺。
 *
 * 專案負責人 2026-08-23 指出：「如果你要爬升，結果又快速大轉彎，這樣速度
 * 不是會被消耗太多嗎」。是。比能量看不到這件事。
 *
 * 那一支還有第二個毛病：它下的是**水平**瞄準方向，而 `extend` 在低速時
 * `extendPitchAngle` 是**負的**（低頭換速度）。轉彎與俯衝疊在一起是另一
 * 回事，不能拿水平轉彎的數字代替。這一支照抄 `steerCommand` 的 `extend`
 * 那條路徑：`unloadAim` → `shrinkTowardNose` → `applyFloor`，只換航向。
 *
 * ## 場景
 *
 * 錨點（戰場／被護送的轟炸機）在原點。飛機從原點朝 +Z 離場，速度見底
 * （`cornerRatio = 0.75`）—— 這正是 `extend` 觸發的狀態，而錨點在**正
 * 後方**，也正是人工回報的那個幾何。
 *
 * ## 判準
 *
 * 第一版想量「速度補回來**而且**回到戰場要幾秒」，量出來兩者恆等 ——
 * 因為飛機 **3~5 秒**就把 `cornerRatio` 由 0.75 補到 0.95，而且只跑了
 * 400 m，1 km 的回家判準從頭到尾都成立。
 *
 * 但那次失敗本身就是關鍵證據：**補速度很快，而 `extend` 持續很久**。
 * 兩者對不上，是因為 `extend` 的解除條件不是速度，是**相對**能量閂鎖
 * （`energyAdvantage < −300` 才進、`> +100` 才出）。人工實測那個閂鎖曾
 * 連續開 46 秒、166 秒 —— 速度早就補完了，它還在跑。
 *
 * 所以改成固定跑 `SPAN` 秒，逐時刻印出兩欄，各自回答一個問題：
 *
 * ```
 *   離錨點的距離   bias 有沒有把人留在戰場
 *   cornerRatio    轉彎有沒有把速度吃掉
 * ```
 *
 * ## 掃的是什麼
 *
 * `bias` = 每個決策拍把航向往錨點方位拉過去的比例。
 *
 * ```
 *   0     現況：照當下航向直飛，補到 cornerExit 之後才回頭
 *   0.25  每拍把方位差收掉四分之一 —— 緩轉
 *   1.00  立刻整個轉過去
 * ```
 *
 * 這就是「不可以大幅度轉彎以免又減少速度」那句話的連續版本。
 */
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { manoeuvreSpeed, energyPull, DEFAULT_DOCTRINE } from '../../src/ai/doctrine'
import {
  shrinkTowardNose, applyFloor, extendPitchAngle, floorPitchAngle, DEFAULT_STEER,
} from '../../src/ai/steer'
import { DEFAULT_RULES } from '../../src/ai/rules'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import type { AircraftSpec } from '../../src/specs/types'

const DT = 1 / 240
const DECIDE = 24
const RAD = 180 / Math.PI
/** 觀察時長，秒。取人工實測的 extend 持續時間量級 */
const SPAN = 60
/** 取樣時刻，秒 */
const MARKS = [5, 10, 20, 40, 60]

const ALTS = [4000, 1200]
const BIASES = [0, 0.1, 0.25, 0.5, 1.0]
const RATIO0 = 0.75

const SPECS: [string, AircraftSpec][] = [
  ['Bf 109 G-6', applyFeel(BF109G6, GAME_FEEL)],
  ['P-51D', applyFeel(P51D, GAME_FEEL)],
]

const n = (v: number, w: number, d = 1): string =>
  (Number.isFinite(v) ? v.toFixed(d) : '—').padStart(w)

const R = new Vector3()
const U = new Vector3()
const FWD = new Vector3(0, 0, -1)

function bankDeg(a: Aircraft): number {
  const right = R.set(1, 0, 0).applyQuaternion(a.state.orientation)
  const up = U.set(0, 1, 0).applyQuaternion(a.state.orientation)
  return Math.abs(Math.atan2(-right.y, up.y) * RAD)
}

function ratioOf(a: Aircraft, spec: AircraftSpec): number {
  return a.diag.aero.tas / manoeuvreSpeed(spec, a.state.position.y, DEFAULT_DOCTRINE)
}

function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  xs.sort((a, b) => a - b)
  return xs[Math.floor(xs.length / 2)]!
}

/**
 * `unloadAim` 的複製品，但航向可以指定。
 *
 * 【為什麼複製而不是 import】`unloadAim` 沒有出口，而且它的航向恆等於
 * 當下速度向量的水平投影 —— 這一支要問的就是「換一個航向會怎樣」。
 * 其餘完全一致：航跡角相對**地平線**定義，不是加在當前方向上的增量
 * （那個寫法會每格滾雪球，見 `unloadAim` 的註解）。
 */
function unloadAt(headingRad: number, pitch: number, out: Vector3): void {
  const c = Math.cos(pitch)
  out.set(Math.sin(headingRad) * c, Math.sin(pitch), -Math.cos(headingRad) * c)
}

interface Row {
  /** 各取樣時刻離錨點的距離，m */
  dist: number[]
  /** 各取樣時刻的 cornerRatio */
  ratio: number[]
  /** 期間離錨點最遠，m */
  maxDist: number
  bankMid: number
  bankPeak: number
  /** 期間最低 cornerRatio */
  ratioMin: number
  /** 期間的高度變化，m */
  dAlt: number
}

function fly(spec: AircraftSpec, alt: number, bias: number): Row {
  const self = new Aircraft(spec, alt, manoeuvreSpeed(spec, alt, DEFAULT_DOCTRINE) * RATIO0)
  self.state.position.set(0, alt, 0)
  // 朝 +Z 離場 —— 錨點在原點，所以錨點在正後方
  self.state.velocity.set(0, 0, self.state.velocity.length())
  self.state.orientation.setFromUnitVectors(FWD, U.set(0, 0, 1))
  self.prevOrientation.copy(self.state.orientation)

  const aim = new Vector3()
  const banks: number[] = []
  let bankPeak = 0
  let ratioMin = Infinity
  let maxDist = 0
  const dist: number[] = []
  const ratioAt: number[] = []
  let mark = 0
  const exit = DEFAULT_RULES.cornerExit
  const steps = Math.round(SPAN / DT)

  for (let s = 0; s <= steps; s++) {
    if (s % DECIDE === 0) {
      const p = self.state.position
      const v = self.state.velocity
      const here = Math.atan2(v.x, -v.z)
      // 錨點在原點，所以指向錨點就是指向 −p
      const home = Math.atan2(-p.x, p.z)
      const r = ratioOf(self, spec)

      // bias = 0 是現況：補到 cornerExit 之前照當下航向直飛，之後才回頭
      const pull = bias > 0 ? bias : (r >= exit ? 1 : 0)
      let err = home - here
      while (err > Math.PI) err -= 2 * Math.PI
      while (err < -Math.PI) err += 2 * Math.PI

      const clearance = p.y
      unloadAt(here + err * pull, extendPitchAngle(r, 0, clearance, DEFAULT_STEER), aim)
      shrinkTowardNose(self, energyPull(r, DEFAULT_DOCTRINE), aim)
      applyFloor(self, floorPitchAngle(clearance, DEFAULT_STEER), aim)
    }
    self.update(aim, WEP_THROTTLE, DT, 0)

    const b = bankDeg(self)
    banks.push(b)
    if (b > bankPeak) bankPeak = b
    const r = ratioOf(self, spec)
    if (r < ratioMin) ratioMin = r
    const p = self.state.position
    const d = Math.hypot(p.x, p.z)
    if (d > maxDist) maxDist = d

    if (mark < MARKS.length && s * DT >= MARKS[mark]!) {
      dist.push(d)
      ratioAt.push(r)
      mark++
    }
    if (p.y < 50) break
  }
  while (dist.length < MARKS.length) {
    dist.push(Number.NaN)
    ratioAt.push(Number.NaN)
  }

  return {
    dist,
    ratio: ratioAt,
    maxDist,
    bankMid: median(banks),
    bankPeak,
    ratioMin,
    dAlt: self.state.position.y - alt,
  }
}

for (const [name, spec] of SPECS) {
  for (const alt of ALTS) {
    console.log(`\n══ ${name}　${alt} m　起始 cornerRatio ${RATIO0.toFixed(2)}`
      + `　起始俯仰指令 ${(extendPitchAngle(RATIO0, 0, alt, DEFAULT_STEER) * RAD).toFixed(1)}°`
      + `　pullCeiling ${energyPull(RATIO0, DEFAULT_DOCTRINE).toFixed(3)} ══`)
    console.log('          離錨點的距離，m               cornerRatio'
      + '                    坡度  最低   高度')
    console.log('   bias  '
      + MARKS.map((m) => `${String(m)}s`.padStart(6)).join('')
      + '  '
      + MARKS.map((m) => `${String(m)}s`.padStart(7)).join('')
      + '   中位/峰值  ratio')
    for (const bias of BIASES) {
      const r = fly(spec, alt, bias)
      console.log(`  ${n(bias, 5, 2)} `
        + r.dist.map((d) => n(d, 6, 0)).join('')
        + '  '
        + r.ratio.map((x) => n(x, 7, 3)).join('')
        + `${n(r.bankMid, 7, 0)}°/${n(r.bankPeak, 4, 0)}°`
        + `${n(r.ratioMin, 7, 3)}${n(r.dAlt, 7, 0)} m`)
    }
  }
}

console.log('\n【怎麼讀】bias = 0 是現況：照當下航向直飛，'
  + `速度補到 cornerExit（${DEFAULT_RULES.cornerExit}）之後才回頭。`)
console.log('「離錨點的距離」看的是有沒有留在戰場；'
  + '「cornerRatio」看的是轉彎有沒有把速度吃掉。')
