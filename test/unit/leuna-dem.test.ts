import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { BufferAttribute } from 'three'
import { demToField } from '../../src/tools/leunaDem'
import { buildRiverWater, riverLines, type RiverFile } from '../../src/tools/leunaRiver'
import { createLeuna, PLANT_PAD, plantToWorld } from '../../src/world/leuna'
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
   * 【墊面一定要完全平，而且是 0】十二座構件與整片佈景都假設廠區的地面是
   * 0 —— 斜的話儲槽一半埋進土裡一半浮在空中，整體抬高的話整座廠埋在地下。
   *
   * 【壓平要多退一格】墊面邊界外第一圈的格點若不是平的，雙線性內插會把它
   * 帶進墊面裡，在墊面內留下 0.85 m 的起伏 —— 小到只會被當成「地面好像
   * 有點不平」。
   */
  it('墊面完全平坦，而且高度是 0', () => {
    let lo = Infinity
    let hi = -Infinity
    // 【掃廠區局部座標】墊面轉了 `PLANT_HEADING`，用世界的軸對齊矩形掃會
    // 掃到墊面外的坡上
    const w = { x: 0, z: 0 }
    for (let dz = -PLANT_PAD.halfZ; dz <= PLANT_PAD.halfZ; dz += 25) {
      for (let dx = -PLANT_PAD.halfX; dx <= PLANT_PAD.halfX; dx += 25) {
        plantToWorld(dx, dz, w)
        const h = real.sample(w.x, w.z)
        lo = Math.min(lo, h)
        hi = Math.max(hi, h)
      }
    }
    expect(hi - lo, `墊面落差 ${(hi - lo).toFixed(3)} m`).toBeLessThan(0.001)
    expect(Math.abs(lo), `墊面在 ${lo.toFixed(1)} m`).toBeLessThan(0.001)
  })

  /**
   * 【邊緣一定要收到 0】高度場的場外回 0（`outsideZero`），遠景環也在 0。
   * 這一帶的真實高程在邊上是 30–191 m —— 不收的話整片實測地形是一塊台地，
   * 四周一圈上百公尺的懸崖。
   */
  it('地圖四邊都收到 0', () => {
    let worst = 0
    for (let t = -15000; t <= 15000; t += 200) {
      for (const h of [real.sample(t, -15000), real.sample(t, 15000),
        real.sample(-15000, t), real.sample(15000, t)]) {
        worst = Math.max(worst, Math.abs(h))
      }
    }
    expect(worst, `邊緣最高 ${worst.toFixed(1)} m`).toBeLessThan(0.01)
  })

  /**
   * 【基準是廠區，所以會有負的】薩勒河的谷底比廠區低二十幾公尺，那是真的。
   * 全部壓成非負的話河谷就不見了。
   */
  it('薩勒河那一側低於廠區', () => {
    expect(real.sample(2860, -7100)).toBeLessThan(-10)
  })

  /**
   * 這一條**記錄的是那個發現**：真實地形比手擺的起伏大得多，而且差別不在
   * 峰高而在質地 —— 手擺是平地放十顆孤立的丘（96% 完全平），實測是到處都在
   * 緩緩起伏（沒有一塊是平的）。
   */
  it('起伏比手擺的大，而且幾乎沒有一塊是平的', () => {
    const r = grid(real)
    const h = grid(hand)
    const sd = (a: number[]): number => {
      const m = a.reduce((x, y) => x + y, 0) / a.length
      return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length)
    }
    expect(sd(r), `實測標準差 ${sd(r).toFixed(1)} m`).toBeGreaterThan(sd(h) * 3)
    expect(Math.max(...r) - Math.min(...r)).toBeGreaterThan(150)
    /**
     * 【平坦要看鄰格不看絕對高度】基準是廠區，所以「高度接近 0」的意思是
     * 「與廠區同高」而不是「平的」。真正的平是**與旁邊一樣高**。
     */
    const flat = (f: { sample(x: number, z: number): number }): number => {
      let n = 0
      let same = 0
      for (let z = -14000; z <= 14000; z += 200) {
        for (let x = -14000; x <= 14000; x += 200) {
          const a = f.sample(x, z)
          n++
          if (Math.abs(f.sample(x + 200, z) - a) < 0.05
            && Math.abs(f.sample(x, z + 200) - a) < 0.05) same++
        }
      }
      return same / n
    }
    const fr = flat(real)
    expect(fr, `實測的平地佔 ${(fr * 100).toFixed(0)}%`).toBeLessThan(0.05)
    expect(flat(hand), '手擺那一版本來就大半是平的').toBeGreaterThan(0.9)
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

/**
 * 薩勒河。**水面鋪在地表上不挖槽** —— 高度場一格 80 m，而河寬 50–80 m，
 * 挖出來的槽會被相鄰格點的內插填掉，水面反而被兩岸埋住（實測只露出一條
 * 四十公尺的縫）。理由寫在 `leunaRiver.ts` 的檔頭。
 */
describe('薩勒河的水面', () => {
  const file = JSON.parse(
    new TextDecoder().decode(readFileSync('public/data/leuna-rivers.json')),
  ) as RiverFile
  const lines = riverLines(real, file)

  it('抓到了薩勒河，而且在廠區以東', () => {
    const saale = lines.filter((l) => l.name === 'Saale')
    expect(saale.length, '找不到 Saale').toBeGreaterThan(0)
    const longest = saale.reduce((a, b) => (b.points.length > a.points.length ? b : a))
    // 廠區中心在 x = 0。河的中位 x 要在東邊
    const xs = longest.points.map((p) => p[0]).sort((a, b) => a - b)
    expect(xs[Math.floor(xs.length / 2)]!, '薩勒河跑到廠區西邊了').toBeGreaterThan(500)
  })

  /**
   * 【水面不能低於地面】它是鋪在地表上的，低一公分就整段被地面蓋掉 ——
   * 而畫面上是一條斷斷續續的河，不是任何錯誤。
   */
  it('每一點都高於當地地形', () => {
    let worst = Infinity
    for (const l of lines) {
      for (let i = 0; i < l.points.length; i++) {
        worst = Math.min(worst, l.level[i]! - real.sample(l.points[i]![0], l.points[i]![1]))
      }
    }
    expect(worst, `最低只高出 ${worst.toFixed(2)} m`).toBeGreaterThan(0)
  })

  /**
   * 【捲繞方向】帶狀網格的三角形若捲反了，法線朝下、整條河被背面剔除 ——
   * 而畫面上是**什麼都沒有**，不是一條黑帶子。
   */
  it('每一個三角形的法線都朝上', () => {
    const geo = buildRiverWater(lines)
    const pos = geo.geometry.getAttribute('position') as BufferAttribute
    const idx = geo.geometry.getIndex()!
    let down = 0
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t)
      const b = idx.getX(t + 1)
      const c = idx.getX(t + 2)
      const ux = pos.getX(b) - pos.getX(a)
      const uz = pos.getZ(b) - pos.getZ(a)
      const vx = pos.getX(c) - pos.getX(a)
      const vz = pos.getZ(c) - pos.getZ(a)
      // 法線的 Y 分量：u × v 的 y
      if (uz * vx - ux * vz <= 0) down++
    }
    expect(down, `${down} / ${idx.count / 3} 個三角形的法線朝下`).toBe(0)
  })
})
