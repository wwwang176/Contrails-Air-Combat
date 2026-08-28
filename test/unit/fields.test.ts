import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import {
  fieldAt, fieldSurfaceColor, regionAt, FIELD_ANISO, FIELD_GLSL, FIELD_JITTER,
  FIELD_SPACING, FIELD_SPACING_VAR, HEDGE_CHANCE, HEDGE_WIDTH, REGION_SPACING,
  TRACK_WIDTH, type FieldSample, type RegionSample,
} from '../../src/render/fields'

const reg: RegionSample = { r1: 0, r2: 0, id: 0, angle: 0, cellW: 0, tone: 0 }
const s: FieldSample = { f1: 0, f2: 0, id: 0, id2: 0, hedgeThreshold: 0 }
const col = new Color()

/** 這一點的地面色，十六進位字串 */
function at(x: number, z: number): string {
  return fieldSurfaceColor(x, z, col).getHexString()
}

describe('兩層的田區', () => {
  it('同一個世界座標恆得到同一個顏色', () => {
    const first = at(1234.5, -8765.25)
    expect(at(1234.5, -8765.25)).toBe(first)
  })

  /**
   * 【為什麼要與 7×7 對答案】3×3 的鄰域搜尋只在抖動 ≤ 0.5 格時保證找得到
   * 最近的種子，而**次近**的那一顆條件更嚴。這一條直接暴力比對，把
   * 「搜尋範圍不夠」這個失效變成測得到的。
   *
   * 【兩層都要驗】區塊那一層是各向同性的，田那一層在拉長的網格上 ——
   * 拉長之後 3×3 仍然夠，是因為抖動是**格的比例**，不是絕對距離。
   */
  it('3×3 的搜尋與 7×7 的暴力解一致（兩層都是）', () => {
    let worstRegion = 0
    let worstField = 0
    for (let z = -4000; z <= 4000; z += 37) {
      for (let x = -4000; x <= 4000; x += 37) {
        regionAt(x, z, reg)
        const [br1, br2] = brute(x, z, 0, REGION_SPACING, 1, 0)
        worstRegion = Math.max(worstRegion, Math.abs(reg.r1 - br1), Math.abs(reg.r2 - br2))

        fieldAt(x, z, reg, s)
        const [bf1, bf2] = brute(x, z, reg.angle, reg.cellW, FIELD_ANISO, reg.id)
        worstField = Math.max(worstField, Math.abs(s.f1 - bf1), Math.abs(s.f2 - bf2))
      }
    }
    console.log(JSON.stringify({
      區塊最大誤差: worstRegion.toExponential(2),
      田最大誤差: worstField.toExponential(2),
    }))
    expect(worstRegion).toBeLessThan(1e-9)
    expect(worstField).toBeLessThan(1e-9)
  })

  it('抖動小於半格 —— 3×3 的前提', () => {
    expect(FIELD_JITTER).toBeLessThan(0.5)
  })

  /**
   * 【這一條是這次改版的重點】各向同性的 Voronoi 長出來的是圓潤的六邊形，
   * 讀起來是碎石地坪。量法：把同一塊田的點投影到區塊的座標軸上，
   * 長軸與短軸的跨距比應該落在 `FIELD_ANISO` 附近。
   */
  it('田是長條的，而且長軸就是區塊的走向', () => {
    const ratios: number[] = []
    for (const [cx, cz] of [[0, 0], [5000, 3000], [-7000, 2000], [3000, -9000]]) {
      regionAt(cx!, cz!, reg)
      fieldAt(cx!, cz!, reg, s)
      const want = s.id
      const cos = Math.cos(-reg.angle)
      const sin = Math.sin(-reg.angle)
      let loU = Infinity; let hiU = -Infinity
      let loV = Infinity; let hiV = -Infinity
      let n = 0
      for (let dz = -900; dz <= 900; dz += 4) {
        for (let dx = -900; dx <= 900; dx += 4) {
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
      expect(n).toBeGreaterThan(100)
      ratios.push((hiV - loV) / (hiU - loU))
    }
    console.log(JSON.stringify({ 長寬比: ratios.map((r) => r.toFixed(2)) }))
    // 【區間寬是因為單一格子的形狀還受鄰居擠壓】比值是量級，不是等式
    for (const r of ratios) {
      expect(r).toBeGreaterThan(FIELD_ANISO * 0.5)
      expect(r).toBeLessThan(FIELD_ANISO * 1.8)
    }
  })

  /**
   * 【為什麼不畫滿】每一條邊都畫的話，深綠線會佔掉 17% 的地面 —— 太多。
   * 這一條量的是「有樹籬的田界佔全部田界的比例」，判準就是 `HEDGE_CHANCE`。
   */
  it('大約 HEDGE_CHANCE 的田界長樹籬', () => {
    let boundary = 0
    let hedged = 0
    for (let z = -3000; z <= 3000; z += 5.3) {
      for (let x = -3000; x <= 3000; x += 5.3) {
        regionAt(x, z, reg)
        if (reg.r2 - reg.r1 < TRACK_WIDTH) continue
        fieldAt(x, z, reg, s)
        if (s.f2 - s.f1 >= s.hedgeThreshold) continue
        boundary++
        if (at(x, z) === '2c3a24') hedged++
      }
    }
    const share = hedged / boundary
    console.log(JSON.stringify({
      田界取樣: boundary,
      有樹籬: (share * 100).toFixed(1) + '%',
      HEDGE_CHANCE,
    }))
    expect(share).toBeGreaterThan(HEDGE_CHANCE - 0.12)
    expect(share).toBeLessThan(HEDGE_CHANCE + 0.12)
  })

  /**
   * 【深色線不能佔太多地】改版前是 17%，畫出來像迷彩網。樹籬 16 m 寬、
   * 只長一半，加上農路，總量應該落在一成以內。
   */
  it('樹籬與農路加起來不超過一成', () => {
    let dark = 0
    let n = 0
    for (let z = -4000; z <= 4000; z += 7.1) {
      for (let x = -4000; x <= 4000; x += 7.1) {
        const c = at(x, z)
        if (c === '2c3a24' || c === '9c8f6e') dark++
        n++
      }
    }
    const share = (100 * dark) / n
    console.log(JSON.stringify({ 樹籬加農路: share.toFixed(1) + '%' }))
    expect(share).toBeGreaterThan(2)
    expect(share).toBeLessThan(10)
  })

  /**
   * 【配色要成片，不能雜訊】同一區裡的田只在基調 ±1 挑，所以相鄰兩塊的
   * 亮度差有上限。量法：沿一條線走，記錄跨過田界時亮度的跳幅。
   */
  it('同一區裡相鄰兩塊田的色差有限', () => {
    let worst = 0
    const a = new Color()
    const b = new Color()
    for (let z = -2000; z <= 2000; z += 91) {
      for (let x = -2000; x < 2000; x += 3) {
        regionAt(x, z, reg)
        if (reg.r2 - reg.r1 < TRACK_WIDTH + 40) continue
        fieldAt(x, z, reg, s)
        // 只看真的跨過一條田界的取樣
        if (s.f2 - s.f1 > s.hedgeThreshold * 3) continue
        fieldSurfaceColor(x - 40, z, a)
        fieldSurfaceColor(x + 40, z, b)
        // 【農路也要排除】它是乾土色，比任何一塊田都亮 —— 初稿漏掉它，
        // 量到 0.615 而以為是配色沒有相關
        const skip = ['2c3a24', '6b5238', '9c8f6e']
        if (skip.includes(a.getHexString()) || skip.includes(b.getHexString())) continue
        worst = Math.max(worst, Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b))
      }
    }
    console.log(JSON.stringify({ 最大色差: worst.toFixed(3) }))
    // 基調 ±1 加上亮度抖動的上限。改成隨機挑色盤的話這個數字會翻倍
    expect(worst).toBeLessThan(0.30)
  })

  it('田的尺度落在間距的區間裡', () => {
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
      最小短軸: minCell.toFixed(0) + ' m',
      最大短軸: maxCell.toFixed(0) + ' m',
    }))
    expect(minCell).toBeGreaterThanOrEqual(FIELD_SPACING * FIELD_SPACING_VAR[0] - 1)
    expect(maxCell).toBeLessThanOrEqual(FIELD_SPACING * FIELD_SPACING_VAR[1] + 1)
  })

  it('顏色不是全部同一色', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 600; i++) seen.add(at(i * 411.7, i * -233.3))
    expect(seen.size).toBeGreaterThan(8)
  })

  /**
   * 【這一條只證明常數沒有漂，不證明演算法是對的】GLSL 跑不進 headless，
   * 所以**語法**由 `farmland-shot.e2e.ts` 在真的 WebGL2 context 裡編譯來守，
   * 而**演算法**由下面那條金本位守。三條合起來才夠。
   */
  it('GLSL 的常數由 TS 那一份產生', () => {
    for (const v of [
      FIELD_SPACING.toFixed(1), FIELD_ANISO.toFixed(3), FIELD_JITTER.toFixed(3),
      REGION_SPACING.toFixed(1), HEDGE_WIDTH.toFixed(1), HEDGE_CHANCE.toFixed(3),
      TRACK_WIDTH.toFixed(1),
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
      'h = (h ^ (h >> 15u)) * 0x846ca68bu;',
      'float ox = (float(h & 0xffffu) / 65536.0 - 0.5) * 2.0 * FIELD_JITTER;',
      'uint h = fieldHash2(i ^ int(rid), j);',
      'vec2 seed = (vec2(float(i), float(j)) + 0.5 + vec2(ox, oz)) * cellW;',
      'if (d < f1) { f2 = f1; id2 = id; s2 = s1; f1 = d; id = h; s1 = seed; }',
      'float hedge = HEDGE_WIDTH * length(vec2(e.x, e.y / FIELD_ANISO));',
      'if (r2 - r1 < TRACK_WIDTH) return TRACK_COLOR;',
      'float(fieldHash1(id ^ id2)) / 4294967296.0 < HEDGE_CHANCE',
      '(world.x * sn + world.y * cs) / FIELD_ANISO);',
      'int t = clamp(tone + int((fh >> 8u) % 3u) - 1, 0, 7);',
    ]
    for (const line of want) expect(FIELD_GLSL).toContain(line)
  })
})

