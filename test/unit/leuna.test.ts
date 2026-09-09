import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  type BlockKind,
  createLeuna, EGRESS, FLAK_SITES, LANE_WIDTH, LEUNA_HILLS, PAD_CLEARANCE, PLANT_BLOCKS,
  PLANT_CENTER, PLANT_LAYOUT, PLANT_PAD, plantToWorld, RAILS, ROADS, worldToPlant,
} from '../../src/world/leuna'
import { FARM_CELL, HILL_GAP, HILL_LIMIT, HILL_PEAK_MAX } from '../../src/world/farmland'
import { WOBBLE_MAX } from '../../src/world/archipelago'

/** 兩條線段有沒有真的交叉。共線當作沒交叉 —— 河與路平行走一段不是過河 */
function crosses(
  a: { x: number; z: number }, b: { x: number; z: number },
  c: readonly [number, number], d: readonly [number, number],
): boolean {
  const rx = b.x - a.x
  const rz = b.z - a.z
  const sx = d[0] - c[0]
  const sz = d[1] - c[1]
  const den = rx * sz - rz * sx
  if (Math.abs(den) < 1e-9) return false
  const t = ((c[0] - a.x) * sz - (c[1] - a.z) * sx) / den
  const u = ((c[0] - a.x) * rz - (c[1] - a.z) * rx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

/** 圓心到墊面矩形的最近距離。**先轉進廠區局部座標** —— 墊面不是軸對齊的 */
const LOCAL = { x: 0, z: 0 }
function padDistance(cx: number, cz: number): number {
  worldToPlant(cx, cz, LOCAL)
  const dx = Math.max(0, Math.abs(LOCAL.x) - PLANT_PAD.halfX)
  const dz = Math.max(0, Math.abs(LOCAL.z) - PLANT_PAD.halfZ)
  return Math.hypot(dx, dz)
}

describe('leuna 地形', () => {
  const { field, hills } = createLeuna()

  /**
   * 【量的是幾何距離，不是墊面內的高度】只量高度的話，丘陵挪到離墊面
   * 100 m 還是綠的 —— 它還沒碰到墊面，但 clearance 已經沒了。
   */
  it('每一顆丘陵的膨脹圓離墊面至少 PAD_CLEARANCE', () => {
    for (const h of hills) {
      expect(padDistance(h.cx, h.cz) - h.outerRadius, `${h.cx},${h.cz}`)
        .toBeGreaterThanOrEqual(PAD_CLEARANCE)
    }
  })

  it('墊面加一格圍裙內每一格都是 0', () => {
    const apron = FARM_CELL
    const x0 = PLANT_CENTER.x - PLANT_PAD.halfX - apron
    const x1 = PLANT_CENTER.x + PLANT_PAD.halfX + apron
    const z0 = PLANT_CENTER.z - PLANT_PAD.halfZ - apron
    const z1 = PLANT_CENTER.z + PLANT_PAD.halfZ + apron
    for (let x = x0; x <= x1; x += FARM_CELL / 2) {
      for (let z = z0; z <= z1; z += FARM_CELL / 2) {
        expect(field.sample(x, z), `${x},${z}`).toBe(0)
      }
    }
  })

  it('outerRadius 由 radius × WOBBLE_MAX 推出', () => {
    for (const h of hills) expect(h.outerRadius).toBeCloseTo(h.radius * WOBBLE_MAX, 9)
  })

  it('丘陵都在 HILL_LIMIT 之內，最近的一對至少 HILL_GAP', () => {
    let closest = Infinity
    for (let i = 0; i < hills.length; i++) {
      const a = hills[i]!
      expect(Math.hypot(a.cx, a.cz) + a.outerRadius, `${a.cx},${a.cz}`).toBeLessThanOrEqual(HILL_LIMIT)
      for (let j = i + 1; j < hills.length; j++) {
        const b = hills[j]!
        const gap = Math.hypot(a.cx - b.cx, a.cz - b.cz) - a.outerRadius - b.outerRadius
        if (gap < closest) closest = gap
      }
    }
    expect(closest).toBeGreaterThanOrEqual(HILL_GAP)
  })

  it('峰不超過 HILL_PEAK_MAX、沒有一格是負的、真的有起伏', () => {
    let top = 0
    for (const v of field.data) {
      expect(v).toBeGreaterThanOrEqual(0)
      if (v > top) top = v
    }
    expect(top).toBeLessThanOrEqual(HILL_PEAK_MAX)
    expect(top).toBeGreaterThan(30)
  })

  it('手擺的清單就是場上的丘陵，而且決定性', () => {
    expect(hills.length).toBe(LEUNA_HILLS.length)
    const again = createLeuna()
    expect(Array.from(again.field.data)).toEqual(Array.from(field.data))
  })

  it('12 座構件在墊面內、8 座砲位在墊面外', () => {
    expect(PLANT_LAYOUT).toHaveLength(12)
    for (const p of PLANT_LAYOUT) {
      expect(Math.abs(p.dx)).toBeLessThanOrEqual(PLANT_PAD.halfX - 40)
      expect(Math.abs(p.dz)).toBeLessThanOrEqual(PLANT_PAD.halfZ - 40)
    }
    expect(FLAK_SITES).toHaveLength(8)
    for (const s of FLAK_SITES) expect(padDistance(s.x, s.z)).toBeGreaterThan(800)
  })
})

describe('leuna 的佈局常數', () => {
  it('預定砲位環繞廠區 2.4 到 3.3 km', () => {
    for (const s of FLAK_SITES) {
      const d = Math.hypot(s.x - PLANT_CENTER.x, s.z - PLANT_CENTER.z)
      expect(d, `${s.x},${s.z}`).toBeGreaterThanOrEqual(2400)
      expect(d, `${s.x},${s.z}`).toBeLessThanOrEqual(3300)
    }
  })

  it('脫離方向是 −Z：投完繼續往前，不回頭', () => {
    expect(EGRESS.z).toBeLessThan(0)
    expect(EGRESS.x).toBe(0)
  })
})

describe('leuna 的廠區', () => {
  /**
   * 【長軸一定要是 Z】真實的洛伊納沿薩勒河西岸南北延伸。轉成東西向的話它在
   * 航照上就是另一座工廠，而且投彈航路（朝 −Z）穿過廠區只剩一半的時間。
   */
  it('墊面是 1.5 × 3 km，長軸南北', () => {
    expect(PLANT_PAD.halfX * 2).toBe(1500)
    expect(PLANT_PAD.halfZ * 2).toBe(3000)
    expect(PLANT_PAD.halfZ).toBeGreaterThan(PLANT_PAD.halfX)
  })

  /**
   * 【長軸往西偏 12.5 度】實測值：OSM 上 Chemiestandort Leuna 三塊廠區，各自
   * 量落在自己範圍內的鐵路方位分佈，峰值都在 −15…−10°。
   *
   * 【往東偏是錯的】符號寫反的話廠區與薩勒河的夾角變成兩倍，而畫面上只是
   * 「工廠有點斜」—— 看不出方向反了。北端要往**西**移。
   */
  it('廠區長軸相對正北往西偏 10 到 15 度', () => {
    const north = { x: 0, z: 0 }
    plantToWorld(0, -PLANT_PAD.halfZ, north)
    const deg = (Math.atan2(north.x - PLANT_CENTER.x, PLANT_CENTER.z - north.z) * 180) / Math.PI
    expect(deg, `北端偏了 ${deg.toFixed(1)}°`).toBeLessThan(-10)
    expect(deg).toBeGreaterThan(-15)
    expect(north.x).toBeLessThan(PLANT_CENTER.x)
  })

  /** 兩支轉換必須互為反函式 —— 分家的話墊面與佈景會差一整個廠區的位移 */
  it('plantToWorld 與 worldToPlant 是一對', () => {
    const w = { x: 0, z: 0 }
    const l = { x: 0, z: 0 }
    for (const [dx, dz] of [[0, 0], [750, 1500], [-750, -1500], [123, -456]] as const) {
      plantToWorld(dx, dz, w)
      worldToPlant(w.x, w.z, l)
      expect(l.x).toBeCloseTo(dx, 6)
      expect(l.z).toBeCloseTo(dz, 6)
    }
  })

  /**
   * 【鐵路骨幹貫穿廠區，兩端接出去】合成油廠的煤、氫與成品油全部靠軌道
   * 進出。骨幹只到廠界就停的話，那些調車場是接不到任何地方的死路。
   */
  it('鐵路骨幹貫穿墊面而且兩端都出圖', () => {
    const line = RAILS[0]!
    // 【容 1 m】兩個門就在墊面邊上，而它們是旋轉算出來的
    const inside = line.filter((p) => padDistance(p.x, p.z) < 1)
    expect(inside.length, '骨幹沒有進墊面').toBeGreaterThanOrEqual(2)
    const offMap = (p: { x: number; z: number }): boolean =>
      Math.abs(p.x) >= 14000 || Math.abs(p.z) >= 14000
    expect(offMap(line[0]!), '北端沒有出圖').toBe(true)
    expect(offMap(line[line.length - 1]!), '南端沒有出圖').toBe(true)
    // 【要留在薩勒河的西岸】河在廠區以東 3.2 km
    expect(Math.max(...line.map((p) => p.x))).toBeLessThan(2000)
  })

  /**
   * 【調車場要貼著骨幹】它們是骨幹沿線鼓起來的股道群。離骨幹遠的話那些
   * 股道接不到主線 —— 畫面上只是「廠區裡有一塊鋪滿軌道的地」。
   */
  it('每一塊調車場都貼著鐵路骨幹', () => {
    const yards = PLANT_BLOCKS.filter((b) => b.kind === 'railyard')
    expect(yards.length).toBeGreaterThanOrEqual(2)
    // 街廓是廠區局部座標、骨幹是世界座標 —— 轉到同一個系再比
    const rail = RAILS[0]!.map((p) => {
      const q = { x: 0, z: 0 }
      worldToPlant(p.x, p.z, q)
      return q
    })
    for (const b of yards) {
      const near = rail.some((p) => p.x >= b.x0 - 40 && p.x <= b.x1 + 40
        && p.z >= b.z0 - 600 && p.z <= b.z1 + 600)
      expect(near, `調車場 ${b.seed} 離骨幹太遠`).toBe(true)
    }
  })

  /**
   * 【機能要相符】氫化塔進製程區、鍋爐房與冷卻塔進公用區、儲油槽進儲槽區。
   * 街廓表改過幾輪，構件沒跟著挪的症狀是「反應塔站在一圈土堤圍起來的儲槽
   * 中間」—— 玩得起來，但一眼看得出是兩套東西擺在一起。
   */
  it('每一座構件都在機能相符的街廓裡，沒有一座落在巷道上', () => {
    const want: Record<string, readonly BlockKind[]> = {
      hydroTower: ['process'], chimney: ['utility', 'process'],
      boilerHouse: ['utility'], coolingTower: ['utility'],
      gasHolder: ['utility'], oilTank: ['tankFarm'],
    }
    for (const t of PLANT_LAYOUT) {
      // 構件的 dx/dz 與街廓都已經是廠區局部座標
      const b = PLANT_BLOCKS.find(
        (k) => t.dx >= k.x0 && t.dx < k.x1 && t.dz >= k.z0 && t.dz < k.z1)
      expect(b, `${t.kind} (${t.dx}, ${t.dz}) 落在巷道上`).toBeDefined()
      expect(want[t.kind], `${t.kind} 沒有登記機能`).toBeDefined()
      expect(want[t.kind]!, `${t.kind} (${t.dx}, ${t.dz}) 在 ${b!.kind} 街廓裡`)
        .toContain(b!.kind)
    }
  })

  /**
   * 【四群各三座】一趟對準的投彈帶得走一群，四群要飛四趟，而過關只要六座。
   * 全部擠成一堆的話一趟就結束，散成十二處的話飛不完 —— 兩邊都是這一關
   * 不要的節奏。
   */
  it('分成四群，群內間距不到 200 m、群與群相隔 500 m 以上', () => {
    const rest = PLANT_LAYOUT.map((p) => ({ x: p.dx, z: p.dz }))
    const groups: { x: number; z: number }[][] = []
    while (rest.length > 0) {
      const g = [rest.shift()!]
      for (let grew = true; grew;) {
        grew = false
        for (let i = rest.length - 1; i >= 0; i--) {
          if (!g.some((m) => Math.hypot(m.x - rest[i]!.x, m.z - rest[i]!.z) < 200)) continue
          g.push(...rest.splice(i, 1))
          grew = true
        }
      }
      groups.push(g)
    }
    expect(groups.length, `分成 ${groups.length} 群`).toBe(4)
    for (const g of groups) expect(g.length).toBe(3)
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        let best = Infinity
        for (const a of groups[i]!) {
          for (const b of groups[j]!) best = Math.min(best, Math.hypot(a.x - b.x, a.z - b.z))
        }
        expect(best, `第 ${i} 群與第 ${j} 群只隔 ${best.toFixed(0)} m`).toBeGreaterThan(500)
      }
    }
  })

  it('道路從墊面邊接到地圖邊緣', () => {
    const reachesEdge = ROADS.some((r) => r.some((p) => Math.abs(p.x) >= 14000 || Math.abs(p.z) >= 14000))
    const touchesPad = ROADS.some((r) => r.some((p) => padDistance(p.x, p.z) === 0))
    expect(reachesEdge).toBe(true)
    expect(touchesPad).toBe(true)
  })

  /**
   * 【連外的線一條都不准跨薩勒河】道路與鐵路是地面著色器畫的色帶，河的水面
   * 是一片蓋在地上的網格 —— 跨過去的那一段不是橋，是一條淹在水裡的路。
   *
   * 【廠區被河從東、北、南三面繞著】所以連外線全部往西展開。要往南或往東
   * 拉一條新的線，先跑這一條看它要不要橋。
   *
   * 河的折線只有實測高程展示區在用（`tools/leunaRiver.ts`），但佈局得照著
   * 它擺，否則河一進遊戲全部要重畫。
   */
  it('連外的道路與鐵路都不跨河', () => {
    const data = JSON.parse(
      new TextDecoder().decode(readFileSync('public/data/leuna-rivers.json')),
    ) as { rivers: { name: string; points: [number, number][] }[] }
    for (const [tag, lines] of [['道路', ROADS], ['鐵路', RAILS]] as const) {
      for (const line of lines) {
        for (let i = 0; i + 1 < line.length; i++) {
          for (const river of data.rivers) {
            for (let j = 0; j + 1 < river.points.length; j++) {
              const hit = crosses(line[i]!, line[i + 1]!, river.points[j]!, river.points[j + 1]!)
              expect(hit, `${tag} (${line[i]!.x},${line[i]!.z})→(${line[i + 1]!.x},`
                + `${line[i + 1]!.z}) 跨過 ${river.name}`).toBe(false)
            }
          }
        }
      }
    }
  })
})

