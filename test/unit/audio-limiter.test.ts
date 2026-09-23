import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  LIMITER_CEILING, LIMITER_CEILING_DB, LIMITER_LOOKAHEAD, LIMITER_RELEASE,
  limiterStep, limiterTarget, lookaheadFrames, releaseCoeff,
} from '../../src/audio/limiter'

/**
 * # 主匯流排的限幅器
 *
 * 守的是「任何場面都不破音」。真正的處理在 `public/audio/limiter.js`
 * （另一個執行緒、不能 import），所以這一支測 `src/audio/limiter.ts` 的同一套
 * 公式，另外用原始碼比對確認兩邊沒有走鐘。
 */

describe('限幅器的增益', () => {
  it('沒超過天花板就不動', () => {
    expect(limiterTarget(0.1)).toBe(1)
    expect(limiterTarget(LIMITER_CEILING)).toBe(1)
    expect(limiterTarget(0)).toBe(1)
  })

  /** 【超過就剛好壓到天花板】壓過頭是把大場面弄小聲，壓不夠就是破音 */
  it('超過時壓到剛好等於天花板', () => {
    for (const peak of [0.9, 1, 2, 8]) {
      expect(peak * limiterTarget(peak)).toBeCloseTo(LIMITER_CEILING, 12)
    }
  })

  it('天花板低於 0 dBFS，留給樣本間的真峰值', () => {
    expect(LIMITER_CEILING_DB).toBeLessThanOrEqual(-1)
    expect(LIMITER_CEILING).toBeCloseTo(10 ** (LIMITER_CEILING_DB / 20), 12)
  })

  /** 【降立刻、升要慢】兩邊都平滑的話峰值會漏過去 */
  it('降到位是一步，回升照釋放係數', () => {
    const c = releaseCoeff(LIMITER_RELEASE, 48000)
    expect(limiterStep(1, 0.4, c)).toBe(0.4)
    const up = limiterStep(0.4, 1, c)
    expect(up).toBeGreaterThan(0.4)
    expect(up).toBeLessThan(1)
  })

  /** 一個釋放時間常數走完約 63%（1 − 1/e） */
  it('一個時間常數之後回到目標的約 63%', () => {
    const sr = 48000
    const c = releaseCoeff(LIMITER_RELEASE, sr)
    let g = 0
    for (let i = 0; i < Math.round(LIMITER_RELEASE * sr); i++) g = limiterStep(g, 1, c)
    expect(g).toBeCloseTo(1 - 1 / Math.E, 2)
  })

  it('釋放係數在合理範圍，壞參數不炸', () => {
    expect(releaseCoeff(LIMITER_RELEASE, 48000)).toBeGreaterThan(0.99)
    expect(releaseCoeff(LIMITER_RELEASE, 48000)).toBeLessThan(1)
    expect(releaseCoeff(0, 48000)).toBe(0)
    expect(releaseCoeff(LIMITER_RELEASE, 0)).toBe(0)
  })

  /** 【緩衝至少一格】0 格時讀寫指標重疊，輸出會變成沒有延遲的原訊號 */
  it('預看格數至少 1', () => {
    expect(lookaheadFrames(LIMITER_LOOKAHEAD, 48000)).toBe(240)
    expect(lookaheadFrames(0, 48000)).toBe(1)
  })

  /**
   * 【真正的驗收】餵一段會破表的訊號，跑完整條「預看 → 取窗內峰值 → 壓」的
   * 流程，輸出不得超過天花板。這一條抓的是公式組合起來會不會漏峰值。
   */
  it('模擬一整段：輸出不超過天花板', () => {
    const sr = 48000
    const n = lookaheadFrames(LIMITER_LOOKAHEAD, sr)
    const c = releaseCoeff(LIMITER_RELEASE, sr)
    const buf = new Float32Array(n)
    let gain = 1
    let write = 0
    let out = 0
    const input = new Float32Array(sr / 10)
    for (let i = 0; i < input.length; i++) {
      // 平時小聲，中間插一串爆表的瞬態
      const base = 0.2 * Math.sin((2 * Math.PI * 220 * i) / sr)
      input[i] = i > 2000 && i < 2400 ? base + 3.5 * Math.sin((2 * Math.PI * 1500 * i) / sr) : base
    }
    // 窗內峰值用逐格掃描（與 worklet 的環狀緩衝等價，測的是公式不是效能）
    for (let i = 0; i < input.length; i++) {
      const delayed = buf[write]!
      buf[write] = input[i]!
      write = (write + 1) % n
      let peak = 0
      for (let k = 0; k < n; k++) peak = Math.max(peak, Math.abs(buf[k]!))
      gain = limiterStep(gain, limiterTarget(peak), c)
      out = Math.max(out, Math.abs(delayed * gain))
    }
    // 1e-6 是浮點捨入；天花板本身還留著 0.5 dB 的真峰值餘裕
    expect(out).toBeLessThanOrEqual(LIMITER_CEILING + 1e-6)
  })
})

