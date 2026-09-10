import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import {
  edgeAt, fieldAt, fieldGlslWithSite, fieldSurfaceColor, isWoodField, regionAt, regionParams,
  regionSeed, roadBounds, siteSurfaceColor, splitCut, EDGE_JITTER, FIELD_ANISO,
  FIELD_GLSL, FIELD_SPACING, FIELD_SPACING_VAR, HEDGE_CHANCE, HEDGE_WIDTH,
  REGION_SPACING, SPLIT_CHANCE, TRACK_WIDTH, WOOD_CHANCE,
  type FieldSample, type RegionSample, type SplitCut,
} from '../../src/render/fields'
import { LEUNA_SITE } from '../../src/render/terrain'
import { FARM_EXTENT } from '../../src/world/farmland'

const reg: RegionSample = {
  r1: 0, r2: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
}
const s: FieldSample = { id: 0, edge: 0, hedged: false }
const col = new Color()

const HEDGE = '293123'
const TRACK = '938b77'
const PLOUGHED = '615242'
const WOOD = '2f3a28'

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
    // 【樹林與犁田同類】它們是另一種地，不是另一個色調 —— 色盤的
    // 「相鄰索引顏色相近」本來就管不到它們
    const skip = [HEDGE, TRACK, PLOUGHED, WOOD]
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
   * 所以**語法**由 `glsl-compile.e2e.ts` 在真的 WebGL2 context 裡編譯來守，
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
      'bool isHedge = float(fieldHash1(edgeKey)) / 4294967296.0 < HEDGE_CHANCE;',
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

/**
 * 放置植被的三支。**它們存在的理由是「數字只有一個來源」** ——
 * `flora.ts` 要走樹籬的線，需要種子、需要區塊參數、需要那條對切線。
 * 在那邊重抄一次公式的話，一邊改了另一邊不會紅，而症狀是樹離開了樹籬。
 */
