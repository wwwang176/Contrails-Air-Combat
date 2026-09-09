import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { demToField } from '../../src/tools/leunaDem'
import { createLeuna, PLANT_CENTER, PLANT_PAD } from '../../src/world/leuna'
import { FARM_CELL, FARM_SIZE } from '../../src/world/farmland'

/**
 * 洛伊納一帶的實測高程。**只有展示區在用** —— 遊戲的
 * `createTerrain('leuna')` 走的仍然是手擺丘陵那一條。
 */
const dem = JSON.parse(
  new TextDecoder().decode(readFileSync('public/data/leuna-dem.json')),
) as Parameters<typeof demToField>[0]

const real = demToField(dem)
const { field: hand } = createLeuna()

/** 30 km 見方每 200 m 取樣一次 */
function grid(f: { sample(x: number, z: number): number }): number[] {
  const out: number[] = []
  for (let z = -14000; z <= 14000; z += 200) {
    for (let x = -14000; x <= 14000; x += 200) out.push(f.sample(x, z))
  }
  return out
}

describe('實測高程', () => {
  it('JSON 涵蓋整張高度場，而且沒有缺口', () => {
    expect(dem.elevation).toHaveLength(dem.size * dem.size)
    expect(dem.halfMetres).toBeGreaterThanOrEqual(((FARM_SIZE - 1) / 2) * FARM_CELL)
    for (const e of dem.elevation) expect(Number.isFinite(e)).toBe(true)
  })

  /**
   * 【墊面一定要完全平】十二座構件與整片佈景都假設地面是 0 —— 斜的話儲槽
   * 一半埋進土裡、一半浮在空中。
   *
   * 【壓平要多退一格】墊面邊界外第一圈的格點若不是平的，雙線性內插會把它
   * 帶進墊面裡。少了那一格，實測是 0.85 m 的起伏 —— 小到只會被當成「地面
   * 好像有點不平」。
   */
  it('墊面完全平坦', () => {
    let lo = Infinity
    let hi = -Infinity
    for (let z = PLANT_CENTER.z - PLANT_PAD.halfZ; z <= PLANT_CENTER.z + PLANT_PAD.halfZ; z += 25) {
      for (let x = PLANT_CENTER.x - PLANT_PAD.halfX; x <= PLANT_CENTER.x + PLANT_PAD.halfX; x += 25) {
        const h = real.sample(x, z)
        lo = Math.min(lo, h)
        hi = Math.max(hi, h)
      }
    }
    expect(hi - lo, `墊面落差 ${(hi - lo).toFixed(3)} m`).toBeLessThan(0.001)
  })

  /**
   * 【最低點歸零】高度場的場外回 0（`outsideZero`），而真實高程在這一帶是
   * 51–249 m。不歸零的話地圖邊緣是一圈五十公尺深的懸崖。
   */
  it('沒有負的高度', () => {
    expect(Math.min(...grid(real))).toBeGreaterThanOrEqual(0)
  })

  /**
   * 這一條**記錄的是那個發現**：真實地形比手擺的起伏大得多，而且差別不在
   * 峰高而在質地 —— 手擺是平地放十顆孤立的丘（96% 完全平），實測是到處都在
   * 緩緩起伏（沒有一塊是平的）。
   */
  it('起伏比手擺的大，而且沒有一塊是平的', () => {
    const r = grid(real)
    const h = grid(hand)
    const sd = (a: number[]): number => {
      const m = a.reduce((x, y) => x + y, 0) / a.length
      return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length)
    }
    expect(sd(r), `實測標準差 ${sd(r).toFixed(1)} m`).toBeGreaterThan(sd(h) * 3)
    expect(Math.max(...r) - Math.min(...r)).toBeGreaterThan(150)
    const flat = r.filter((e) => e < 0.5).length / r.length
    expect(flat, `平地佔 ${(flat * 100).toFixed(0)}%`).toBeLessThan(0.02)
    expect(h.filter((e) => e < 0.5).length / h.length, '手擺那一版本來就大半是平的')
      .toBeGreaterThan(0.9)
  })

  /**
   * 【內插要平滑】DEM 的取樣是 320 m、高度場是 80 m。最近鄰會在飛行中看到
   * 320 m 見方的階梯。
   *
   * 【門檻不能寫死一個「看起來差不多」的公尺數】那一帶真的有陡坡（蓋澤爾谷
   * 的坑壁一格就掉五十幾公尺），寫死的話擋不住最近鄰、只會擋住真實地形。
   * 雙線性的性質是「80 m 的落差不超過同一格 320 m 落差的四分之一」——
   * 最近鄰在格線上會是整整一個 320 m 的落差，那條界線分得開。
   */
  it('內插是雙線性不是最近鄰：80 m 的落差不超過 DEM 一格的四分之一', () => {
    let demStep = 0
    for (let j = 0; j < dem.size; j++) {
      for (let i = 0; i + 1 < dem.size; i++) {
        const a = dem.elevation[j * dem.size + i]!
        const b = dem.elevation[j * dem.size + i + 1]!
        demStep = Math.max(demStep, Math.abs(b - a))
      }
    }
    let worst = 0
    for (let z = -14000; z <= 14000; z += FARM_CELL) {
      for (let x = -14000; x < 14000; x += FARM_CELL) {
        worst = Math.max(worst, Math.abs(real.sample(x + FARM_CELL, z) - real.sample(x, z)))
      }
    }
    const cap = (demStep / 4) * 1.05
    expect(worst, `80 m 最大落差 ${worst.toFixed(1)} m，DEM 一格最大 ${demStep.toFixed(1)} m`)
      .toBeLessThanOrEqual(cap)
  })
})
