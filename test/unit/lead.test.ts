import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { interceptTime, solveLead, NO_INTERCEPT } from '../../src/world/lead'

/**
 * spec §5.2：`|P + V·t| = s·t` 的最小正根。
 *
 * 【為什麼要逐格覆蓋五種分支】spec 明講這是整個 M2 最容易寫錯又最不容易
 * 被發現的地方。特別是「目標比彈快就無解」是**錯的**——迎頭接近時仍然
 * 有解，而那正好是最常見的正面交鋒。
 */
const S = 887   // .50 BMG

describe('interceptTime —— 五種分支', () => {
  it('分支 1：a < 0（彈比目標快）恆有唯一正根', () => {
    const P = new Vector3(0, 0, -500)
    const V = new Vector3(0, 0, 0)
    expect(interceptTime(P, V, S)).toBeCloseTo(500 / S, 9)
  })

  it('分支 1（續）：橫向移動的目標仍有唯一正根，且滿足原式', () => {
    const P = new Vector3(0, 0, -300)
    const V = new Vector3(200, 0, 0)
    const t = interceptTime(P, V, S)
    expect(t).toBeGreaterThan(0)
    expect(P.clone().addScaledVector(V, t).length()).toBeCloseTo(S * t, 6)
  })

  it('分支 2：a > 0 且 b ≥ 0（目標比彈快且正在遠離）無解', () => {
    const P = new Vector3(0, 0, -300)
    const V = new Vector3(0, 0, -1000)   // 沿視線遠離，比彈快
    expect(interceptTime(P, V, S)).toBe(NO_INTERCEPT)
  })

  it('分支 3：a > 0、b < 0、判別式 < 0 無解', () => {
    // 比彈快、略微接近但橫向分量太大，追不上
    const P = new Vector3(0, 0, -300)
    const V = new Vector3(950, 0, 312)
    expect(V.length()).toBeGreaterThan(S)
    expect(interceptTime(P, V, S)).toBe(NO_INTERCEPT)
  })

  it('分支 4：a > 0、b < 0、判別式 ≥ 0 兩根皆正，取小的', () => {
    const P = new Vector3(0, 0, -300)
    const V = new Vector3(600, 0, 800)
    expect(V.length()).toBeGreaterThan(S)
    const t = interceptTime(P, V, S)
    expect(t).toBeGreaterThan(0)
    expect(P.clone().addScaledVector(V, t).length()).toBeCloseTo(S * t, 6)

    // 另一根也是正的，而且比較大——確認取到的是小的那一個
    const a = V.lengthSq() - S * S
    const b = 2 * P.dot(V)
    const c = P.lengthSq()
    const other = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a)
    expect(other).toBeGreaterThan(0)
    expect(t).toBeLessThan(other)
  })

  it('分支 5：|a| ≈ 0 退化成一次式，且僅在 b < 0 時有效', () => {
    const P = new Vector3(0, 0, -300)
    // 目標速度恰等於初速、正面接近 → 有解
    expect(interceptTime(P, new Vector3(0, 0, S), S)).toBeCloseTo(300 / (2 * S), 9)
    // 目標速度恰等於初速、沿視線遠離 → 永遠追不上
    expect(interceptTime(P, new Vector3(0, 0, -S), S)).toBe(NO_INTERCEPT)
  })

  it('退化情形不可直接除以 a：|a| ≈ 0 的結果必須有限且為正', () => {
    // 缺陷版本在這裡會得到 ±Infinity 或 NaN，預瞄環於是閃爍或飛走。
    const P = new Vector3(0, 0, -300)
    for (const eps of [0, 1e-7, -1e-7]) {
      const t = interceptTime(P, new Vector3(0, 0, S + eps), S)
      expect(Number.isFinite(t)).toBe(true)
      expect(t).toBeGreaterThan(0)
    }
  })
})

describe('interceptTime —— spec §5.1.1 的算例', () => {
  it('雙方各 200 m/s 迎頭、目標 900 m：t = 0.70 s，彈丸只飛了 621 m', () => {
    // 這一組數字直接來自 spec，是「上限用壽命不用射程」那段的證據。
    const P = new Vector3(0, 0, -900)
    const V = new Vector3(0, 0, 400)   // 目標 +200 − 射手 −200
    const t = interceptTime(P, V, S)
    expect(t).toBeCloseTo(0.699, 3)
    expect(S * t).toBeCloseTo(620, 0)
    // 打得到（在 1.2 s 壽命內），儘管距離 900 m
    expect(t).toBeLessThan(1.2)
  })

  it('尾追時攔截點比現在遠：700 m 的目標可能打不到', () => {
    // 目標以 250 m/s 遠離、射手 200 m/s，彈丸相對速度只有 887 − 50 = 837
    const P = new Vector3(0, 0, -700)
    const V = new Vector3(0, 0, -50)
    const t = interceptTime(P, V, S)
    expect(t).toBeGreaterThan(700 / S)   // 比「直接除距離」更久
  })
})

describe('邊界', () => {
  it('目標與射手重疊時回傳 0', () => {
    expect(interceptTime(new Vector3(), new Vector3(1, 2, 3), S)).toBe(0)
  })

  it('靜止目標的解就是距離除以初速', () => {
    for (const d of [10, 100, 1064]) {
      const t = interceptTime(new Vector3(0, d, 0), new Vector3(), S)
      expect(t).toBeCloseTo(d / S, 9)
    }
  })
})

describe('solveLead', () => {
  it('回傳攔截時間，並把預瞄方向寫進 out（單位向量）', () => {
    const P = new Vector3(0, 0, -300)
    const V = new Vector3(200, 0, 0)
    const out = new Vector3()
    const t = solveLead(P, V, S, out)
    expect(t).toBeGreaterThan(0)
    expect(out.length()).toBeCloseTo(1, 12)
    // 預瞄方向必須落在目標未來位置上。
    // 【容差為什麼是 1e-6 而不是 1e-9】angleTo 是 acos，在夾角趨近 0 時
    // 導數發散，絕對誤差下限約 √(machine eps) ≈ 1.5e-8——比這更嚴的門檻
    // 測的是浮點數不是解算器。而解錯的話夾角會是預瞄角本身的量級
    // （這一組約 0.22 rad），1e-6 綽綽有餘分得開。
    expect(out.angleTo(P.clone().addScaledVector(V, t))).toBeLessThan(1e-6)
  })

  it('橫向移動的目標，預瞄方向必須偏向運動方向', () => {
    const P = new Vector3(0, 0, -300)
    const out = new Vector3()
    solveLead(P, new Vector3(200, 0, 0), S, out)
    expect(out.x).toBeGreaterThan(0)
  })

  it('無解時不動 out —— 呼叫端才能安全地沿用上一幀的值', () => {
    const out = new Vector3(1, 2, 3)
    const t = solveLead(new Vector3(0, 0, -300), new Vector3(0, 0, -1000), S, out)
    expect(t).toBe(NO_INTERCEPT)
    expect(out.toArray()).toEqual([1, 2, 3])
  })

  it('不修改輸入的 P 與 V', () => {
    const P = new Vector3(0, 0, -300)
    const V = new Vector3(200, 0, 0)
    solveLead(P, V, S, new Vector3())
    expect(P.toArray()).toEqual([0, 0, -300])
    expect(V.toArray()).toEqual([200, 0, 0])
  })
})
