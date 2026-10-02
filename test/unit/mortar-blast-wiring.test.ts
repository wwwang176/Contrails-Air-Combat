import { describe, expect, it } from 'vitest'
import { LAND_BLAST, scaleBlast } from '../../src/render/blast'

/** 【用 import.meta.glob 而不是 fs】`main.ts` 抓 DOM，載進 vitest 會直接爆；讀原始碼 */
const SOURCES = import.meta.glob('../../src/main.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
// 【換行統一成 LF】工作區在 Windows 上是 CRLF
const MAIN = Object.values(SOURCES)[0]!.replace(/\r\n/g, '\n')

describe('迫擊砲彈落地的爆炸', () => {
  /** 與炸彈同一份火球與粒子（LAND_BLAST），只是縮小：自己另寫一份配方的話兩邊會漂開 */
  it('用炸彈的配方縮小，接到地面戰的落地回呼', () => {
    expect(MAIN).toContain('scaleBlast(LAND_BLAST, MORTAR_BLAST_SCALE ** 3, MORTAR_BLAST)')
    expect(MAIN).toContain('createGroundBattle(theater, emitFirePuff, smokeTexture, emitMortarBlast)')
    const at = MAIN.indexOf('const emitMortarBlast')
    const body = MAIN.slice(at, MAIN.indexOf('\n}\n', at))
    expect(body).toContain('emitBlast(BLAST_POOLS, MORTAR_BLAST,')
  })

  /** 純畫面的小爆炸：不震鏡頭、不打燈、不點地面火 */
  it('不震鏡頭、不打燈、不點地面火', () => {
    const at = MAIN.indexOf('const emitMortarBlast')
    const body = MAIN.slice(at, MAIN.indexOf('\n}\n', at))
    for (const word of ['addShake', 'blastLights', 'lightGroundFire']) expect(body, word).not.toContain(word)
  })

  it('縮小之後比基準彈的火球小、顆數也少，而且不是零', () => {
    const scale = Number(/const MORTAR_BLAST_SCALE = ([0-9.]+)/.exec(MAIN)![1])
    expect(scale).toBeGreaterThan(0)
    expect(scale).toBeLessThan(1)
    const small: { -readonly [K in keyof typeof LAND_BLAST]: number } = { ...LAND_BLAST }
    scaleBlast(LAND_BLAST, scale ** 3, small)
    expect(small.fireSize).toBeLessThan(LAND_BLAST.fireSize)
    expect(small.fireSize).toBeGreaterThan(0)
    expect(small.fireCount).toBeLessThanOrEqual(LAND_BLAST.fireCount)
    expect(small.fireCount).toBeGreaterThan(0)
  })
})
