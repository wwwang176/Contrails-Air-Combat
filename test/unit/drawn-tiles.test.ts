import { describe, expect, it } from 'vitest'
import { createDrawnTiles, DRAWN_TILES_N } from '../../src/render/drawnTiles'
import { createVegetation } from '../../src/render/vegetation'
import { pushFlora, FloraKind, type FloraSource } from '../../src/core/floraBuffer'
import {
  FLORA_RADIUS, LOD_HYSTERESIS, LOD_NONE, REBUILD_EVERY, REBUILD_MOVE, TILE_SIZE,
} from '../../src/render/vegetationPolicy'
import { RECENTRE_FRACTION } from '../../src/render/fieldClipmap'
import { FIELD_CLIP_MID } from '../../src/render/terrain'

/** 每一格的格心一株闊葉 */
const everyTile: FloraSource = (x0, z0, x1, z1, _h, out) => {
  const i = Math.floor(x0 / TILE_SIZE)
  const j = Math.floor(z0 / TILE_SIZE)
  pushFlora(out, (i + 0.5) * TILE_SIZE, 0, (j + 0.5) * TILE_SIZE, 0, 1, 0.5, FloraKind.BroadTree)
  void x1
  void z1
}

describe('哪些格有畫樹（drawnTiles）', () => {
  it('記下的要等發布後才生效，貼圖與原點一起換', () => {
    const d = createDrawnTiles()
    d.stage(10, -4)
    d.mark(12, -3)
    expect(d.drawnAt(12, -3)).toBe(false)
    d.publish()
    expect(d.drawnAt(12, -3)).toBe(true)
    expect(d.drawnAt(11, -3)).toBe(false)
    const o = d.uniforms.uTreesOrigin.value
    expect([o.x, o.y]).toEqual([10 - DRAWN_TILES_N / 2, -4 - DRAWN_TILES_N / 2])
    const tex = d.uniforms.uTreesDrawn.value.image.data as Uint8Array
    expect(tex[(-3 - o.y) * DRAWN_TILES_N + (12 - o.x)]).toBe(255)
    d.dispose()
  })

  /** 植被圈 24 格、窗 64 格：圈裡每一格都在窗裡，邊上一圈恆為 0（夾邊取樣讀到 0） */
  it('窗蓋得住整個植被圈，還留邊', () => {
    expect(DRAWN_TILES_N / 2 - 1).toBeGreaterThan(Math.ceil(FLORA_RADIUS / TILE_SIZE))
  })
})

describe('植被發布的那一份', () => {
  it('與植被的級數相同：有畫樹（不是 LOD_NONE）的格才算', () => {
    const drawnTiles = createDrawnTiles()
    const v = createVegetation([everyTile], () => 0, { drawnTiles })
    v.update(0, 0)
    v.settle()
    // 快取比外圈大一點（外圈逐格往內抖），兩種格都有
    const tiles = v.debugTiles()
    expect(tiles.some((t) => t.lod === LOD_NONE)).toBe(true)
    expect(tiles.some((t) => t.lod < LOD_NONE)).toBe(true)
    for (const t of tiles) expect(drawnTiles.drawnAt(t.i, t.j)).toBe(t.lod < LOD_NONE)
    // 圈外遠處沒有樹
    expect(drawnTiles.drawnAt(40, 0)).toBe(false)
    v.dispose()
  })

  /**
   * 【與畫面上的樹同一幀換】重建分幀寫，寫完才換上新的樹。寫到一半的時候地面還要是
   * 舊的那一份，不然退出外圈的舊樹還在畫，底下的地卻已經換成烘圖
   */
  it('分幀重建寫到一半時還是舊的那一份，寫完才換', () => {
    const drawnTiles = createDrawnTiles()
    const v = createVegetation([everyTile], () => 0, { drawnTiles, rebuildBudget: 1 })
    v.update(0, 0)
    v.settle()
    // 西邊 4.6 km 那一格（外圈最小 4.8 km，一定有畫）；往東走 3 km 它就出了外圈
    const west = -19
    expect(drawnTiles.drawnAt(west, 0)).toBe(true)
    // 重建隔 REBUILD_EVERY 幀才開始，一幀只寫一筆：50 幀時已經開始、還沒寫完
    const done = v.stats.rebuilds
    for (let f = 0; f < 50; f++) v.update(3000, 0)
    expect(REBUILD_EVERY).toBeLessThan(50)
    expect(v.stats.rebuilds).toBe(done)
    // 那一格已經出了外圈（或從快取丟掉），畫面上還是舊的樹
    const lod = v.debugTiles().find((t) => t.i === west && t.j === 0)?.lod ?? LOD_NONE
    expect(lod).toBe(LOD_NONE)
    expect(drawnTiles.drawnAt(west, 0)).toBe(true)
    v.settle()
    expect(drawnTiles.drawnAt(west, 0)).toBe(false)
    v.dispose()
  })
})

describe('中圖（FIELD_CLIP_MID）', () => {
  /**
   * 鏡頭離窗心最多 `RECENTRE_FRACTION` 個窗寬才挪。窗心到窗邊扣掉它，要大於植被外圈加上
   * 換級的遲滯與重建的移動門檻 —— 不夠的話植被圈邊上有畫樹的格讀不到中圖
   */
  it('窗蓋得住整個植被圈', () => {
    const span = FIELD_CLIP_MID.size * FIELD_CLIP_MID.metersPerTexel
    expect(span / 2 - span * RECENTRE_FRACTION).toBeGreaterThan(FLORA_RADIUS + LOD_HYSTERESIS + REBUILD_MOVE)
  })
})
