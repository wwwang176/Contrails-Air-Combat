import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import {
  fieldAt, fieldColor, FIELD_GLSL, FIELD_JITTER, FIELD_SPACING, HEDGE_WIDTH,
  type FieldSample,
} from '../../src/render/fields'

const s: FieldSample = { f1: 0, f2: 0, id: 0 }

describe('田區的抖動網格 Voronoi', () => {
  it('同一個世界座標恆得到同一塊田', () => {
    fieldAt(1234.5, -8765.25, s)
    const first = s.id
    fieldAt(1234.5, -8765.25, s)
    expect(s.id).toBe(first)
  })

  /**
   * 【為什麼要與 7×7 對答案】3×3 的鄰域搜尋只在抖動 ≤ 0.5 格時保證找得到
   * 最近的種子，而**次近**的那一顆條件更嚴。這一條直接暴力比對，把
   * 「搜尋範圍不夠」這個失效變成測得到的。
   */
  it('3×3 的搜尋與 7×7 的暴力解一致', () => {
    let worst = 0
    for (let z = -900; z <= 900; z += 7) {
      for (let x = -900; x <= 900; x += 7) {
        fieldAt(x, z, s)
        const [b1, b2] = bruteForce(x, z)
        worst = Math.max(worst, Math.abs(s.f1 - b1), Math.abs(s.f2 - b2))
      }
    }
    console.log(JSON.stringify({ 最大誤差: worst.toExponential(2) }))
    expect(worst).toBeLessThan(1e-9)
  })

  it('抖動小於半格 —— 3×3 的前提', () => {
    expect(FIELD_JITTER).toBeLessThan(0.5)
  })

  /**
   * 【為什麼量面積佔比，不量「沿掃描線的長度」】掃描線若剛好平行於一條
   * 分界線，會一路貼著它走 —— 初稿那樣量到的最長是 602 m，而帶寬只有 26 m。
   * 那個數字量的是掃描線的走向，不是帶寬。
   *
   * 【佔比是推導的】垂直平分線附近 `f2 − f1 ≈ 2 ×（到平分線的帶號距離）`，
   * 所以 `f2 − f1 < W` 的區域寬度恰好是 `W`。抖動網格每一格約四個鄰居、
   * 每條邊由兩格共用，所以單位面積的分界線長度約 `2 / spacing`，
   * 佔比因此約 `2W / spacing = 2 × 26 / 340 = 15.3%`。
   */
  it('防風林的面積佔比與帶寬對得上', () => {
    const fraction = (w: number): number => {
      let hit = 0
      let n = 0
      for (let z = -1700; z <= 1700; z += 3.1) {
        for (let x = -1700; x <= 1700; x += 3.1) {
          fieldAt(x, z, s)
          if (s.f2 - s.f1 < w) hit++
          n++
        }
      }
      return hit / n
    }
    const full = fraction(HEDGE_WIDTH)
    const half = fraction(HEDGE_WIDTH / 2)
    const predicted = (2 * HEDGE_WIDTH) / FIELD_SPACING
    console.log(JSON.stringify({
      佔比: (full * 100).toFixed(1) + '%',
      推導: (predicted * 100).toFixed(1) + '%',
      半寬的佔比: (half * 100).toFixed(1) + '%',
    }))
    // 【區間寬是因為「每格四個鄰居」只是量級】真實的抖動網格有五邊、六邊的格
    expect(full).toBeGreaterThan(predicted * 0.6)
    expect(full).toBeLessThan(predicted * 1.4)
    // 【線性才證明它真的是一條等寬的帶】門檻減半，佔比也要跟著減半
    expect(half / full).toBeGreaterThan(0.42)
    expect(half / full).toBeLessThan(0.58)
  })

  /**
   * 【上界是推導的，不是量出來的】一個點自己那一格的種子，兩軸各最多偏
   * `0.5 + FIELD_JITTER` 格 —— 所以離它不會超過
   * `√2 × (0.5 + 0.38) = 1.244` 倍間距。抓到比這個大的值，代表 `fieldAt`
   * 挑錯了種子（例如網格對齊差半格）。
   */
  it('田的尺度與間距同量級', () => {
    const bound = FIELD_SPACING * Math.SQRT2 * (0.5 + FIELD_JITTER)
    let maxF1 = 0
    let sum = 0
    let n = 0
    for (let z = -3000; z <= 3000; z += 31) {
      for (let x = -3000; x <= 3000; x += 31) {
        fieldAt(x, z, s)
        maxF1 = Math.max(maxF1, s.f1)
        sum += s.f1
        n++
      }
    }
    console.log(JSON.stringify({
      離種子最遠: maxF1.toFixed(1) + ' m',
      平均: (sum / n).toFixed(1) + ' m',
      上界: bound.toFixed(1) + ' m',
      FIELD_SPACING,
    }))
    expect(maxF1).toBeLessThan(bound)
    // 【平均要落在間距的一半上下】全部擠在一角的話上面那條照樣會過
    expect(sum / n).toBeGreaterThan(FIELD_SPACING * 0.3)
    expect(sum / n).toBeLessThan(FIELD_SPACING * 0.7)
  })

  it('顏色由 id 決定，而且不是全部同一色', () => {
    const seen = new Set<string>()
    const c = new Color()
    for (let i = 0; i < 400; i++) {
      fieldAt(i * 411.7, i * -233.3, s)
      seen.add(fieldColor(s.id, c).getHexString())
    }
    expect(seen.size).toBeGreaterThan(3)
  })

  /**
   * 【這一條只證明常數沒有漂，不證明演算法是對的】GLSL 跑不進 headless，
   * 所以**語法**由 `farmland-shot.e2e.ts` 在真的 WebGL2 context 裡編譯來守，
   * 而**演算法**由下面那條金本位守。三條合起來才夠。
   */
  it('GLSL 的常數由 TS 那一份產生', () => {
    expect(FIELD_GLSL).toContain(FIELD_SPACING.toFixed(1))
    expect(FIELD_GLSL).toContain(HEDGE_WIDTH.toFixed(1))
    expect(FIELD_GLSL).toContain(FIELD_JITTER.toFixed(3))
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
      'return h ^ (h >> 13u);',
      'float ox = (float(h & 0xffffu) / 65536.0 - 0.5) * 2.0 * FIELD_JITTER;',
      'float oz = (float(h >> 16u) / 65536.0 - 0.5) * 2.0 * FIELD_JITTER;',
      'if (d < f1) { f2 = f1; f1 = d; id = h; }',
      'if (f2 - f1 < HEDGE_WIDTH) return HEDGE_COLOR;',
    ]
    for (const line of want) expect(FIELD_GLSL).toContain(line)
  })
})

