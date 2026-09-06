import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { applySafety } from '../../src/ai/safety'
import {
  createSense, senseTerrain, SENSE_INTERVAL, type TerrainSource,
} from '../../src/ai/terrainSense'
import { createArchipelago, type IslandDesc } from '../../src/world/archipelago'
import { CRASH_CLEARANCE } from '../../src/aircraft/crash'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { HE111 } from '../../src/specs/he111'
import { B17G } from '../../src/specs/b17g'
import type { AircraftSpec } from '../../src/specs/types'

/**
 * 【本份唯一真正承重的測試】從各方位、各機型、各速度朝一座島直撲，
 * 安全層必須守得住。
 *
 * 它的價值在於把「地形生成」與「AI 能力」綁成一個閉環 —— 生成器不能長出
 * AI 閃不掉的山，而不是靠人眼檢查。
 *
 * 【基準指令固定朝島心，那是刻意的】真實的 AI 在追敵人，敵人在島的另一邊時
 * 它會一直朝那個方向飛 —— 安全層轉開之後，戰術層下一步又把它拉回去。
 * 這是最嚴苛也最真實的情境。用「保持當前航向」當基準會讓測試變容易，
 * 因為安全層介入一次就永久改變了航向。
 *
 * 【不經過 AiController】戰術層不參與 —— 安全層本來就有最後決定權，
 * 而且少一層就少一堆與這件事無關的雜訊。
 *
 * ── 實測，連同兩個要留給下一位的解讀 ──
 *
 * ```
 *   192 組   撞山 0              ← 硬斷言
 *            沒回到出發距離 32    全部是正撞（off 0），其中 31 組鎖存已解除、
 *                                 人已在圓外，只是 50 秒內沒走完
 *            最低離地 88.6 m
 *            最長連續接管 46.0 s
 * ```
 *
 * 【27.9 m 不是門檻，是紀錄】安全層在 margin ≤ needed 時才觸發，觸發之後
 * 拉平還要時間，所以高度本來就會落到 clearance（120 m）以下 —— 那是
 * spec 已經寫明的既知行為。這裡把地形場景的值記下來，
 * 要不要為它立護欄是負責人的決定。
 *
 * 【26 秒的連續接管是基準指令造成的】戰術層的替身「永遠朝原方向」，
 * 安全層轉開之後它下一步又拉回去，於是飛機沿著島邊蹭著走。真實的 AI
 * 目標會移動，不會這樣。這個數字要當成上界看，不是預期值。
 */

const DT = 1 / 240
const DEG = Math.PI / 180
/** 50 秒。大島加前視距離約 5.8 km，200 m/s 下 29 秒 —— 留足餘裕 */
const MAX_STEPS = 12000

/** 每個機型自己的合法速度，km/h。800 對轟炸機不是合法速度 */
const CASES: { spec: AircraftSpec; speeds: readonly number[] }[] = [
  { spec: P51D, speeds: [400, 700] },
  { spec: BF109K4, speeds: [400, 650] },
  { spec: HE111, speeds: [300, 400] },
  { spec: B17G, speeds: [300, 400] },
]

/**
 * 【八個方位，不是兩個】
 *
 * 原本只取兩個，理由是「島近似圓對稱，換方位不增加任何覆蓋，實測八個方位
 * 逐位元相同」。**島換成多瓣之後那句話不成立了**：次峰是偏心的，所以同一座
 * 島從不同方位進場遇到的剖面完全不同 —— 方位從一個重複的維度變成這一組
 * 測試最有資訊的維度之一。
 *
 * 192 組變成 768 組，實測由 3.6 s 變成約 14 s。
 */
const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315]

/** 航跡到島心的垂距，佔膨脹半徑的比例。0 = 正撞，1.1 = 擦過外緣 */
const OFFSETS = [0, 0.4, 0.8, 1.1]
/** 貼著 AI 硬性最低高度進場 —— 最嚴苛 */
const ENTRY_ALT = 150

interface Run {
  crashed: boolean
  minClear: number
  takeoverShare: number
  maxHold: number
  escaped: boolean
  blewUp: boolean
  finalAlt: number
  finalDist: number
  finalIsland: number
  steps: number
}

