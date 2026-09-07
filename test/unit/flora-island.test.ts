import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import {
  createFloraBuffer, createIslandFlora, islandCanopyCover, FloraKind, FLORA_STRIDE,
  ISLAND_GRID,
} from '../../src/render/flora'
import { BUSH_R, CONE_CROWN_R } from '../../src/render/floraShapes'
import { createArchipelago, type IslandDesc } from '../../src/world/archipelago'
import { isGrass, shade } from '../../src/render/island'

const arch = createArchipelago()
const source = createIslandFlora(arch.field, arch.islands)
const height = (x: number, z: number): number => arch.field.sample(x, z)
const BUF = createFloraBuffer(65536)
const col = new Color()

/** 標稱半徑最大的那一座 */
const big: IslandDesc = [...arch.islands].sort((a, b) => b.radius - a.radius)[0]!

interface Row { x: number; y: number; z: number; kind: number; scale: number }

function collect(x0: number, z0: number, x1: number, z1: number): Row[] {
  BUF.count = 0
  BUF.dropped = 0
  source(x0, z0, x1, z1, height, BUF)
  expect(BUF.dropped).toBe(0)
  const out: Row[] = []
  for (let i = 0; i < BUF.count; i++) {
    const o = i * FLORA_STRIDE
    out.push({
      x: BUF.data[o]!, y: BUF.data[o + 1]!, z: BUF.data[o + 2]!, kind: BUF.kind[i]!,
      scale: BUF.data[o + 4]!,
    })
  }
  return out
}

const key = (r: Row): string => [r.x, r.y, r.z, r.kind].join(',')

/** 這個點最近的那座島 */
function nearest(x: number, z: number): IslandDesc {
  let best = arch.islands[0]!
  let bd = Infinity
  for (const isl of arch.islands) {
    const d = Math.hypot(isl.cx - x, isl.cz - z)
    if (d < bd) { bd = d; best = isl }
  }
  return best
}

function onBig(): Row[] {
  const r = big.outerRadius
  return collect(big.cx - r, big.cz - r, big.cx + r, big.cz + r)
}

