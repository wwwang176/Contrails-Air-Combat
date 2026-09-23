import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  LIMITER_ATTACK, LIMITER_CEILING, LIMITER_CEILING_DB, LIMITER_LOOKAHEAD, LIMITER_RELEASE,
  WindowPeak, limiterStep, limiterTarget, lookaheadFrames, releaseCoeff,
} from '../../src/audio/limiter'
import { DECORRELATE_WINDOW, decorrelateDelay } from '../../src/audio/pick'

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

  /**
   * 【降得快、升得慢】降那一邊也要平滑 —— 一個取樣之間拉掉一兩 dB 會在波形上
   * 留折角，低頻聽起來就是破音。但降的速度要比升快得多。
   */
  it('降與升都是平滑的，而降得快得多', () => {
    const rel = releaseCoeff(LIMITER_RELEASE, 48000)
    const att = releaseCoeff(LIMITER_ATTACK, 48000)
    const down = limiterStep(1, 0.4, rel, att)
    expect(down).toBeLessThan(1)
    expect(down).toBeGreaterThan(0.4)
    const up = limiterStep(0.4, 1, rel, att)
    expect(up).toBeGreaterThan(0.4)
    expect(up).toBeLessThan(1)
    // 同樣的差距，降走掉的比升多一個量級
    expect(1 - down).toBeGreaterThan((up - 0.4) * 10)
  })

  /** 【起音要在預看之內走完】走不完的話峰值抵達時增益還沒降到位 */
  it('六個起音常數等於一個預看窗', () => {
    expect(LIMITER_ATTACK * 6).toBeCloseTo(LIMITER_LOOKAHEAD, 9)
    const att = releaseCoeff(LIMITER_ATTACK, 48000)
    let g = 1
    for (let i = 0; i < lookaheadFrames(LIMITER_LOOKAHEAD, 48000); i++) g = limiterStep(g, 0.25, 0, att)
    expect(g).toBeLessThan(0.253)
  })

  /** 一個釋放時間常數走完約 63%（1 − 1/e） */
  it('一個時間常數之後回到目標的約 63%', () => {
    const sr = 48000
    const c = releaseCoeff(LIMITER_RELEASE, sr)
    let g = 0
    for (let i = 0; i < Math.round(LIMITER_RELEASE * sr); i++) g = limiterStep(g, 1, c, 0)
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
    const att = releaseCoeff(LIMITER_ATTACK, sr)
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
      gain = limiterStep(gain, limiterTarget(peak), c, att)
      out = Math.max(out, Math.abs(delayed * gain))
    }
    // 【起音平滑會留一點點超出】六個時間常數之後還差 0.25%，而天花板本身
    // 留著 0.5 dB 的真峰值餘裕 —— 1% 的超出仍在 0 dBFS 之下
    expect(out).toBeLessThanOrEqual(LIMITER_CEILING * 1.01)
  })
})

/**
 * 【窗內峰值與逐格掃描一模一樣】這一格錯了，限幅器會在峰值還在窗內時就放開
 * （漏峰值），或壓著已經離開的峰值不放（整體悶掉）。
 */
describe('滑動窗最大值', () => {
  function brute(xs: Float32Array, size: number, i: number): number {
    let m = 0
    for (let k = Math.max(0, i - size + 1); k <= i; k++) m = Math.max(m, xs[k]!)
    return m
  }

  it('每一格都等於逐格掃描', () => {
    let seed = 7
    const rand = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (const size of [1, 2, 5, 240]) {
      const xs = new Float32Array(3000)
      // 混著遞增、遞減、平台與突刺 —— 單調佇列的每一條分支都要走到
      for (let i = 0; i < xs.length; i++) {
        const phase = Math.floor(i / 300) % 4
        xs[i] = phase === 0 ? i % 300 / 300 : phase === 1 ? 1 - i % 300 / 300 : phase === 2 ? 0.5 : rand() ** 4
      }
      const w = new WindowPeak(size)
      for (let i = 0; i < xs.length; i++) {
        expect(w.push(xs[i]!), `size ${size} i ${i}`).toBe(brute(xs, size, i))
      }
    }
  })

  it('清掉之後從頭開始，不記得舊的峰值', () => {
    const w = new WindowPeak(10)
    w.push(0.9)
    w.clear()
    expect(w.push(0.1)).toBeCloseTo(0.1, 6)
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

  it('降與升的兩個係數都在 worklet 裡', () => {
    expect(SRC).toContain('const ATTACK = LOOKAHEAD / 6')
    expect(SRC).toContain('target + (gain - target) * (target < gain ? this.attack : this.coeff)')
  })

  /** 【窗內峰值用單調佇列】逐格掃描在音訊執行緒上量得到；兩份的核心兩行要一樣 */
  it('窗內峰值與純函數同一套單調佇列', () => {
    expect(SRC).toContain('while (this.count > 0 && this.ats[this.head] <= this.n - size)')
    expect(SRC).toContain('if (this.vals[back] > mag) break')
    expect(SRC).not.toMatch(/for \(let k = 0; k < this\.size; k\+\+\)/)
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

/**
 * 同一個檔案同時播兩份是完全同相，直接 +6 dB。錯開幾毫秒之後約 +3 dB。
 *
 * 【不動起始位置】跳掉開頭會裁掉起音 —— `hit-1` 的峰值就在前 15 ms 裡。
 */
describe('同檔去相關', () => {
  it('錯開的長度在 3–12 ms', () => {
    expect(decorrelateDelay(() => 0)).toBeCloseTo(0.003, 9)
    expect(decorrelateDelay(() => 1)).toBeCloseTo(0.012, 9)
    expect(DECORRELATE_WINDOW).toBeGreaterThan(0.012)
  })

  it('接線：同一檔在窗內的第二份才延後，而且沒有動起始位置', () => {
    const SRC = new TextDecoder().decode(readFileSync('src/audio/engine.ts')).replace(/\r\n/g, '\n')
    expect(SRC).toContain('DECORRELATE_WINDOW')
    expect(SRC).toContain('decorrelateDelay(Math.random)')
    // `offset` 是 three 的起始位置；一次性音效不得碰它
    const play = SRC.slice(SRC.indexOf('function playFile'), SRC.indexOf('function playPool'))
    expect(play).not.toContain('.offset')
  })
})
