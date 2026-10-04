import { FLEET } from './reel/fleet'
import { STREAM } from './reel/stream'
import { DOGFIGHT } from './reel/dogfight'
import { STRIKE } from './reel/strike'
import { RAID } from './reel/raid'
import { STUKA } from './reel/stuka'
import type { Shot } from './reel/kit'

export * from './reel/kit'

/**
 * 主選單短片一輪的分鏡。每一段一個檔案（`app/reel/`），型別與工具在 `reel/kit.ts`。
 */
export function reelShots(): readonly Shot[] {
  return [FLEET, STREAM, DOGFIGHT, STRIKE, RAID, STUKA]
}
