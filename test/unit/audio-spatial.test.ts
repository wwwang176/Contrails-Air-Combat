import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { azimuthDeg, equalPowerMatrix, inverseDistanceGain, type ListenerPose } from '../../src/audio/pan'

/**
 * # 定位：自己算左右，不用 `PannerNode`
 *
 * 音訊執行緒算不完時，瀏覽器塞靜音補上 —— 聽起來是一陣劈啪，輸出峰值卻完全
 * 不變。`PannerNode` 的位置一動就逐取樣重算方位（離線實測 40 條聲道：three
 * 預設的漸變 67%、直接設值 19～41%、自己算交給增益 10～15%）。
 *
 * 公式照 Web Audio 規格，**與 Chrome 的 PannerNode 對拍過**（134 組含邊界情況，
 * 最大誤差 1e-6）。這裡守的是那幾個一看就知道對錯的點。
 */

/** 站在原點、面向 −z、頭頂 +y —— three 鏡頭的預設 */
const POSE: ListenerPose = { px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 }

describe('方位角', () => {
  it('正前 0、正右 +90、正左 −90、正後 ±180', () => {
    expect(azimuthDeg(0, 0, -10, POSE)).toBeCloseTo(0, 9)
    expect(azimuthDeg(10, 0, 0, POSE)).toBeCloseTo(90, 9)
    expect(azimuthDeg(-10, 0, 0, POSE)).toBeCloseTo(-90, 9)
    expect(Math.abs(azimuthDeg(0, 0, 10, POSE))).toBeCloseTo(180, 9)
  })

  /** 【高度不影響左右】正前上方仍是正前 */
  it('只看水平面上的方向', () => {
    expect(azimuthDeg(0, 50, -10, POSE)).toBeCloseTo(0, 9)
    expect(azimuthDeg(10, -30, 0, POSE)).toBeCloseTo(90, 9)
  })

  /** 【重合與正上方是 0】不處理的話是 0/0 —— NaN 進增益，那一聲整個沒了 */
  it('重合、正上、正下都是 0，不是 NaN', () => {
    expect(azimuthDeg(0, 0, 0, POSE)).toBe(0)
    expect(azimuthDeg(0, 50, 0, POSE)).toBe(0)
    expect(azimuthDeg(0, -50, 0, POSE)).toBe(0)
  })

  /** 【跟著鏡頭轉】鏡頭向右轉 90°（面向 +x），原本右邊的東西變成正前 */
  it('聽者轉向時方位跟著轉', () => {
    const turned = { ...POSE, fx: 1, fz: 0 }
    expect(azimuthDeg(10, 0, 0, turned)).toBeCloseTo(0, 9)
    expect(azimuthDeg(0, 0, 10, turned)).toBeCloseTo(90, 9)
  })
})

describe('equal-power 矩陣', () => {
  const m = new Float32Array(4)

  /** 【單聲道在正中間是兩邊各 √½】不是各 1 —— 各 1 的話正前方的聲音大 3 dB */
  it('單聲道：正中間兩邊各 √½，正右只有右聲道', () => {
    equalPowerMatrix(0, false, 1, m)
    expect(m[0]).toBeCloseTo(Math.SQRT1_2, 6)
    expect(m[2]).toBeCloseTo(Math.SQRT1_2, 6)
    equalPowerMatrix(90, false, 1, m)
    expect(m[0]).toBeCloseTo(0, 6)
    expect(m[2]).toBeCloseTo(1, 6)
  })

  /** 【立體聲在正中間原樣通過】與單聲道是兩套公式；套錯的話引擎聲整個小 3 dB */
  it('立體聲：正中間原樣通過，偏右時左聲道的一部分倒進右邊', () => {
    equalPowerMatrix(0, true, 1, m)
    ;[1, 0, 0, 1].forEach((v, i) => expect(m[i]).toBeCloseTo(v, 6))
    equalPowerMatrix(90, true, 1, m)
    expect(m[0]).toBeCloseTo(0, 6)
    expect(m[2]).toBeCloseTo(1, 6)
    expect(m[3]).toBe(1)
  })

  it('前後對折：正後方與正前方一樣，右後與右前一樣', () => {
    const a = new Float32Array(4)
    equalPowerMatrix(180, false, 1, m)
    equalPowerMatrix(0, false, 1, a)
    expect(Array.from(m)).toEqual(Array.from(a))
    equalPowerMatrix(150, true, 1, m)
    equalPowerMatrix(30, true, 1, a)
    expect(Array.from(m)).toEqual(Array.from(a))
  })

  it('整個矩陣乘上距離衰減', () => {
    equalPowerMatrix(0, false, 0.5, m)
    expect(m[0]).toBeCloseTo(0.5 * Math.SQRT1_2, 6)
  })
})

