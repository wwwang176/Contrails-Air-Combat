import { describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { boxOutside, frustumPlanesOf, hilbertKey, visibleRuns } from '../../src/render/cullRuns'

/** 站在原點、朝 +X 平視、60° 垂直視角、16:9 */
function camera(yawDeg = 0, pitchDeg = 0, y = 100): PerspectiveCamera {
  const c = new PerspectiveCamera(60, 16 / 9, 1, 60000)
  c.position.set(0, y, 0)
  c.rotation.order = 'YXZ'
  // three 的相機朝 −Z；yaw −90° 轉到 +X
  c.rotation.set((pitchDeg * Math.PI) / 180, ((yawDeg - 90) * Math.PI) / 180, 0)
  c.updateMatrixWorld(true)
  return c
}

const planes = (c: PerspectiveCamera): Float64Array => {
  const p = new Float64Array(24)
  frustumPlanesOf(c, p)
  return p
}

describe('boxOutside', () => {
  const p = planes(camera())

  it('正前方的盒子看得到、背後的看不到', () => {
    expect(boxOutside(p, 900, 0, -50, 1100, 50, 50)).toBe(false)
    expect(boxOutside(p, -1100, 0, -50, -900, 50, 50)).toBe(true)
  })

  /** 【取離平面最遠的那個角】取錯角的話，一半在背後的長盒子（一條林帶）整條被剔掉 */
  it('一半在鏡頭背後的長盒子看得到', () => {
    expect(boxOutside(p, -3000, 0, -20, 3000, 30, 20)).toBe(false)
    expect(boxOutside(p, -20, 50, -3000, 20, 150, 3000)).toBe(false)
    expect(boxOutside(p, -20, -3000, -20, 20, 3000, 20)).toBe(false)
  })

  it('跨過視錐邊的盒子算看得到', () => {
    // 60° 垂直、16:9 → 水平半角約 45.7°；z 方向從 0 延伸到 2000 的盒子一定跨進來
    expect(boxOutside(p, 1000, 0, 500, 1010, 10, 2000)).toBe(false)
  })

  /** 【高度也算數】盒子比視錐的下緣還低就剔掉 —— 盒子的 y 範圍要包住整株 */
  it('往下看時腳下的盒子看得到，平視時看不到', () => {
    const under = [-50, 0, -50, 50, 10, 50] as const
    expect(boxOutside(planes(camera(0, -89, 500)), ...under)).toBe(false)
    expect(boxOutside(planes(camera(0, 0, 500)), ...under)).toBe(true)
  })
})

describe('hilbertKey', () => {
  it('相鄰的格在曲線上也相鄰（隔一步的比例高）', () => {
    let near = 0
    let total = 0
    for (let i = -20; i < 20; i++) {
      for (let j = -20; j < 20; j++) {
        total++
        const d = Math.abs(hilbertKey(i, j) - hilbertKey(i + 1, j))
        if (d === 1) near++
      }
    }
    expect(near / total).toBeGreaterThan(0.3)
  })

  it('每一格一個鍵，不撞', () => {
    const seen = new Set<number>()
    for (let i = -50; i < 50; i++) for (let j = -50; j < 50; j++) seen.add(hilbertKey(i, j))
    expect(seen.size).toBe(10000)
  })
})

describe('visibleRuns', () => {
  /** 五筆，每筆 10 個實例，x 從 −2000 排到 +2000 —— 鏡頭朝 +X，只看得到後兩筆 */
  const n = 5
  const starts = new Int32Array([0, 10, 20, 30, 40])
  const ends = new Int32Array([10, 20, 30, 40, 50])
  const boxes = new Float32Array(n * 6)
  for (let k = 0; k < n; k++) {
    const x = -2000 + k * 1000
    boxes.set([x - 10, 0, -10, x + 10, 10, 10], k * 6)
  }
  const rs = new Int32Array(n)
  const re = new Int32Array(n)

  it('看得到的相鄰筆接成一段', () => {
    const runs = visibleRuns(n, starts, ends, boxes, planes(camera()), 4, rs, re)
    expect(runs).toBe(1)
    expect([rs[0], re[0]]).toEqual([30, 50])
  })

  it('朝背後看就是另一段', () => {
    const runs = visibleRuns(n, starts, ends, boxes, planes(camera(180)), 4, rs, re)
    expect(runs).toBe(1)
    expect([rs[0], re[0]]).toEqual([0, 20])
  })

  /** 【超過上限就把間隔最小的併起來】多畫一些看不到的，換少一次 draw call */
  it('段數超過上限時併掉最小的間隔', () => {
    // 五筆各 10、5、10、20、10 個實例；第 0、2、4 筆在鏡頭前面，1、3 在背後 ——
    // 三段，兩個間隔是 5 與 20
    const s = new Int32Array([0, 10, 15, 25, 45])
    const e = new Int32Array([10, 15, 25, 45, 55])
    const vis = new Float32Array(n * 6)
    for (const k of [0, 2, 4]) vis.set([990, 0, -10, 1010, 10, 10], k * 6)
    for (const k of [1, 3]) vis.set([-1010, 0, -10, -990, 10, 10], k * 6)
    const p = planes(camera())
    expect(visibleRuns(n, s, e, vis, p, 3, rs, re)).toBe(3)
    expect(visibleRuns(n, s, e, vis, p, 2, rs, re)).toBe(2)
    expect([rs[0], re[0], rs[1], re[1]]).toEqual([0, 25, 45, 55])
    expect(visibleRuns(n, s, e, vis, p, 1, rs, re)).toBe(1)
    expect([rs[0], re[0]]).toEqual([0, 55])
  })

  it('什麼都看不到就是零段', () => {
    expect(visibleRuns(n, starts, ends, boxes, planes(camera(0, 89)), 4, rs, re)).toBe(0)
  })
})
