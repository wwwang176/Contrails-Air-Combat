import { KI84 } from '../specs/ki84'
import { A6M5 } from '../specs/a6m5'
import { FLEET } from './reel/fleet'
import { STREAM } from './reel/stream'
import { DOGFIGHT } from './reel/dogfight'
import { STRIKE } from './reel/strike'
import { homeShot } from './reel/home'
import type { Shot } from './reel/kit'

export * from './reel/kit'

/**
 * 主選單短片一輪的分鏡。每一段一個檔案（`app/reel/`），型別與工具在 `reel/kit.ts`。
 * `pick` 是 0～1 的抽籤值，決定歸航那一段飛哪一台。
 */
export function reelShots(pick: number): readonly Shot[] {
  return [FLEET, STREAM, DOGFIGHT, STRIKE, homeShot(pick < 0.5 ? KI84 : A6M5)]
}