function attempt(
  spec: AircraftSpec, tasKmh: number, isl: IslandDesc, bearingDeg: number,
  offsetFrac: number,
  src: TerrainSource, sampleAt: (x: number, z: number) => number,
): Run {
  const tas = tasKmh / 3.6
  const a = new Aircraft(spec, ENTRY_ALT, tas)
  const th = bearingDeg * DEG
  // 島外一段距離，朝島心
  const start = isl.outerRadius + 1200 * 1.2
  // 側移 offset 之後航跡到島心的垂距就是它 —— 方向不變，仍朝原本的方位
  const off = offsetFrac * isl.outerRadius
  a.state.position.set(
    isl.cx + Math.cos(th) * start - Math.sin(th) * off,
    ENTRY_ALT,
    isl.cz + Math.sin(th) * start + Math.cos(th) * off,
  )
  const dir = new Vector3(-Math.cos(th), 0, -Math.sin(th)).normalize()
  a.state.velocity.copy(dir).multiplyScalar(tas)
  a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)

  const sense = createSense()
  const cmd = createCommand()
  let crashed = false
  let minClear = Infinity
  let takeovers = 0
  let hold = 0
  let maxHold = 0
  let escaped = false
  let blewUp = false

  let stepsRun = 0
  for (let step = 0; step < MAX_STEPS; step++) {
    stepsRun = step
    // 戰術層的替身：永遠朝原本的方向
    cmd.aimWorld.copy(dir)
    cmd.throttle = 1
    cmd.brake = 0
    cmd.firing = false

    if (step % SENSE_INTERVAL === 0) senseTerrain(a, src, sense)
    const floor = sense.floor > 0 ? sense.floor : 0
    const act = applySafety(a, floor, cmd, undefined, sense)
    if (act !== 'none') { takeovers++; hold++; if (hold > maxHold) maxHold = hold } else hold = 0

    a.update(cmd.aimWorld, cmd.throttle, DT, cmd.brake)

    const p = a.state.position
    const v = a.state.velocity
    /**
     * 【數值爆炸會假綠】position 變 NaN 時 field.sample 回 −Infinity，
     * clear 變 NaN，而 NaN 的比較全部是 false —— 撞地判定與最低離地都不會
     * 觸發，那一組只會被算進「沒脫離」。
     */
    if (
      !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)
      || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)
    ) { blewUp = true; break }
    const ground = sampleAt(p.x, p.z)
    const clear = p.y - Math.max(ground, 0)
    if (clear < minClear) minClear = clear
    if (p.y <= Math.max(ground, 0) + CRASH_CLEARANCE) { crashed = true; break }

    // 【過關的判準：回到出發時的距離】不是「離開膨脹圓」—— 剛爬過島頂的
    // 飛機還在圓的邊上，那不算走過去了
    const dc = Math.hypot(p.x - isl.cx, p.z - isl.cz)
    if (dc > start) { escaped = true; break }
  }

  const p = a.state.position
  return {
    crashed, minClear, escaped, blewUp,
    takeoverShare: takeovers / MAX_STEPS, maxHold: maxHold * DT,
    finalAlt: p.y,
    finalDist: Math.hypot(p.x - isl.cx, p.z - isl.cz) - isl.outerRadius,
    finalIsland: sense.island,
    steps: stepsRun,
  }
}

