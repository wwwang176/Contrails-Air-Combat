/**
 * 開局巡航的站位誤差，**依真實時間切窗**。不是測試（`.probe.ts`）。
 *
 * 跑法：`npx vite-node test/tools/cruise-station.probe.ts`
 *
 * 【要回答什麼】開局巡航時編隊維持得住嗎，`countLocks` 數不數同小隊各跑
 * 一場。巡航階段若用「兩隊重心靠到 `THREAT_RANGE` 以內」判定結束，重心
 * 一直沒靠到 900 m 以內時視窗會把整場混戰都吞進去，站位誤差與取樣數一起
 * 暴增，看起來像編隊散了。
 *
 * 所以兩種切法都印：**時間**切窗（開局 10 km、對頭接近率約 400 m/s，
 * 第一次接觸約在 21 s）與重心判定，好分辨「編隊真的散了」與「視窗被污染了」。
 */
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { THREAT_RANGE } from '../../src/ai/assess'
import { Vector3 } from 'three'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

/** 玩家座位放一個恆平飛的假駕駛 —— 量的是 AI 對 AI */
class Idle implements Controller {
  private readonly aim = new Vector3(0, 0, -1)
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim)
    out.throttle = 0.7
    out.firing = false
  }
}

const DT = 1 / 240
const SECONDS = 150
const SEED = 20260805
/** 依 `BattleConfig.entryRange` 的註解：10 km、接近率約 400 m/s */
const CRUISE_SECONDS = 20

function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

const BLUE = new Vector3()
const RED = new Vector3()

interface Out {
  /** 開局 20 s 內的站位誤差 */
  early: number[]
  /** 兩隊重心第一次靠到 THREAT_RANGE 以內的時刻，s；沒發生為 NaN */
  mergeAt: number
  /** 重心判定切出來的巡航階段取樣數 */
  legacySamples: number
  legacyMedian: number
}

function run(flightAware: boolean): Out {
  const b = createBattle(new Idle(), DEFAULT_BATTLE, SEED)
  if (!flightAware) {
    // 【怎麼關掉】板子收的是 `flights.flightOf` 那一個實體。換成一條獨立的
    // 全 −1，`compactFlights` 就再也碰不到它 —— 逐字回到分編隊之前的行為
    const off = new Int32Array(b.world.combatants.length).fill(-1)
    ;(b.board as { flightOf: Int32Array }).flightOf = off
  }
  const cs = b.world.combatants

  const early: number[] = []
  const legacy: number[] = []
  let mergeAt = NaN
  let cruisePhase = true

  const centroidGap = (): number => {
    BLUE.set(0, 0, 0)
    RED.set(0, 0, 0)
    let nb = 0
    let nr = 0
    for (const c of cs) {
      if (!c.alive) continue
      if (c.team === 'blue') { BLUE.add(c.aircraft.state.position); nb++ } else { RED.add(c.aircraft.state.position); nr++ }
    }
    if (nb === 0 || nr === 0) return Infinity
    return BLUE.divideScalar(nb).distanceTo(RED.divideScalar(nr))
  }

  const steps = Math.round(SECONDS / DT)
  for (let i = 0; i < steps; i++) {
    stepBattle(b, DT)
    if (i % 12 !== 0) continue
    const t = i * DT
    const gap = centroidGap()
    if (cruisePhase && gap <= THREAT_RANGE) { cruisePhase = false; mergeAt = t }
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k]!
      const ai = c.controller
      if (!c.alive || !(ai instanceof AiController) || ai.stationReference === null) continue
      if (t < CRUISE_SECONDS) early.push(ai.stationError)
      if (cruisePhase) legacy.push(ai.stationError)
    }
  }

  return { early, mergeAt, legacySamples: legacy.length, legacyMedian: median(legacy) }
}

const off = run(false)
const on = run(true)

console.log(`=== 開局巡航站位誤差（20v20、種子 ${SEED}）===`)
console.log(`【時間切窗】開局 ${CRUISE_SECONDS} s 內 —— 這一段兩隊還隔著 10 km，`
  + '僚機的三級目標全部被 THREAT_RANGE 擋掉，站位誤差本來就該貼近 0')
console.log('設定                 樣本      中位      P90')
for (const [name, r] of [['不數同小隊（新）', on], ['每一架都數（舊）', off]] as const) {
  const mid = median(r.early)
  const p90 = median(r.early.filter((x) => x >= mid))
  console.log(`${name}  ${String(r.early.length).padStart(7)}  ${mid.toFixed(1).padStart(7)} m`
    + `  ${p90.toFixed(1).padStart(7)} m`)
}

console.log(`\n【重心判定】巡航階段在「兩隊重心靠到 ${THREAT_RANGE} m 以內」時結束`)
console.log('設定                 重心靠攏於      該判定的樣本   中位')
for (const [name, r] of [['不數同小隊（新）', on], ['每一架都數（舊）', off]] as const) {
  console.log(`${name}  ${(Number.isNaN(r.mergeAt) ? '（60 s 內沒發生）' : `${r.mergeAt.toFixed(1)} s`).padStart(12)}`
    + `  ${String(r.legacySamples).padStart(12)}  ${r.legacyMedian.toFixed(1)} m`)
}
