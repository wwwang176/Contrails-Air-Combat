import { describe, it, expect } from 'vitest'
import { Quaternion } from 'three'
import {
  ALPHA_MARGIN, PILOT_G_POSITIVE, QMAX_FLOOR,
  createPitchLimit, gLoadFromOrientation, pitchRateLimit,
} from '../../src/control/limiters'
import { atmosphere } from '../../src/physics/atmosphere'
import { computeAeroState, liftCoefficient } from '../../src/physics/aero'
import { cornerSpeed, stallSpeed } from '../../src/analysis/envelope'
import { G0 } from '../../src/core/math'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { Vector3 } from 'three'
import type { AeroState, AirData } from '../../src/physics/types'

function setup(altitude: number, tas: number) {
  const air: AirData = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }
  atmosphere(altitude, air)
  const aero: AeroState = { tas: 0, alpha: 0, beta: 0, qbar: 0, mach: 0 }
  computeAeroState(new Vector3(0, 0, -tas), air, aero)
  return { air, aero }
}

// 正立平飛的 gLoad——本檔案絕大多數測試不關心姿態，只關心 nAero/nLimit/
// source 這些與 gLoad 無關的量，或在需要 qMax 數值時假設正立平飛。
const LEVEL = 1

describe('pitchRateLimit', () => {
  it('失速速度附近可用過載接近 1，迎角為限制來源', () => {
    const vs = stallSpeed(P51D, 0, 1)
    const { aero } = setup(0, vs)
    const out = pitchRateLimit(P51D, aero, false, LEVEL, createPitchLimit())
    expect(out.nLimit).toBeLessThan(1.3)
    expect(out.source).toBe('alpha')
  })

  it('高速時由飛行員或結構限制接手', () => {
    const { aero } = setup(0, 200)
    const out = pitchRateLimit(P51D, aero, false, LEVEL, createPitchLimit())
    expect(out.source === 'pilot' || out.source === 'structure').toBe(true)
    expect(out.nLimit).toBeLessThanOrEqual(P51D.limits.gPositive)
  })

  it('可用過載永不超過結構極限', () => {
    for (const v of [80, 150, 250, 350]) {
      const { aero } = setup(0, v)
      const out = pitchRateLimit(P51D, aero, false, LEVEL, createPitchLimit())
      expect(out.nLimit).toBeLessThanOrEqual(P51D.limits.gPositive + 1e-9)
    }
  })

  it('飛行員極限**不再**夾住過載 —— 生理限制只以黑視呈現', () => {
    // 【這條測的是 2026-08-11 的裁決，方向與它取代的那條相反】
    // 舊測試斷言 nLimit ≤ PILOT_G_POSITIVE。那個硬夾是錯的模型：真實的
    // 飛行員拉得過去，代價是黑視（hud/widgets/gEffect.ts），不是操縱面
    // 突然不理他。副作用是 spec 裡的結構極限從來沒有生效過。
    //
    // 保留一條**反向**斷言而不是直接刪掉，是因為「有沒有人把夾制加回來」
    // 需要被守住 —— 直接刪掉的話，重新引入 6.5 G 硬夾不會有任何測試轉紅。
    const { aero } = setup(0, 300)
    const out = pitchRateLimit(P51D, aero, false, LEVEL, createPitchLimit())
    expect(out.nLimit).toBeGreaterThan(PILOT_G_POSITIVE)
    expect(out.source).not.toBe('pilot')
  })

  it('qMax 隨速度上升先增後受過載上限壓平', () => {
    const rates: number[] = []
    for (const v of [80, 120, 160, 200, 260, 320]) {
      const { aero } = setup(0, v)
      rates.push(pitchRateLimit(P51D, aero, false, LEVEL, createPitchLimit()).qMax)
    }
    expect(rates[1]!).toBeGreaterThan(rates[0]!)
    // 高速段因 qMax = (n−gLoad)·g/V 而遞減
    expect(rates[5]!).toBeLessThan(rates[3]!)
  })

  // 【已移除】原斷言比較 qMax(70) 與 qMax(160)*0.6，意圖驗證「低速能量不足」，
  // 但 qMax(V) 是單峰函數，V=70 與 V=160 分屬峰值兩側，比較它們並不能代表
  // 「低速能量不足」。已改用下方三則斷言取代：直接釘住「低速時限制來源是
  // 氣動且遠低於結構極限」「高速時限制來源是飛行員且氣動遠超過飛行員上限」
  // 「qMax 峰值落在轉折速度附近，與 envelope.cornerSpeed 有可解釋的偏移」。
  // 詳見 task-17-report.md 第一輪分析。

  it('低速時限制來源是氣動（迎角），且遠低於結構極限', () => {
    // 實測（P-51D 海平面 V=70 m/s）：nAero=2.2253，結構極限 8G，
    // 餘裕 5.7747G——「低速拉不動」不是接近結構極限，而是氣動本身就
    // 給不出多少過載。此結論與 gLoad／qMax 公式無關，nAero 本身未變。
    const { aero } = setup(0, 70)
    const out = pitchRateLimit(P51D, aero, false, LEVEL, createPitchLimit())
    expect(out.source).toBe('alpha')
    expect(out.nLimit).toBeCloseTo(out.nAero, 10)
    expect(out.nAero).toBeLessThan(P51D.limits.gPositive * 0.5)
  })

  it('高速時限制來源是結構，且氣動可用過載遠超過結構極限', () => {
    // 實測（P-51D 海平面 V=160 m/s）：nAero=11.6258，結構極限 8G，
    // 比值 1.4532——機翼還能給更多，是機體先撐不住。
    //
    // 【2026-08-11 之前這條測的是 'pilot'】當時 6.5 G 的飛行員硬夾比結構
    // 極限低，所以結構分支形同死碼。硬夾拿掉之後 source 換成 'structure'，
    // nAero 本身沒變（它不受任何夾制影響）。
    const { aero } = setup(0, 160)
    const out = pitchRateLimit(P51D, aero, false, LEVEL, createPitchLimit())
    expect(out.source).toBe('structure')
    expect(out.nLimit).toBeCloseTo(P51D.limits.gPositive, 10)
    expect(out.nAero).toBeGreaterThan(P51D.limits.gPositive * 1.4)
  })

  it('qMax 峰值落在轉折速度附近，與 envelope.cornerSpeed 有可解釋的偏移', () => {
    // 峰值位置只由 nAero(V) 與 min(結構,飛行員) 的交叉點決定，與 gLoad
    // 無關（qMax = (nLimit−gLoad)·g/V 在交叉點左側嚴格遞增、右側嚴格
    // 遞減，極值必在交叉點——加回 gLoad 只改變峰值「高度」，不改變
    // 「位置」）。
    //
    // 【2026-08-11：偏移方向反轉，而且現在有閉式解】飛行員硬夾拿掉之後，
    // cornerSpeed 與 qMax 峰值**用的是同一個過載上限**（結構極限），
    // 差別只剩 CL：cornerSpeed 用滿 CL_max，峰值用 0.95·α_crit 的餘裕 CL。
    // 於是比值可以直接算出來：
    //
    //   CL 比 = (0.95·α_crit − α_0) / (α_crit − α_0)
    //         = (0.95×17 + 2.5) / (17 + 2.5) = 18.65 / 19.5 = 0.9564
    //   速度比 = 1/√0.9564 = 1.0225          （n ∝ V²·CL，n 相同時 V ∝ 1/√CL）
    //
    // 峰值因此落在 cornerSpeed 的**上方** 2.25%（舊制是下方 2~15%，因為
    // 當時峰值用 6.5 G 而 cornerSpeed 用 8 G，過載差主導了方向）。
    // 實測 132.73 / 129.80 = 1.0226，與閉式解差 1e-4。
    let bestV = 0
    let bestQ = -Infinity
    for (let v = 50; v <= 200; v += 0.5) {
      const { aero } = setup(0, v)
      const q = pitchRateLimit(P51D, aero, false, LEVEL, createPitchLimit()).qMax
      if (q > bestQ) { bestQ = q; bestV = v }
    }
    for (let v = bestV - 1; v <= bestV + 1; v += 0.01) {
      const { aero } = setup(0, v)
      const q = pitchRateLimit(P51D, aero, false, LEVEL, createPitchLimit()).qMax
      if (q > bestQ) { bestQ = q; bestV = v }
    }
    const corner = cornerSpeed(P51D, 0)
    // 閉式解 1.0225；區間留 ±1% 給掃描解析度（0.01 m/s）與浮點誤差
    expect(bestV).toBeGreaterThan(corner * 1.012)
    expect(bestV).toBeLessThan(corner * 1.033)
  })

  it('Bf 109 縫翼展開時可用過載高於未展開，且幅度與縫翼加成一致', () => {
    // 只驗證 slats > clean 會被「slatsDeployed 傳進 liftCoefficient 卻沒有
    // 真的加上 slatAlphaBonus」這種變異蒙混過去（例如誤傳 false 進
    // liftCoefficient，讓計算落入失速後崩塌段而不是線性段，仍能產生
    // 一個「更大」但幅度錯誤的值）。改為驗證幅度：縫翼展開時 alphaCrit
    // 增加 slatAlphaBonus，兩種狀態都仍在線性段內，故 nAero 之比應等於
    // CL 之比（CL 對迎角線性），與翼面積、動壓等因子無關。
    const { aero } = setup(0, 110)
    const clean = pitchRateLimit(BF109K4, aero, false, LEVEL, createPitchLimit())
    const slats = pitchRateLimit(BF109K4, aero, true, LEVEL, createPitchLimit())
    expect(clean.source).toBe('alpha')
    expect(slats.source).toBe('alpha')
    const clClean = liftCoefficient(BF109K4, BF109K4.lift.alphaCrit * ALPHA_MARGIN, false)
    const clSlats = liftCoefficient(
      BF109K4,
      BF109K4.lift.alphaCrit * ALPHA_MARGIN + BF109K4.lift.slatAlphaBonus,
      true,
    )
    expect(slats.nAero / clean.nAero).toBeCloseTo(clSlats / clClean, 6)
    expect(slats.nAero / clean.nAero).toBeGreaterThan(1.1) // 實測 ≈1.15，取整數下界防止假陽性
  })

  it('高空同速度下可用過載低於海平面', () => {
    const low = setup(0, 180)
    const high = setup(8000, 180)
    const nLow = pitchRateLimit(P51D, low.aero, false, LEVEL, createPitchLimit()).nAero
    const nHigh = pitchRateLimit(P51D, high.aero, false, LEVEL, createPitchLimit()).nAero
    expect(nHigh).toBeLessThan(nLow)
  })

  it('ALPHA_MARGIN 實際套用在 nAero 上（非僅範圍檢查）', () => {
    // 原斷言只驗證 0.8<ALPHA_MARGIN<1，刪掉源碼裡的 *ALPHA_MARGIN 乘項
    // 完全不影響它（見 task-17-report.md 的 mutation 紀錄）。這裡改為
    // 獨立算出「用滿 α_crit（不打折）算出的 nAero」與「用 0.95·α_crit
    // 算出的 nAero」，驗證 pitchRateLimit 回傳的正是後者，而不是前者
    // 或介於兩者之間的任意值——用滿 CL 而非 0.95 margin 會讓比例偏離
    // 預期比值，斷言必定紅燈。
    const { aero } = setup(0, 70) // P-51D 在此速度是 alpha-limited（見上）
    const out = pitchRateLimit(P51D, aero, false, LEVEL, createPitchLimit())
    const clFull = liftCoefficient(P51D, P51D.lift.alphaCrit, false)
    const clMargin = liftCoefficient(P51D, P51D.lift.alphaCrit * ALPHA_MARGIN, false)
    const nAeroFull = (aero.qbar * P51D.wing.area * clFull) / (P51D.mass * G0)
    expect(out.nAero).toBeCloseTo(nAeroFull * (clMargin / clFull), 6)
    // 且必須嚴格小於「不打折」的版本，否則 margin 沒有真的在降低可用過載
    expect(out.nAero).toBeLessThan(nAeroFull)
  })

  it('迎角餘裕比例本身落在合理區間', () => {
    expect(ALPHA_MARGIN).toBeLessThan(1)
    expect(ALPHA_MARGIN).toBeGreaterThan(0.8)
  })

  it('零速度不產生 NaN', () => {
    const { aero } = setup(0, 0)
    const out = pitchRateLimit(P51D, aero, false, LEVEL, createPitchLimit())
    expect(Number.isFinite(out.qMax)).toBe(true)
    expect(Number.isFinite(out.nLimit)).toBe(true)
  })

  it('寫入傳入的 out 並回傳同一參考（零配置）', () => {
    const { aero } = setup(0, 180)
    const out = createPitchLimit()
    expect(pitchRateLimit(P51D, aero, false, LEVEL, out)).toBe(out)
  })

  it('gLoad 反映重力支持：倒飛時 qMax 高於正立平飛（同一 nLimit）', () => {
    // 正立平飛 gLoad=1：重力已提供 1G，舵面只需再拉 (n−1)。
    // 倒飛 gLoad=−1：重力反向幫倒忙，舵面要拉滿 (n+1)，但這裡驗證的是
    // 「指揮儀允許提交的角速度指令」——倒飛時要達到同樣的過載 n，
    // 需要更高的俯仰率（因為重力在扯後腿），qMax 應該更高，不是更低。
    const { aero } = setup(0, 160) // 飛行員上限段，nLimit 恆為 6.5，互相可比
    const level = pitchRateLimit(P51D, aero, false, 1, createPitchLimit())
    const inverted = pitchRateLimit(P51D, aero, false, -1, createPitchLimit())
    expect(level.nLimit).toBeCloseTo(inverted.nLimit, 10) // 過載上限與姿態無關
    expect(inverted.qMax).toBeGreaterThan(level.qMax)
    expect(inverted.qMax).toBeCloseTo(((inverted.nLimit + 1) * G0) / aero.tas, 10)
    expect(level.qMax).toBeCloseTo(((level.nLimit - 1) * G0) / aero.tas, 10)
  })

  it('gLoad 造成 n_limit−gLoad ≤ 0 時，qMax 夾在地板值而非 0 或負值', () => {
    // 失速速度附近 nLimit≈0.956（見上）；正立平飛時 n_limit−gLoad<0，
    // 若無地板 qMax 會是負值——指揮儀不該指令「反向」拉桿。
    const vs = stallSpeed(P51D, 0, 1)
    const { aero } = setup(0, vs)
    const out = pitchRateLimit(P51D, aero, false, LEVEL, createPitchLimit())
    expect(out.nLimit).toBeLessThan(1) // 確認確實落在會觸發地板的區間
    expect(out.qMax).toBe(QMAX_FLOOR)
  })

  it('gLoadFromOrientation：正立為 1、倒飛為 −1、90° 坡度為 0', () => {
    const level = gLoadFromOrientation(new Quaternion())
    expect(level).toBeCloseTo(1, 10)

    const inverted = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI)
    expect(gLoadFromOrientation(inverted)).toBeCloseTo(-1, 10)

    const banked90 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
    expect(gLoadFromOrientation(banked90)).toBeCloseTo(0, 6)
  })
})