describe('地形迴避的飛行掃描', () => {
  const { field, islands } = createArchipelago()
  const src: TerrainSource = { islands }
  const sampleAt = (x: number, z: number): number => field.sample(x, z)

  // 三個代表：最高、最寬、最小
  const byPeak = [...islands].sort((p, q) => q.peak - p.peak)[0]!
  const byWide = [...islands].sort((p, q) => q.outerRadius - p.outerRadius)[0]!
  const bySmall = [...islands].sort((p, q) => p.outerRadius - q.outerRadius)[0]!
  const TARGETS = [
    { name: '最高', isl: byPeak },
    { name: '最寬', isl: byWide },
    { name: '最小', isl: bySmall },
  ]

  it('任何方位、任何機型、任何合法速度都不得撞上', () => {
    const failures: string[] = []
    let worstClear = Infinity
    let worstHold = 0
    let notEscaped = 0
    let total = 0
    const blowups: string[] = []
    const stuck: { who: string; alt: number; dist: number; isl: number; share: string }[] = []

    for (const t of TARGETS) {
      for (const c of CASES) {
        for (const v of c.speeds) {
          for (const b of BEARINGS) for (const o of OFFSETS) {
            total++
            const r = attempt(c.spec, v, t.isl, b, o, src, sampleAt)
            if (r.blewUp) blowups.push(t.name + '/' + c.spec.id + '/' + v + '/' + b + '/off' + o)
            if (r.crashed) failures.push(`${t.name}/${c.spec.id}/${v}/${b}°/off${o}`)
            if (!r.escaped && !r.crashed) notEscaped++
            if (r.minClear < worstClear) worstClear = r.minClear
            if (r.maxHold > worstHold) worstHold = r.maxHold
            if (!r.escaped && !r.crashed) {
              stuck.push({
                who: t.name + '/' + c.spec.id + '/' + v + '/' + b + '/off' + o,
                alt: Math.round(r.finalAlt), dist: Math.round(r.finalDist),
                isl: r.finalIsland, share: r.takeoverShare.toFixed(2),
              })
            }
          }
        }
      }
    }

    console.log(JSON.stringify({
      total,
      crashed: failures.length,
      notEscaped,
      worstClear: worstClear.toFixed(1),
      worstHoldSeconds: worstHold.toFixed(2),
      peaks: TARGETS.map((t) => ({
        n: t.name, peak: t.isl.peak.toFixed(0), r: t.isl.outerRadius.toFixed(0),
      })),
      failures: failures.slice(0, 12),
    }))
    console.log('沒脫離的前十筆：' + JSON.stringify(stuck.slice(0, 10)))
    const climbed = stuck.filter((x) => x.alt > 1000).length
    console.log(JSON.stringify({ stuckTotal: stuck.length, 爬到1000以上: climbed }))
    console.log('期限結束仍在鎖存中：' + JSON.stringify(stuck.filter((x) => x.isl >= 0)))

    expect(failures).toEqual([])
    // 數值爆炸不得被當成「沒脫離」矇混過去
    expect(blowups).toEqual([])

    /**
     * 【第二條硬斷言：離地高度的下界】只斷言不撞是不夠的 —— 一架貼著地面
     * 蹭過去的飛機也能通過，而那在遊戲裡看起來就是「AI 快撞山了」。
     *
     * 50 m 的依據是實測 88.6 m。**刻意留很大的餘裕** —— 這個數字在這一輪
     * 裡從 27.9 走到 56.8 再到 88.6，每一次都是修對了一個東西，
     * 而不是調參數調出來的。把門檻貼著現況會讓它變成「記錄」而不是護欄。**它遠高於 CRASH_CLEARANCE
     * 的 2 m，也就是說這條在真的撞上之前很久就會紅。**
     *
     * 【這個數字是被一次修補改善的】修補前是 27.9 m：安全層的油門策略
     * 「高於角落速度就收油門加煞車」是為俯衝改出設計的，套到繞山上剛好
     * 相反 —— 繞山要能量。給地形分支自己的油門之後翻了一倍。
     */
    expect(worstClear).toBeGreaterThan(50)

    /**
     * 【期限結束仍在鎖存中的，必須是在爬，不是在打轉】
     *
     * 這一條先前寫成「數量不得超過 8」，那是把當時的失敗數抄成門檻 ——
     * 也就是為了讓測試變綠而放寬。換成有物理意義的判準：**高度必須高於
     * 進場高度**。爬不過又繞不過一座大山時，全力爬升是真飛行員會做的事；
     * 貼著海面繞圈不是。
     *
     * 實測 20 組落在這裡（全部是正撞島心），高度 370–967 m，
     * 進場是 150 m。轟炸機佔多數 —— He 111 的爬升率約 4.5 m/s，爬過
     * 915 m 的山要 197 秒，而這個場景只給 50 秒。那是物理。
     */
    for (const x of stuck) {
      if (x.isl < 0) continue
      expect(x.alt).toBeGreaterThan(ENTRY_ALT)
    }
  })
})
