/**
 * 德 M4 的 AI Ju 87 怎麼攻擊。**一次性量測，不進測試組。**
 *
 * 四架全放 AI（玩家座位也是），接線照 `main.ts` 的 `wireTerrain`。每一趟俯衝（相位 `dive`）記：
 * 壓機鼻的高度與水平距離、俯衝的機鼻角與航跡角、機翼的實際滾轉（機體右向量的仰角，近垂直時
 * 不退化）、指示空速、安全層有沒有介入、炸彈真的出去（彈艙存量減少）的高度、拉起後的最低離地、
 * 最大過載。結尾統計各相位的時間比例與兩輪之間的間隔。
 *
 * 環境變數：SECONDS（預設 300）、SEED（預設 20260913）、VERBOSE（印每一趟的取樣）。
 *
 * 跑法：`npx vite-node test/tools/ju87-ai-dive.probe.ts`
 */
import { Vector3 } from 'three'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { createTerrain } from '../../src/render/terrain'
import { flatSeaCrashPolicy } from '../../src/world/seaCrash'
import { settleGroundTargets } from '../../src/world/groundTargets'
import { clearImpacts } from '../../src/world/events'
import { clearKills } from '../../src/world/kills'
import { maxClimbRate } from '../../src/analysis/envelope'
import { RHO0 } from '../../src/physics/atmosphere'
import { readyCard } from '../fixtures/mission'

const DT = 1 / 240
const SECONDS = Number(process.env['SECONDS'] ?? 300)
const SEED = Number(process.env['SEED'] ?? 20260913)
const VERBOSE = process.env['VERBOSE'] !== undefined
const DEG = 180 / Math.PI

const terrain = createTerrain('kursk')
const b = createBattle(new AiController(), missionConfigFrom(readyCard('germany-m4')), SEED)
const w = b.world
const policy = flatSeaCrashPolicy(terrain.collisionHeightAt)
let crashes = 0
w.crashPolicy = (c) => {
  const hit = policy(c)
  if (hit && c.team === 'blue') crashes++
  return hit
}
w.land = terrain.land
w.groundAt = terrain.collisionHeightAt
w.waterAt = terrain.waterAt
settleGroundTargets(w.groundTargets, w.groundAt)

const wired = new Set<AiController>()
const wire = (): void => {
  for (const c of w.combatants) {
    const ctl = c.controller
    if (!(ctl instanceof AiController) || wired.has(ctl)) continue
    ctl.ships = w.ships
    ctl.groundTargets = w.groundTargets
    ctl.bombBay = c.bombBay
    ctl.bombDrag = w.bombDrag
    ctl.terrain = terrain
    ctl.clearTerrainState()
    wired.add(ctl)
  }
}

interface Dive {
  seat: number
  t0: number
  entryH: number
  entryRange: number
  entryRoll: number
  maxRoll: number
  gammaMin: number
  pitchMin: number
  iasMax: number
  safety: string
  safetyH: number
  releaseT: number
  releaseH: number
  releasePitch: number
  releaseRoll: number
  releaseBack: string
  minAgl: number
  maxN: number
  samples: string[]
}

/** 脫離段持續爬升的累計，依離地高度每 250 m 一格 */
const climb: { n: number; vz: number; tas: number; pitch: number; load: number; roll: number; aoa: number }[] = []
const NOSE = new Vector3()
const RIGHT = new Vector3()
const UP = new Vector3()
const dives: Dive[] = []
const open = new Map<number, Dive>()
const prevPhase = new Map<number, string>()
const load = new Map<number, number>()
const phaseSteps: Record<string, number> = {}
let flightSteps = 0
let blueSteps = 0