/**
 * 【兩份實作不得走鐘】worklet 在另一個執行緒，import 不進去，所以公式是抄的。
 * 這一條讀原始碼比對那幾個常數與式子 —— 改一邊沒改另一邊的症狀是「測試全過
 * 但遊戲照樣破音」。
 */
describe('worklet 與純函數同一套公式', () => {
  const SRC = new TextDecoder().decode(readFileSync('public/audio/limiter.js'))

  it('天花板、釋放、預看三個數字一致', () => {
    expect(SRC).toContain(`const CEILING_DB = ${LIMITER_CEILING_DB}`)
    expect(SRC).toContain(`const RELEASE = ${LIMITER_RELEASE}`)
    expect(SRC).toContain(`const LOOKAHEAD = ${LIMITER_LOOKAHEAD}`)
  })

  it('降立刻、升照係數這一條在 worklet 裡', () => {
    expect(SRC).toContain('target < gain ? target : target + (gain - target) * this.coeff')
  })

  /** 【收到 reset 要清緩衝】暫停與換場靠它，不清就會漏出舊聲音 */
  it('有 reset 訊息的處理', () => {
    expect(SRC).toContain("this.port.onmessage")
    expect(SRC).toContain('reset')
  })
})

/**
 * 接線護欄 —— 讀 `engine.ts` 的原始碼。
 *
 * 限幅器在鏈路最後一道，壞掉的症狀是**整場沒有聲音**，而且不報錯。
 */
describe('限幅器的接線', () => {
  const SRC = new TextDecoder().decode(readFileSync('src/audio/engine.ts')).replace(/\r\n/g, '\n')

  it('接在淡入之後、喇叭之前', () => {
    expect(SRC).toContain('fade.connect(node)')
    expect(SRC).toContain('node.connect(ctx.destination)')
  })

  /** 【載入失敗要直通】不插節點，鏈路維持 fade → destination */
  it('載入失敗只是不插節點', () => {
    expect(SRC).toMatch(/addModule\(assetUrl\('\/audio\/limiter\.js'\)\)[\s\S]*catch\(\(\) => \{ limiter = null \}\)/)
  })

  /** 【執行期失敗也要旁路】processorerror 之後那個節點永遠輸出靜音 */
  it('processorerror 之後把節點拆掉、接回喇叭', () => {
    const at = SRC.indexOf('node.onprocessorerror')
    expect(at).toBeGreaterThan(0)
    const body = SRC.slice(at, at + 260)
    expect(body).toContain('fade.disconnect()')
    expect(body).toContain('fade.connect(ctx.destination)')
  })

  /** 【恢復與換場都要清緩衝】不清就會漏出乘過舊增益的那幾毫秒 */
  it('恢復與 stopAll 都送 reset', () => {
    expect(SRC).toContain("limiter?.port.postMessage('reset')")
    const resume = SRC.slice(SRC.indexOf('function applyRunState'), SRC.indexOf('function fadeIn'))
    expect(resume).toContain('resetLimiter()')
    const stop = SRC.slice(SRC.indexOf('function stopAll'), SRC.indexOf('async function loadAll'))
    expect(stop).toContain('resetLimiter()')
  })
})
