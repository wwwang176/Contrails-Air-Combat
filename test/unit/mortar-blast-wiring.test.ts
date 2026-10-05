import { describe, expect, it } from 'vitest'

/** 【用 import.meta.glob 而不是 fs】`main.ts` 抓 DOM，載進 vitest 會直接爆；讀原始碼 */
const SOURCES = import.meta.glob(['../../src/main.ts', '../../src/render/battleScenery.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
// 【換行統一成 LF】工作區在 Windows 上是 CRLF
const MAIN = SOURCES['../../src/main.ts']!.replace(/\r\n/g, '\n')
const SCENERY = SOURCES['../../src/render/battleScenery.ts']!

describe('迫擊砲彈落地的爆炸', () => {
  /** 配方在 `render/mortarBlast.ts`（炸彈那一份縮小）；`main.ts` 只負責把它接到地面戰的落地回呼 */
  it('用 mortarBlast 的配方，接到地面戰的落地回呼', () => {
    expect(MAIN).toContain("import { MORTAR_BLAST, MORTAR_BLAST_SCALE } from './render/mortarBlast'")
    expect(MAIN).toContain('burn: emitFirePuff, impact: onGroundImpact, fired: noteGroundShot')
    expect(MAIN).toContain('battleScenery.rebuild(world, pendingMission?.battle.theater)')
    expect(SCENERY).toContain('createGroundBattle(theater, assets.burn, assets.smokeTexture, assets.impact, assets.fired)')
    const at = MAIN.indexOf('const emitMortarBlast')
    const body = MAIN.slice(at, MAIN.indexOf('\n}\n', at))
    expect(body).toContain('emitBlast(BLAST_POOLS, MORTAR_BLAST,')
  })

  /**
   * 【聲音走一般爆炸的事件】與飛機、炸彈同一條（`CUE.Explosion`），當量與畫面同一個常數 ——
   * 畫面縮小、聲音沒跟著縮的話，一發砲彈聽起來像一顆炸彈。
   */
  it('小爆炸另外送一筆一般爆炸聲，當量與畫面同一個常數', () => {
    const at = MAIN.indexOf('const onGroundImpact')
    expect(at).toBeGreaterThan(0)
    const body = MAIN.slice(at, MAIN.indexOf('\n}\n', at))
    expect(body).toContain('emitMortarBlast(x, y, z)')
    expect(body).toContain('pushCue(cues, CUE.Explosion, x, y, z, MORTAR_BLAST_SCALE)')
  })

  /** 純畫面的小爆炸：不震鏡頭、不打燈、不點地面火 */
  it('不震鏡頭、不打燈、不點地面火', () => {
    const at = MAIN.indexOf('const emitMortarBlast')
    const body = MAIN.slice(at, MAIN.indexOf('\n}\n', at))
    for (const word of ['addShake', 'blastLights', 'lightGroundFire']) expect(body, word).not.toContain(word)
  })
})
