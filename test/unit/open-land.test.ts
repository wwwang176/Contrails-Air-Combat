import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import {
  fieldAt, fieldGlsl, FIELD_GLSL, FIELD_REACH, isOpenParcel, onTrack, openWoodCover, regionAt, REGION_SPACING,
  OPEN_CONIFER_SHARE, OPEN_DOT_AA, OPEN_DOT_REACH, OPEN_TREE_SCALE, OPEN_WOOD_CELL, OPEN_WOOD_DENSITY,
  OPEN_WOOD_GATE, OPEN_WOOD_NEAR_MARGIN,
  valueNoise, VILLAGE_CHANCE, villageDistance, fieldSurfaceColor, WOOD_GRID, type FieldSample, type RegionSample,
} from '../../src/render/fields'
import { BROAD_CROWN_R } from '../../src/render/floraShapes'
import {
  createFloraBuffer, farmHedgeFlora, farmWoodFlora, FLORA_STRIDE, FloraKind, openHedgeFlora, openWoodFlora,
  villageSite, type FloraSource,
} from '../../src/render/flora'

/**
 * # 田圍著村（`fields.ts` 的 `FIELD_REACH`）
 *
 * 程序生成的內陸地圖：田只在村的周圍，其餘是空地（牧草地、荒地、休耕）與成團
 * 的樹林。
 */

const REG: RegionSample = { r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0 }
const FLD: FieldSample = { id: 0, edge: 0, hedged: false, cx: 0, cz: 0 }
const parcel = (x: number, z: number): FieldSample => {
  regionAt(x, z, REG)
  fieldAt(x, z, REG, FLD)
  return FLD
}

