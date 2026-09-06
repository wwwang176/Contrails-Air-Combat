import { solveImpact, bombDragK, BOMB_TERMINAL_SPEED } from '../../src/world/bomb'
import { sustainedTurnRate, maxLevelSpeed } from '../../src/analysis/envelope'
import { G4M } from '../../src/specs/g4m'
import { B17G } from '../../src/specs/b17g'
import { HE111 } from '../../src/specs/he111'
import { A6M5 } from '../../src/specs/a6m5'
import type { AircraftSpec } from '../../src/specs/types'
import type { BombState, Impact } from '../../src/world/bomb'

/**
 * 攻擊航路的幾何，逐機種。**推導用的三個數字都在這裡對照。**
 *
 * 跑法：`npx vite-node test/tools/strike-geometry.probe.ts`
 */

const K = bombDragK(BOMB_TERMINAL_SPEED)
const DT = 1 / 240
const SETTLES = [1200, 0]
const st: BombState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
const hit: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }

/** 平飛投彈的水平前拋距離，m。 */
function throwOf(alt: number, tas: number): number {
  st.x = 0; st.y = alt; st.z = 0
  st.vx = 0; st.vy = 0; st.vz = -tas
  if (!solveImpact(st, K, () => 0, DT, hit)) return NaN
  return Math.hypot(hit.x, hit.z)
}

const SPECS: [string, AircraftSpec][] = [
  ['G4M 一式陸攻', G4M], ['B-17G', B17G], ['He 111', HE111], ['A6M5 零戰', A6M5],
]

for (const settle of SETTLES) {
for (const alt of [1000, 4000]) {
  console.log(`── 高度 ${alt} m　直線段 ${settle} m ──`)
  console.log('  機種            航路速度   前拋   鎖定距離   迴旋半徑   脫離距離')
  for (const [name, spec] of SPECS) {
    // 【航路速度取極速的八成】巡航投彈不會全油門，也不會慢到接近失速
    const tas = maxLevelSpeed(spec, alt) * 0.8
    const thr = throwOf(alt, tas)
    const lock = thr + settle
    const omega = sustainedTurnRate(spec, alt, tas)
    const r = omega > 0 ? tas / omega : NaN
    const egress = lock + 2 * r
    console.log(
      `  ${name.padEnd(14)} ${tas.toFixed(0).padStart(6)} m/s`
      + ` ${thr.toFixed(0).padStart(6)} ${lock.toFixed(0).padStart(10)}`
      + ` ${r.toFixed(0).padStart(10)} ${egress.toFixed(0).padStart(10)}`,
    )
  }
  console.log('')
}
}
