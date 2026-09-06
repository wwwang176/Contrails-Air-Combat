/**
 * 落點矩陣的表格輸出。**跑的是 `src/world/bomb.ts` 的 `solveImpact` 本人**，
 * 不是另一份重寫的算式 —— 那正是這個專案一再付代價的「兩份真相」。
 *
 * 用法：`npx vitest run test/tools/bomb-matrix.probe.ts`
 *
 * 斷言在 `test/unit/bomb-matrix.test.ts`，這一支只印數字給人看。
 */
import { it } from 'vitest'
import { G0 } from '../../src/core/math'
import { BOMB_CONE_HALF_ANGLE } from '../../src/camera/bombsight'
import {
  BOMB_TERMINAL_SPEED, bombDragK, solveImpact, type BombState, type Impact,
} from '../../src/world/bomb'

const DT = 1 / 240
const SEA = (): number => 0
const K = bombDragK(BOMB_TERMINAL_SPEED)
const CONE_DEG = (BOMB_CONE_HALF_ANGLE * 180) / Math.PI

const ALTS = [200, 300, 500, 1000, 2000, 3000, 4000, 5000, 6000, 8000]
const SPEEDS = [60, 90, 130]

function solve(alt: number, speed: number, k: number): Impact {
  const s: BombState = { x: 0, y: alt, z: 0, vx: 0, vy: 0, vz: -speed }
  const out: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }
  if (!solveImpact(s, k, SEA, DT, out)) throw new Error('解不出落點')
  return out
}

const pad = (v: string | number, n: number): string => String(v).padStart(n)

it('印出落點矩陣', () => {
  const lines: string[] = []
  lines.push(`終端速度 ${BOMB_TERMINAL_SPEED} m/s　圓錐半角 ${CONE_DEG.toFixed(0)}°　dt = 1/240`)
  for (const speed of SPEEDS) {
    lines.push('')
    lines.push(`── 投彈時真空速 ${speed} m/s（${(speed * 3.6).toFixed(0)} km/h）`)
    lines.push('  高度    前拋     真空前拋   trail   落地時間  落地速度  離天底   夾制')
    for (const alt of ALTS) {
      const r = solve(alt, speed, K)
      const vac = speed * Math.sqrt((2 * alt) / G0)
      const thr = -r.z
      const deg = (Math.atan2(thr, alt) * 180) / Math.PI
      lines.push(
        `${pad(alt, 6)} ${pad(thr.toFixed(0), 8)} ${pad(vac.toFixed(0), 10)}`
        + ` ${pad((vac - thr).toFixed(0), 8)} ${pad(r.seconds.toFixed(1), 9)}`
        + ` ${pad(r.speed.toFixed(0), 9)} ${pad(deg.toFixed(1), 8)}°`
        + `  ${deg > CONE_DEG ? '★ 夾' : '—'}`,
      )
    }
  }
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'))
})