describe('哪些地是空地', () => {
  /** 【一半上下】田太少的話整張圖是荒地；太多的話又回到一路是田 */
  it('空地佔三成五到七成五', () => {
    let open = 0
    let n = 0
    for (let x = -20000; x < 20000; x += 173) {
      for (let z = -20000; z < 20000; z += 191) {
        if (isOpenParcel(parcel(x, z))) open++
        n++
      }
    }
    expect(open / n).toBeGreaterThan(0.35)
    expect(open / n).toBeLessThan(0.75)
  })

  /** 【村旁一定是田、離村很遠一定是空地】範圍最小是 0.7 × 0.8 倍、最大 1.3 × 1.2 倍 */
  it('村旁 800 m 內一定是田；離村 2.4 km 外一定是空地', () => {
    let near = 0
    let far = 0
    for (let x = -20000; x < 20000; x += 97) {
      for (let z = -20000; z < 20000; z += 103) {
        const f = parcel(x, z)
        const d = villageDistance(f.cx, f.cz)
        if (d < FIELD_REACH * 0.7 * 0.8 - 1) {
          expect(isOpenParcel(f), `(${x},${z})`).toBe(false)
          near++
        } else if (d > FIELD_REACH * 1.3 * 1.2 + 1) {
          expect(isOpenParcel(f), `(${x},${z})`).toBe(true)
          far++
        }
      }
    }
    expect(near).toBeGreaterThan(1000)
    expect(far).toBeGreaterThan(1000)
  })

  /**
   * 【交界落在田界上】用地塊的中心判斷，所以同一塊地裡的每一點答案相同 —— 用
   * 每一點自己的位置判斷的話，交界會切過一塊田
   */
  it('同一塊地裡的每一點答案相同', () => {
    const byParcel = new Map<string, boolean>()
    for (let x = -8000; x < 8000; x += 37) {
      for (let z = -8000; z < 8000; z += 41) {
        const f = parcel(x, z)
        const key = `${f.id}:${f.cx.toFixed(3)}:${f.cz.toFixed(3)}`
        const o = isOpenParcel(f)
        const seen = byParcel.get(key)
        if (seen !== undefined) expect(o, key).toBe(seen)
        byParcel.set(key, o)
      }
    }
    expect(byParcel.size).toBeGreaterThan(1000)
  })

  /** 【站址與植被的村同一套】`villageSite` 生的每一個村，`villageDistance` 都量得到 */
  it('植被的村都在 villageDistance 找得到的站址上', () => {
    const out = { x: 0, z: 0 }
    let checked = 0
    for (let i = -6; i < 6; i++) {
      for (let j = -6; j < 6; j++) {
        if (!villageSite(i, j, out)) continue
        expect(villageDistance(out.x, out.z)).toBeLessThan(1e-6)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(144 * VILLAGE_CHANCE * 0.5)
    expect(REGION_SPACING).toBe(3200)
  })
})

describe('地色', () => {
  it('open 的空地沒有樹籬色也沒有作物色；不開時與原本逐位元相同', () => {
    const a = new Color()
    const b = new Color()
    let differ = 0
    for (let x = -12000; x < 12000; x += 131) {
      for (let z = -12000; z < 12000; z += 137) {
        fieldSurfaceColor(x, z, a, 'summer', false)
        fieldSurfaceColor(x, z, b, 'summer')
        expect(a.equals(b)).toBe(true)
        fieldSurfaceColor(x, z, b, 'summer', true)
        if (!a.equals(b)) differ++
      }
    }
    expect(differ).toBeGreaterThan(1000)
  })

  it('GLSL：不開時與原本逐字相同；開的那一份有同一組常數與判準', () => {
    expect(fieldGlsl('summer')).toBe(FIELD_GLSL)
    const open = fieldGlsl('summer', false, true)
    expect(open).toContain(`const float FIELD_REACH = ${FIELD_REACH.toFixed(1)};`)
    expect(open).toContain(`const float VILLAGE_CHANCE = ${VILLAGE_CHANCE.toFixed(3)};`)
    expect(open).toContain('bool isOpenParcel(vec2 centre, uint fh)')
    expect(open).toContain('if (isOpenParcel(parcel, fh)) {')
    // 【地塊中心轉差值】直接轉上萬公尺的座標，有的 GPU 差將近一公尺，與 CPU 判得不一樣
    expect(open).toContain('vec2 dq = pq - q;')
    expect(open).toContain('vec2 parcel = world + vec2(')
    // 空地在條紋之後、樹籬之前
    expect(open.indexOf('if (isOpenParcel(parcel, fh))')).toBeGreaterThan(open.indexOf('col *= stripe('))
    expect(open.indexOf('if (isOpenParcel(parcel, fh))')).toBeLessThan(open.indexOf('col = mix(col, mix(HEDGE_COLOR'))
  })
})

describe('樹籬與樹林', () => {
  const run = (src: FloraSource, x0: number, z0: number, size: number): { x: number; z: number }[] => {
    const buf = createFloraBuffer(200_000)
    src(x0, z0, x0 + size, z0 + size, () => 0, buf)
    expect(buf.dropped).toBe(0)
    const out: { x: number; z: number }[] = []
    for (let i = 0; i < buf.count; i++) out.push({ x: buf.data[i * FLORA_STRIDE]!, z: buf.data[i * FLORA_STRIDE + 2]! })
    return out
  }

  it('空地的邊不長樹籬；田那一側照長', () => {
    const all = run(farmHedgeFlora, -3000, -3000, 6000)
    const open = run(openHedgeFlora, -3000, -3000, 6000)
    expect(open.length).toBeLessThan(all.length * 0.8)
    expect(open.length).toBeGreaterThan(all.length * 0.15)
    for (const p of open) expect(isOpenParcel(parcel(p.x, p.z))).toBe(false)
  })

  /** 【放置與地色共用覆蓋率】空地上的樹只長在覆蓋率大於 0 的地方 */
  it('空地上的樹林跟著 openWoodCover，而且比原本的樹林多', () => {
    const before = run(farmWoodFlora, -6000, -6000, 12000)
    const after = run(openWoodFlora, -6000, -6000, 12000)
    expect(after.length).toBeGreaterThan(before.length * 1.5)
    let inOpen = 0
    for (const p of after) {
      if (!isOpenParcel(parcel(p.x, p.z))) continue
      inOpen++
      expect(openWoodCover(p.x, p.z)).toBeGreaterThan(0)
    }
    expect(inOpen).toBeGreaterThan(1000)
  })

  /**
   * 【遠圖的樹點與植被逐株相同】遠圖把空地的樹一棵一棵烘成點（GLSL 的
   * `openTreesOver`）。照那一段 GLSL 的式子用 JS 逐格算，與植被在空地上長的樹逐株
   * 比：位置、大小、樹種。對不上的話，點與 6 km 內冒出來的樹不在同一個地方
   */
  it('遠圖的空地樹點與植被逐株相同', () => {
    const x0 = -6000
    const z0 = -6000
    const x1 = 6000
    const z1 = 6000
    const buf = createFloraBuffer(400_000)
    openWoodFlora(x0, z0, x1, z1, () => 0, buf)
    const trees = new Map<string, { scale: number; kind: number }>()
    for (let i = 0; i < buf.count; i++) {
      const o = i * FLORA_STRIDE
      const x = buf.data[o]!
      const z = buf.data[o + 2]!
      if (!isOpenParcel(parcel(x, z))) continue
      trees.set(`${x.toFixed(2)},${z.toFixed(2)}`, { scale: buf.data[o + 4]!, kind: buf.kind[i]! })
    }
    let dots = 0
    for (let gz = Math.floor(z0 / WOOD_GRID); gz <= Math.floor(z1 / WOOD_GRID); gz++) {
      for (let gx = Math.floor(x0 / WOOD_GRID); gx <= Math.floor(x1 / WOOD_GRID); gx++) {
        const h = hash2(gx, gz)
        const g = hash1(h)
        const x = (gx + 0.15 + (h / 4294967296) * 0.7) * WOOD_GRID
        const z = (gz + 0.15 + (g / 4294967296) * 0.7) * WOOD_GRID
        if (x < x0 || x >= x1 || z < z0 || z >= z1) continue
        const g2 = hash1(g)
        const u = (g2 & 0xffff) / 65536
        if (u >= OPEN_WOOD_DENSITY || u >= openWoodCover(x, z) * OPEN_WOOD_DENSITY) continue
        // 點只畫在空地上；凹路上的點被凹路蓋掉（植被在凹路上不長）
        if (!isOpenParcel(parcel(x, z)) || onTrack(x, z, REG)) continue
        const g3 = hash1(g2)
        const scale = OPEN_TREE_SCALE[0] + ((g3 & 0xffff) / 65536) * (OPEN_TREE_SCALE[1] - OPEN_TREE_SCALE[0])
        const cone = ((g3 >>> 24) & 0xff) / 256 < OPEN_CONIFER_SHARE
        // 植被的座標存成 float32
        const t = trees.get(`${Math.fround(x).toFixed(2)},${Math.fround(z).toFixed(2)}`)
        expect(t, `(${x.toFixed(1)}, ${z.toFixed(1)})`).toBeDefined()
        expect(t!.scale).toBeCloseTo(scale, 5)
        expect(t!.kind).toBe(cone ? FloraKind.ConeTree : FloraKind.BroadTree)
        dots++
      }
    }
    expect(dots).toBe(trees.size)
    expect(dots).toBeGreaterThan(5000)
  })

  /**
   * 【早退不漏樹】遠圖畫樹點時，雜訊比門檻低 `OPEN_WOOD_NEAR_MARGIN` 的點直接跳過。
   * 餘量不夠的話林緣那一圈的點會被切掉一塊 —— 這裡拿植被真的長出來的樹，驗它的樹冠
   * 蓋到的每一點都不會被早退跳過
   */
  it('遠圖的樹點早退不會跳過任何一棵樹的樹冠', () => {
    const buf = createFloraBuffer(400_000)
    openWoodFlora(-6000, -6000, 6000, 6000, () => 0, buf)
    const noise = (x: number, z: number): number =>
      0.65 * valueNoise(x, z, OPEN_WOOD_CELL[0], 0x6a11) + 0.35 * valueNoise(x, z, OPEN_WOOD_CELL[1], 0x3b57)
    const floor = OPEN_WOOD_GATE[0] - OPEN_WOOD_NEAR_MARGIN
    let worst = Infinity
    let n = 0
    for (let i = 0; i < buf.count; i++) {
      const o = i * FLORA_STRIDE
      const x = buf.data[o]!
      const z = buf.data[o + 2]!
      if (!isOpenParcel(parcel(x, z))) continue
      const r = BROAD_CROWN_R * buf.data[o + 4]! + OPEN_DOT_AA
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2
        worst = Math.min(worst, noise(x + Math.cos(a) * r, z + Math.sin(a) * r) - floor)
      }
      n++
    }
    expect(n).toBeGreaterThan(5000)
    expect(worst).toBeGreaterThanOrEqual(0)
    // 量尺有事可做：最貼近的那一棵離門檻不遠
    expect(worst).toBeLessThan(OPEN_WOOD_NEAR_MARGIN)
  })

  /**
   * 【餘量夾得住】樹點用一點的雜訊 ± `OPEN_WOOD_NEAR_MARGIN` 夾住周圍
   * `OPEN_DOT_REACH` 內每一棵候選樹的覆蓋率，夾得出答案的就不算雜訊。餘量小了，
   * 夾出來的答案會與逐棵算的不同 —— 點多一棵或少一棵
   */
  it('空地樹林的雜訊在 OPEN_DOT_REACH 裡變不到 OPEN_WOOD_NEAR_MARGIN', () => {
    const noise = (x: number, z: number): number =>
      0.65 * valueNoise(x, z, OPEN_WOOD_CELL[0], 0x6a11) + 0.35 * valueNoise(x, z, OPEN_WOOD_CELL[1], 0x3b57)
    let seed = 13
    const rand = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    let worst = 0
    for (let k = 0; k < 200_000; k++) {
      const x = (rand() - 0.5) * 60000
      const z = (rand() - 0.5) * 60000
      const a = rand() * Math.PI * 2
      const d = OPEN_DOT_REACH * Math.sqrt(rand())
      worst = Math.max(worst, Math.abs(noise(x + Math.cos(a) * d, z + Math.sin(a) * d) - noise(x, z)))
    }
    console.log(JSON.stringify({ 最大差: worst.toFixed(4), 餘量: OPEN_WOOD_NEAR_MARGIN.toFixed(4) }))
    expect(worst).toBeLessThanOrEqual(OPEN_WOOD_NEAR_MARGIN)
    // 量尺有事可做：量到的差有餘量的四成以上（餘量是斜率的上界，實際的斜率小一截）
    expect(worst).toBeGreaterThan(OPEN_WOOD_NEAR_MARGIN * 0.4)
  })

  /** GLSL 那一段逐字釘住：改了 GLSL 而沒改上面那一條的式子，這裡會紅 */
  it('遠圖的樹點：GLSL 的式子', () => {
    const glsl = fieldGlsl('summer', false, true)
    for (const line of [
      'uint h = fieldHash2(gx, gz);',
      'uint g = fieldHash1(h);',
      'vec2 p = vec2(float(gx) + 0.15 + float(h) / 4294967296.0 * 0.7,',
      'float(gz) + 0.15 + float(g) / 4294967296.0 * 0.7) * WOOD_GRID;',
      'uint g2 = fieldHash1(g);',
      'float u = float(g2 & 0xffffu) / 65536.0;',
      'if (d >= OPEN_DOT_REACH) continue;',
      'if (u >= acceptHi) continue;',
      'if (u >= acceptLo && u >= openWoodCover(p) * OPEN_WOOD_DENSITY) continue;',
      'float acceptLo = smoothstep(OPEN_WOOD_GATE_LO, OPEN_WOOD_GATE_HI, nw - OPEN_WOOD_NEAR_MARGIN) * OPEN_WOOD_DENSITY;',
      'float acceptHi = smoothstep(OPEN_WOOD_GATE_LO, OPEN_WOOD_GATE_HI, nw + OPEN_WOOD_NEAR_MARGIN) * OPEN_WOOD_DENSITY;',
      'uint g3 = fieldHash1(g2);',
      'float scale = OPEN_TREE_SCALE_LO + float(g3 & 0xffffu) / 65536.0 * (OPEN_TREE_SCALE_HI - OPEN_TREE_SCALE_LO);',
      'bool cone = float((g3 >> 24u) & 0xffu) / 256.0 < OPEN_CONIFER_SHARE;',
      'if (fieldTrees > 0.5) col = openTreesOver(world, col, px);',
      `const float WOOD_GRID = ${WOOD_GRID.toFixed(1)};`,
      `const float OPEN_WOOD_DENSITY = ${OPEN_WOOD_DENSITY.toFixed(3)};`,
      `const float OPEN_CONIFER_SHARE = ${OPEN_CONIFER_SHARE.toFixed(3)};`,
    ]) expect(glsl).toContain(line)
  })
})

/** 與 `fields.ts` 裡那兩支必須相同 */
function hash2(i: number, j: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2545f491)
  return (h ^ (h >>> 13)) >>> 0
}
function hash1(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return (h ^ (h >>> 16)) >>> 0
}