describe('植被放置要用的三支', () => {
  const P = { x: 0, z: 0 }
  const other: RegionSample = {
    r1: 0, r2: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
  }
  const cut: SplitCut = { axis: 0, at: 0, lo: 0, hi: 0 }

  it('regionSeed 與 regionAt 用的是同一顆種子', () => {
    // 種子上取樣的話，到最近種子的距離就是 0
    for (const [i, j] of [[0, 0], [3, -2], [-5, 7], [11, 13]] as const) {
      regionSeed(i, j, P)
      regionAt(P.x, P.z, reg)
      expect(reg.r1).toBeLessThan(1e-6)
    }
  })

  it('regionSeed 的種子落在自己那一格裡', () => {
    for (let j = -3; j <= 3; j++) {
      for (let i = -3; i <= 3; i++) {
        regionSeed(i, j, P)
        expect(Math.floor(P.x / REGION_SPACING)).toBe(i)
        expect(Math.floor(P.z / REGION_SPACING)).toBe(j)
      }
    }
  })

  it('regionParams(id) 與 regionAt 給的參數完全相同', () => {
    for (let k = 0; k < 300; k++) {
      const x = k * 137.5 - 8000
      const z = k * 91.3 - 5000
      regionAt(x, z, reg)
      regionParams(reg.id, other)
      expect(other.angle).toBe(reg.angle)
      expect(other.cellW).toBe(reg.cellW)
      expect(other.cellH).toBe(reg.cellH)
      expect(other.tone).toBe(reg.tone)
    }
  })

  /**
   * 【這一條承重】對切線是 `fieldAt` 認定的樹籬之一，佔全部樹籬帶的 11.8%
   * （實測）。走線走不到它的話，那些樹籬會畫在地上卻沒有樹。
   * `splitCut` 回錯的位置，下面兩個斷言都會紅。
   */
  /**
   * 在世界座標 `(x, z)` 那一格的對切線上取一點，往側向位移 `off` 公尺。
   * 回 `null` 表示這一格沒有對切、或那個點已經落到別的區塊去了 ——
   * 落到別的區塊的話那裡是另一套格線，比什麼都沒有意義。
   */
  function onCut(x: number, z: number, off: number): { x: number; z: number } | null {
    regionAt(x, z, reg)
    if (reg.r2 - reg.r1 < TRACK_WIDTH) return null
    const rid = reg.id
    const angle = reg.angle
    const cs = Math.cos(-angle)
    const sn = Math.sin(-angle)
    const qx = x * cs - z * sn
    const qz = x * sn + z * cs
    let r = Math.floor(qz / reg.cellH)
    if (qz < edgeAt(r, reg.cellH, 1)) r--
    else if (qz >= edgeAt(r + 1, reg.cellH, 1)) r++
    const colSalt = (r * 2 + 1) | 0
    let c = Math.floor(qx / reg.cellW)
    if (qx < edgeAt(c, reg.cellW, colSalt)) c--
    else if (qx >= edgeAt(c + 1, reg.cellW, colSalt)) c++
    if (!splitCut(c, r, reg, cut)) return null

    // `axis` 0 = 線上的 qx 固定，沿 qz 走；側向就是 qx
    const mid = (cut.lo + cut.hi) / 2
    const px = cut.axis === 0 ? cut.at + off : mid
    const pz = cut.axis === 0 ? mid : cut.at + off
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    const wx = px * ca - pz * sa
    const wz = px * sa + pz * ca
    regionAt(wx, wz, reg)
    if (reg.id !== rid || reg.r2 - reg.r1 < TRACK_WIDTH) return null
    return { x: wx, z: wz }
  }

  it('splitCut 就是 fieldAt 認定的那一條切線', () => {
    let checked = 0
    for (let k = 0; k < 600; k++) {
      const p = onCut(k * 233.7 - 40000, k * 149.1 - 30000, 0)
      if (p === null) continue
      regionAt(p.x, p.z, reg)
      fieldAt(p.x, p.z, reg, s)
      // 切線上：離最近的田界幾乎是 0
      expect(s.edge).toBeLessThan(1)
      checked++
    }
    // 【不得是空操作】一條都沒驗到的話上面整段沒有意義
    expect(checked).toBeGreaterThan(40)
  })

  it('切線兩側是兩塊不同的田', () => {
    const a: FieldSample = { id: 0, edge: 0, hedged: false }
    const b: FieldSample = { id: 0, edge: 0, hedged: false }
    let checked = 0
    for (let k = 0; k < 600; k++) {
      const x = k * 311.3 - 50000
      const z = k * 187.9 - 20000
      const pa = onCut(x, z, -8)
      const pb = onCut(x, z, 8)
      if (pa === null || pb === null) continue
      regionAt(pa.x, pa.z, reg)
      fieldAt(pa.x, pa.z, reg, a)
      regionAt(pb.x, pb.z, reg)
      fieldAt(pb.x, pb.z, reg, b)
      expect(a.id).not.toBe(b.id)
      checked++
    }
    expect(checked).toBeGreaterThan(40)
  })

  /**
   * 【精確計數，不是寬鬆的比例】比例只要落在區間裡就綠，而「差一位元」的
   * 實作照樣落在區間裡。固定的索引集合上，正確的實作只有一個答案。
   */
  it('有對切的格子 —— 固定 4,000 格的精確筆數', () => {
    regionAt(0, 0, reg)
    let hits = 0
    for (let r = -40; r < 40; r++) {
      for (let c = -25; c < 25; c++) if (splitCut(c, r, reg, cut)) hits++
    }
    expect(hits).toBe(1434)
    // 寫死的數字要自己說得出意義
    expect(hits / 4000).toBeGreaterThan(SPLIT_CHANCE - 0.06)
    expect(hits / 4000).toBeLessThan(SPLIT_CHANCE + 0.06)
  })

  it('切線恆在格內，而且兩端就是格的兩邊', () => {
    regionAt(0, 0, reg)
    let checked = 0
    for (let r = -20; r < 20; r++) {
      for (let c = -20; c < 20; c++) {
        if (!splitCut(c, r, reg, cut)) continue
        const lo = cut.axis === 0
          ? edgeAt(c, reg.cellW, (r * 2 + 1) | 0)
          : edgeAt(r, reg.cellH, 1)
        const hi = cut.axis === 0
          ? edgeAt(c + 1, reg.cellW, (r * 2 + 1) | 0)
          : edgeAt(r + 1, reg.cellH, 1)
        expect(cut.at).toBeGreaterThan(lo)
        expect(cut.at).toBeLessThan(hi)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(100)
  })
})

describe('樹林', () => {
  /** 【精確計數】理由同對切線那一條 */
  it('固定 10,000 個 id 的精確筆數', () => {
    let woods = 0
    for (let k = 0; k < 10000; k++) {
      regionAt(k * 71.3 - 30000, k * 43.7 - 20000, reg)
      fieldAt(k * 71.3 - 30000, k * 43.7 - 20000, reg, s)
      if (isWoodField(s.id)) woods++
    }
    expect(woods).toBe(460)
    expect(woods / 10000).toBeGreaterThan(WOOD_CHANCE - 0.02)
    expect(woods / 10000).toBeLessThan(WOOD_CHANCE + 0.02)
  })

  /**
   * 【位元不得重疊】低 8 位是犁田、8–15 是色調、16–23 是明度抖動。
   * 樹林用 24–31 —— 動低 24 位不得改變答案。
   */
  it('樹林用的位元與犁田、色調、明度都不重疊', () => {
    for (let k = 0; k < 500; k++) {
      const id = (k * 2654435761) >>> 0
      expect(isWoodField((id & 0xff000000) >>> 0)).toBe(isWoodField(id))
    }
  })

  it('樹林田的地色比任何一塊非樹林的田都暗', () => {
    const wood = new Color()
    const c = new Color()
    let gotWood = false
    let maxCrop = 0
    for (let k = 0; k < 30000; k++) {
      const x = k * 13.7 - 20000
      const z = k * 29.3 - 40000
      regionAt(x, z, reg)
      if (reg.r2 - reg.r1 < TRACK_WIDTH) continue
      fieldAt(x, z, reg, s)
      // 【不比樹籬】樹籬比樹林還暗，那是對的 —— 這一條比的是田
      if (s.hedged && s.edge < HEDGE_WIDTH / 2) continue
      fieldSurfaceColor(x, z, c)
      if (isWoodField(s.id)) { wood.copy(c); gotWood = true; continue }
      maxCrop = Math.max(maxCrop, c.r + c.g + c.b)
    }
    expect(gotWood).toBe(true)
    expect(wood.r + wood.g + wood.b).toBeLessThan(maxCrop)
  })

  it('GLSL 有樹林的判準與顏色', () => {
    expect(FIELD_GLSL).toContain('bool isWoodField(uint id)')
    expect(FIELD_GLSL).toContain('WOOD_COLOR')
    expect(FIELD_GLSL).toContain(WOOD_CHANCE.toFixed(3))
  })
})

/**
 * 帶的邊緣抗鋸齒。**只在 GPU 上做**，與條紋同一個理由 —— 這是 CPU 與 GLSL
 * 容許分家的第二處，而且是唯一的一處新增。
 *
 * `fieldAt` 與 `fieldSurfaceColor` 維持二值，因為樹的位置靠它們；近距離
 * 足跡趨近 0 時覆蓋率收斂回二值，所以樹的位置與看到的暗帶仍然對得上。
 */
describe('帶的邊緣抗鋸齒', () => {
  const body = FIELD_GLSL.slice(FIELD_GLSL.indexOf('vec3 fieldColorAt'))

  /**
   * 【盒濾波，不是 smoothstep】`1 - smoothstep(halfW - w, halfW + w, d)` 在
   * `w` 超過帶寬時會把影響範圍撐到 `halfW + w`，遠處變成一片過暗的灰霧。
   * 盒濾波在 `w → ∞` 時趨近 `halfW / w`，也就是那條帶在像素裡的真實面積比
   * —— 細線變淡，不是變寬。
   */
  it('覆蓋率是解析盒濾波', () => {
    expect(FIELD_GLSL).toContain(
      'clamp((min(d + w, halfW) - max(d - w, 0.0)) / (2.0 * w), 0.0, 1.0)')
    expect(FIELD_GLSL).not.toContain('smoothstep(halfW')
  })

  /**
   * 【足跡要無條件算，而且吃世界座標】`best` 是四條外框加一條切線取 min，
   * 在最近邊換手的角平分線上不可微 —— 田角會長出楔形接縫。而導數指令在
   * fragment quad 內分歧時結果本來就不可靠，所以不能放進任何分支。
   */
  it('像素足跡在最前面、無條件、吃世界座標', () => {
    expect(body).toContain(
      'float px = 0.5 * length(vec2(fwidth(world.x), fwidth(world.y)));')
    expect(FIELD_GLSL).not.toContain('fwidth(best)')
    // 足跡要在第一個 return 之前 —— 而且在區塊那個迴圈之前
    expect(body.indexOf('float px =')).toBeLessThan(body.indexOf('for (int dj'))
  })

  /**
   * 【硬判斷一個都不准留】留一個就是留一條會爬的線。改寫成三元式也不行 ——
   * 所以這裡直接查那三個 return 不存在。
   */
  it('三個提早 return 都拿掉了', () => {
    expect(FIELD_GLSL).not.toContain('return TRACK_COLOR;')
    expect(FIELD_GLSL).not.toContain('return HEDGE_COLOR;')
    expect(FIELD_GLSL).not.toContain('return WOOD_COLOR;')
  })

  /**
   * 【疊色的順序就是優先權】凹路壓過樹籬、樹籬壓過田 —— 與
   * `fieldSurfaceColor` 相同。順序反了的話村口的凹路會被樹籬蓋掉。
   */
  it('順序是 底色 → 條紋 → 樹籬 → 凹路', () => {
    const at = (t: string): number => {
      const i = body.indexOf(t)
      expect([t, i >= 0]).toEqual([t, true])
      return i
    }
    expect(at('col = mix(col, HEDGE_COLOR')).toBeGreaterThan(at('col *= stripe('))
    expect(at('col = mix(col, TRACK_COLOR')).toBeGreaterThan(at('col = mix(col, HEDGE_COLOR'))
  })

  /**
   * 【兩條帶的半寬不一樣，別統一】凹路現況的判準是 `r2 - r1 < TRACK_WIDTH`，
   * 所以它的半寬就是 `TRACK_WIDTH`；樹籬是 `best < HEDGE_WIDTH * 0.5`。
   */
  it('兩條帶各自傳對的距離與半寬', () => {
    expect(body).toContain('bandCoverage(best, HEDGE_WIDTH * 0.5, px)')
    expect(body).toContain('bandCoverage(r2 - r1, TRACK_WIDTH, px)')
  })
})

/**
 * 犁溝與作物條紋。**只在 GPU 上做** —— 抗鋸齒需要片段的導數（`fwidth`），
 * CPU 沒有對應物。沒有抗鋸齒的話 1 km 外整片田會出現摩爾紋，比沒有條紋更糟。
 *
 * 這是 CPU 與 GLSL 兩份唯一容許分家的地方，所以這一組測試同時守兩件事：
 * 條紋**確實被呼叫**（不是宣告了放著），以及 CPU 那一份確實沒有條紋。
 */
describe('犁溝與作物條紋', () => {
  it('條紋確實被 fieldColorAt 呼叫，不是宣告了放著', () => {
    // 【承重】只檢查 'fwidth' 與 'stripe' 存在的話，把 helper 放著不用也會綠
    expect(FIELD_GLSL).toContain('col *= stripe(q, STRIPE_PERIOD, amp);')
  })

  it('犁田的條紋幅度是作物的兩倍，而樹林一條都沒有', () => {
    // 【樹林是林冠不是作物】CPU 的 fieldSurfaceColor 對樹林回純色，
    // GPU 這邊套上條紋的話會多出一個沒核可的分歧
    expect(FIELD_GLSL).toContain(
      'float amp = wood ? 0.0 : (ploughed ? STRIPE_AMP * 2.0 : STRIPE_AMP);')
  })

  it('條紋順著田的長軸，所以是沿短軸重複', () => {
    // 長邊是 cellH（q 的第二軸），所以行沿它走 —— 重複發生在 q.x 上
    expect(FIELD_GLSL).toContain('float u = q.x / period;')
  })

  it('取樣不足時淡出，用的是導數不是距離', () => {
    expect(FIELD_GLSL).toContain('fwidth(u)')
    // 【不得改用相機距離】那要多傳一個 uniform，而遠景環與細節地形是
    // 兩個不同的物件，兩邊會不一致
    expect(FIELD_GLSL).not.toContain('cameraPosition')
  })

  it('CPU 那一份沒有條紋 —— 同一塊田裡半個週期外仍然同色', () => {
    let checked = 0
    for (let k = 0; k < 4000; k++) {
      const x = k * 17.3 - 30000
      const z = k * 11.9 - 20000
      regionAt(x, z, reg)
      if (reg.r2 - reg.r1 < TRACK_WIDTH + 40) continue
      fieldAt(x, z, reg, s)
      // 離田界遠一點，免得位移之後跨過樹籬
      if (s.edge < 30) continue
      const id = s.id
      const cs = Math.cos(reg.angle)
      const sn = Math.sin(reg.angle)
      // 沿 q.x 位移半個週期（3.5 m）—— 有條紋的話這裡顏色就會變
      const nx = x + 3.5 * cs
      const nz = z + 3.5 * sn
      regionAt(nx, nz, reg)
      fieldAt(nx, nz, reg, s)
      if (s.id !== id) continue
      expect(at(nx, nz)).toBe(at(x, z))
      checked++
    }
    expect(checked).toBeGreaterThan(500)
  })
})

/**
 * 道路與鐵路那兩個迴圈的早退。
 *
 * 【為什麼要早退】十五段點線距離是**每個像素**都跑的，而投彈高度整片畫面
 * 有七成是田。墊面那個外接矩形擋不了它們 —— 連外道路一路畫到圖邊，用墊面
 * 的矩形擋會把連外那幾條整段砍掉。
 *
 * 【矩形太小的症狀】路的外緣沿著矩形邊被削掉一條直線，而且只在特定視角
 * 出現 —— 不報錯。所以下面那一條在驗每一段連同抗鋸齒帶都還在矩形裡。
 */
describe('道路與鐵路的外接矩形', () => {
  const b = roadBounds(LEUNA_SITE)

  it('每一個端點連同半寬都在矩形內', () => {
    const half = Math.max(LEUNA_SITE.roadWidth, LEUNA_SITE.railWidth ?? 0) / 2
    let checked = 0
    for (const lines of [LEUNA_SITE.roads, LEUNA_SITE.rails ?? []]) {
      for (const line of lines) {
        for (const p of line) {
          checked++
          expect(p.x - half).toBeGreaterThan(b.x0)
          expect(p.x + half).toBeLessThan(b.x1)
          expect(p.z - half).toBeGreaterThan(b.z0)
          expect(p.z + half).toBeLessThan(b.z1)
        }
      }
    }
    expect(checked).toBeGreaterThan(10)
  })

  /**
   * 【為什麼要有這一條】矩形若大到蓋住整片細節地形，早退就等於沒有 ——
   * 而且測試照樣全綠。
   */
  it('矩形要真的擋掉一大片 —— 蓋滿全圖的話早退等於沒有', () => {
    const area = (b.x1 - b.x0) * (b.z1 - b.z0)
    expect(area / (FARM_EXTENT * FARM_EXTENT)).toBeLessThan(0.45)
  })

  it('廠區的 GLSL 裡道路與鐵路都被矩形包住', () => {
    const src = fieldGlslWithSite('summer', LEUNA_SITE)
    const guard = src.indexOf(`world.x > ${b.x0.toFixed(1)}`)
    expect(guard).toBeGreaterThan(-1)
    expect(src.indexOf('RAILS[')).toBeGreaterThan(guard)
    expect(src.indexOf('ROADS[')).toBeGreaterThan(guard)
  })
})

describe('墊面的顏色', () => {
  it('padHex 省略時是混凝土，給了就用那一色，取樣與 GLSL 一致', () => {
    const site = {
      pad: { x0: -100, z0: -100, x1: 100, z1: 100 }, roads: [], roadWidth: 8, padHex: 0x55663f,
    }
    const c = new Color()
    siteSurfaceColor(0, 0, c, 'summer', site)
    // 取樣把髒污與壓暗乘進去，只比色相：綠比紅高就是草不是混凝土
    expect(c.g).toBeGreaterThan(c.r)
    // `rgb()` 走 `Color.setHex`，sRGB 轉成線性再印四位小數
    expect(fieldGlslWithSite('summer', site)).toContain('vec3(0.0908, 0.1329, 0.0497)')
    const bare = { pad: site.pad, roads: [], roadWidth: 8 }
    siteSurfaceColor(0, 0, c, 'summer', bare)
    expect(Math.abs(c.g - c.r)).toBeLessThan(0.03)
  })
})