/** 7×7 的暴力解，回傳最近與次近 */
function bruteForce(x: number, z: number): [number, number] {
  const gx = Math.floor(x / FIELD_SPACING)
  const gz = Math.floor(z / FIELD_SPACING)
  let f1 = Infinity
  let f2 = Infinity
  for (let dj = -3; dj <= 3; dj++) {
    for (let di = -3; di <= 3; di++) {
      const i = gx + di
      const j = gz + dj
      const h = hash2(i, j)
      const ox = ((h & 0xffff) / 65536 - 0.5) * 2 * FIELD_JITTER
      const oz = ((h >>> 16) / 65536 - 0.5) * 2 * FIELD_JITTER
      const sx = (i + 0.5 + ox) * FIELD_SPACING
      const sz = (j + 0.5 + oz) * FIELD_SPACING
      const d = Math.hypot(x - sx, z - sz)
      if (d < f1) { f2 = f1; f1 = d } else if (d < f2) f2 = d
    }
  }
  return [f1, f2]
}

/**
 * 與 `fields.ts` 裡那一支必須相同。
 *
 * 【為什麼測試自己抄一份】上面那條測試要問的是「3×3 夠不夠」，而不是
 * 「雜湊是什麼」。共用同一支的話，雜湊本身錯了兩邊會一起錯。
 */
function hash2(i: number, j: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2545f491)
  return (h ^ (h >>> 13)) >>> 0
}