/**
 * 街廓是佈景填充的單位：巷道格線切出來，每一格掛一個機能標籤。填充器
 * （`render/geometry/ground/plantFill.ts`）只認這張表。
 */
describe('廠區的街廓', () => {
  it('二十幾個街廓，全部在墊面內，互不重疊', () => {
    // 七欄四列＝二十八格，扣掉調車場那一對合併之後是二十七個
    expect(PLANT_BLOCKS.length).toBeGreaterThanOrEqual(24)
    expect(PLANT_BLOCKS.length).toBeLessThanOrEqual(28)
    // 街廓是廠區局部座標，墊面在那個系裡就是 ±half
    const x0 = -PLANT_PAD.halfX
    const x1 = PLANT_PAD.halfX
    const z0 = -PLANT_PAD.halfZ
    const z1 = PLANT_PAD.halfZ
    for (const b of PLANT_BLOCKS) {
      expect(b.x0).toBeGreaterThanOrEqual(x0)
      expect(b.x1).toBeLessThanOrEqual(x1)
      expect(b.z0).toBeGreaterThanOrEqual(z0)
      expect(b.z1).toBeLessThanOrEqual(z1)
      expect(b.x1 - b.x0).toBeGreaterThan(100)
      expect(b.z1 - b.z0).toBeGreaterThan(100)
    }
    for (let i = 0; i < PLANT_BLOCKS.length; i++) {
      for (let j = i + 1; j < PLANT_BLOCKS.length; j++) {
        const a = PLANT_BLOCKS[i]!
        const b = PLANT_BLOCKS[j]!
        const apart = a.x1 <= b.x0 || b.x1 <= a.x0 || a.z1 <= b.z0 || b.z1 <= a.z0
        expect(apart, `街廓 ${i} 與 ${j} 重疊`).toBe(true)
      }
    }
  })

  /**
   * 【為什麼要驗這一條】巷道是格線退出來的。退錯邊（減成加）街廓會壓在
   * 巷道上，而畫面上只是「東西擺得比較滿」，看不出錯。
   *
   * 巷寬因街廓而異（每一條都同寬的話，白邊自己會排成一張格線），所以量的
   * 是區間不是定值。
   */
  it('任兩個街廓之間都留得下一條巷', () => {
    let closest = Infinity
    let widest = 0
    for (let i = 0; i < PLANT_BLOCKS.length; i++) {
      for (let j = i + 1; j < PLANT_BLOCKS.length; j++) {
        const a = PLANT_BLOCKS[i]!
        const b = PLANT_BLOCKS[j]!
        // 只看真正面對面的那一對：另一軸要有重疊
        const zOverlap = a.z0 < b.z1 && b.z0 < a.z1
        const xOverlap = a.x0 < b.x1 && b.x0 < a.x1
        if (zOverlap) {
          const gap = a.x0 >= b.x1 ? a.x0 - b.x1 : b.x0 >= a.x1 ? b.x0 - a.x1 : Infinity
          if (gap < closest) closest = gap
          if (gap !== Infinity && gap > widest) widest = gap
        }
        if (xOverlap) {
          const gap = a.z0 >= b.z1 ? a.z0 - b.z1 : b.z0 >= a.z1 ? b.z0 - a.z1 : Infinity
          if (gap < closest) closest = gap
          if (gap !== Infinity && gap > widest) widest = gap
        }
      }
    }
    expect(closest, `最窄的巷只有 ${closest.toFixed(1)} m`).toBeGreaterThanOrEqual(LANE_WIDTH * 0.6)
    expect(closest).toBeLessThanOrEqual(LANE_WIDTH * 1.5)
    // 【寬窄要真的不一樣】全部同寬的話這一條會退化成上面那一條
    expect(widest - closest, '每一條巷都一樣寬').toBeGreaterThan(2)
  })

  it('每一座可炸構件都落在某個街廓內，而且那個街廓不是 open', () => {
    for (const p of PLANT_LAYOUT) {
      const b = PLANT_BLOCKS.find(
        (k) => p.dx >= k.x0 && p.dx < k.x1 && p.dz >= k.z0 && p.dz < k.z1)
      expect(b, `構件 ${p.kind} (${p.dx},${p.dz}) 掉在巷道或街廓外`).toBeDefined()
      expect(b!.kind, `構件 ${p.kind} 落在 open 街廓`).not.toBe('open')
    }
  })

  it('機能配比：open 不超過 4 個，六種機能都有人用，種子互不相同', () => {
    expect(PLANT_BLOCKS.filter((b) => b.kind === 'open').length).toBeLessThanOrEqual(4)
    expect(new Set(PLANT_BLOCKS.map((b) => b.kind)).size).toBe(6)
    expect(new Set(PLANT_BLOCKS.map((b) => b.seed)).size).toBe(PLANT_BLOCKS.length)
  })

  /**
   * 【同機能不能連成一大片】相鄰同機能會被 `mergePlan` 併成一塊，而併出來的
   * 大方塊從投彈高度看下去就是「那一整區都是油槽」。一格約 350 × 370 m，
   * 兩格就超過 21 萬 m²。
   *
   * **調車場是例外**：它要接得到外面的鐵路，沿南緣併成一條長場才合理。
   */
  it('除了調車場，沒有一個街廓大到兩格', () => {
    for (const b of PLANT_BLOCKS) {
      const area = (b.x1 - b.x0) * (b.z1 - b.z0)
      const cap = b.kind === 'railyard' ? 340_000 : 210_000
      expect(area, `${b.kind} ${b.seed} 佔 ${Math.round(area / 1000)} 千 m²`)
        .toBeLessThanOrEqual(cap)
    }
  })
})