for (let i = 0, total = Math.round(SECONDS / DT); i < total; i++) {
  wire()
  stepBattle(b, DT)
  clearImpacts(w.groundKillEvents)
  clearKills(w.killEvents)
  clearImpacts(w.hitEvents)
  clearImpacts(w.splashEvents)
  clearImpacts(w.bombEvents)
  for (const c of w.combatants) {
    if (c.team !== 'blue' || !c.alive) continue
    const ctl = c.controller
    if (!(ctl instanceof AiController)) continue
    const a = c.aircraft
    const p = a.state.position
    const v = a.state.velocity
    const tas = v.length()
    const gamma = tas > 1 ? Math.asin(v.y / tas) * DEG : 0
    NOSE.set(0, 0, -1).applyQuaternion(a.state.orientation)
    RIGHT.set(1, 0, 0).applyQuaternion(a.state.orientation)
    UP.set(0, 1, 0).applyQuaternion(a.state.orientation)
    const pitch = Math.asin(NOSE.y) * DEG
    const roll = Math.asin(RIGHT.y) * DEG
    const ground = terrain.collisionHeightAt(p.x, p.z)
    const agl = p.y - ground
    const phase = ctl.diveBombPhase
    blueSteps++
    phaseSteps[phase] = (phaseSteps[phase] ?? 0) + 1
    const l = c.bombBay.load + c.bombBay.queue
    const prevLoad = load.get(c.index)
    load.set(c.index, l)
    const before = prevPhase.get(c.index)
    prevPhase.set(c.index, phase)
    const tgt = ctl.groundTarget
    if (process.env['WATCH'] === String(c.index) && i % (10 * 240) === 0) {
      const range = tgt === null ? NaN : Math.hypot(tgt.position.x - p.x, tgt.position.z - p.z)
      console.log(`  watch t=${w.time.toFixed(0)} #${c.index} ${phase} 目標 ${tgt?.index ?? -1} 水平 ${range.toFixed(0)} 離目標高 ${tgt === null ? 'NA' : (p.y - tgt.position.y).toFixed(0)} 真速 ${tas.toFixed(0)} 位置 ${p.x.toFixed(0)},${p.z.toFixed(0)}`)
    }
    if (before !== undefined && before !== phase && process.env['TRACE'] !== undefined) {
      const range = tgt === null ? NaN : Math.hypot(tgt.position.x - p.x, tgt.position.z - p.z)
      console.log(`  t=${w.time.toFixed(1).padStart(5)} #${c.index} ${before}→${phase} 離目標高 ${tgt === null ? 'NA' : (p.y - tgt.position.y).toFixed(0)} 水平 ${range.toFixed(0)} 真速 ${tas.toFixed(0)} 目標 ${tgt?.index ?? -1}`)
    }
    if (phase === 'dive' && before !== 'dive') {
      const range = tgt === null ? NaN : Math.hypot(tgt.position.x - p.x, tgt.position.z - p.z)
      open.set(c.index, {
        seat: c.index, t0: w.time, entryH: tgt === null ? NaN : p.y - tgt.position.y, entryRange: range, entryRoll: roll,
        maxRoll: 0, gammaMin: 0, pitchMin: 0, iasMax: 0, safety: 'none', safetyH: -1, releaseT: -1, releaseH: -1, releasePitch: NaN, releaseRoll: NaN, releaseBack: '',
        minAgl: Infinity, maxN: 0, samples: [],
      })
    }
    const d = open.get(c.index)
    if (d !== undefined) {
      const ias = Math.sqrt((2 * a.diag.aero.qbar) / RHO0)
      if (phase === 'dive' && Math.abs(roll) > d.maxRoll) d.maxRoll = Math.abs(roll)
      if (gamma < d.gammaMin) d.gammaMin = gamma
      if (pitch < d.pitchMin) d.pitchMin = pitch
      if (ias > d.iasMax) d.iasMax = ias
      if (agl < d.minAgl) d.minAgl = agl
      if (a.diag.loadFactor > d.maxN) d.maxN = a.diag.loadFactor
      if (ctl.safetyAction !== 'none' && d.safety === 'none') {
        d.safety = `${ctl.safetyAction}@${phase}`
        d.safetyH = tgt === null ? agl : p.y - tgt.position.y
      }
      if (prevLoad !== undefined && l < prevLoad && d.releaseT < 0) {
        d.releaseT = w.time
        d.releaseH = tgt === null ? agl : p.y - tgt.position.y
        // 投彈那一刻：機鼻往下的角度（往前或往後下方都算，機鼻過垂直之後是回頭對著目標）、滾轉、機翼是否顛倒
        d.releasePitch = Math.asin(-NOSE.y) * DEG
        d.releaseRoll = UP.y < 0 ? 180 - Math.abs(roll) : Math.abs(roll)
        d.releaseBack = NOSE.dot(new Vector3(tgt === null ? 0 : tgt.position.x - p.x, 0, tgt === null ? 0 : tgt.position.z - p.z)) > 0 ? '朝目標' : '背對目標'
      }
      if (VERBOSE && i % 240 === 0) {
        d.samples.push(`${(tgt === null ? agl : p.y - tgt.position.y).toFixed(0)}m 俯${pitch.toFixed(0)} γ${gamma.toFixed(0)} 滾${roll.toFixed(0)} IAS${ias.toFixed(0)} ${phase}`)
      }
      if (phase === 'level' || (phase === 'egress' && before === 'pullout' && false)) {
        dives.push(d)
        open.delete(c.index)
      }
    }
    flightSteps++
    // 脫離段的持續爬升：速度已經掉下來（不是拉起之後的衝高）才算，依離地高度每 250 m 一格
    if (phase === 'egress' && tas < 85 && Math.abs(roll) < 8) {
      const band = Math.min(8, Math.floor(agl / 250))
      const e = climb[band] ?? (climb[band] = { n: 0, vz: 0, tas: 0, pitch: 0, load: 0, roll: 0, aoa: 0 })
      e.n++
      e.vz += v.y
      e.tas += tas
      e.pitch += pitch
      e.load += a.diag.loadFactor
      e.roll += Math.abs(roll)
      e.aoa += pitch - gamma
    }
  }
  if (b.outcome !== 'fighting') break
}
for (const d of open.values()) dives.push(d)
const spec = w.combatants.find((c) => c.team === 'blue')!.aircraft.spec
console.log('脫離段的持續爬升（速度已掉下來、機翼平的樣本），對照這台飛機在 WEP 下的物理最大爬升率：')
climb.forEach((e, band) => {
  if (e.n < 50) return
  const alt = band * 250 + 125
  const best = maxClimbRate(spec, alt)
  console.log(`  離地 ${band * 250}～${band * 250 + 250} m：實際 ${(e.vz / e.n).toFixed(1)} m/s（真速 ${(e.tas / e.n).toFixed(0)}、機鼻 ${(e.pitch / e.n).toFixed(1)}°、攻角約 ${(e.aoa / e.n).toFixed(1)}°、過載 ${(e.load / e.n).toFixed(2)}、坡度 ${(e.roll / e.n).toFixed(1)}°）｜物理最大 ${best.rate.toFixed(1)} m/s（真速 ${best.speed.toFixed(0)}）`)
})