describe('反比距離衰減', () => {
  it('ref 以內不衰減，兩倍 ref 剩一半', () => {
    expect(inverseDistanceGain(10, 80, 1)).toBe(1)
    expect(inverseDistanceGain(160, 80, 1)).toBeCloseTo(0.5, 12)
  })

  it('rolloff 0 或沒有 ref 都不衰減', () => {
    expect(inverseDistanceGain(5000, 80, 0)).toBe(1)
    expect(inverseDistanceGain(5000, 0, 1)).toBe(1)
  })
})

describe('接線', () => {
  const ENGINE = new TextDecoder().decode(readFileSync('src/audio/engine.ts')).replace(/\r\n/g, '\n')
  const SPATIAL = new TextDecoder().decode(readFileSync('src/audio/spatial.ts'))

  /** 【不能換回 three 的】換回去的話每一幀又是一整排位置漸變 */
  it('engine 建的是自己算左右的聲道與不寫位置的 listener', () => {
    expect(ENGINE).toContain('new SilentListener()')
    expect(ENGINE).toContain('new PannedAudio(listener)')
    expect(ENGINE).not.toMatch(/new (AudioListener|PositionalAudio)\(/)
    expect(SPATIAL).not.toContain('createPanner')
  })

  /** 【listener 不寫位置】沒有 panner 讀它，three 預設每幀排的九條漸變是白做的 */
  it('listener 不碰位置參數', () => {
    const body = SPATIAL.slice(SPATIAL.indexOf('class SilentListener'), SPATIAL.indexOf('const ROUTES'))
    expect(body).not.toMatch(/positionX|forwardX|upX|setPosition|setOrientation/)
  })

  /** 【鏡頭的朝向每幀讀】少了這一步，轉頭之後左右不會跟著變 */
  it('每幀先讀鏡頭再更新聲道', () => {
    const begin = ENGINE.slice(ENGINE.indexOf('function beginFrame('), ENGINE.indexOf('function assign('))
    expect(begin).toMatch(/readPose\(\)\n\s*updateVoices\(dt\)/)
  })

  /** 【循環音也要逐幀更新左右】飛機一直在動 */
  it('循環音每次指派都更新左右', () => {
    const fn = ENGINE.slice(ENGINE.indexOf('function assign('), ENGINE.indexOf('function endFrame('))
    expect(fn).toContain('pan(v.audio, true, d,')
  })

  /**
   * 【沒在響的拔掉出口】瀏覽器處理每一個接到喇叭上的節點，不管有沒有聲音
   * （離線實測 84 條閒置聲道 7～19%，拔掉的 0.05%）。反過來，播之前忘了接回去
   * 就是整條斷的 —— 沒有聲音也不報錯，所以接回去寫在 `play` 裡面。
   */
  it('播之前一定接上出口，播完、放掉、換場都拔掉', () => {
    const play = SPATIAL.slice(SPATIAL.indexOf('override play('), SPATIAL.indexOf('wake(): void'))
    expect(play).toMatch(/this\.wake\(\)\n\s*super\.play\(delay\)/)
    const update = ENGINE.slice(ENGINE.indexOf('function updateVoices('), ENGINE.indexOf('function beginFrame('))
    expect(update).toMatch(/if \(!v\.audio\.isPlaying && v\.waitingSince < 0\) \{\n\s*v\.audio\.sleep\(\)/)
    const end = ENGINE.slice(ENGINE.indexOf('function endFrame('), ENGINE.indexOf('function meter('))
    expect(end).toMatch(/v\.audio\.stop\(\)\n\s*v\.audio\.sleep\(\)/)
    const stop = ENGINE.slice(ENGINE.indexOf('function stopAll('), ENGINE.indexOf('for (const slot of Object.keys(selves)'))
    expect(stop.match(/v\.audio\.sleep\(\)/g)).toHaveLength(2)
  })

  /** 【變動夠大才排】距離每幀都在變，照排的話兩級低通一直走逐取樣重算係數 */
  it('截止頻率變動小於門檻就不重排', () => {
    const fn = ENGINE.slice(ENGINE.indexOf('function setCutoff('), ENGINE.indexOf('const voices: Voice[]'))
    expect(fn).toContain('if (ramp > 0 && Math.abs(hz - v.cutoff) <= v.cutoff * CUTOFF_STEP) return')
    expect(fn).toContain('v.cutoff = hz')
  })
})
