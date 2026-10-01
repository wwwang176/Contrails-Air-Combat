import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  MINE_DASH, MINE_DASH_FADE, MINE_DOT_FADE, MINE_PITCH, scarsGlsl, type BattleScars, type ScarRect,
} from '../../src/render/battleScars'
import { FIELD_CLIP_FAR, FIELD_CLIP_NEAR } from '../../src/render/terrain'

/**
 * # 戰場的痕跡（雷區的 GLSL）
 *
 * 只測字串層：雷區的小點與虛線依像素足跡淡出，淡出範圍必須在遠層取樣之前結束；沒有雷區時
 * 輸出與加雷區之前逐字相同。
 */

const BASE: Omit<BattleScars, 'minefields'> = {
  zone: { x0: -1000, z0: -300, x1: 1200, z1: 400 }, fade: 700, dense: 0.3, sparse: 0.03,
  scorch: [{ x: 10, z: 20, r: 40 }, { x: -300, z: 90, r: 55 }],
  trenches: [{ points: [{ x: -500, z: 10 }, { x: -200, z: 60 }, { x: 100, z: 20 }], width: 44 }],
  tracks: [{ points: [{ x: 0, z: 300 }, { x: 40, z: 100 }], width: 14 }],
}

const RECT = (x: number): ScarRect => ({ x, z: 0, ux: 1, uz: 0, vx: 0, vz: 1, hu: 100, hv: 50 })

describe('雷區的著色器', () => {
  it('沒有雷區時，輸出與加雷區之前逐字相同（長度與雜湊是改動前量到的）', () => {
    const s = scarsGlsl({ ...BASE, minefields: [] })
    expect(s.length).toBe(3831)
    expect(createHash('sha1').update(s).digest('hex')).toBe('5ef594116f0ecf75966428226c897498caccc7a2')
  })

  it('有雷區時陣列大小由資料決定，順序在燒田之後、履帶痕之前', () => {
    const s = scarsGlsl({ ...BASE, minefields: [RECT(0), RECT(300), RECT(600)] })
    expect(s).toContain('MINES_A[3]')
    expect(s).toContain('MINES_B[3]')
    expect(s.indexOf('SCORCH')).toBeLessThan(s.indexOf('MINES_A'))
    expect(s.indexOf('MINES_A')).toBeLessThan(s.indexOf('TRACKS_SEG'))
  })

  /**
   * 烘圖時取樣間距是 √2 × `px`（`px` 是半足跡）。規則的小點與虛線的週期要大於取樣間距的兩倍，
   * 否則混疊成錯誤的低頻紋，烘進遠圖
   */
  it('小點與虛線在取樣會混疊之前就全淡掉，近層則完整看得到', () => {
    expect(MINE_DOT_FADE[1] * 2 * Math.SQRT2).toBeLessThan(MINE_PITCH)
    expect(MINE_DASH_FADE[1] * 2 * Math.SQRT2).toBeLessThan(MINE_DASH)
    const half = (t: number): number => 0.5 * Math.hypot(t, t)
    const far = half(FIELD_CLIP_FAR.metersPerTexel)
    expect(far).toBeGreaterThanOrEqual(MINE_DOT_FADE[1])
    expect(far).toBeGreaterThanOrEqual(MINE_DASH_FADE[1])
    const near = half(FIELD_CLIP_NEAR.metersPerTexel)
    expect(near).toBeLessThanOrEqual(MINE_DOT_FADE[0])
    expect(near).toBeLessThanOrEqual(MINE_DASH_FADE[0])
  })
})
