import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PROP_BLUR, PROP_BLUR_SPIN, advancePropBlur, countBlades, propBlurRate } from '../../src/render/propBlur'

describe('螺旋槳殘影的參數與轉動', () => {
  /** 試聽頁（/tools/propblur.html）調定的那一組 */
  it('參數是調整頁定案的那一組', () => {
    expect(PROP_BLUR).toEqual({
      opacity: 1, rootAlpha: 1, tipAlpha: 0.07, fadeCurve: 1.9, rootSmear: 0.05, tipSmear: 0.205,
      smearCurve: 1.4, bladeWidth: 0.075, base: 0.3, baseCurve: 3.7, spin: 25, shade: 0,
    })
  })

  it('殘影時鐘照經過的秒數走', () => {
    PROP_BLUR_SPIN.clock = 0
    advancePropBlur(0.01)
    expect(PROP_BLUR_SPIN.clock).toBeCloseTo(0.01, 12)
  })

  /** 【轉速跟著油門】油門 100% = `spin`、70% = 0.7 × `spin`，等比例 */
  it('殘影轉速 = spin × 這一架的油門', () => {
    expect(propBlurRate(1)).toBe(PROP_BLUR.spin)
    expect(propBlurRate(0.7)).toBeCloseTo(17.5, 9)
    expect(propBlurRate(0)).toBe(0)
  })

  /** 每一架的油門不同，所以傳給模型的是這一架自己的油門；換成殘影的門檻（15%）不變 */
  it('畫面每幀把這一架的油門交給槳盤', () => {
    const vis = readFileSync('src/render/aircraftVisuals.ts', 'utf8')
    expect(vis).toContain('shown.setPropSpin(propRotation, c.command.throttle > 0.15, c.command.throttle)')
  })

  /**
   * 【每一幀都推進，所有畫面】選單短片、機庫也有轉動的螺旋槳。戰鬥中照遊戲的流速（結算的慢動作
   * 一起慢、暫停不動）
   */
  it('主迴圈每一幀推進殘影，戰鬥中照遊戲流速', () => {
    const main = readFileSync('src/main.ts', 'utf8').replace(/\r\n/g, '\n')
    const at = main.indexOf('function frame(now: number) {')
    const fn = main.slice(at, main.indexOf('\n}\n', at))
    // 【載入中當成戰鬥外】第一場載入時畫面已經是 battle、`battle` 還沒建，讀它的 outcome 會拋錯
    expect(fn).toContain("const inBattle = screen === 'battle' && !loadingBattle")
    expect(fn).toContain('advancePropBlur(propBlurSeconds)')
    expect(fn).toContain('const propBlurSeconds = !inBattle ? frameSeconds : paused ? 0 : frameSeconds * timeScale(battle.outcome, sinceBattleEnd)')
  })
})

/** 合成的槳葉頂點：`n` 片、每片從槳根到槳尖一排點，加一點寬度與起始角 */
function blades(n: number, radius: number, start = 0, width = 0.12): Float32Array {
  const out: number[] = []
  for (let b = 0; b < n; b++) {
    const a0 = start + (b / n) * Math.PI * 2
    for (let r = 0.1; r <= 1.0001; r += 0.05) {
      for (const w of [-width / 2, 0, width / 2]) {
        const a = a0 + w / Math.max(r, 0.2)
        out.push(Math.cos(a) * r * radius, Math.sin(a) * r * radius, (Math.random() - 0.5) * 0.05)
      }
    }
  }
  // 轂心那一團：每個方向都有點，不能被算成槳葉
  for (let k = 0; k < 24; k++) out.push(Math.cos(k / 4) * 0.12, Math.sin(k / 4) * 0.12, 0)
  return new Float32Array(out)
}

describe('從槳葉幾何數出槳葉數', () => {
  it.each([2, 3, 4, 5])('%i 片', (n) => {
    expect(countBlades(blades(n, 1.7), 1.7)).toBe(n)
  })

  /** 【跨過 ±180°】有一片剛好落在 atan2 的接縫上，不能被拆成兩片 */
  it('有一片跨在 ±180° 的接縫上', () => {
    expect(countBlades(blades(3, 1.5, Math.PI), 1.5)).toBe(3)
    expect(countBlades(blades(4, 1.5, Math.PI - 0.02), 1.5)).toBe(4)
  })

  it('沒有槳葉頂點時退回 3 片', () => {
    expect(countBlades(new Float32Array([0, 0, 0, 0.1, 0, 0]), 1.7)).toBe(3)
  })
})