describe('群島的樹', () => {
  /** 【不得是空操作】沒有這一條，一個永遠回零的來源可以通過下面每一條 */
  it('最大的那座島上樹夠多', () => {
    const rows = onBig()
    console.log(JSON.stringify({
      島半徑: big.radius.toFixed(0) + ' m',
      峰高: big.peak.toFixed(0) + ' m',
      棵數: rows.length,
    }))
    expect(rows.length).toBeGreaterThan(300)
  })

  it('每一棵都長在綠色的地方', () => {
    const rows = onBig()
    expect(rows.length).toBeGreaterThan(300)
    const grassHex = shade(20, 0, col).getHex()
    for (const r of rows) {
      const h = height(r.x, r.z)
      expect(isGrass(h)).toBe(true)
      // 判準與**畫面上那一支**對得起來，不只是與自己的常數對得起來
      expect(shade(h, 0, col).getHex()).toBe(grassHex)
    }
  })

  /**
   * 【這一條擋的是拿錯 SHORE_BAND】`world/archipelago.ts` 也有一個同名常數，
   * 值是 200。錯用它當下界的話，生出來的樹只是 `isGrass` 真集合的子集 ——
   * 上面那一條照樣全綠，而 12～200 m 的大片綠帶會整片光禿。
   */
  it('12 到 200 m 的草帶確實有樹', () => {
    const rows = onBig()
    const band = rows.filter((r) => {
      const h = height(r.x, r.z)
      return h >= 12 && h < 200
    })
    console.log(JSON.stringify({ 全部: rows.length, 在12到200之間: band.length }))
    expect(band.length).toBeGreaterThan(150)
  })

  it('沒有一棵在海裡', () => {
    const rows = onBig()
    expect(rows.length).toBeGreaterThan(300)
    for (const r of rows) expect(height(r.x, r.z)).toBeGreaterThan(0)
  })

  it('每一棵都站在地上', () => {
    const rows = onBig()
    expect(rows.length).toBeGreaterThan(300)
    for (const r of rows) expect(r.y).toBeCloseTo(height(r.x, r.z), 3)
  })

  /**
   * 【一定要控制高度】密度同時吃坡度與高度，而島上「陡」與「高」高度相關
   * ——不控制的話兩項互相抵銷，實測比值正好是 1.00，坡度那一項整條拿掉也
   * 看不出來。所以只在同一條高度帶（峰高的 25%～60%）裡比。
   */
  it('同一條高度帶裡，陡的地方比緩的地方稀疏', () => {
    const r = big.outerRadius
    const rows = onBig()
    expect(rows.length).toBeGreaterThan(300)
    // 島上可以長樹的地方，按坡度分兩堆，各自量「有樹的比例」
    const cell = arch.field.cell
    const slopeAt = (x: number, z: number): number => {
      const dx = (height(x + cell, z) - height(x - cell, z)) / (2 * cell)
      const dz = (height(x, z + cell) - height(x, z - cell)) / (2 * cell)
      return Math.atan(Math.hypot(dx, dz))
    }
    const inBand = (x: number, z: number): boolean => {
      const h = height(x, z)
      if (!isGrass(h)) return false
      const t = h / nearest(x, z).peak
      return t >= 0.25 && t < 0.6
    }
    let gentleArea = 0
    let steepArea = 0
    const STEP = 20
    for (let z = big.cz - r; z < big.cz + r; z += STEP) {
      for (let x = big.cx - r; x < big.cx + r; x += STEP) {
        if (!inBand(x, z)) continue
        if (slopeAt(x, z) < Math.PI / 6) gentleArea++
        else steepArea++
      }
    }
    let gentle = 0
    let steep = 0
    for (const row of rows) {
      if (!inBand(row.x, row.z)) continue
      if (slopeAt(row.x, row.z) < Math.PI / 6) gentle++
      else steep++
    }
    const gd = gentle / gentleArea
    const sd = steep / steepArea
    console.log(JSON.stringify({
      緩坡密度: gd.toFixed(4), 陡坡密度: sd.toFixed(4), 比: (sd / gd).toFixed(2),
    }))
    expect(gentleArea).toBeGreaterThan(100)
    expect(steepArea).toBeGreaterThan(100)
    expect(sd).toBeLessThan(gd * 0.92)
  })


  /**
   * 【分子與分母都要是「聯集」，不是「面積相加」】樹冠會互相重疊：名目強度
   * 0.35 的實際遮蔽只有 `1 − e^(−0.35) ≈ 0.295`，少了五個半百分點。兩邊都用
   * 相加的話會同時高估，這一條再寬也抓不到重疊 —— 而抓重疊正是它存在的理由。
   *
   * 所以實測走佔據柵格：把大島切成 2 m 的格，每一株把自己的圓蓋上去，重疊
   * 只算一次。
   */
  it('覆蓋率與柵格量到的實際遮蔽對得起來', () => {
    const coverAt = islandCanopyCover(arch.field, arch.islands)
    const rows = onBig()
    const CELL = 2
    const r = big.outerRadius
    const n = Math.ceil((2 * r) / CELL)
    const hit = new Uint8Array(n * n)
    for (const row of rows) {
      const rad = (row.kind === FloraKind.Bush ? BUSH_R : CONE_CROWN_R) * row.scale
      const gx = (row.x - (big.cx - r)) / CELL
      const gz = (row.z - (big.cz - r)) / CELL
      const gr = rad / CELL
      const a0 = Math.max(0, Math.floor(gx - gr))
      const a1 = Math.min(n - 1, Math.ceil(gx + gr))
      const b0 = Math.max(0, Math.floor(gz - gr))
      const b1 = Math.min(n - 1, Math.ceil(gz + gr))
      for (let b = b0; b <= b1; b++) {
        for (let a = a0; a <= a1; a++) {
          const dx = a + 0.5 - gx
          const dz = b + 0.5 - gz
          if (dx * dx + dz * dz <= gr * gr) hit[b * n + a] = 1
        }
      }
    }
    // 【只在可以長樹的地上比】否則分母混進沙灘與海
    //
    // 【而且要分高度帶】全島平均只有 17% 的覆蓋率，那個密度下「聯集」與
    // 「面積相加」只差 7.6% —— 一條全島的斷言分辨不出兩個模型，把 `1 − e^(−λ)`
    // 改回 `min(1, λ)` 照樣全綠。山頂那一帶密得多，兩者才真的分岔。
    const covered = [0, 0, 0]
    const usable = [0, 0, 0]
    const predicted = [0, 0, 0]
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const x = big.cx - r + (a + 0.5) * CELL
        const z = big.cz - r + (b + 0.5) * CELL
        const h = height(x, z)
        if (!isGrass(h)) continue
        const t = h / nearest(x, z).peak
        const band = t >= 0.6 ? 2 : t < 0.25 ? 0 : 1
        usable[band]!++
        covered[band]! += hit[b * n + a]!
        predicted[band]! += coverAt(x, z)
      }
    }
    const label = ['山腳', '中段', '山頂']
    const model: number[] = []
    const actual: number[] = []
    for (let k = 0; k < 3; k++) {
      model.push(predicted[k]! / usable[k]!)
      actual.push(covered[k]! / usable[k]!)
      console.log(JSON.stringify({
        帶: label[k], 模型: model[k]!.toFixed(4), 柵格: actual[k]!.toFixed(4),
        誤差: (((model[k]! - actual[k]!) / actual[k]!) * 100).toFixed(1) + '%',
      }))
    }
    expect(usable[0]! + usable[1]! + usable[2]!).toBeGreaterThan(100000)
    // 【山頂那一帶是這條測試的重點】相加的模型在這裡會高估一成以上
    expect(actual[2]!).toBeGreaterThan(0.2)
    expect(model[2]!).toBeGreaterThan(actual[2]! * 0.92)
    expect(model[2]!).toBeLessThan(actual[2]! * 1.08)
    // 其餘兩帶只要不離譜
    for (const k of [0, 1]) {
      expect(model[k]!).toBeGreaterThan(actual[k]! * 0.85)
      expect(model[k]!).toBeLessThan(actual[k]! * 1.15)
    }
  })

  it('沙灘與海上的覆蓋率是 0', () => {
    const coverAt = islandCanopyCover(arch.field, arch.islands)
    expect(coverAt(big.cx + big.outerRadius * 3, big.cz)).toBe(0)
  })

  it('全是海的那一格回 0 筆', () => {
    // 場地一角，離任何一座島都很遠
    const rows = collect(19000, 19000, 19250, 19250)
    expect(rows.length).toBe(0)
  })

  it('分割等價：大矩形 ≡ 切成 4 × 4 之後的聯集', () => {
    const r = big.outerRadius
    const whole = onBig().map(key).sort()
    const parts: string[] = []
    const w = (2 * r) / 4
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        parts.push(...collect(
          big.cx - r + w * i, big.cz - r + w * j,
          big.cx - r + w * (i + 1), big.cz - r + w * (j + 1),
        ).map(key))
      }
    }
    expect(whole.length).toBeGreaterThan(300)
    expect(parts.sort()).toEqual(whole)
  })

  it('每一棵都落在自己那一格裡', () => {
    let n = 0
    const r = big.outerRadius
    for (let tz = big.cz - r; tz < big.cz + r; tz += 250) {
      for (let tx = big.cx - r; tx < big.cx + r; tx += 250) {
        for (const row of collect(tx, tz, tx + 250, tz + 250)) {
          expect(row.x).toBeGreaterThanOrEqual(tx)
          expect(row.x).toBeLessThan(tx + 250)
          expect(row.z).toBeGreaterThanOrEqual(tz)
          expect(row.z).toBeLessThan(tz + 250)
          n++
        }
      }
    }
    expect(n).toBeGreaterThan(300)
  })

  it('島上只有針葉樹與灌木，不長闊葉或房子', () => {
    const rows = onBig()
    expect(rows.length).toBeGreaterThan(300)
    for (const r of rows) {
      expect(r.kind === FloraKind.ConeTree || r.kind === FloraKind.Bush).toBe(true)
    }
  })

  /** 【不得是空操作】灌木那一段整段拿掉的話，上面那一條照樣全綠 */
  it('灌木夠多，但沒有多過樹', () => {
    const rows = onBig()
    const trees = rows.filter((r) => r.kind === FloraKind.ConeTree).length
    const bushes = rows.filter((r) => r.kind === FloraKind.Bush).length
    console.log(JSON.stringify({ 樹: trees, 灌木: bushes, 比: (bushes / trees).toFixed(2) }))
    expect(bushes).toBeGreaterThan(trees * 0.4)
    expect(bushes).toBeLessThan(trees)
  })

  /**
   * 【山頂密、山腳疏】按高度分兩帶，各自量「單位可用面積上有幾株」。
   *
   * 分母一定要是**那一帶自己的可用面積** —— 直接比株數的話，量到的是兩帶
   * 面積大小的差別，把密度那條斜線整條拿掉也會過。
   *
   * 【坡度是共變數】陡的地方本來就稀疏，而山頂通常比山腳陡 —— 也就是說
   * 坡度那一項會把這個效果**抵銷**，不會假造它。實測仍有三倍以上。
   */
  it('山頂比山腳密', () => {
    const r = big.outerRadius
    const rows = onBig()
    const band = (x: number, z: number): number => {
      const t = height(x, z) / nearest(x, z).peak
      return t >= 0.6 ? 1 : t < 0.25 ? 0 : -1
    }
    const area = [0, 0]
    const STEP = 20
    for (let z = big.cz - r; z < big.cz + r; z += STEP) {
      for (let x = big.cx - r; x < big.cx + r; x += STEP) {
        if (!isGrass(height(x, z))) continue
        const b = band(x, z)
        if (b >= 0) area[b]!++
      }
    }
    const n = [0, 0]
    for (const row of rows) {
      const b = band(row.x, row.z)
      if (b >= 0) n[b]!++
    }
    const low = n[0]! / area[0]!
    const high = n[1]! / area[1]!
    console.log(JSON.stringify({
      山腳密度: low.toFixed(4), 山頂密度: high.toFixed(4), 比: (high / low).toFixed(2),
    }))
    expect(area[0]!).toBeGreaterThan(100)
    expect(area[1]!).toBeGreaterThan(100)
    expect(high).toBeGreaterThan(low * 2)
  })

  /**
   * 【樹要成叢】逐格獨立的 Bernoulli 抽樣鋪出來的是均勻的絨毛。把島切成
   * 100 m 的格數樹，獨立抽樣下每格的株數是二項分佈，變異數／平均
   * （離散指數）恆小於 1；成叢的話有的格滿、有的格空，離散指數遠大於 1。
   *
   * 【只在同一條高度帶裡量】高度那條斜線本身也會讓格與格不同，山頂與
   * 山腳混在一起量到的是斜線不是叢。
   *
   * 【殺得死】`islandAccept` 拿掉 `islandClump` 那一項就回到獨立抽樣，
   * 指數掉到 1 以下。
   */
  it('同一條高度帶裡，樹是一叢一叢的 —— 每百公尺格株數的離散指數遠大於 1', () => {
    const r = big.outerRadius
    const rows = onBig()
    const CELL = 100
    const n = Math.ceil((2 * r) / CELL)
    const counts = new Float64Array(n * n)
    const inBand = (x: number, z: number): boolean => {
      const h = height(x, z)
      if (!isGrass(h)) return false
      const t = h / nearest(x, z).peak
      return t >= 0.25 && t < 0.6
    }
    for (const row of rows) {
      if (row.kind !== FloraKind.ConeTree || !inBand(row.x, row.z)) continue
      const a = Math.floor((row.x - (big.cx - r)) / CELL)
      const b = Math.floor((row.z - (big.cz - r)) / CELL)
      counts[b * n + a]!++
    }
    // 只算整格都在帶內的格：邊緣格一半是海，株數低是幾何不是叢
    const used: number[] = []
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const x0 = big.cx - r + a * CELL
        const z0 = big.cz - r + b * CELL
        let inside = true
        for (let k = 0; k < 9 && inside; k++) {
          inside = inBand(x0 + (k % 3) * (CELL / 2), z0 + Math.floor(k / 3) * (CELL / 2))
        }
        if (inside) used.push(counts[b * n + a]!)
      }
    }
    const mean = used.reduce((s, v) => s + v, 0) / used.length
    const variance = used.reduce((s, v) => s + (v - mean) ** 2, 0) / used.length
    const dispersion = variance / mean
    console.log(JSON.stringify({
      格數: used.length, 平均株數: mean.toFixed(1), 離散指數: dispersion.toFixed(2),
    }))
    expect(used.length).toBeGreaterThan(30)
    expect(mean).toBeGreaterThan(5)
    expect(dispersion).toBeGreaterThan(3)
  })

  /** 一格最多一棵樹加一叢灌木，所以上限要各自比 */
  it('樹與灌木各自的密度都不超過網格上限', () => {
    const rows = onBig()
    const area = (2 * big.outerRadius) ** 2
    const grid = 1e6 / (ISLAND_GRID * ISLAND_GRID)
    for (const [label, kind] of [
      ['樹', FloraKind.ConeTree], ['灌木', FloraKind.Bush],
    ] as const) {
      const perKm2 = (rows.filter((r) => r.kind === kind).length / area) * 1e6
      console.log(JSON.stringify({
        種類: label, 每平方公里: perKm2.toFixed(0), 網格上限: grid.toFixed(0),
      }))
      expect(perKm2).toBeLessThan(grid)
    }
  })
})