/**
 * 7×7 的暴力解，回傳最近與次近。
 *
 * 【為什麼測試自己抄一份種子的算式】上面那條測試要問的是「3×3 夠不夠」，
 * 而不是「雜湊是什麼」。共用同一支的話，雜湊本身錯了兩邊會一起錯。
 */
function brute(
  x: number, z: number, angle: number, cell: number, aniso: number, mix: number,
): [number, number] {
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  const qx = x * cos - z * sin
  const qz = (x * sin + z * cos) / aniso
  const gx = Math.floor(qx / cell)
  const gz = Math.floor(qz / cell)
  let f1 = Infinity
  let f2 = Infinity
  for (let dj = -3; dj <= 3; dj++) {
    for (let di = -3; di <= 3; di++) {
      const h = hash2((gx + di) ^ mix, gz + dj)
      const ox = ((h & 0xffff) / 65536 - 0.5) * 2 * FIELD_JITTER
      const oz = ((h >>> 16) / 65536 - 0.5) * 2 * FIELD_JITTER
      const sx = (gx + di + 0.5 + ox) * cell
      const sz = (gz + dj + 0.5 + oz) * cell
      const d = Math.hypot(qx - sx, qz - sz)
      if (d < f1) { f2 = f1; f1 = d } else if (d < f2) f2 = d
    }
  }
  return [f1, f2]
}

/** 與 `fields.ts` 裡那一支必須相同 */
function hash2(i: number, j: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2545f491)
  return (h ^ (h >>> 13)) >>> 0
}
