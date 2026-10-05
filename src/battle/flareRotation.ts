import type { Battle } from './battleState'
import { FLARE_LANES, FLARE_RELIGHT_DELAY, spawnFlare } from '../world/flares'
import type { FlareBeat } from './beats'

/** 只暴露這個生命週期實際讀寫的戰局狀態；不建立執行期包裝物件。 */
type FlareBattle = Pick<Battle,
  'flareCursor' | 'flareDue' | 'flareLane' | 'flareRotation'> & {
    readonly world: Pick<Battle['world'], 'time' | 'flares'>
  }

/**
 * 開始輪替：清單的前 `FLARE_LANES` 個位置各點一枚（各帶自己的延遲），之後
 * 由 `stepFlareRotation` 接手。相位由序號給 —— 決定性，各枚不會同步搖。
 * 池滿就少點幾枚（`spawnFlare` 回 −1），不拋：那是容量估錯，不該炸掉一場仗。
 */
export function dropFlares(b: FlareBattle, beat: FlareBeat): void {
  b.flareRotation = beat
  b.flareCursor = 0
  for (let k = 0; k < FLARE_LANES && k < beat.points.length; k++) {
    const p = beat.points[k]!
    b.flareLane[k] = spawnFlare(b.world.flares, p.x, p.altitude, p.z, k * 1.1, p.delay)
    b.flareDue[k] = -1
    b.flareCursor++
  }
}

/**
 * 輪替：燈位上的那一枚熄了就排重點，時間到了在清單的下一個位置點新的一枚。
 * 清單走完從頭再來。每個物理步跑，沒有輪替時一次比較就早退。
 */
export function stepFlareRotation(b: FlareBattle): void {
  const rot = b.flareRotation
  if (rot === null) return
  const now = b.world.time
  const pool = b.world.flares
  for (let k = 0; k < FLARE_LANES; k++) {
    const slot = b.flareLane[k]!
    if (slot >= 0) {
      if (pool.live[slot] !== 0) continue
      b.flareLane[k] = -1
      b.flareDue[k] = now + FLARE_RELIGHT_DELAY
      continue
    }
    const due = b.flareDue[k]!
    if (due < 0 || now < due) continue
    const p = rot.points[b.flareCursor % rot.points.length]!
    b.flareLane[k] = spawnFlare(pool, p.x, p.altitude, p.z, b.flareCursor * 1.1, 0)
    b.flareCursor++
    b.flareDue[k] = -1
  }
}
