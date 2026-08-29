import { describe, it, expect } from 'vitest'
import { createTurretBarrels } from '../../src/render/turretBarrels'

/**
 * 砲塔槍管的上傳閘。
 *
 * 【為什麼值得一條測試】舊的寫法每幀把用不到的槽全部重寫成零，再無條件
 * `needsUpdate` —— three 於是整條 40 KB 重傳（`updateRanges` 是空的，走全
 * 緩衝那個分支）。而戰鬥機對戰鬥機的一場仗裡**一格都用不到**。
 * 2026-08-29 實測那一下 1.09 ms，三十秒的量測裡佔掉 3.7 秒。
 *
 * 【比 version 不是比 needsUpdate】`needsUpdate` 在 three 只有 setter，
 * 讀出來恆是 undefined。
 */
describe('砲塔槍管的實例上傳', () => {
  it('場上沒有砲塔時，update 不會標要上傳', () => {
    const b = createTurretBarrels(40)
    const before = b.object.instanceMatrix.version
    for (let k = 0; k < 30; k++) b.update([], [], [])
    expect(b.object.instanceMatrix.version).toBe(before)
    b.dispose()
  })

  it('容量還是照 40 架 × 8 座 × 2 管配', () => {
    const b = createTurretBarrels(40)
    expect(b.object.instanceMatrix.count).toBe(640)
    b.dispose()
  })
})
