import { describe, expect, it } from 'vitest'
import { blastFireRadius, LAND_BLAST } from '../../src/render/blast'
import { MORTAR_BLAST, MORTAR_BLAST_SCALE, MORTAR_FIRE_CONE, MORTAR_FIRE_SPEED_RATIO } from '../../src/render/mortarBlast'

describe('迫擊砲彈落地的爆炸配方', () => {
  it('是炸彈那一份（LAND_BLAST）縮小：火球更小、顆數更少，而且不是零', () => {
    expect(MORTAR_BLAST_SCALE).toBeGreaterThan(0)
    expect(MORTAR_BLAST_SCALE).toBeLessThan(1)
    expect(MORTAR_BLAST.fireSize).toBeLessThan(LAND_BLAST.fireSize)
    expect(MORTAR_BLAST.fireSize).toBeGreaterThan(0)
    expect(MORTAR_BLAST.fireCount).toBeLessThanOrEqual(LAND_BLAST.fireCount)
    expect(MORTAR_BLAST.fireCount).toBeGreaterThan(0)
  })

  /**
   * 【火要留在中央】`scaleBlast` 不縮初速（爆炸相似律），而火塊的壽命是建池時固定的，
   * 所以只縮尺寸的話，小爆炸的火塊照樣衝出幾乎一樣遠 —— 0.4 倍的火球半徑仍有基準彈的八成
   */
  it('火球的外緣離中心不超過基準彈的三分之一，噴出的角度比基準彈窄（偏向上）', () => {
    expect(blastFireRadius(MORTAR_BLAST)).toBeLessThanOrEqual(blastFireRadius(LAND_BLAST) / 3)
    expect(MORTAR_BLAST.fireSpeed).toBeCloseTo(LAND_BLAST.fireSpeed * MORTAR_FIRE_SPEED_RATIO, 9)
    expect(MORTAR_FIRE_CONE).toBeLessThan(LAND_BLAST.fireCone)
    expect(MORTAR_BLAST.fireCone).toBe(MORTAR_FIRE_CONE)
  })

  it('煙與塵的初速也跟著縮，不比基準彈快', () => {
    expect(MORTAR_BLAST.smokeSpeed).toBeLessThan(LAND_BLAST.smokeSpeed)
    expect(MORTAR_BLAST.dustSpeed).toBeLessThan(LAND_BLAST.dustSpeed)
  })
})