console.log(`種子 ${SEED}，${SECONDS} 秒；墜毀（藍隊）${crashes}；活著 ${w.combatants.filter((c) => c.team === 'blue' && c.alive).length}/4；地面目標損失 ${w.groundTargets.filter((t) => !t.alive).length}`)
console.log('各相位時間比例', JSON.stringify(Object.fromEntries(Object.entries(phaseSteps).map(([k, v]) => [k, +((100 * v) / Math.max(1, blueSteps)).toFixed(1)]))))
for (const d of dives) {
  console.log(`#${d.seat} t=${d.t0.toFixed(0).padStart(3)} 壓機鼻 高${d.entryH.toFixed(0)} 水平${d.entryRange.toFixed(0)} 滾${d.entryRoll.toFixed(0)}°｜` +
    `機鼻最陡 ${d.pitchMin.toFixed(0)}° 航跡 ${d.gammaMin.toFixed(0)}° 俯衝中最大滾轉 ${d.maxRoll.toFixed(0)}° IAS最高 ${d.iasMax.toFixed(0)}｜` +
    `投彈 ${d.releaseT < 0 ? '沒投出去' : `t=${d.releaseT.toFixed(1)} 高${d.releaseH.toFixed(0)} 機鼻下${d.releasePitch.toFixed(0)}°(${d.releaseBack}) 滾轉${d.releaseRoll.toFixed(0)}°`}｜最低離地 ${d.minAgl.toFixed(0)} 最大過載 ${d.maxN.toFixed(1)}｜安全層 ${d.safety}${d.safetyH >= 0 ? `@高${d.safetyH.toFixed(0)}` : ''}`)
  if (VERBOSE) console.log('   ' + d.samples.join(' | '))
}
