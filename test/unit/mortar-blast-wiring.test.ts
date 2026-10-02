import { describe, expect, it } from 'vitest'

/** 【用 import.meta.glob 而不是 fs】`main.ts` 抓 DOM，載進 vitest 會直接爆；讀原始碼 */
const SOURCES = import.meta.glob('../../src/main.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
// 【換行統一成 LF】工作區在 Windows 上是 CRLF
const MAIN = Object.values(SOURCES)[0]!.replace(/\r\n/g, '\n')

describe('迫擊砲彈落地的爆炸', () => {
  /** 配方在 `render/mortarBlast.ts`（炸彈那一份縮小）；`main.ts` 只負責把它接到地面戰的落地回呼 */
  it('用 mortarBlast 的配方，接到地面戰的落地回呼', () => {
    expect(MAIN).toContain("import { MORTAR_BLAST } from './render/mortarBlast'")
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
})
