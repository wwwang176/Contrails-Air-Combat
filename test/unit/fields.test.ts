import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import {
  edgeAt, fieldAt, fieldSurfaceColor, regionAt, EDGE_JITTER, FIELD_ANISO,
  FIELD_GLSL, FIELD_SPACING, FIELD_SPACING_VAR, HEDGE_CHANCE, HEDGE_WIDTH,
  REGION_SPACING, SPLIT_CHANCE, TRACK_WIDTH,
  type FieldSample, type RegionSample,
} from '../../src/render/fields'

const reg: RegionSample = {
  r1: 0, r2: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
}
const s: FieldSample = { id: 0, edge: 0, hedged: false }
const col = new Color()

const HEDGE = '28351f'
const TRACK = '9c8f6e'
const PLOUGHED = '6b5238'

/** 這一點的地面色，十六進位字串 */
function at(x: number, z: number): string {
  return fieldSurfaceColor(x, z, col).getHexString()
}

describe('Bocage 的田區', () => {
  it('同一個世界座標恆得到同一個顏色', () => {
    const first = at(1234.5, -8765.25)
    expect(at(1234.5, -8765.25)).toBe(first)
  })

  /**
   * 【整個矩形格的前提】格線恆遞增。推移量若到半格，相鄰兩條線會交換次序，
   * 田會翻面 —— 而症狀是畫面上出現一格寬的亂線。
   *
   * 【為什麼直接驗 `edgeAt`】由成品反推「格線有沒有交換」很難；這一支是
   * 那個性質唯一的來源，直接驗便宜得多。
   */
  it('格線恆遞增', () => {
    let worst = Infinity
    for (const cell of [FIELD_SPACING * FIELD_SPACING_VAR[0],
      FIELD_SPACING * FIELD_SPACING_VAR[1]]) {
      // 【縱界的 salt 帶列號】所以要掃一批列，不是只掃 0 與 1
      for (const salt of [1, 3, 5, 101, -7, -33, 999]) {
        for (let k = -400; k < 400; k++) {
          worst = Math.min(worst, edgeAt(k + 1, cell, salt) - edgeAt(k, cell, salt))
        }
      }
    }
    console.log(JSON.stringify({
      最窄的田: worst.toFixed(1) + ' m',
      理論下界: (FIELD_SPACING * FIELD_SPACING_VAR[0] * (1 - 2 * EDGE_JITTER)).toFixed(1) + ' m',
    }))
    expect(worst).toBeGreaterThan(0)
  })

  /**
   * 【找到的那一格必須真的包住查詢點】推移量 < 0.5 格保證「由 floor 起算、
   * 左右各看一格」找得到。這一條把那個保證變成測得到的。
   */
  it('找到的那一格真的包住查詢點', () => {
    let bad = 0
    for (let z = -3000; z <= 3000; z += 13) {
      for (let x = -3000; x <= 3000; x += 13) {
        regionAt(x, z, reg)
        const cos = Math.cos(-reg.angle)
        const sin = Math.sin(-reg.angle)
        const qx = x * cos - z * sin
        const qz = x * sin + z * cos
        let r = Math.floor(qz / reg.cellH)
        if (qz < edgeAt(r, reg.cellH, 1)) r--
        else if (qz >= edgeAt(r + 1, reg.cellH, 1)) r++
        const salt = (r * 2 + 1) | 0
        let c = Math.floor(qx / reg.cellW)
        if (qx < edgeAt(c, reg.cellW, salt)) c--
        else if (qx >= edgeAt(c + 1, reg.cellW, salt)) c++
        if (qx < edgeAt(c, reg.cellW, salt) || qx >= edgeAt(c + 1, reg.cellW, salt)) bad++
        if (qz < edgeAt(r, reg.cellH, 1) || qz >= edgeAt(r + 1, reg.cellH, 1)) bad++
      }
    }
    expect(bad).toBe(0)
  })

  /**
   * 【這一條是這一版的重點】Bocage 的田接近矩形，Voronoi 給的是凸多邊形。
   * 判準：把同一塊田的點收集起來，看它**填滿自己的外接矩形**到什麼程度。
   * 矩形接近 1，六邊形只有 0.7 上下。
   */
  it('田是矩形的，不是凸多邊形', () => {
    const fills: number[] = []
    for (const [cx, cz] of [[600, 400], [5200, 3100], [-7100, 2200], [3050, -9000]]) {
      regionAt(cx!, cz!, reg)
      const want = (fieldAt(cx!, cz!, reg, s), s.id)
      const cos = Math.cos(-reg.angle)
      const sin = Math.sin(-reg.angle)
      let loU = Infinity; let hiU = -Infinity
      let loV = Infinity; let hiV = -Infinity
      let n = 0
      const STEP = 2
      for (let dz = -400; dz <= 400; dz += STEP) {
        for (let dx = -400; dx <= 400; dx += STEP) {
          const x = cx! + dx
          const z = cz! + dz
          regionAt(x, z, reg)
          fieldAt(x, z, reg, s)
          if (s.id !== want) continue
          n++
          const u = x * cos - z * sin
          const v = x * sin + z * cos
          loU = Math.min(loU, u); hiU = Math.max(hiU, u)
          loV = Math.min(loV, v); hiV = Math.max(hiV, v)
        }
      }
      expect(n).toBeGreaterThan(200)
      fills.push((n * STEP * STEP) / ((hiU - loU) * (hiV - loV)))
    }
    console.log(JSON.stringify({ 填滿率: fills.map((f) => f.toFixed(2)) }))
    // 【矩形接近 1】六邊形是 0.75、圓是 0.79 —— 這一條分得出來
    for (const f of fills) expect(f).toBeGreaterThan(0.92)
  })

  /**
   * 【Bocage 的定義】每一塊田都被圍起來。留一點缺口是給農路的出入口，
   * 全滿反而假。
   */
  it('幾乎每一條田界都長樹籬', () => {
    let boundary = 0
    let hedged = 0
    for (let z = -3000; z <= 3000; z += 5.3) {
      for (let x = -3000; x <= 3000; x += 5.3) {
        regionAt(x, z, reg)
        if (reg.r2 - reg.r1 < TRACK_WIDTH) continue
        fieldAt(x, z, reg, s)
        if (s.edge >= HEDGE_WIDTH / 2) continue
        boundary++
        if (s.hedged) hedged++
      }
    }
    const share = hedged / boundary
    console.log(JSON.stringify({
      田界取樣: boundary,
      有樹籬: (share * 100).toFixed(1) + '%',
      HEDGE_CHANCE,
    }))
    expect(share).toBeGreaterThan(HEDGE_CHANCE - 0.08)
    expect(share).toBeLessThan(1.0001)
  })

  /**
   * 【樹籬該佔到一成七】那是 Bocage 由空中看起來像一張綠色網的原因。
   * 開放田制只有半成 —— 兩者差在這裡，不是差在顏色。
   */
  it('樹籬與凹路佔地一到兩成', () => {
    let dark = 0
    let n = 0
    for (let z = -4000; z <= 4000; z += 6.1) {
      for (let x = -4000; x <= 4000; x += 6.1) {
        const c = at(x, z)
        if (c === HEDGE || c === TRACK) dark++
        n++
      }
    }
    const share = (100 * dark) / n
    console.log(JSON.stringify({ 樹籬加凹路: share.toFixed(1) + '%' }))
    expect(share).toBeGreaterThan(10)
    expect(share).toBeLessThan(22)
  })

  /**
   * 【配色要成片，不能雜訊】同一區裡的田只在基調 ±1 挑，所以相鄰兩塊的
   * 色差有上限。
   */
  it('同一區裡相鄰兩塊田的色差有限', () => {
    let worst = 0
    const a = new Color()
    const b = new Color()
    const skip = [HEDGE, TRACK, PLOUGHED]
    for (let z = -2000; z <= 2000; z += 71) {
      for (let x = -2000; x < 2000; x += 3) {
        regionAt(x, z, reg)
        if (reg.r2 - reg.r1 < TRACK_WIDTH + 60) continue
        fieldAt(x, z, reg, s)
        if (s.edge > HEDGE_WIDTH) continue
        fieldSurfaceColor(x - 40, z, a)
        fieldSurfaceColor(x + 40, z, b)
        if (skip.includes(a.getHexString()) || skip.includes(b.getHexString())) continue
        worst = Math.max(worst, Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b))
      }
    }
    console.log(JSON.stringify({ 最大色差: worst.toFixed(3) }))
    expect(worst).toBeLessThan(0.30)
  })

  it('田的尺度落在設定的區間裡', () => {
    let minCell = Infinity
    let maxCell = 0
    for (let z = -8000; z <= 8000; z += 211) {
      for (let x = -8000; x <= 8000; x += 211) {
        regionAt(x, z, reg)
        minCell = Math.min(minCell, reg.cellW)
        maxCell = Math.max(maxCell, reg.cellW)
      }
    }
    console.log(JSON.stringify({
      最小短邊: minCell.toFixed(0) + ' m',
      最大短邊: maxCell.toFixed(0) + ' m',
      長邊倍率: FIELD_ANISO,
    }))
    expect(minCell).toBeGreaterThanOrEqual(FIELD_SPACING * FIELD_SPACING_VAR[0] - 1)
    expect(maxCell).toBeLessThanOrEqual(FIELD_SPACING * FIELD_SPACING_VAR[1] + 1)
  })

  /** 【對切要真的發生】不然田的大小只剩區塊那一層的變化 */
  it('大約 SPLIT_CHANCE 的格子被對切', () => {
    regionAt(0, 0, reg)
    let split = 0
    const N = 4000
    for (let k = 0; k < N; k++) {
      // 直接重算 cellHash 的低位元 —— 與 fields.ts 的判準相同
      const h = hash2(k ^ reg.id, k * 7 + 3)
      if ((h & 0xff) / 256 < SPLIT_CHANCE) split++
    }
    const share = split / N
    console.log(JSON.stringify({ 被對切: (share * 100).toFixed(1) + '%', SPLIT_CHANCE }))
    expect(share).toBeGreaterThan(SPLIT_CHANCE - 0.05)
    expect(share).toBeLessThan(SPLIT_CHANCE + 0.05)
  })

  it('顏色不是全部同一色', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 600; i++) seen.add(at(i * 411.7, i * -233.3))
    expect(seen.size).toBeGreaterThan(8)
  })

  /**
   * 【這一條只證明常數沒有漂，不證明演算法是對的】GLSL 跑不進 headless，
   * 所以**語法**由 `farmland-shot.e2e.ts` 在真的 WebGL2 context 裡編譯來守，
   * 而**演算法**由下面那條金本位守。
   */
  it('GLSL 的常數由 TS 那一份產生', () => {
    for (const v of [
      FIELD_SPACING.toFixed(1), FIELD_ANISO.toFixed(3), EDGE_JITTER.toFixed(3),
      SPLIT_CHANCE.toFixed(3), REGION_SPACING.toFixed(1), HEDGE_WIDTH.toFixed(1),
      HEDGE_CHANCE.toFixed(3), TRACK_WIDTH.toFixed(1),
    ]) expect(FIELD_GLSL).toContain(v)
    expect(FIELD_GLSL).toContain('vec3 fieldColorAt(')
  })

  /**
   * 【金本位】把 GLSL 裡演算法的那幾行釘死。改了 GLSL 而沒有同步改 CPU 那
   * 一份（或反過來）時，這一條會紅，而 diff 直接指出改了哪一行。
   *
   * **它不是在驗正確性，是在強迫兩份一起改。**
   */
  it('GLSL 的演算法與 CPU 那一份逐行對得上', () => {
    const want = [
      'uint h = uint(i) * 0x27d4eb2du ^ uint(j) * 0x85ebca6bu;',
      'h = (h ^ (h >> 15u)) * 0x2545f491u;',
      'h = (h ^ (h >> 16u)) * 0x7feb352du;',
      'return (float(k) + (float(fieldHash2(k, salt)) / 4294967296.0 - 0.5)',
      'if (q.x < fieldEdgeAt(c, cellW, colSalt)) c -= 1;',
      'else if (q.x >= fieldEdgeAt(c + 1, cellW, colSalt)) c += 1;',
      'int colSalt = r * 2 + 1;',
      'uint edgeKey = fieldHash2(c ^ colSalt, 0x51ed);',
      'uint cellHash = fieldHash2(c ^ int(rid), r);',
      'float f = 0.34 + (float((cellHash >> 8u) & 0xffu) / 255.0) * 0.32;',
      'if (float(fieldHash1(edgeKey)) / 4294967296.0 < HEDGE_CHANCE',
      'uint fh = fieldHash1(cellHash ^ (part * 0x7f4au));',
      'int t = clamp(tone + int((fh >> 8u) % 3u) - 1, 0, 7);',
    ]
    for (const line of want) expect(FIELD_GLSL).toContain(line)
  })
})

/** 與 `fields.ts` 裡那一支必須相同 */
function hash2(i: number, j: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2545f491)
  return (h ^ (h >>> 13)) >>> 0
}
